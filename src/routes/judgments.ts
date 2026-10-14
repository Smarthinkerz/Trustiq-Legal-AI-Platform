import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Db, Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { caseActivity } from './cases'

// ---------------------------------------------------------------------------
// Judgments and enforcement (الأحكام والتنفيذ): what each judgment awarded, the
// appeal deadline on the calendar, the enforcement file, and what has actually
// been collected, per matter and firm-wide.
// ---------------------------------------------------------------------------

const DEGREES = ['first_instance', 'appeal', 'supreme', 'arbitration', 'other'] as const
const RESULTS = ['won', 'partial', 'lost', 'other'] as const
const APPEAL = ['pending', 'appeal', 'no_appeal', 'appealed_by_other'] as const
const ENFORCEMENT = ['not_started', 'filed', 'in_progress', 'collected', 'unenforceable', 'closed'] as const
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
const money = z.coerce.number().min(0).max(1e13)

const fields = {
  judgment_date: day,
  court: optText(300),
  degree: z.enum(DEGREES).default('first_instance'),
  judgment_no: optText(100),
  result: z.enum(RESULTS),
  summary: optText(5000),
  currency: z.enum(CURRENCIES).optional(),
  amount_awarded: money.default(0),
  costs_awarded: money.default(0),
  appeal_deadline: optDay,
  appeal_days: z.coerce.number().int().min(1).max(365).nullish(),
  appeal_decision: z.enum(APPEAL).default('pending'),
  enforcement_status: z.enum(ENFORCEMENT).default('not_started'),
  enforcement_file_no: optText(100),
  enforcement_court: optText(300)
}

const COLS = `j.id, j.case_id, to_char(j.judgment_date, 'YYYY-MM-DD') AS judgment_date, j.court, j.degree, j.judgment_no, j.result, j.summary, j.currency,
  j.amount_awarded::float8 AS amount_awarded, j.costs_awarded::float8 AS costs_awarded, to_char(j.appeal_deadline, 'YYYY-MM-DD') AS appeal_deadline, j.appeal_event_id,
  j.appeal_decision, j.enforcement_status, j.enforcement_file_no, j.enforcement_court, j.created_at, j.updated_at,
  coalesce((SELECT sum(amount) FROM judgment_collections x WHERE x.judgment_id = j.id), 0)::float8 AS collected,
  (j.appeal_deadline - ${GULF_TODAY})::int AS appeal_days_left`

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const outstanding = (j: { result: string; amount_awarded: number; costs_awarded: number; collected: number }) =>
  j.result === 'won' || j.result === 'partial' ? Math.max(0, Math.round((j.amount_awarded + j.costs_awarded - j.collected) * 1000) / 1000) : 0
const withOutstanding = <T extends { result: string; amount_awarded: number; costs_awarded: number; collected: number }>(j: T) => ({ ...j, outstanding: outstanding(j) })

async function loadJudgment(db: Db, orgId: string, id: string): Promise<any> {
  const j = await db.one(`SELECT ${COLS}, k.reference, k.title AS case_title FROM case_judgments j JOIN cases k ON k.id = j.case_id WHERE j.id = $1 AND j.org_id = $2`, [id, orgId])
  if (!j) throw notFound('Judgment')
  return j
}

