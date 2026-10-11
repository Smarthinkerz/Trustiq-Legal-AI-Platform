import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, conflict, notFound, tooMany } from '../lib/errors'
import { jsonBody, optText, optUuid, queryParams, uuidParam } from '../lib/http'
import { emailClientPortalUsers, loadDocumentRequest, refreshRequestStatus, requestEmailLines } from '../services/document-requests'

const REMIND_INTERVAL_MS = 60 * 60_000

const documentRequestsRoutes = new Hono<AppEnv>()

const firmName = async (c: Ctx, orgId: string) =>
  (await c.get('deps').db.one('SELECT firm_name FROM branding WHERE org_id = $1', [orgId]))?.firm_name || auth(c).org.name

async function portalUserCount(c: Ctx, orgId: string, clientId: string) {
  const [r] = await c.get('deps').db.query(
    `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND client_id = $2 AND role = 'client' AND deactivated_at IS NULL`, [orgId, clientId])
  return r.n as number
}

documentRequestsRoutes.get('/', queryParams(z.object({
  client_id: z.string().uuid().optional(),
  case_id: z.string().uuid().optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional()
})), async (c) => {
  const { org } = auth(c)
  const { client_id, case_id, status } = c.req.valid('query')
  const items = await c.get('deps').db.query(
    `SELECT r.id, r.title, r.status, r.due_date, r.client_id, r.case_id, r.created_at, r.completed_at, cl.name AS client_name, k.reference AS case_reference,
            count(i.id)::int AS items, count(i.id) FILTER (WHERE i.status = 'accepted')::int AS accepted,
            count(i.id) FILTER (WHERE i.status = 'uploaded')::int AS to_review
       FROM document_requests r JOIN clients cl ON cl.id = r.client_id LEFT JOIN cases k ON k.id = r.case_id
       LEFT JOIN document_request_items i ON i.request_id = r.id
      WHERE r.org_id = $1 AND ($2::uuid IS NULL OR r.client_id = $2) AND ($3::uuid IS NULL OR r.case_id = $3) AND ($4::text IS NULL OR r.status = $4)
      GROUP BY r.id, cl.name, k.reference
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`, [org.id, client_id ?? null, case_id ?? null, status ?? null])
  return c.json({ items })
})

