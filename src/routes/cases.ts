import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optText, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { CURRENCIES, JURISDICTION_CODES, PRACTICE_AREA_IDS } from '../services/reference'
import { assertCanOpenCase } from '../services/usage'
import { FEE_ARRANGEMENTS, matterFinancials } from '../services/matter-finance'
import { conflictOverride, gateConflicts } from '../lib/conflict-gate'
import { clientConflicts, logConflictCheck, opposingConflicts, type Blocking } from '../services/conflicts'
import { localToIso } from '../services/dictation'
import { sendClientMessage } from './clients'

const STATUSES = ['active', 'pending', 'under_review', 'on_hold', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const caseFields = {
  title: z.string().trim().min(3).max(300),
  title_ar: optText(300),
  client_id: optUuid,
  practice_area: z.enum(PRACTICE_AREA_IDS).nullish().or(z.literal('')).transform((v) => v || null),
  jurisdiction: z.enum(JURISDICTION_CODES),
  court: optText(200),
  opposing_party: optText(300),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  description: optText(10_000),
  estimated_value: z.number().min(0).max(1e13).nullish().transform((v) => v ?? null),
  currency: z.enum(CURRENCIES),
  // Fixed fee, fee cap, or contingency percentage, depending on the arrangement; the budget is for hourly matters.
  fee_arrangement: z.enum(FEE_ARRANGEMENTS),
  fee_amount: z.number().min(0).max(1e13).nullish().transform((v) => v ?? null),
  budget_amount: z.number().min(0).max(1e13).nullish().transform((v) => v ?? null),
  assigned_to: optUuid,
  // Never cleared: a null/blank value leaves the stored date unchanged.
  opened_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? undefined)
}
const createSchema = z.object({
  ...caseFields,
  status: caseFields.status.default('active'),
  priority: caseFields.priority.default('medium'),
  currency: caseFields.currency.optional(),
  fee_arrangement: caseFields.fee_arrangement.default('hourly'),
  conflict_override: conflictOverride
})
const updateSchema = z.object({ ...caseFields, conflict_override: conflictOverride }).partial()

// A matter is in conflict when an opposing party is one of the firm's clients, or its client is an opposing party elsewhere.
async function caseConflicts(db: Queryable, orgId: string, v: { clientId: string | null | undefined; opposing: string | null | undefined; caseId?: string; checkClient: boolean }) {
  const found: Blocking[] = await clientConflicts(db, orgId, v.opposing, v.clientId)
  if (v.checkClient && v.clientId) {
    const cl = await db.query('SELECT name, name_ar FROM clients WHERE id = $1 AND org_id = $2', [v.clientId, orgId])
    if (cl.length) found.push(...await opposingConflicts(db, orgId, [cl[0].name, cl[0].name_ar], v.caseId))
  }
  return found
}
const UPDATABLE = ['title', 'title_ar', 'client_id', 'practice_area', 'jurisdiction', 'court', 'opposing_party', 'status', 'priority', 'description', 'estimated_value', 'currency', 'assigned_to', 'opened_on', 'fee_arrangement', 'fee_amount', 'budget_amount'] as const

async function assertRefs(db: Queryable, orgId: string, refs: { client_id?: string | null; assigned_to?: string | null }) {
  if (refs.client_id && !(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [refs.client_id, orgId])).length) {
    throw badRequest('Selected client does not exist.')
  }
  if (refs.assigned_to && !(await db.query('SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL', [refs.assigned_to, orgId])).length) {
    throw badRequest('Selected team member does not exist.')
  }
}

export async function caseActivity(db: Queryable, orgId: string, caseId: string, userId: string | null, kind: string, body: string) {
  await db.query('INSERT INTO case_activity (org_id, case_id, user_id, kind, body) VALUES ($1, $2, $3, $4, $5)', [orgId, caseId, userId, kind, body])
}

const casesRoutes = new Hono<AppEnv>()

casesRoutes.get('/', queryParams(z.object({
  ...pageSchema,
  status: z.enum([...STATUSES, 'open']).optional(),
  priority: z.enum(PRIORITIES).optional(),
  client_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional()
})), async (c) => {
  const { org } = auth(c)
  const { page, pageSize, q, status, priority, client_id, assigned_to } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = [org.id]
  const conds = ['k.org_id = $1']
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)) }
  if (status === 'open') conds.push(`k.status <> 'closed'`)
  else if (status) add('k.status = ?', status)
  if (priority) add('k.priority = ?', priority)
  if (client_id) add('k.client_id = ?', client_id)
  if (assigned_to) add('k.assigned_to = ?', assigned_to)
  if (q) {
    params.push(likePattern(q))
    const p = `$${params.length}`
    conds.push(`(k.title ILIKE ${p} OR k.title_ar ILIKE ${p} OR k.reference ILIKE ${p} OR k.opposing_party ILIKE ${p} OR cl.name ILIKE ${p})`)
  }
  const where = conds.join(' AND ')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE ${where}`, params)
  const items = await db.query(
    `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.priority, k.jurisdiction, k.practice_area, k.opened_on, k.updated_at,
            k.client_id, cl.name AS client_name, k.assigned_to, u.name AS assignee_name
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE ${where}
      ORDER BY CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, k.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

casesRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  const kase = await db.one(
    `SELECT k.*, to_char(k.retain_until, 'YYYY-MM-DD') AS retain_until, to_char(k.closed_on, 'YYYY-MM-DD') AS closed_on, cl.name AS client_name, cl.name_ar AS client_name_ar, cl.language AS client_language, u.name AS assignee_name
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE k.id = $1 AND k.org_id = $2`, [id, org.id])
  if (!kase) throw notFound('Case')
  const [activity, documents, events] = await Promise.all([
    db.query(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS user_name FROM case_activity a LEFT JOIN users u ON u.id = a.user_id
               WHERE a.case_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC LIMIT 100`, [id, org.id]),
    db.query('SELECT id, title, doc_type, status, source, language, updated_at FROM documents WHERE case_id = $1 AND org_id = $2 ORDER BY updated_at DESC', [id, org.id]),
    db.query('SELECT id, title, kind, starts_at, ends_at, all_day, location, completed_at FROM events WHERE case_id = $1 AND org_id = $2 ORDER BY starts_at', [id, org.id])
  ])
  return c.json({ case: kase, activity, documents, events })
})

casesRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  if (b.status !== 'closed') await assertCanOpenCase(db, org)
  await assertRefs(db, org.id, b)
  const blocking = await caseConflicts(db, org.id, { clientId: b.client_id, opposing: b.opposing_party, checkClient: true })
  const gate = gateConflicts(c, blocking, b.conflict_override)
  const kase = await db.tx(async (q) => {
    const seq = await q.one('UPDATE organizations SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq', [org.id])
    const reference = `${new Date().getFullYear()}-${String(seq!.case_seq).padStart(4, '0')}`
    const row = await q.one(
      `INSERT INTO cases (org_id, reference, title, title_ar, client_id, practice_area, jurisdiction, court, opposing_party, status, priority,
                          description, estimated_value, currency, assigned_to, opened_on, created_by, fee_arrangement, fee_amount, budget_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::date, CURRENT_DATE), $17, $18, $19, $20) RETURNING *`,
      [org.id, reference, b.title, b.title_ar, b.client_id, b.practice_area, b.jurisdiction, b.court, b.opposing_party, b.status, b.priority,
       b.description, b.estimated_value, b.currency ?? org.default_currency, b.assigned_to ?? user.id, b.opened_on ?? null, user.id,
       b.fee_arrangement, b.fee_amount, b.budget_amount])
    await caseActivity(q, org.id, row!.id, user.id, 'created', 'Case opened')
    await logConflictCheck(q, { orgId: org.id, userId: user.id, subjectType: 'case', subjectId: row!.id, subjectName: b.title, matches: blocking, ...gate })
    if (gate.decision === 'override') await caseActivity(q, org.id, row!.id, user.id, 'conflict', `Conflict check overridden: ${gate.reason}`)
    return row
  })
  await audit(c, 'case.created', 'case', kase!.id, { reference: kase!.reference })
  return c.json({ case: kase, conflict_check: { decision: gate.decision, matches: blocking } }, 201)
})

casesRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const current = await db.one('SELECT status, client_id, opposing_party FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!current) throw notFound('Case')
  if (current.status === 'closed' && b.status && b.status !== 'closed') await assertCanOpenCase(db, org)
  await assertRefs(db, org.id, b)
  // Re-check when the parties change.
  const opposingChanged = b.opposing_party !== undefined && (b.opposing_party ?? '') !== (current.opposing_party ?? '')
  const clientChanged = b.client_id !== undefined && b.client_id !== current.client_id
  let gate: ReturnType<typeof gateConflicts> | null = null
  let blocking: Blocking[] = []
  if (opposingChanged || clientChanged) {
    const clientId = b.client_id !== undefined ? b.client_id : current.client_id
    blocking = await caseConflicts(db, org.id, { clientId, opposing: b.opposing_party !== undefined ? b.opposing_party : current.opposing_party, caseId: id, checkClient: clientChanged })
    gate = gateConflicts(c, blocking, b.conflict_override)
  }
  const { sets, values } = buildUpdate(b, UPDATABLE, 3)
  if (b.status === 'closed' && current.status !== 'closed') {
    sets.push('closed_on = CURRENT_DATE', 'closed_by = $' + (values.length + 3), `retain_until = COALESCE(retain_until, CURRENT_DATE + make_interval(years => (SELECT retention_years FROM organizations WHERE id = $2)))`)
    values.push(user.id)
  }
  if (b.status && b.status !== 'closed') sets.push('closed_on = NULL', 'retain_until = NULL', 'closed_by = NULL', 'closing_outcome = NULL')
  // A new fee or budget starts the 80% / 100% alerts again.
  if (b.fee_arrangement !== undefined || b.fee_amount !== undefined || b.budget_amount !== undefined) sets.push('budget_alert_level = 0')
  const kase = await db.one(`UPDATE cases SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  if (b.status && b.status !== current.status) {
    await caseActivity(db, org.id, id, user.id, 'status_change', `Status changed from ${current.status} to ${b.status}`)
  }
  if (gate) {
    await logConflictCheck(db, { orgId: org.id, userId: user.id, subjectType: 'case', subjectId: id, subjectName: kase!.title, matches: blocking, ...gate })
    if (gate.decision === 'override') await caseActivity(db, org.id, id, user.id, 'conflict', `Conflict check overridden: ${gate.reason}`)
  }
  await audit(c, 'case.updated', 'case', id, { fields: Object.keys(b) })
  return c.json({ case: kase })
})

