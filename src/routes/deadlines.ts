import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, queryParams, uuidParam } from '../lib/http'
import { calculateDeadline, DEADLINE_UNITS, isValidDate, WEEKENDS } from '../services/deadlines'
import { JURISDICTION_CODES } from '../services/reference'

const day = z.string().refine(isValidDate, 'Use a valid date (YYYY-MM-DD).')

const deadlinesRoutes = new Hono<AppEnv>()

// Holidays that apply to a jurisdiction: those set for it plus firm-wide ones.
async function holidaysFor(c: Parameters<typeof auth>[0], jurisdiction: string, from: string, to: string) {
  const { org } = auth(c)
  return c.get('deps').db.query<{ date: string; name: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM org_holidays
      WHERE org_id = $1 AND date BETWEEN $2 AND $3 AND (jurisdiction IS NULL OR jurisdiction = $4) ORDER BY date`,
    [org.id, from, to, jurisdiction])
}

deadlinesRoutes.post('/calculate', jsonBody(z.object({
  start: day,
  amount: z.number().int().min(0).max(3650),
  unit: z.enum(DEADLINE_UNITS),
  calendar: z.enum(['gregorian', 'hijri']).default('gregorian'),
  jurisdiction: z.enum(JURISDICTION_CODES),
  roll_forward: z.boolean().default(true)
})), async (c) => {
  const b = c.req.valid('json')
  // Holidays in a window wide enough for the longest period plus roll-forward.
  const span = b.unit === 'years' ? b.amount * 366 : b.unit === 'months' ? b.amount * 31 : b.unit === 'weeks' ? b.amount * 7 : b.unit === 'working_days' ? b.amount * 3 : b.amount
  const to = new Date(Date.parse(`${b.start}T00:00:00Z`) + (span + 90) * 86_400_000).toISOString().slice(0, 10)
  const holidays = await holidaysFor(c, b.jurisdiction, b.start, to)
  const result = calculateDeadline({ ...b, rollForward: b.roll_forward, holidays })
  return c.json({ result, weekend: WEEKENDS[b.jurisdiction] ?? WEEKENDS.gcc })
})

deadlinesRoutes.get('/holidays', queryParams(z.object({ year: z.coerce.number().int().min(1950).max(2100).optional() })), async (c) => {
  const { org } = auth(c)
  const { year } = c.req.valid('query')
  const params: unknown[] = [org.id]
  let filter = ''
  if (year) { params.push(`${year}-01-01`, `${year}-12-31`); filter = ' AND date BETWEEN $2 AND $3' }
  const items = await c.get('deps').db.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, name, jurisdiction FROM org_holidays WHERE org_id = $1${filter} ORDER BY date`, params)
  return c.json({ items })
})

deadlinesRoutes.post('/holidays', jsonBody(z.object({
  date: day,
  name: z.string().trim().min(1).max(200),
  jurisdiction: z.enum(JURISDICTION_CODES).nullish().transform((v) => v ?? null)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const db = c.get('deps').db
  const exists = await db.one(`SELECT 1 FROM org_holidays WHERE org_id = $1 AND date = $2 AND coalesce(jurisdiction, '') = coalesce($3, '')`, [org.id, b.date, b.jurisdiction])
  if (exists) throw badRequest('A holiday is already set for that date.')
  const holiday = await db.one(
    `INSERT INTO org_holidays (org_id, date, name, jurisdiction, created_by) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, name, jurisdiction`, [org.id, b.date, b.name, b.jurisdiction, user.id])
  await audit(c, 'holiday.created', 'holiday', holiday!.id, { date: b.date, name: b.name })
  return c.json({ holiday }, 201)
})

deadlinesRoutes.delete('/holidays/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Holiday')
  const [row] = await c.get('deps').db.query('DELETE FROM org_holidays WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!row) throw notFound('Holiday')
  await audit(c, 'holiday.deleted', 'holiday', id)
  return c.json({ ok: true })
})

export default deadlinesRoutes
