import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Db, Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { addDays, EXPERT_TYPES, FEE_PAYERS, nextDeadline, RESULTS, stage, syncExpertEvents, type Referral } from '../services/experts'
import { caseActivity } from './cases'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
// Empty form fields mean "not set", never zero.
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())

const fields = {
  expert_name: optText(300),
  expert_type: z.enum(EXPERT_TYPES).default('accounting'),
  expert_contact: optText(300),
  court_ref: optText(100),
  referral_date: day,
  scope: optText(5000),
  fee_amount: optNumber(z.coerce.number().min(0).max(1e13)),
  currency: z.enum(CURRENCIES).nullish(),
  fee_payer: z.enum(FEE_PAYERS).default('client'),
  fee_due: optDay,
  fee_paid_on: optDay,
  memo_due: optDay,
  report_due: optDay,
  report_filed_on: optDay,
  report_document_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  report_result: z.enum(RESULTS).nullish().or(z.literal('')).transform((v) => v || null),
  report_summary: optText(5000),
  objection_days: optNumber(z.coerce.number().int().min(1).max(365)),
  objection_due: optDay,
  objections_filed_on: optDay,
  closed: z.boolean().default(false),
  notes: optText(5000)
}
type Fields = z.infer<z.ZodObject<typeof fields>>

const DATE_COLS = ['referral_date', 'fee_due', 'fee_paid_on', 'memo_due', 'report_due', 'report_filed_on', 'objection_due', 'objections_filed_on']
const COLS = `x.id, x.case_id, x.expert_name, x.expert_type, x.expert_contact, x.court_ref, x.scope, x.fee_amount::float8 AS fee_amount, x.currency, x.fee_payer,
  ${DATE_COLS.map((c) => `to_char(x.${c}, 'YYYY-MM-DD') AS ${c}`).join(', ')},
  x.report_document_id, d.title AS report_document_title, x.report_result, x.report_summary, x.objection_days, x.closed, x.event_ids, x.notes, x.created_at, x.updated_at`
const FROM = 'expert_referrals x LEFT JOIN documents d ON d.id = x.report_document_id'

// Adds the stage and the next open deadline (with days left in Gulf time).
function present(r: any, today: string) {
  const next = nextDeadline(r as Referral)
  const daysLeft = next ? Math.round((Date.parse(next.date) - Date.parse(today)) / 86_400_000) : null
  return { ...r, stage: stage(r), next_deadline: next ? { ...next, days_left: daysLeft } : null }
}

async function gulfToday(db: Queryable) {
  const [{ d }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`)
  return d as string
}

async function loadReferral(db: Db, orgId: string, id: string): Promise<any> {
  const r = await db.one(`SELECT ${COLS}, k.reference FROM ${FROM} JOIN cases k ON k.id = x.case_id WHERE x.id = $1 AND x.org_id = $2`, [id, orgId])
  if (!r) throw notFound('Expert referral')
  return r
}

function validate(r: Fields & { objection_due: string | null }) {
  const before = (a: string | null | undefined, label: string) => { if (a && a < r.referral_date) throw badRequest(`The ${label} is before the referral date.`) }
  before(r.fee_due, 'fee deadline'); before(r.fee_paid_on, 'fee payment date'); before(r.memo_due, 'submissions deadline')
  before(r.report_due, 'report due date'); before(r.report_filed_on, 'report date')
  if (r.objections_filed_on && !r.report_filed_on) throw badRequest('Record the report date before the objections.')
  if (r.objection_due && r.report_filed_on && r.objection_due < r.report_filed_on) throw badRequest('The objections deadline is before the report date.')
}

async function checkDocument(db: Queryable, orgId: string, caseId: string, id: string | null | undefined) {
  if (id && !(await db.query('SELECT 1 FROM documents WHERE id = $1 AND org_id = $2 AND case_id = $3', [id, orgId, caseId])).length) {
    throw badRequest('Choose a document from this matter.')
  }
}

// The objections period runs from the report date unless a deadline is typed in.
const objectionDue = (r: { report_filed_on: string | null; objection_days: number | null; objection_due: string | null }, typed: boolean) =>
  typed ? r.objection_due : r.report_filed_on && r.objection_days ? addDays(r.report_filed_on, r.objection_days) : r.objection_due

async function save(q: Queryable, id: string, orgId: string, r: any) {
  await q.query(
    `UPDATE expert_referrals SET expert_name = $3, expert_type = $4, expert_contact = $5, court_ref = $6, referral_date = $7, scope = $8, fee_amount = $9, currency = $10,
            fee_payer = $11, fee_due = $12, fee_paid_on = $13, memo_due = $14, report_due = $15, report_filed_on = $16, report_document_id = $17, report_result = $18,
            report_summary = $19, objection_days = $20, objection_due = $21, objections_filed_on = $22, closed = $23, notes = $24, event_ids = $25, updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, r.expert_name, r.expert_type, r.expert_contact, r.court_ref, r.referral_date, r.scope, r.fee_amount, r.currency, r.fee_payer, r.fee_due, r.fee_paid_on,
      r.memo_due, r.report_due, r.report_filed_on, r.report_document_id, r.report_result, r.report_summary, r.objection_days, r.objection_due, r.objections_filed_on,
      r.closed, r.notes, JSON.stringify(r.event_ids ?? {})])
}

const expertRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

expertRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.one('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id]))) throw notFound('Case')
  const today = await gulfToday(db)
  const items = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE x.case_id = $1 AND x.org_id = $2 ORDER BY x.closed, x.referral_date DESC, x.created_at DESC`, [id, org.id])
  return c.json({ items: items.map((r: any) => present(r, today)) })
})

expertRoutes.post('/case/:id', jsonBody(z.object(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await db.one('SELECT id, reference, currency FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!k) throw notFound('Case')
  await checkDocument(db, org.id, k.id, b.report_document_id)
  const r: any = { ...b, currency: b.fee_amount != null ? b.currency ?? k.currency : null, event_ids: {} }
  r.objection_due = objectionDue(r, b.objection_due != null && !b.objection_days)
  validate(r)
  const newId = await db.tx(async (q) => {
    const [row] = await q.query(`INSERT INTO expert_referrals (org_id, case_id, referral_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [org.id, k.id, b.referral_date, user.id])
    r.event_ids = await syncExpertEvents(q, { orgId: org.id, userId: user.id, reference: k.reference, r: { ...r, id: row.id, case_id: k.id } })
    await save(q, row.id, org.id, r)
    await caseActivity(q, org.id, k.id, user.id, 'expert', `Expert appointed${b.expert_name ? `: ${b.expert_name}` : ''} (${b.expert_type}) on ${b.referral_date}`)
    return row.id as string
  })
  await audit(c, 'expert.created', 'case', k.id, { referral: newId })
  return c.json({ referral: present(await loadReferral(db, org.id, newId), await gulfToday(db)) }, 201)
})

