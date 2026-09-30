import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optText, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { CURRENCIES, JURISDICTION_CODES, PRACTICE_AREA_IDS } from '../services/reference'
import { assertCanOpenCase } from '../services/usage'

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
  assigned_to: optUuid,
  // Never cleared: a null/blank value leaves the stored date unchanged.
  opened_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? undefined)
}
const createSchema = z.object({
  ...caseFields,
  status: caseFields.status.default('active'),
  priority: caseFields.priority.default('medium'),
  currency: caseFields.currency.optional()
})
const updateSchema = z.object(caseFields).partial()
const UPDATABLE = ['title', 'title_ar', 'client_id', 'practice_area', 'jurisdiction', 'court', 'opposing_party', 'status', 'priority', 'description', 'estimated_value', 'currency', 'assigned_to', 'opened_on'] as const

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
    `SELECT k.*, cl.name AS client_name, cl.name_ar AS client_name_ar, u.name AS assignee_name
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
  const kase = await db.tx(async (q) => {
    const seq = await q.one('UPDATE organizations SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq', [org.id])
    const reference = `${new Date().getFullYear()}-${String(seq!.case_seq).padStart(4, '0')}`
    const row = await q.one(
      `INSERT INTO cases (org_id, reference, title, title_ar, client_id, practice_area, jurisdiction, court, opposing_party, status, priority,
                          description, estimated_value, currency, assigned_to, opened_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::date, CURRENT_DATE), $17) RETURNING *`,
      [org.id, reference, b.title, b.title_ar, b.client_id, b.practice_area, b.jurisdiction, b.court, b.opposing_party, b.status, b.priority,
       b.description, b.estimated_value, b.currency ?? org.default_currency, b.assigned_to ?? user.id, b.opened_on ?? null, user.id])
    await caseActivity(q, org.id, row!.id, user.id, 'created', 'Case opened')
    return row
  })
  await audit(c, 'case.created', 'case', kase!.id, { reference: kase!.reference })
  return c.json({ case: kase }, 201)
})

casesRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const current = await db.one('SELECT status FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!current) throw notFound('Case')
  if (current.status === 'closed' && b.status && b.status !== 'closed') await assertCanOpenCase(db, org)
  await assertRefs(db, org.id, b)
  const { sets, values } = buildUpdate(b, UPDATABLE, 3)
  if (b.status === 'closed' && current.status !== 'closed') sets.push('closed_on = CURRENT_DATE')
  if (b.status && b.status !== 'closed') sets.push('closed_on = NULL')
  const kase = await db.one(`UPDATE cases SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  if (b.status && b.status !== current.status) {
    await caseActivity(db, org.id, id, user.id, 'status_change', `Status changed from ${current.status} to ${b.status}`)
  }
  await audit(c, 'case.updated', 'case', id, { fields: Object.keys(b) })
  return c.json({ case: kase })
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
