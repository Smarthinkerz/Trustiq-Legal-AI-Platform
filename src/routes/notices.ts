import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Db, Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { noticeMessages, normalizeNotice } from '../services/ai-read'
import { GULF_TODAY } from '../services/credentials'
import { parseJsonObject } from '../services/legal-prompts'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { caseActivity } from './cases'
import { matterDocumentText } from './judgments'

// ---------------------------------------------------------------------------
// Legal notices (الإنذارات والإخطارات): notices sent to the other side or
// received from it, how and when each was served, and the response period,
// kept on the calendar until the notice is answered or closed.
// ---------------------------------------------------------------------------

export const DIRECTIONS = ['outgoing', 'incoming'] as const
export const METHODS = ['notary', 'court_bailiff', 'courier', 'registered_mail', 'email', 'whatsapp', 'hand', 'other'] as const
export const STATUSES = ['sent', 'delivered', 'responded', 'no_response', 'failed', 'withdrawn', 'closed'] as const
const OPEN = ['sent', 'delivered']
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
// Empty form fields mean "not set", never zero.
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())

const fields = {
  direction: z.enum(DIRECTIONS).default('outgoing'),
  party: z.string().trim().min(1).max(300),
  subject: z.string().trim().min(2).max(500),
  method: z.enum(METHODS).default('notary'),
  reference_no: optText(100),
  notice_date: day,
  delivered_on: optDay,
  response_days: optNumber(z.coerce.number().int().min(1).max(365)),
  response_due: optDay,
  status: z.enum(STATUSES).optional(),
  response_on: optDay,
  response_summary: optText(5000),
  amount: optNumber(z.coerce.number().min(0).max(1e13)),
  currency: z.enum(CURRENCIES).nullish(),
  document_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(5000)
}

const COLS = `n.id, n.case_id, n.direction, n.party, n.subject, n.method, n.reference_no, to_char(n.notice_date, 'YYYY-MM-DD') AS notice_date,
  to_char(n.delivered_on, 'YYYY-MM-DD') AS delivered_on, n.response_days, to_char(n.response_due, 'YYYY-MM-DD') AS response_due, n.status,
  to_char(n.response_on, 'YYYY-MM-DD') AS response_on, n.response_summary, n.amount::float8 AS amount, n.currency, n.document_id, d.title AS document_title,
  n.deadline_event_id, n.notes, n.created_at, n.updated_at, (n.response_due - ${GULF_TODAY})::int AS days_left`
const FROM = 'legal_notices n LEFT JOIN documents d ON d.id = n.document_id'

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// The response period runs from delivery (or, without a delivery date, from the notice date).
export function responseDue(n: { notice_date: string; delivered_on: string | null; response_days: number | null; response_due?: string | null }, explicit: boolean) {
  if (explicit) return n.response_due ?? null
  return n.response_days ? addDays(n.delivered_on ?? n.notice_date, n.response_days) : n.response_due ?? null
}

// Delivery and a recorded response move the status forward unless it was set by hand.
export function nextStatus(cur: string, n: { delivered_on: string | null; response_on: string | null }) {
  if (n.response_on && OPEN.includes(cur)) return 'responded'
  if (n.delivered_on && cur === 'sent') return 'delivered'
  return cur
}

async function loadNotice(db: Db, orgId: string, id: string): Promise<any> {
  const n = await db.one(`SELECT ${COLS}, k.reference FROM ${FROM} JOIN cases k ON k.id = n.case_id WHERE n.id = $1 AND n.org_id = $2`, [id, orgId])
  if (!n) throw notFound('Notice')
  return n
}