expertRoutes.patch('/:id', jsonBody(updateBody(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Expert referral')
  const b = c.req.valid('json') as Partial<Record<keyof Fields, any>>
  const { db } = c.get('deps')
  const cur = await loadReferral(db, org.id, id)
  const r: any = { ...cur }
  for (const [key, v] of Object.entries(b)) if (v !== undefined) r[key] = v
  await checkDocument(db, org.id, cur.case_id, b.report_document_id)
  const typed = b.objection_due !== undefined && !b.objection_days
  r.objection_due = typed ? b.objection_due : b.objection_days !== undefined || b.report_filed_on !== undefined ? objectionDue(r, false) : cur.objection_due
  if (r.fee_amount == null) r.currency = null
  else r.currency = r.currency ?? (await db.one('SELECT currency FROM cases WHERE id = $1', [cur.case_id]))!.currency
  validate(r)
  const before = stage(cur)
  await db.tx(async (q) => {
    r.event_ids = await syncExpertEvents(q, { orgId: org.id, userId: user.id, reference: cur.reference, r })
    await save(q, id, org.id, r)
    const after = stage(r)
    if (after !== before) await caseActivity(q, org.id, cur.case_id, user.id, 'expert', `Expert referral${r.expert_name ? ` (${r.expert_name})` : ''}: ${before} → ${after}`)
  })
  await audit(c, 'expert.updated', 'case', cur.case_id, { referral: id })
  return c.json({ referral: present(await loadReferral(db, org.id, id), await gulfToday(db)) })
})

expertRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Expert referral')
  const { db } = c.get('deps')
  const cur = await loadReferral(db, org.id, id)
  await db.tx(async (q) => {
    const ids = Object.values(cur.event_ids ?? {}) as string[]
    if (ids.length) await q.query('DELETE FROM events WHERE id = ANY($1::uuid[]) AND org_id = $2 AND completed_at IS NULL', [ids, org.id])
    await q.query('DELETE FROM expert_referrals WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'expert.deleted', 'case', cur.case_id, { referral: id })
  return c.json({ ok: true })
})

// Firm-wide register of referrals, open ones first by their next deadline.
expertRoutes.get('/register', queryParams(z.object({
  show: z.enum(['open', 'all']).default('open'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const today = await gulfToday(db)
  const rows = (await db.query(
    `SELECT ${COLS}, k.reference, k.title AS case_title, k.court, cl.name AS client_name, u.name AS lawyer_name
       FROM ${FROM} JOIN cases k ON k.id = x.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE x.org_id = $1 AND ($2 = 'all' OR NOT x.closed) ORDER BY x.referral_date DESC LIMIT 5000`, [org.id, q.show])).map((r: any) => present(r, today))
  rows.sort((a: any, b: any) => (a.closed === b.closed ? 0 : a.closed ? 1 : -1) || (a.next_deadline?.date ?? '9999').localeCompare(b.next_deadline?.date ?? '9999'))
  if (q.format === 'csv') {
    await audit(c, 'expert.register_exported', 'organization', org.id, { rows: rows.length })
    const csv = toCsv([
      ['Reference', 'Matter', 'Client', 'Court', 'Expert', 'Field', 'Court ref.', 'Referred', 'Stage', 'Fee', 'Currency', 'Fee payer', 'Fee due', 'Fee paid',
        'Submissions due', 'Report due', 'Report filed', 'Result', 'Objections due', 'Objections filed', 'Next deadline', 'Lawyer'],
      ...rows.map((r: any) => [r.reference, r.case_title, r.client_name ?? '', r.court ?? '', r.expert_name ?? '', r.expert_type, r.court_ref ?? '', r.referral_date, r.stage,
        r.fee_amount ?? '', r.currency ?? '', r.fee_payer, r.fee_due ?? '', r.fee_paid_on ?? '', r.memo_due ?? '', r.report_due ?? '', r.report_filed_on ?? '',
        r.report_result ?? '', r.objection_due ?? '', r.objections_filed_on ?? '', r.next_deadline?.date ?? '', r.lawyer_name ?? ''])
    ])
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="expert-referrals.csv"', 'cache-control': 'private, no-store' } })
  }
  const open = rows.filter((r: any) => !r.closed)
  return c.json({
    items: rows,
    counts: {
      open: open.length,
      due_soon: open.filter((r: any) => r.next_deadline && r.next_deadline.days_left >= 0 && r.next_deadline.days_left <= 7).length,
      overdue: open.filter((r: any) => r.next_deadline && r.next_deadline.days_left < 0).length,
      awaiting_report: open.filter((r: any) => !r.report_filed_on).length
    }
  })
})

// Open referrals whose next deadline is within a week or passed (for the dashboard).
export async function expertDeadlinesDue(db: Queryable, orgId: string) {
  const today = await gulfToday(db)
  const rows = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE x.org_id = $1 AND NOT x.closed`, [orgId])
  return rows.map((r: any) => present(r, today)).filter((r: any) => r.next_deadline && r.next_deadline.days_left <= 7).length
}

export default expertRoutes
