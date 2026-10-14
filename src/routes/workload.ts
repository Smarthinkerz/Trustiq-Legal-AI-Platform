import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { jsonBody, uuidParam } from '../lib/http'
import { memberItems, teamWorkload } from '../services/workload'
import { caseActivity } from './cases'

// Team workload: the next two weeks per person, court clashes, and handing work over.
const workloadRoutes = new Hono<AppEnv>()
const managers = ['owner', 'admin', 'lawyer'] as const

workloadRoutes.get('/', async (c) => {
  const { user, org } = auth(c)
  if (user.role === 'client') throw forbidden()
  // Staff see their own load; lawyers and partners see the team.
  const data = await teamWorkload(c.get('deps').db, org.id, { userId: user.role === 'staff' ? user.id : undefined })
  return c.json(data)
})

workloadRoutes.get('/:userId', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('userId'), 'Member')
  if (user.role === 'client' || (user.role === 'staff' && id !== user.id)) throw forbidden()
  const { db } = c.get('deps')
  if (!(await db.one(`SELECT 1 FROM users WHERE id = $1 AND org_id = $2 AND role <> 'client'`, [id, org.id]))) throw notFound('Member')
  return c.json(await memberItems(db, org.id, id))
})

// Hands one item to another active member of the firm.
workloadRoutes.post('/reassign', jsonBody(z.object({
  kind: z.enum(['hearing', 'deadline', 'task', 'matter']),
  id: z.string().uuid(),
  to: z.string().uuid()
})), async (c) => {
  requireRole(c, ...managers)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const to = await db.one(`SELECT id, name FROM users WHERE id = $1 AND org_id = $2 AND role <> 'client' AND deactivated_at IS NULL`, [b.to, org.id])
  if (!to) throw badRequest('Choose an active member of your firm.')
  let caseId: string | null = null
  let label = ''
  if (b.kind === 'hearing' || b.kind === 'deadline') {
    const kinds = b.kind === 'hearing' ? ['hearing'] : ['deadline', 'filing']
    const row = await db.one(`UPDATE events SET attendee_id = $3, updated_at = now() WHERE id = $1 AND org_id = $2 AND kind = ANY($4::text[]) RETURNING case_id, title`, [b.id, org.id, to.id, kinds])
    if (!row) throw notFound(b.kind === 'hearing' ? 'Hearing' : 'Deadline')
    caseId = row.case_id
    label = row.title
  } else if (b.kind === 'task') {
    const row = await db.one(`UPDATE tasks SET assigned_to = $3, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING case_id, title`, [b.id, org.id, to.id])
    if (!row) throw notFound('Task')
    caseId = row.case_id
    label = row.title
  } else {
    if (user.role === 'lawyer') requireRole(c, 'owner', 'admin')
    const row = await db.one(`UPDATE cases SET assigned_to = $3, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING id, title`, [b.id, org.id, to.id])
    if (!row) throw notFound('Case')
    caseId = row.id
    label = row.title
  }
  if (caseId) await caseActivity(db, org.id, caseId, user.id, 'assignment', `${b.kind[0]!.toUpperCase()}${b.kind.slice(1)} "${label}" handed to ${to.name}`)
  await audit(c, 'workload.reassigned', b.kind, b.id, { to: to.id })
  return c.json({ ok: true, to: { id: to.id, name: to.name } })
})

export default workloadRoutes
