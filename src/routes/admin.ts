import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv } from '../context'
import { forbidden, notFound } from '../lib/errors'
import { jsonBody, likePattern, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { AI_PACK_REQUESTS, PRICES } from '../../public/static/site/firm-pricing.js'
import { PLANS } from '../lib/plans'

// Platform operator console: manage customer organizations and their plans.
// Access is limited to PLATFORM_ADMIN_EMAILS.
const adminRoutes = new Hono<AppEnv>()

adminRoutes.use(async (c, next) => {
  const { user } = auth(c)
  if (!c.get('deps').config.platformAdminEmails.includes(user.email.toLowerCase())) throw forbidden()
  await next()
})

// Our real AI cost per request from recorded token usage, and the margin of the overage pack.
const OMR_PER_USD = 0.3845 // The Omani rial's fixed peg.
adminRoutes.get('/ai-cost', queryParams(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })), async (c) => {
  const { days } = c.req.valid('query')
  const { db, config } = c.get('deps')
  const rows = await db.query(
    `SELECT model, count(*)::int AS requests, COALESCE(sum(prompt_tokens), 0)::bigint AS prompt_tokens, COALESCE(sum(completion_tokens), 0)::bigint AS completion_tokens
       FROM ai_usage WHERE created_at >= now() - make_interval(days => $1) GROUP BY model ORDER BY requests DESC`, [days])
  const inUsd = (p: number, k: number) => (p * config.ai.priceInputPerMTok + k * config.ai.priceOutputPerMTok) / 1e6
  const models = rows.map((r: any) => ({ ...r, prompt_tokens: Number(r.prompt_tokens), completion_tokens: Number(r.completion_tokens), cost_usd: inUsd(Number(r.prompt_tokens), Number(r.completion_tokens)) }))
  const requests = models.reduce((a, m) => a + m.requests, 0)
  const cost = models.reduce((a, m) => a + m.cost_usd, 0)
  const perRequest = requests ? cost / requests : null
  const pack = (price: number, usd: number) => {
    if (perRequest === null) return null
    const packCostUsd = perRequest * AI_PACK_REQUESTS
    return { price, cost_usd: Math.round(packCostUsd * 100) / 100, margin_percent: Math.round((1 - packCostUsd / usd) * 1000) / 10 }
  }
  return c.json({
    days, requests, cost_usd: Math.round(cost * 100) / 100,
    cost_per_request_usd: perRequest === null ? null : Math.round(perRequest * 100000) / 100000,
    prices_per_million_tokens_usd: { input: config.ai.priceInputPerMTok, output: config.ai.priceOutputPerMTok },
    models,
    ai_pack: {
      requests: AI_PACK_REQUESTS,
      omr: pack(PRICES.OMR.aiPack, PRICES.OMR.aiPack / OMR_PER_USD),
      usd: pack(PRICES.USD.aiPack, PRICES.USD.aiPack)
    },
    note: 'Image and transcription requests are priced at the text rates; check the rates against the provider price list.'
  })
})

// Data deletion requests from firms, decided by the platform team.
adminRoutes.get('/deletion-requests', async (c) => {
  const items = await c.get('deps').db.query(
    `SELECT r.*, o.name AS org_name, u.email AS requested_by_email, cl.name AS client_name
       FROM deletion_requests r JOIN organizations o ON o.id = r.org_id
       LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN clients cl ON cl.id = r.client_id
      ORDER BY (r.status = 'requested') DESC, r.created_at DESC LIMIT 200`)
  return c.json({ items })
})

adminRoutes.patch('/deletion-requests/:id', jsonBody(z.object({ status: z.enum(['completed', 'rejected']), decision_note: z.string().trim().max(2000).nullish() })), async (c) => {
  const id = uuidParam(c.req.param('id'), 'Request')
  const b = c.req.valid('json')
  const [r] = await c.get('deps').db.query(
    `UPDATE deletion_requests SET status = $2, decision_note = $3, decided_at = now() WHERE id = $1 AND status = 'requested' RETURNING id, org_id`,
    [id, b.status, b.decision_note ?? null])
  if (!r) throw notFound('Request')
  await audit(c, `admin.deletion_${b.status}`, 'deletion_request', id, { org: r.org_id })
  return c.json({ ok: true })
})

adminRoutes.get('/organizations', queryParams(z.object(pageSchema)), async (c) => {
  const { page, pageSize, q } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = []
  let where = 'TRUE'
  if (q) { params.push(likePattern(q)); where = `(o.name ILIKE $1 OR EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id AND u.email ILIKE $1))` }
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM organizations o WHERE ${where}`, params)
  const items = await db.query(
    `SELECT o.id, o.name, o.plan, o.trial_ends_at, o.plan_expires_at, o.created_at,
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
  trial_ends_at: z.string().datetime({ offset: true }).nullish(),
  plan_expires_at: z.string().datetime({ offset: true }).nullish()
})), async (c) => {
  const id = uuidParam(c.req.param('id'), 'Organization')
  const b = c.req.valid('json')
  const row = await c.get('deps').db.one(
    `UPDATE organizations SET plan = COALESCE($2, plan), trial_ends_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE trial_ends_at END,
            plan_expires_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE plan_expires_at END, updated_at = now()
      WHERE id = $1 RETURNING id, name, plan, trial_ends_at, plan_expires_at`,
    [id, b.plan ?? null, b.trial_ends_at !== undefined, b.trial_ends_at ?? null, b.plan_expires_at !== undefined, b.plan_expires_at ?? null])
  if (!row) throw notFound('Organization')
  await audit(c, 'admin.organization_updated', 'organization', id, b)
  return c.json({ organization: row })
})

export default adminRoutes