// Keeps the response deadline on the calendar while the notice is open.
async function syncDeadline(q: Queryable, o: { orgId: string; userId: string; reference: string; n: any }) {
  const n = o.n
  const open = !!n.response_due && OPEN.includes(n.status)
  const title = n.direction === 'incoming' ? `Reply to notice due – ${o.reference}` : `Notice response period ends – ${o.reference}`
  const note = n.direction === 'incoming'
    ? `Last day to reply to the notice from ${n.party}: ${n.subject}`
    : `The period given to ${n.party} to respond ends. Decide the next step (claim, payment order, follow-up). Notice: ${n.subject}`
  if (n.deadline_event_id) {
    if (!n.response_due) {
      await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [n.deadline_event_id, o.orgId])
      await q.query('UPDATE legal_notices SET deadline_event_id = NULL WHERE id = $1', [n.id])
      return
    }
    await q.query(
      `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4, notes = $5,
              completed_at = CASE WHEN $6::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now()
        WHERE id = $1 AND org_id = $2`, [n.deadline_event_id, o.orgId, n.response_due, title, note, open])
    return
  }
  if (!n.response_due) return
  const [e] = await q.query(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
     VALUES ($1, $2, $3, 'deadline', ($4::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7) RETURNING id`,
    [o.orgId, n.case_id, title, n.response_due, note, open, o.userId])
  await q.query('UPDATE legal_notices SET deadline_event_id = $2 WHERE id = $1', [n.id, e.id])
}

async function checkDocument(db: Queryable, orgId: string, caseId: string, documentId: string | null | undefined) {
  if (!documentId) return
  if (!(await db.query('SELECT 1 FROM documents WHERE id = $1 AND org_id = $2 AND case_id = $3', [documentId, orgId, caseId])).length) {
    throw badRequest('Choose a document from this matter.')
  }
}

function checkDates(n: { notice_date: string; delivered_on: string | null; response_due: string | null; response_on: string | null }) {
  if (n.delivered_on && n.delivered_on < n.notice_date) throw badRequest('The delivery date is before the notice date.')
  if (n.response_due && n.response_due < n.notice_date) throw badRequest('The response deadline is before the notice date.')
  if (n.response_on && n.response_on < n.notice_date) throw badRequest('The response date is before the notice date.')
}

const noticeRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

noticeRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.one('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id]))) throw notFound('Case')
  const items = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE n.case_id = $1 AND n.org_id = $2 ORDER BY n.notice_date DESC, n.created_at DESC`, [id, org.id])
  return c.json({ items })
})

