import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv } from '../context'
import { badRequest, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, optText, optUuid, queryParams, uuidParam } from '../lib/http'
import { caseActivity } from './cases'

const KINDS = ['hearing', 'deadline', 'meeting', 'filing', 'reminder'] as const
const isoDate = z.string().datetime({ offset: true })

const eventFields = {
  title: z.string().trim().min(1).max(300),
  kind: z.enum(KINDS),
  starts_at: isoDate,
  ends_at: isoDate.nullish().transform((v) => v ?? null),
  all_day: z.boolean(),
  location: optText(300),
  notes: optText(5000),
  case_id: optUuid,
  completed: z.boolean()
}
const createSchema = z.object({ ...eventFields, kind: eventFields.kind.default('meeting'), all_day: eventFields.all_day.default(false), completed: eventFields.completed.optional() })
const updateSchema = z.object(eventFields).partial()

const eventsRoutes = new Hono<AppEnv>()

eventsRoutes.get('/', queryParams(z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  case_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
})), async (c) => {
  const { org } = auth(c)
  const { from, to, case_id, limit } = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = ['e.org_id = $1']
  if (from) { params.push(from); conds.push(`COALESCE(e.ends_at, e.starts_at) >= $${params.length}`) }
  if (to) { params.push(to); conds.push(`e.starts_at < $${params.length}`) }
  if (case_id) { params.push(case_id); conds.push(`e.case_id = $${params.length}`) }
  const items = await c.get('deps').db.query(
    `SELECT e.*, k.reference AS case_reference, k.title AS case_title FROM events e LEFT JOIN cases k ON k.id = e.case_id
      WHERE ${conds.join(' AND ')} ORDER BY e.starts_at LIMIT ${limit}`, params)
  return c.json({ items })
})

eventsRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (b.ends_at && new Date(b.ends_at) < new Date(b.starts_at)) throw badRequest('End time must be after start time.')
  const { db } = c.get('deps')
  if (b.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, org.id])).length) throw badRequest('Selected case does not exist.')
  const event = await db.one(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, ends_at, all_day, location, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [org.id, b.case_id, b.title, b.kind, b.starts_at, b.ends_at, b.all_day, b.location, b.notes, user.id])
  if (b.case_id) await caseActivity(db, org.id, b.case_id, user.id, 'event', `${b.kind}: ${b.title} (${b.starts_at.slice(0, 10)})`)
  await audit(c, 'event.created', 'event', event!.id)
  return c.json({ event }, 201)
})

eventsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Event')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const current = await db.one('SELECT starts_at, ends_at FROM events WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!current) throw notFound('Event')
  const starts = b.starts_at ?? current.starts_at
  const ends = b.ends_at !== undefined ? b.ends_at : current.ends_at
  if (ends && new Date(ends) < new Date(starts)) throw badRequest('End time must be after start time.')
  if (b.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, org.id])).length) throw badRequest('Selected case does not exist.')
  const { sets, values } = buildUpdate(b, ['title', 'kind', 'starts_at', 'ends_at', 'all_day', 'location', 'notes', 'case_id'], 3)
  if (b.completed !== undefined) sets.push(`completed_at = ${b.completed ? 'COALESCE(completed_at, now())' : 'NULL'}`)
  const event = await db.one(`UPDATE events SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  if (!event) throw notFound('Event')
  await audit(c, 'event.updated', 'event', id)
  return c.json({ event })
})

eventsRoutes.delete('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Event')
  const rows = await c.get('deps').db.query('DELETE FROM events WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Event')
  await audit(c, 'event.deleted', 'event', id)
  return c.json({ ok: true })
})

export default eventsRoutes
