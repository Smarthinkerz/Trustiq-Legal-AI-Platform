import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { hashToken, newToken } from '../lib/crypto'
import { badRequest, conflict } from '../lib/errors'
import { optUuid } from '../lib/http'
import { notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optText, pageSchema, paged, queryParams, uuidParam } from '../lib/http'

const clientFields = {
  kind: z.enum(['individual', 'company']),
  name: z.string().trim().min(2).max(200),
  name_ar: optText(200),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')).transform((v) => v || null),
  phone: optText(60),
  id_number: optText(80),
  vat_number: optText(40),
  address: optText(500),
  notes: optText(5000)
}
const createSchema = z.object({ ...clientFields, kind: clientFields.kind.default('individual') })
const updateSchema = z.object({ ...clientFields, archived: z.boolean() }).partial()
const UPDATABLE = ['kind', 'name', 'name_ar', 'email', 'phone', 'id_number', 'vat_number', 'address', 'notes'] as const

const clientsRoutes = new Hono<AppEnv>()

clientsRoutes.get('/', queryParams(z.object({ ...pageSchema, archived: z.enum(['true', 'false']).default('false') })), async (c) => {
  const { org } = auth(c)
  const { page, pageSize, q, archived } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = [org.id]
  let where = `c.org_id = $1 AND c.archived_at IS ${archived === 'true' ? 'NOT ' : ''}NULL`
  if (q) {
    params.push(likePattern(q))
    where += ` AND (c.name ILIKE $${params.length} OR c.name_ar ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.id_number ILIKE $${params.length})`
  }
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM clients c WHERE ${where}`, params)
  const items = await db.query(
    `SELECT c.id, c.kind, c.name, c.name_ar, c.email, c.phone, c.id_number, c.created_at, c.archived_at,
            (SELECT count(*)::int FROM cases k WHERE k.client_id = c.id AND k.status <> 'closed') AS open_cases,
            (SELECT count(*)::int FROM client_messages m WHERE m.client_id = c.id AND m.from_client AND m.read_at IS NULL) AS unread_messages
       FROM clients c WHERE ${where} ORDER BY c.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

clientsRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  const client = await db.one('SELECT * FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!client) throw notFound('Client')
  const cases = await db.query(
    'SELECT id, reference, title, title_ar, status, priority, jurisdiction, updated_at FROM cases WHERE client_id = $1 AND org_id = $2 ORDER BY updated_at DESC',
    [id, org.id])
  const documents = await db.query(
    'SELECT id, title, doc_type, status, updated_at FROM documents WHERE client_id = $1 AND org_id = $2 ORDER BY updated_at DESC LIMIT 50', [id, org.id])
  return c.json({ client, cases, documents })
})

clientsRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const client = await c.get('deps').db.one(
    `INSERT INTO clients (org_id, kind, name, name_ar, email, phone, id_number, vat_number, address, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [org.id, b.kind, b.name, b.name_ar, b.email, b.phone, b.id_number, b.vat_number, b.address, b.notes, user.id])
  await audit(c, 'client.created', 'client', client!.id)
  return c.json({ client }, 201)
})

clientsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const b = c.req.valid('json')
  const { sets, values } = buildUpdate(b, UPDATABLE, 3)
  if (b.archived !== undefined) sets.push(`archived_at = ${b.archived ? 'COALESCE(archived_at, now())' : 'NULL'}`)
  const client = await c.get('deps').db.one(
    `UPDATE clients SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, org.id, ...values])
  if (!client) throw notFound('Client')
  await audit(c, 'client.updated', 'client', id, { fields: Object.keys(b) })
  return c.json({ client })
})

clientsRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const rows = await c.get('deps').db.query('DELETE FROM clients WHERE id = $1 AND org_id = $2 RETURNING name', [id, org.id])
  if (!rows.length) throw notFound('Client')
  await audit(c, 'client.deleted', 'client', id, { name: rows[0].name })
  return c.json({ ok: true })
})

// ---------------- Client portal (firm side) ----------------

const PORTAL_INVITE_DAYS = 14

clientsRoutes.get('/:id/portal', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])).length) throw notFound('Client')
  const [users, invites] = await Promise.all([
    db.query(`SELECT id, name, email, last_login_at, deactivated_at FROM users WHERE org_id = $1 AND client_id = $2 ORDER BY deactivated_at NULLS FIRST, name`, [org.id, id]),
    db.query(`SELECT left(id, 16) AS id, email, expires_at FROM auth_tokens WHERE org_id = $1 AND client_id = $2 AND kind = 'invite' AND used_at IS NULL AND expires_at > now()`, [org.id, id])
  ])
  return c.json({ users, invites })
})