noticeRoutes.post('/case/:id', jsonBody(z.object(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await db.one('SELECT id, reference, currency FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!k) throw notFound('Case')
  await checkDocument(db, org.id, k.id, b.document_id)
  const due = responseDue(b, b.response_due != null && !b.response_days)
  const status = nextStatus(b.status ?? 'sent', b)
  checkDates({ ...b, response_due: due })
  const row = await db.tx(async (q) => {
    const n = await q.one(
      `INSERT INTO legal_notices (org_id, case_id, direction, party, subject, method, reference_no, notice_date, delivered_on, response_days, response_due,
                                  status, response_on, response_summary, amount, currency, document_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [org.id, k.id, b.direction, b.party, b.subject, b.method, b.reference_no, b.notice_date, b.delivered_on, b.response_days, due,
        status, b.response_on, b.response_summary, b.amount, b.amount != null ? b.currency ?? k.currency : null, b.document_id, b.notes, user.id])
    await syncDeadline(q, { orgId: org.id, userId: user.id, reference: k.reference, n: { ...b, id: n!.id, case_id: k.id, response_due: due, status, deadline_event_id: null } })
    await caseActivity(q, org.id, k.id, user.id, 'notice',
      `${b.direction === 'incoming' ? 'Notice received from' : 'Notice sent to'} ${b.party} on ${b.notice_date}: ${b.subject}`)
    return n!
  })
  await audit(c, 'notice.created', 'case', k.id, { notice: row.id, direction: b.direction })
  return c.json({ notice: await loadNotice(db, org.id, row.id) }, 201)
})

noticeRoutes.patch('/:id', jsonBody(updateBody(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Notice')
  const b = c.req.valid('json') as Partial<Record<keyof typeof fields, any>>
  const { db } = c.get('deps')
  const cur = await loadNotice(db, org.id, id)
  const m: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) m[k] = v
  await checkDocument(db, org.id, cur.case_id, b.document_id)
  // A changed period or delivery recomputes the deadline; a date typed in wins.
  const recompute = b.response_days !== undefined || b.delivered_on !== undefined || b.notice_date !== undefined
  m.response_due = b.response_due !== undefined && !b.response_days ? b.response_due : recompute ? responseDue(m, false) : cur.response_due
  m.status = b.status ?? nextStatus(cur.status, { delivered_on: b.delivered_on !== undefined ? m.delivered_on : null, response_on: b.response_on !== undefined ? m.response_on : null })
  if (m.amount == null) m.currency = null
  else m.currency = m.currency ?? (await db.one('SELECT currency FROM cases WHERE id = $1', [cur.case_id]))!.currency
  checkDates(m)
  await db.tx(async (q) => {
    await q.query(
      `UPDATE legal_notices SET direction = $3, party = $4, subject = $5, method = $6, reference_no = $7, notice_date = $8, delivered_on = $9, response_days = $10,
              response_due = $11, status = $12, response_on = $13, response_summary = $14, amount = $15, currency = $16, document_id = $17, notes = $18, updated_at = now()
        WHERE id = $1 AND org_id = $2`,
      [id, org.id, m.direction, m.party, m.subject, m.method, m.reference_no, m.notice_date, m.delivered_on, m.response_days, m.response_due, m.status,
        m.response_on, m.response_summary, m.amount, m.currency, m.document_id, m.notes])
    await syncDeadline(q, { orgId: org.id, userId: user.id, reference: cur.reference, n: m })
    if (m.status !== cur.status) await caseActivity(q, org.id, cur.case_id, user.id, 'notice', `Notice to/from ${m.party}: ${cur.status} → ${m.status}`)
  })
  await audit(c, 'notice.updated', 'case', cur.case_id, { notice: id, status: m.status })
  return c.json({ notice: await loadNotice(db, org.id, id) })
})

noticeRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Notice')
  const { db } = c.get('deps')
  const cur = await loadNotice(db, org.id, id)
  await db.tx(async (q) => {
    if (cur.deadline_event_id) await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [cur.deadline_event_id, org.id])
    await q.query('DELETE FROM legal_notices WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'notice.deleted', 'case', cur.case_id, { notice: id })
  return c.json({ ok: true })
})

// Firm-wide register: open notices by response deadline, or everything.
noticeRoutes.get('/register', queryParams(z.object({
  show: z.enum(['open', 'all']).default('open'),
  direction: z.enum(['all', ...DIRECTIONS]).default('all'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = await db.query(
    `SELECT ${COLS}, k.reference, k.title AS case_title, cl.name AS client_name, u.name AS lawyer_name
       FROM ${FROM} JOIN cases k ON k.id = n.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE n.org_id = $1 AND ($2 = 'all' OR n.direction = $2) AND ($3 = 'all' OR n.status IN ('sent', 'delivered'))
      ORDER BY (n.status IN ('sent', 'delivered')) DESC, n.response_due NULLS LAST, n.notice_date DESC LIMIT 5000`, [org.id, q.direction, q.show])
  if (q.format === 'csv') {
    await audit(c, 'notice.register_exported', 'organization', org.id, { rows: rows.length })
    const csv = toCsv([
      ['Reference', 'Matter', 'Client', 'Direction', 'Party', 'Subject', 'Method', 'Notice ref.', 'Notice date', 'Delivered', 'Response days', 'Response due',
        'Status', 'Response date', 'Amount', 'Currency', 'Lawyer'],
      ...rows.map((n: any) => [n.reference, n.case_title, n.client_name ?? '', n.direction, n.party, n.subject, n.method, n.reference_no ?? '', n.notice_date,
        n.delivered_on ?? '', n.response_days ?? '', n.response_due ?? '', n.status, n.response_on ?? '', n.amount ?? '', n.currency ?? '', n.lawyer_name ?? ''])
    ])
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="legal-notices.csv"', 'cache-control': 'private, no-store' } })
  }
  const open = rows.filter((n: any) => OPEN.includes(n.status))
  return c.json({
    items: rows,
    counts: {
      open: open.length,
      due_soon: open.filter((n: any) => n.response_due && n.days_left >= 0 && n.days_left <= 7).length,
      overdue: open.filter((n: any) => n.response_due && n.days_left < 0).length
    }
  })
})


// Reads a notice on the matter (its extracted or OCR text) into the form's fields. Nothing is saved.
noticeRoutes.post('/case/:id/read', jsonBody(z.object({ document_id: z.string().uuid() })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { user, org } = auth(c)
  const { db, ai } = c.get('deps')
  const [k] = await db.query('SELECT k.id, k.opposing_party, cl.name AS client_name FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.id = $1 AND k.org_id = $2',
    [uuidParam(c.req.param('id'), 'Case'), org.id])
  if (!k) throw notFound('Case')
  const text = await matterDocumentText(db, org.id, k.id, c.req.valid('json').document_id)
  await assertCanUseAi(db, org)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
  const result = await ai.complete({ messages: noticeMessages(text, { client: k.client_name, today }), json: true, maxTokens: 900, temperature: 0 })
  await recordAiUsage(db, org.id, user.id, 'notice_read', result)
  try {
    return c.json({ fields: normalizeNotice(parseJsonObject(result.text)) })
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI could not read this document. Please type the details.')
  }
})

export default noticeRoutes