casesRoutes.get('/:id/financials', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const [financials] = await matterFinancials(c.get('deps').db, org.id, { caseIds: [id], includeClosed: true })
  if (!financials) throw notFound('Case')
  return c.json({ financials })
})

casesRoutes.post('/:id/notes', jsonBody(z.object({ body: z.string().trim().min(1).max(10_000) })), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])).length) throw notFound('Case')
  await caseActivity(db, org.id, id, user.id, 'note', c.req.valid('json').body)
  await db.query('UPDATE cases SET updated_at = now() WHERE id = $1', [id])
  return c.json({ ok: true }, 201)
})

// Saves a reviewed dictation: the file note, chosen tasks and dates, and optionally the client update.
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
casesRoutes.post('/:id/dictation', jsonBody(z.object({
  note: z.string().trim().min(1).max(20_000),
  title: optText(200),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(300), due_date: dateStr.nullish().or(z.literal('')).transform((v) => v || null) })).max(15).default([]),
  events: z.array(z.object({
    title: z.string().trim().min(1).max(300), kind: z.enum(['hearing', 'deadline', 'filing', 'meeting']), date: dateStr,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish().or(z.literal('')).transform((v) => v || ''), location: optText(300)
  })).max(10).default([]),
  client_message: optText(5000)
})), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const deps = c.get('deps')
  const [kase] = await deps.db.query('SELECT id, client_id, jurisdiction FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!kase) throw notFound('Case')
  if (b.client_message && !kase.client_id) throw badRequest('This case has no client to send the update to.')
  const saved = await deps.db.tx(async (q) => {
    await caseActivity(q, org.id, id, user.id, 'note', b.title ? `${b.title}\n\n${b.note}` : b.note)
    for (const t of b.tasks) {
      await q.query(`INSERT INTO tasks (org_id, case_id, title, assigned_to, due_date, priority, status, created_by) VALUES ($1, $2, $3, $4, $5, 'medium', 'open', $4)`,
        [org.id, id, t.title, user.id, t.due_date])
    }
    for (const e of b.events) {
      const when = localToIso(e.date, e.time, kase.jurisdiction)
      await q.query(`INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, location, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [org.id, id, e.title, e.kind, when.starts_at, when.all_day, e.location, user.id])
      await caseActivity(q, org.id, id, user.id, 'event', `${e.kind}: ${e.title} (${e.date})`)
    }
    await q.query('UPDATE cases SET updated_at = now() WHERE id = $1', [id])
    return { tasks: b.tasks.length, events: b.events.length }
  })
  let messaged = false
  if (b.client_message && kase.client_id) {
    await sendClientMessage({ db: deps.db, mailer: deps.mailer, config: deps.config, log: deps.log },
      { orgId: org.id, orgName: org.name, clientId: kase.client_id, caseId: id, senderId: user.id, body: b.client_message })
    messaged = true
  }
  await audit(c, 'case.dictation_saved', 'case', id, { ...saved, messaged })
  return c.json({ ok: true, ...saved, messaged }, 201)
})

casesRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const rows = await c.get('deps').db.query('DELETE FROM cases WHERE id = $1 AND org_id = $2 RETURNING reference, title', [id, org.id])
  if (!rows.length) throw notFound('Case')
  await audit(c, 'case.deleted', 'case', id, rows[0])
  return c.json({ ok: true })
})

export default casesRoutes
