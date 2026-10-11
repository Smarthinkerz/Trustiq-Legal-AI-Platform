import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, uuidParam } from '../lib/http'
import { clientUpdateText, OUTCOMES } from '../services/hearings'
import { caseActivity } from './cases'
import { sendClientMessage } from './clients'

const hearingsRoutes = new Hono<AppEnv>()

const RECORD_COLUMNS = `h.id, h.case_id, h.event_id, h.outcome, h.summary, h.next_steps, h.next_event_id, h.shared_with_client, h.client_message,
  h.created_at, h.updated_at, e.title AS hearing_title, e.starts_at AS hearing_at, e.all_day AS hearing_all_day, e.location AS hearing_location,
  n.starts_at AS next_hearing_at, n.all_day AS next_hearing_all_day, n.location AS next_hearing_location, u.name AS recorded_by`
const RECORD_FROM = `hearing_records h JOIN events e ON e.id = h.event_id LEFT JOIN events n ON n.id = h.next_event_id LEFT JOIN users u ON u.id = h.created_by`

hearingsRoutes.get('/', queryParams(z.object({ case_id: z.string().uuid() })), async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT ${RECORD_COLUMNS} FROM ${RECORD_FROM} WHERE h.org_id = $1 AND h.case_id = $2 ORDER BY e.starts_at DESC`, [org.id, c.req.valid('query').case_id])
  return c.json({ items })
})

// Past hearings (last 90 days) with no recorded outcome yet.
hearingsRoutes.get('/awaiting', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT e.id, e.title, e.starts_at, e.all_day, e.location, e.case_id, k.reference AS case_reference, k.title AS case_title
       FROM events e JOIN cases k ON k.id = e.case_id
      WHERE e.org_id = $1 AND e.kind = 'hearing' AND e.completed_at IS NULL AND e.starts_at < now() AND e.starts_at > now() - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM hearing_records h WHERE h.event_id = e.id)
      ORDER BY e.starts_at DESC LIMIT 50`, [org.id])
  return c.json({ items })
})

const isoDateTime = z.string().datetime({ offset: true })
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

hearingsRoutes.post('/', jsonBody(z.object({
  event_id: z.string().uuid(),
  outcome: z.enum(OUTCOMES),
  summary: z.string().trim().min(1).max(5000),
  next_steps: optText(5000),
  next_hearing: z.object({ starts_at: isoDateTime, all_day: z.boolean().default(false), location: optText(300) }).nullish(),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(300), due_date: day.nullish().or(z.literal('')).transform((v) => v || null) })).max(10).default([]),
  notify_client: z.boolean().default(false),
  client_message: optText(5000)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const event = await db.one(
    `SELECT e.id, e.title, e.kind, e.starts_at, e.all_day, e.location, e.case_id, k.reference, k.title AS case_title, k.client_id, k.jurisdiction, k.assigned_to
       FROM events e LEFT JOIN cases k ON k.id = e.case_id WHERE e.id = $1 AND e.org_id = $2`, [b.event_id, org.id])
  if (!event) throw notFound('Hearing')
  if (event.kind !== 'hearing' || !event.case_id) throw badRequest('Outcomes can be recorded for hearings linked to a case.')
  if (b.next_hearing && new Date(b.next_hearing.starts_at) <= new Date(event.starts_at)) throw badRequest('The next hearing must be after this one.')
  if (b.notify_client && !event.client_id) throw badRequest('This case has no client to notify.')
  if (await db.one('SELECT 1 FROM hearing_records WHERE event_id = $1', [event.id])) throw conflict('An outcome is already recorded for this hearing.')

  const message = b.notify_client
    ? b.client_message ?? clientUpdateText({
      outcome: b.outcome, caseRef: event.reference, caseTitle: event.case_title, hearingAt: new Date(event.starts_at), hearingAllDay: event.all_day,
      jurisdiction: event.jurisdiction,
      next: b.next_hearing ? { at: new Date(b.next_hearing.starts_at), allDay: b.next_hearing.all_day, location: b.next_hearing.location ?? event.location } : null
    })
    : null

  const id = await db.tx(async (q) => {
    let nextId: string | null = null
    if (b.next_hearing) {
      const [n] = await q.query(
        `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, location, created_by) VALUES ($1, $2, $3, 'hearing', $4, $5, $6, $7) RETURNING id`,
        [org.id, event.case_id, event.title, b.next_hearing.starts_at, b.next_hearing.all_day, b.next_hearing.location ?? event.location, user.id])
      nextId = n.id
    }
    const [r] = await q.query(
      `INSERT INTO hearing_records (org_id, case_id, event_id, outcome, summary, next_steps, next_event_id, shared_with_client, client_message, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [org.id, event.case_id, event.id, b.outcome, b.summary, b.next_steps, nextId, b.notify_client, message, user.id])
    await q.query(`UPDATE events SET completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = $1`, [event.id])
    for (const t of b.tasks) {
      await q.query(`INSERT INTO tasks (org_id, case_id, title, assigned_to, due_date, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [org.id, event.case_id, t.title, event.assigned_to ?? user.id, t.due_date, user.id])
    }
    if (b.outcome === 'settled' || b.outcome === 'dismissed' || b.outcome === 'judgment') {
      await q.query(`UPDATE cases SET updated_at = now() WHERE id = $1`, [event.case_id])
    }
    await caseActivity(q, org.id, event.case_id, user.id, 'hearing',
      `Hearing ${new Date(event.starts_at).toISOString().slice(0, 10)}: ${b.outcome}${b.next_hearing ? `; next hearing ${b.next_hearing.starts_at.slice(0, 10)}` : ''}`)
    return r.id as string
  })
  if (message) {
    await sendClientMessage({ db, mailer, config, log }, { orgId: org.id, orgName: org.name, clientId: event.client_id, caseId: event.case_id, senderId: user.id, body: message })
  }
  await audit(c, 'hearing.recorded', 'event', event.id, { outcome: b.outcome, next: !!b.next_hearing, tasks: b.tasks.length, notified: !!message })
  const record = await db.one(`SELECT ${RECORD_COLUMNS} FROM ${RECORD_FROM} WHERE h.id = $1`, [id])
  return c.json({ record }, 201)
})

hearingsRoutes.patch('/:id', jsonBody(z.object({
  outcome: z.enum(OUTCOMES).optional(),
  summary: z.string().trim().min(1).max(5000).optional(),
  next_steps: optText(5000)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Hearing record')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const rows = await db.query(
    `UPDATE hearing_records SET outcome = COALESCE($3, outcome), summary = COALESCE($4, summary),
            next_steps = CASE WHEN $5::boolean THEN $6 ELSE next_steps END, updated_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING id`,
    [id, org.id, b.outcome ?? null, b.summary ?? null, b.next_steps !== undefined, b.next_steps ?? null])
  if (!rows.length) throw notFound('Hearing record')
  await audit(c, 'hearing.record_updated', 'hearing_record', id)
  return c.json({ record: await db.one(`SELECT ${RECORD_COLUMNS} FROM ${RECORD_FROM} WHERE h.id = $1`, [id]) })
})

export default hearingsRoutes