// Keeps the appeal deadline on the calendar in step with the judgment.
async function syncAppealEvent(q: Queryable, o: { orgId: string; userId: string; judgment: any; reference: string }) {
  const j = o.judgment
  const open = j.appeal_deadline && (j.appeal_decision === 'pending' || j.appeal_decision === 'appeal')
  const title = `Appeal deadline – ${o.reference}`
  if (j.appeal_event_id) {
    if (!j.appeal_deadline) {
      await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [j.appeal_event_id, o.orgId])
      await q.query('UPDATE case_judgments SET appeal_event_id = NULL WHERE id = $1', [j.id])
      return
    }
    await q.query(
      `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4,
              completed_at = CASE WHEN $5::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now()
        WHERE id = $1 AND org_id = $2`, [j.appeal_event_id, o.orgId, j.appeal_deadline, title, open])
    return
  }
  if (!j.appeal_deadline) return
  const [e] = await q.query(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
     VALUES ($1, $2, $3, 'deadline', ($4::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7) RETURNING id`,
    [o.orgId, j.case_id, title, j.appeal_deadline, 'Last day to appeal the judgment. Check the period against the applicable procedure law.', open, o.userId])
  await q.query('UPDATE case_judgments SET appeal_event_id = $2 WHERE id = $1', [j.id, e.id])
}

const judgmentRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

judgmentRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.one('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id]))) throw notFound('Case')
  const items = await db.query(`SELECT ${COLS} FROM case_judgments j WHERE j.case_id = $1 AND j.org_id = $2 ORDER BY j.judgment_date DESC, j.created_at DESC`, [id, org.id])
  const ids = items.map((j: any) => j.id)
  const collections = ids.length ? await db.query(
    `SELECT x.id, x.judgment_id, to_char(x.collected_on, 'YYYY-MM-DD') AS collected_on, x.amount::float8 AS amount, x.source, x.note, u.name AS created_by_name
       FROM judgment_collections x LEFT JOIN users u ON u.id = x.created_by WHERE x.judgment_id = ANY($1::uuid[]) ORDER BY x.collected_on, x.created_at`, [ids]) : []
  return c.json({ items: items.map((j: any) => ({ ...withOutstanding(j), collections: collections.filter((x: any) => x.judgment_id === j.id) })) })
})

judgmentRoutes.post('/case/:id', jsonBody(z.object(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await db.one('SELECT id, reference, currency, court FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!k) throw notFound('Case')
  const appealDeadline = b.appeal_deadline ?? (b.appeal_days ? addDays(b.judgment_date, b.appeal_days) : null)
  if (appealDeadline && appealDeadline < b.judgment_date) throw badRequest('The appeal deadline is before the judgment date.')
  const row = await db.tx(async (q) => {
    const j = await q.one(
      `INSERT INTO case_judgments (org_id, case_id, judgment_date, court, degree, judgment_no, result, summary, currency, amount_awarded, costs_awarded,
                                   appeal_deadline, appeal_decision, enforcement_status, enforcement_file_no, enforcement_court, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id, case_id, appeal_deadline, appeal_decision, appeal_event_id`,
      [org.id, k.id, b.judgment_date, b.court ?? k.court, b.degree, b.judgment_no, b.result, b.summary, b.currency ?? k.currency, b.amount_awarded, b.costs_awarded,
        appealDeadline, b.appeal_decision, b.enforcement_status, b.enforcement_file_no, b.enforcement_court, user.id])
    await syncAppealEvent(q, { orgId: org.id, userId: user.id, judgment: { ...j, appeal_deadline: appealDeadline }, reference: k.reference })
    await caseActivity(q, org.id, k.id, user.id, 'judgment', `Judgment recorded (${b.result}) dated ${b.judgment_date}`)
    return j!
  })
  await audit(c, 'judgment.created', 'case', k.id, { judgment: row.id, result: b.result })
  return c.json({ judgment: withOutstanding(await loadJudgment(db, org.id, row.id)) }, 201)
})

judgmentRoutes.patch('/:id', jsonBody(updateBody(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Judgment')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadJudgment(db, org.id, id)
  const judgmentDate = b.judgment_date ?? cur.judgment_date
  const appealDeadline = b.appeal_days ? addDays(judgmentDate, b.appeal_days) : b.appeal_deadline !== undefined ? b.appeal_deadline : cur.appeal_deadline
  if (appealDeadline && appealDeadline < judgmentDate) throw badRequest('The appeal deadline is before the judgment date.')
  const set = (k: keyof typeof b, v: unknown) => (b[k] !== undefined ? v : (cur as any)[k])
  await db.tx(async (q) => {
    await q.query(
      `UPDATE case_judgments SET judgment_date = $3, court = $4, degree = $5, judgment_no = $6, result = $7, summary = $8, currency = $9,
              amount_awarded = $10, costs_awarded = $11, appeal_deadline = $12, appeal_decision = $13, enforcement_status = $14,
              enforcement_file_no = $15, enforcement_court = $16, updated_at = now()
        WHERE id = $1 AND org_id = $2`,
      [id, org.id, judgmentDate, set('court', b.court), set('degree', b.degree), set('judgment_no', b.judgment_no), set('result', b.result), set('summary', b.summary),
        set('currency', b.currency), set('amount_awarded', b.amount_awarded), set('costs_awarded', b.costs_awarded), appealDeadline,
        set('appeal_decision', b.appeal_decision), set('enforcement_status', b.enforcement_status), set('enforcement_file_no', b.enforcement_file_no),
        set('enforcement_court', b.enforcement_court)])
    await syncAppealEvent(q, {
      orgId: org.id, userId: user.id, reference: cur.reference,
      judgment: { id, case_id: cur.case_id, appeal_event_id: cur.appeal_event_id, appeal_deadline: appealDeadline, appeal_decision: set('appeal_decision', b.appeal_decision) }
    })
  })
  await audit(c, 'judgment.updated', 'case', cur.case_id, { judgment: id })
  return c.json({ judgment: withOutstanding(await loadJudgment(db, org.id, id)) })
})

judgmentRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Judgment')
  const { db } = c.get('deps')
  const cur = await loadJudgment(db, org.id, id)
  await db.tx(async (q) => {
    if (cur.appeal_event_id) await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [cur.appeal_event_id, org.id])
    await q.query('DELETE FROM case_judgments WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'judgment.deleted', 'case', cur.case_id, { judgment: id })
  return c.json({ ok: true })
})

judgmentRoutes.post('/:id/collections', jsonBody(z.object({
  collected_on: day, amount: z.coerce.number().positive().max(1e13), source: optText(200), note: optText(1000)
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Judgment')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadJudgment(db, org.id, id)
  if (cur.result !== 'won' && cur.result !== 'partial') throw badRequest('Collections can be recorded only for judgments in your client\'s favour.')
  await db.tx(async (q) => {
    await q.query('INSERT INTO judgment_collections (org_id, judgment_id, collected_on, amount, source, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [org.id, id, b.collected_on, b.amount, b.source, b.note, user.id])
    // Fully collected: close the enforcement automatically unless it was already marked otherwise.
    await q.query(
      `UPDATE case_judgments j SET enforcement_status = 'collected', updated_at = now()
        WHERE j.id = $1 AND j.enforcement_status IN ('not_started', 'filed', 'in_progress')
          AND (SELECT sum(amount) FROM judgment_collections x WHERE x.judgment_id = j.id) >= j.amount_awarded + j.costs_awarded`, [id])
    await caseActivity(q, org.id, cur.case_id, user.id, 'judgment', `Collected ${b.amount} ${cur.currency} under the judgment of ${cur.judgment_date}`)
  })
  await audit(c, 'judgment.collection_added', 'case', cur.case_id, { judgment: id, amount: b.amount })
  return c.json({ judgment: withOutstanding(await loadJudgment(db, org.id, id)) }, 201)
})

judgmentRoutes.delete('/collections/:cid', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const cid = uuidParam(c.req.param('cid'), 'Collection')
  const { db } = c.get('deps')
  const row = await db.one('DELETE FROM judgment_collections WHERE id = $1 AND org_id = $2 RETURNING judgment_id', [cid, org.id])
  if (!row) throw notFound('Collection')
  await audit(c, 'judgment.collection_deleted', 'judgment', row.judgment_id, { collection: cid })
  return c.json({ judgment: withOutstanding(await loadJudgment(db, org.id, row.judgment_id)) })
})

// Firm-wide register of judgments, appeal deadlines and amounts still to collect.
judgmentRoutes.get('/register', queryParams(z.object({
  show: z.enum(['open', 'all']).default('open'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = (await db.query(
    `SELECT ${COLS}, k.reference, k.title AS case_title, cl.name AS client_name, k.opposing_party, u.name AS lawyer_name
       FROM case_judgments j JOIN cases k ON k.id = j.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE j.org_id = $1 ORDER BY j.judgment_date DESC LIMIT 5000`, [org.id])).map((j: any) => withOutstanding(j))
  const isOpen = (j: any) => (j.outstanding > 0 && !['unenforceable', 'closed', 'collected'].includes(j.enforcement_status)) ||
    (j.appeal_deadline && j.appeal_days_left >= 0 && j.appeal_decision === 'pending')
  const items = q.show === 'open' ? rows.filter(isOpen) : rows
  if (q.format === 'csv') {
    await audit(c, 'judgment.register_exported', 'organization', org.id, { rows: items.length })
    const csv = toCsv([
      ['Reference', 'Matter', 'Client', 'Opposing party', 'Judgment date', 'Court', 'Degree', 'Judgment no.', 'Result', 'Currency', 'Awarded', 'Costs', 'Collected', 'Outstanding',
        'Appeal deadline', 'Appeal decision', 'Enforcement', 'Enforcement file', 'Lawyer'],
      ...items.map((j: any) => [j.reference, j.case_title, j.client_name ?? '', j.opposing_party ?? '', j.judgment_date, j.court ?? '', j.degree, j.judgment_no ?? '', j.result, j.currency,
        j.amount_awarded, j.costs_awarded, j.collected, j.outstanding, j.appeal_deadline ?? '', j.appeal_decision, j.enforcement_status, j.enforcement_file_no ?? '', j.lawyer_name ?? ''])
    ])
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="judgments-enforcement.csv"', 'cache-control': 'private, no-store' } })
  }
  const totals: Record<string, { awarded: number; collected: number; outstanding: number }> = {}
  for (const j of rows) {
    if (j.result !== 'won' && j.result !== 'partial') continue
    const t = (totals[j.currency] ??= { awarded: 0, collected: 0, outstanding: 0 })
    t.awarded += j.amount_awarded + j.costs_awarded
    t.collected += j.collected
    if (!['unenforceable', 'closed'].includes(j.enforcement_status)) t.outstanding += j.outstanding
  }
  const appealsDue = rows.filter((j: any) => j.appeal_deadline && j.appeal_decision === 'pending' && j.appeal_days_left >= 0 && j.appeal_days_left <= 14).length
  return c.json({ items, totals, appeals_due: appealsDue, total: rows.length })
})

export default judgmentRoutes
