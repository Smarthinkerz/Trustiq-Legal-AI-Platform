import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv } from '../context'
import { badRequest, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optText, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { CHECKLISTS } from '../services/reference'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const STATUSES = ['open', 'in_progress', 'done'] as const
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const taskFields = {
  title: z.string().trim().min(2).max(300),
  description: optText(5000),
  case_id: optUuid,
  assigned_to: optUuid,
  due_date: isoDate.nullish().or(z.literal('')).transform((v) => v || null),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES)
}

const tasksRoutes = new Hono<AppEnv>()

tasksRoutes.get('/', queryParams(z.object({
  ...pageSchema,
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum([...STATUSES, 'active']).default('active'),
  case_id: z.string().uuid().optional()
})), async (c) => {
  const { user, org } = auth(c)
  const f = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = ['t.org_id = $1']
  if (f.scope === 'mine' && !f.case_id) { params.push(user.id); conds.push(`t.assigned_to = $${params.length}`) }
  if (f.status === 'active') conds.push(`t.status <> 'done'`)
  else { params.push(f.status); conds.push(`t.status = $${params.length}`) }
  if (f.case_id) { params.push(f.case_id); conds.push(`t.case_id = $${params.length}`) }
  if (f.q) { params.push(likePattern(f.q)); conds.push(`t.title ILIKE $${params.length}`) }
  const where = conds.join(' AND ')
  const { db } = c.get('deps')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM tasks t WHERE ${where}`, params)
  const items = await db.query(
    `SELECT t.*, k.reference AS case_reference, k.title AS case_title, u.name AS assignee_name,
            (t.status <> 'done' AND t.due_date < CURRENT_DATE) AS overdue
       FROM tasks t LEFT JOIN cases k ON k.id = t.case_id LEFT JOIN users u ON u.id = t.assigned_to
      WHERE ${where}
      ORDER BY (t.status = 'done'), t.due_date NULLS LAST,
               CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize])
  return c.json(paged(items, n, f.page, f.pageSize))
})

async function assertRefs(c: any, orgId: string, b: { case_id?: string | null; assigned_to?: string | null }) {
  const { db } = c.get('deps')
  if (b.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, orgId])).length) throw badRequest('Selected case does not exist.')
  if (b.assigned_to && !(await db.query(`SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role <> 'client' AND deactivated_at IS NULL`, [b.assigned_to, orgId])).length) {
    throw badRequest('Selected team member does not exist.')
  }
}

tasksRoutes.post('/', jsonBody(z.object({ ...taskFields, priority: taskFields.priority.default('medium'), status: taskFields.status.default('open') })), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  await assertRefs(c, org.id, b)
  const task = await c.get('deps').db.one(
    `INSERT INTO tasks (org_id, case_id, title, description, assigned_to, due_date, priority, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [org.id, b.case_id, b.title, b.description, b.assigned_to ?? user.id, b.due_date, b.priority, b.status, user.id])
  await audit(c, 'task.created', 'task', task!.id)
  return c.json({ task }, 201)
})

tasksRoutes.patch('/:id', jsonBody(z.object(taskFields).partial()), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Task')
  const b = c.req.valid('json')
  await assertRefs(c, org.id, b)
  const { sets, values } = buildUpdate(b, ['title', 'description', 'case_id', 'assigned_to', 'due_date', 'priority', 'status'], 3)
  if (b.status === 'done') sets.push('completed_at = COALESCE(completed_at, now())')
  else if (b.status) sets.push('completed_at = NULL')
  const task = await c.get('deps').db.one(`UPDATE tasks SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  if (!task) throw notFound('Task')
  return c.json({ task })
})

tasksRoutes.delete('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Task')
  const rows = await c.get('deps').db.query('DELETE FROM tasks WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Task')
  await audit(c, 'task.deleted', 'task', id)
  return c.json({ ok: true })
})

tasksRoutes.post('/apply-checklist', jsonBody(z.object({
  case_id: z.string().uuid(),
  checklist: z.enum(Object.keys(CHECKLISTS) as [string, ...string[]]),
  language: z.enum(['en', 'ar']).default('en')
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await db.one('SELECT id, assigned_to FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, org.id])
  if (!k) throw badRequest('Selected case does not exist.')
  const steps = CHECKLISTS[b.checklist]
  await db.tx(async (q) => {
    for (const s of steps) {
      await q.query(`INSERT INTO tasks (org_id, case_id, title, assigned_to, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [org.id, b.case_id, s[b.language], k.assigned_to ?? user.id, user.id])
    }
  })
  await audit(c, 'task.checklist_applied', 'case', b.case_id, { checklist: b.checklist })
  return c.json({ created: steps.length }, 201)
})

export default tasksRoutes
