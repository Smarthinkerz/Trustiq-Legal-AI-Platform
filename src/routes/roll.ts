import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, queryParams, uuidParam } from '../lib/http'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { groupRoll, renderRollDocx, rollItems } from '../services/roll'

// Court roll: hearings for a period, grouped by day and court, printable in Arabic or English.
const rollRoutes = new Hono<AppEnv>()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

rollRoutes.get('/', queryParams(z.object({
  from: day, to: day,
  who: z.string().uuid().optional().or(z.literal('me')),
  format: z.enum(['json', 'docx']).default('json'),
  lang: z.enum(['en', 'ar']).default('en'),
  letterhead: z.enum(['true', 'false']).default('true')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { user, org } = auth(c)
  const q = c.req.valid('query')
  if (q.to < q.from) throw badRequest('The end date is before the start date.')
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 62) throw badRequest('Choose a period of up to two months.')
  const { db } = c.get('deps')
  const who = q.who === 'me' ? user.id : q.who ?? null
  const items = await rollItems(db, org.id, { from: q.from, to: q.to, who })
  if (q.format === 'docx') {
    const lh = q.letterhead === 'true' ? await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id]) : null
    const whoName = who ? (await db.one('SELECT name FROM users WHERE id = $1 AND org_id = $2', [who, org.id]))?.name ?? null : null
    const buf = await renderRollDocx({ lang: q.lang, from: q.from, to: q.to, items, firmName: (q.lang === 'ar' ? lh?.firm_name_ar : null) || lh?.firm_name || org.name, letterhead: lh as any, filterLabel: whoName })
    await audit(c, 'roll.exported', 'organization', org.id, { from: q.from, to: q.to, hearings: items.length })
    return new Response(new Uint8Array(buf), {
      headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`court-roll-${q.from}${q.to !== q.from ? `-to-${q.to}` : ''}.docx`), 'cache-control': 'private, no-store' }
    })
  }
  const unassigned = items.filter((x) => !x.attendee_id && !x.lawyer_id).length
  return c.json({ days: groupRoll(items), total: items.length, unassigned })
})

// Who attends a hearing (often a junior for the responsible partner). null clears it.
rollRoutes.patch('/:id', jsonBody(z.object({ attendee_id: z.string().uuid().nullable() })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Hearing')
  const { attendee_id } = c.req.valid('json')
  const { db } = c.get('deps')
  if (attendee_id && !(await db.one(`SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role <> 'client' AND deactivated_at IS NULL`, [attendee_id, org.id]))) {
    throw badRequest('Choose an active member of your firm.')
  }
  const row = await db.one(`UPDATE events SET attendee_id = $3, updated_at = now() WHERE id = $1 AND org_id = $2 AND kind = 'hearing' RETURNING id, attendee_id`, [id, org.id, attendee_id])
  if (!row) throw notFound('Hearing')
  await audit(c, 'roll.attendee_set', 'event', id, { attendee_id })
  return c.json(row)
})

export default rollRoutes