documentRequestsRoutes.post('/', jsonBody(z.object({
  client_id: z.string().uuid(),
  case_id: optUuid,
  title: z.string().trim().min(2).max(200),
  message: optText(2000),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  items: z.array(z.object({ label: z.string().trim().min(1).max(200), note: optText(500) })).min(1).max(30)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const client = await db.one('SELECT id FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])
  if (!client) throw badRequest('Selected client does not exist.')
  if (b.case_id) {
    const k = await db.one('SELECT client_id FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, org.id])
    if (!k) throw badRequest('Selected case does not exist.')
    if (k.client_id !== b.client_id) throw badRequest('The case does not belong to this client.')
  }
  const id = await db.tx(async (q) => {
    const [r] = await q.query(
      `INSERT INTO document_requests (org_id, client_id, case_id, title, message, due_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [org.id, b.client_id, b.case_id, b.title, b.message, b.due_date, user.id])
    for (const [i, item] of b.items.entries()) {
      await q.query('INSERT INTO document_request_items (org_id, request_id, label, note, position) VALUES ($1, $2, $3, $4, $5)', [org.id, r.id, item.label, item.note, i])
    }
    return r.id as string
  })
  await audit(c, 'document_request.created', 'document_request', id, { items: b.items.length })
  const firm = await firmName(c, org.id)
  const emailed = await emailClientPortalUsers({ db, mailer, config, log }, org.id, b.client_id, `Documents requested: ${b.title.slice(0, 80)} – ${firm}`,
    requestEmailLines(firm, b.title, b.items.map((i) => i.label), { message: b.message, due: b.due_date }))
  return c.json({ ...(await loadDocumentRequest(db, org.id, id)), portal_users: await portalUserCount(c, org.id, b.client_id), emailed }, 201)
})

documentRequestsRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const data = await loadDocumentRequest(c.get('deps').db, org.id, uuidParam(c.req.param('id'), 'Request'))
  if (!data) throw notFound('Request')
  return c.json({ ...data, portal_users: await portalUserCount(c, org.id, data.request.client_id) })
})

documentRequestsRoutes.post('/:id/items/:itemId/review', jsonBody(z.object({ accepted: z.boolean(), reason: optText(500) })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Request')
  const itemId = uuidParam(c.req.param('itemId'), 'Item')
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const item = await db.one(
    `SELECT i.label, i.status, r.status AS request_status, r.client_id, r.title FROM document_request_items i JOIN document_requests r ON r.id = i.request_id
      WHERE i.id = $1 AND i.request_id = $2 AND r.org_id = $3`, [itemId, id, org.id])
  if (!item) throw notFound('Item')
  if (item.request_status === 'cancelled') throw conflict('This request was cancelled.')
  if (item.status === 'pending') throw conflict('The client has not uploaded this document yet.')
  await db.tx(async (q) => {
    await q.query(
      `UPDATE document_request_items SET status = $2, reviewed_at = now(), reject_reason = $3 WHERE id = $1`,
      [itemId, b.accepted ? 'accepted' : 'rejected', b.accepted ? null : b.reason])
    if (b.accepted) await refreshRequestStatus(q, id)
    else await q.query(`UPDATE document_requests SET status = 'open', completed_at = NULL, updated_at = now() WHERE id = $1 AND status = 'completed'`, [id])
  })
  await audit(c, b.accepted ? 'document_request.item_accepted' : 'document_request.item_returned', 'document_request', id, { item: itemId })
  if (!b.accepted) {
    const firm = await firmName(c, org.id)
    await emailClientPortalUsers({ db, mailer, config, log }, org.id, item.client_id, `Please upload again: ${item.label.slice(0, 80)} – ${firm}`, [
      `${firm} could not accept the document you uploaded for "${item.label}" (${item.title}).`,
      ...(b.reason ? [`Reason: ${b.reason}`] : []), 'Please sign in to your client portal and upload it again.',
      '', '—', '', `لم يتمكن ${firm} من قبول المستند الذي رفعته لـ «${item.label}». يُرجى تسجيل الدخول إلى بوابة العملاء ورفعه مرة أخرى.`
    ])
  }
  return c.json(await loadDocumentRequest(db, org.id, id))
})

documentRequestsRoutes.post('/:id/remind', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Request')
  const { db, mailer, config, log } = c.get('deps')
  const data = await loadDocumentRequest(db, org.id, id)
  if (!data) throw notFound('Request')
  const r = data.request
  if (r.status !== 'open') throw conflict('Only open requests can be reminded.')
  if (r.last_reminded_at && Date.now() - new Date(r.last_reminded_at).getTime() < REMIND_INTERVAL_MS) throw tooMany('A reminder was sent less than an hour ago.')
  const missing = data.items.filter((i: any) => i.status === 'pending' || i.status === 'rejected').map((i: any) => i.label)
  if (!missing.length) throw conflict('The client has uploaded everything; review the uploads instead.')
  const firm = await firmName(c, org.id)
  const emailed = await emailClientPortalUsers({ db, mailer, config, log }, org.id, r.client_id, `Reminder: documents requested – ${firm}`,
    requestEmailLines(firm, r.title, missing, { due: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null, reminder: true }))
  await db.query('UPDATE document_requests SET last_reminded_at = now() WHERE id = $1', [id])
  await audit(c, 'document_request.reminded', 'document_request', id)
  return c.json({ ok: true, emailed })
})

documentRequestsRoutes.post('/:id/cancel', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Request')
  const rows = await c.get('deps').db.query(
    `UPDATE document_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND org_id = $2 AND status = 'open' RETURNING id`, [id, org.id])
  if (!rows.length) throw conflict('Only open requests can be cancelled.')
  await audit(c, 'document_request.cancelled', 'document_request', id)
  return c.json({ ok: true })
})

export default documentRequestsRoutes
