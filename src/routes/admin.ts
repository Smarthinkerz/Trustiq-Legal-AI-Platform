import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv } from '../context'
import { forbidden, notFound } from '../lib/errors'
import { jsonBody, likePattern, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { PLANS } from '../lib/plans'

// Platform operator console: manage customer organizations and their plans.
// Access is limited to PLATFORM_ADMIN_EMAILS.
const adminRoutes = new Hono<AppEnv>()

adminRoutes.use(async (c, next) => {
  const { user } = auth(c)
  if (!c.get('deps').config.platformAdminEmails.includes(user.email.toLowerCase())) throw forbidden()
  await next()
})

adminRoutes.get('/organizations', queryParams(z.object(pageSchema)), async (c) => {
  const { page, pageSize, q } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = []
  let where = 'TRUE'
  if (q) { params.push(likePattern(q)); where = `(o.name ILIKE $1 OR EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id AND u.email ILIKE $1))` }
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM organizations o WHERE ${where}`, params)
  const items = await db.query(
    `SELECT o.id, o.name, o.plan, o.trial_ends_at, o.created_at,
            (SELECT email FROM users u WHERE u.org_id = o.id AND u.role = 'owner' ORDER BY u.created_at LIMIT 1) AS owner_email,
            (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND u.deactivated_at IS NULL) AS users,
            (SELECT count(*)::int FROM cases k WHERE k.org_id = o.id) AS cases,
            (SELECT count(*)::int FROM ai_usage a WHERE a.org_id = o.id AND a.created_at >= date_trunc('month', now())) AS ai_this_month,
            (SELECT max(s.last_seen_at) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.org_id = o.id) AS last_active_at
       FROM organizations o WHERE ${where} ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

adminRoutes.patch('/organizations/:id', jsonBody(z.object({
  plan: z.enum(Object.keys(PLANS) as [string, ...string[]]).optional(),
  trial_ends_at: z.string().datetime({ offset: true }).nullish()
})), async (c) => {
  const id = uuidParam(c.req.param('id'), 'Organization')
  const b = c.req.valid('json')
  const row = await c.get('deps').db.one(
    `UPDATE organizations SET plan = COALESCE($2, plan), trial_ends_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE trial_ends_at END, updated_at = now()
      WHERE id = $1 RETURNING id, name, plan, trial_ends_at`,
    [id, b.plan ?? null, b.trial_ends_at !== undefined, b.trial_ends_at ?? null])
  if (!row) throw notFound('Organization')
  await audit(c, 'admin.organization_updated', 'organization', id, b)
  return c.json({ organization: row })
})

export default adminRoutes
