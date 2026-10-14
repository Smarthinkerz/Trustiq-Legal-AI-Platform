import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest } from '../lib/errors'
import { jsonBody, queryParams } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { suggestTime } from '../services/time-capture'

// Suggested time entries from the signed-in lawyer's own activity.
const timeCaptureRoutes = new Hono<AppEnv>()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

timeCaptureRoutes.get('/', queryParams(z.object({ from: day.optional(), to: day.optional() })), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const [{ today, week_ago }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS today, to_char(${GULF_TODAY} - 6, 'YYYY-MM-DD') AS week_ago`)
  const from = q.from ?? week_ago
  const to = q.to ?? today
  if (to < from) throw badRequest('The end date is before the start date.')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 31) throw badRequest('Choose a period of up to a month.')
  const items = await suggestTime(db, { orgId: org.id, userId: user.id, from, to, lang: user.locale === 'ar' ? 'ar' : 'en' })
  return c.json({ from, to, items, minutes: items.reduce((n, s) => n + s.minutes, 0) })
})

// Logs the chosen suggestions (with any edits) as time entries at the lawyer's rate.
timeCaptureRoutes.post('/accept', jsonBody(z.object({
  items: z.array(z.object({
    key: z.string().min(3).max(200),
    case_id: z.string().uuid(),
    work_date: day,
    minutes: z.number().int().min(1).max(1440),
    description: z.string().trim().min(2).max(2000),
    billable: z.boolean().default(true)
  })).min(1).max(200)
})), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const { items } = c.req.valid('json')
  const { db } = c.get('deps')
  const caseIds = [...new Set(items.map((x) => x.case_id))]
  const ok = await db.query('SELECT id FROM cases WHERE org_id = $1 AND id = ANY($2::uuid[])', [org.id, caseIds])
  if (ok.length !== caseIds.length) throw badRequest('Selected case does not exist.')
  const [{ rate }] = await db.query('SELECT COALESCE(u.hourly_rate, o.default_hourly_rate, 0)::float8 AS rate FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1', [user.id])
  const created = await db.tx(async (q) => {
    let n = 0
    for (const x of items) {
      const rows = await q.query(
        `INSERT INTO time_entries (org_id, case_id, user_id, work_date, minutes, description, rate, billable, source_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (user_id, source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`,
        [org.id, x.case_id, user.id, x.work_date, x.minutes, x.description, rate, x.billable, x.key])
      n += rows.length
    }
    return n
  })
  await audit(c, 'billing.time_captured', 'user', user.id, { entries: created, minutes: items.reduce((n, x) => n + x.minutes, 0) })
  return c.json({ created, skipped: items.length - created }, 201)
})

timeCaptureRoutes.post('/dismiss', jsonBody(z.object({ keys: z.array(z.string().min(3).max(200)).min(1).max(500) })), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const { keys } = c.req.valid('json')
  await c.get('deps').db.query(
    `INSERT INTO time_suggestion_dismissals (org_id, user_id, key) SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`, [org.id, user.id, keys])
  return c.json({ dismissed: keys.length })
})

export default timeCaptureRoutes