clientsRoutes.post('/:id/portal-invite', jsonBody(z.object({ email: z.string().trim().toLowerCase().email().max(254) })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { email } = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const client = await db.one('SELECT id, name FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!client) throw notFound('Client')
  if (await db.one('SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw conflict('A user with this email already exists.')
  await db.query(`DELETE FROM auth_tokens WHERE org_id = $1 AND kind = 'invite' AND lower(email) = $2 AND used_at IS NULL`, [org.id, email])
  const token = newToken()
  await db.query(
    `INSERT INTO auth_tokens (id, kind, org_id, email, role, client_id, created_by, expires_at) VALUES ($1, 'invite', $2, $3, 'client', $4, $5, $6)`,
    [hashToken(token), org.id, email, id, user.id, new Date(Date.now() + PORTAL_INVITE_DAYS * 86400_000)])
  const inviteUrl = `${config.appUrl}/app#/accept-invite?token=${token}`
  let emailed = false
  if (mailer.configured) {
    try {
      await mailer.send({
        to: email,
        subject: `${org.name} invited you to your secure client portal`,
        text: `${org.name} has given you access to a secure client portal where you can follow your matters, download documents and invoices, and message your lawyer.\n\nSet up your account within ${PORTAL_INVITE_DAYS} days:\n${inviteUrl}\n\n` +
          `دعاك ${org.name} إلى بوابة الموكلين الآمنة لمتابعة قضاياك وتنزيل المستندات والفواتير ومراسلة محاميك. افتح الرابط أعلاه لإنشاء حسابك.`
      })
      emailed = true
    } catch (err) {
      log.warn('portal invite email failed', { err })
    }
  }
  await audit(c, 'portal.invited', 'client', id, { email })
  return c.json({ invite_url: inviteUrl, emailed }, 201)
})

clientsRoutes.delete('/:id/portal-users/:userId', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const userId = uuidParam(c.req.param('userId'), 'User')
  const { db } = c.get('deps')
  const rows = await db.query(`UPDATE users SET deactivated_at = now() WHERE id = $1 AND org_id = $2 AND client_id = $3 AND role = 'client' RETURNING id`, [userId, org.id, id])
  if (!rows.length) throw notFound('Portal user')
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId])
  await audit(c, 'portal.user_removed', 'user', userId)
  return c.json({ ok: true })
})

clientsRoutes.get('/:id/messages', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  const items = await db.query(
    `SELECT m.id, m.body, m.from_client, m.case_id, k.reference AS case_reference, m.created_at, m.read_at, u.name AS sender_name
       FROM client_messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN cases k ON k.id = m.case_id
      WHERE m.org_id = $1 AND m.client_id = $2 ORDER BY m.created_at DESC LIMIT 200`, [org.id, id])
  await db.query('UPDATE client_messages SET read_at = now() WHERE org_id = $1 AND client_id = $2 AND from_client AND read_at IS NULL', [org.id, id])
  return c.json({ items: items.reverse() })
})

clientsRoutes.post('/:id/messages', jsonBody(z.object({ body: z.string().trim().min(1).max(10_000), case_id: optUuid })), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])).length) throw notFound('Client')
  if (b.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [b.case_id, org.id, id])).length) throw badRequest('Selected case does not belong to this client.')
  const msg = await db.one(
    'INSERT INTO client_messages (org_id, client_id, case_id, sender_id, from_client, body) VALUES ($1, $2, $3, $4, false, $5) RETURNING id, created_at',
    [org.id, id, b.case_id, user.id, b.body])
  if (mailer.configured) {
    const recipients = await db.query(`SELECT email, locale FROM users WHERE org_id = $1 AND client_id = $2 AND deactivated_at IS NULL AND notify_email`, [org.id, id])
    for (const r of recipients) {
      await mailer.send({
        to: r.email,
        subject: r.locale === 'ar' ? `رسالة جديدة من ${org.name}` : `New message from ${org.name}`,
        text: (r.locale === 'ar' ? `لديك رسالة جديدة في بوابة الموكلين:\n\n` : `You have a new message in your client portal:\n\n`) + `${b.body.slice(0, 2000)}\n\n${config.appUrl}/app#/portal`
      }).catch((err) => log.warn('client message email failed', { err }))
    }
  }
  await audit(c, 'portal.message_sent', 'client', id)
  return c.json({ message: msg }, 201)
})

export default clientsRoutes
