import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { hashToken, newToken } from '../lib/crypto'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, optText, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { CURRENCIES, JURISDICTION_CODES } from '../services/reference'
import { usageThisMonth } from '../services/usage'

const INVITE_DAYS = 7
const LOGO_MAX_BYTES = 1024 * 1024
const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

const orgRoutes = new Hono<AppEnv>()

orgRoutes.get('/', async (c) => {
  const { org } = auth(c)
  const { db } = c.get('deps')
  const [members] = await db.query('SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND deactivated_at IS NULL', [org.id])
  return c.json({ org, members: members.n, usage: await usageThisMonth(db, org.id) })
})

orgRoutes.patch('/', jsonBody(z.object({
  name: z.string().trim().min(2).max(160).optional(),
  default_jurisdiction: z.enum(JURISDICTION_CODES).optional(),
  default_currency: z.enum(CURRENCIES).optional()
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const body = c.req.valid('json')
  const { sets, values } = buildUpdate(body, ['name', 'default_jurisdiction', 'default_currency'], 2)
  if (sets.length) await c.get('deps').db.query(`UPDATE organizations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [org.id, ...values])
  await audit(c, 'org.updated', 'organization', org.id, body)
  const updated = await c.get('deps').db.one('SELECT id, name, plan, trial_ends_at, default_jurisdiction, default_currency FROM organizations WHERE id = $1', [org.id])
  return c.json({ org: updated })
})

// ---- Members ----

orgRoutes.get('/members', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT id, email, name, role, locale, last_login_at, created_at, deactivated_at FROM users
      WHERE org_id = $1 ORDER BY deactivated_at NULLS FIRST, name`, [org.id])
  return c.json({ items })
})

orgRoutes.patch('/members/:id', jsonBody(z.object({ role: z.enum(['owner', 'admin', 'lawyer', 'staff']) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Member')
  const { role } = c.req.valid('json')
  const { db } = c.get('deps')
  const target = await db.one('SELECT id, role FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL', [id, org.id])
  if (!target) throw notFound('Member')
  // Only owners can grant or remove the owner role.
  if ((role === 'owner' || target.role === 'owner') && user.role !== 'owner') throw forbidden('Only an owner can change owner access.')
  if (target.role === 'owner' && role !== 'owner') {
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'owner' AND deactivated_at IS NULL`, [org.id])
    if (n <= 1) throw badRequest('The organization must keep at least one owner.')
  }
  await db.query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [id, role])
  await audit(c, 'member.role_changed', 'user', id, { from: target.role, to: role })
  return c.json({ ok: true })
})

orgRoutes.delete('/members/:id', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Member')
  if (id === user.id) throw badRequest('You cannot remove yourself.')
  const { db } = c.get('deps')
  const target = await db.one('SELECT id, role FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL', [id, org.id])
  if (!target) throw notFound('Member')
  if (target.role === 'owner' && user.role !== 'owner') throw forbidden('Only an owner can remove another owner.')
  // Deactivate rather than delete so authorship and the audit trail stay intact.
  await db.query('UPDATE users SET deactivated_at = now(), updated_at = now() WHERE id = $1', [id])
  await db.query('DELETE FROM sessions WHERE user_id = $1', [id])
  await audit(c, 'member.deactivated', 'user', id)
  return c.json({ ok: true })
})

// ---- Invitations ----

orgRoutes.get('/invites', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT id, email, role, expires_at, created_at FROM auth_tokens
      WHERE org_id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [org.id])
  // The id is a token hash; expose a short handle only.
  return c.json({ items: items.map((i) => ({ ...i, id: i.id.slice(0, 16) })) })
})

orgRoutes.post('/invites', jsonBody(z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['admin', 'lawyer', 'staff'])
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const { email, role } = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  if (await db.one('SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw conflict('A user with this email already exists.')
  await db.query(`DELETE FROM auth_tokens WHERE org_id = $1 AND kind = 'invite' AND lower(email) = $2 AND used_at IS NULL`, [org.id, email])
  const token = newToken()
  await db.query(
    `INSERT INTO auth_tokens (id, kind, org_id, email, role, created_by, expires_at) VALUES ($1, 'invite', $2, $3, $4, $5, $6)`,
    [hashToken(token), org.id, email, role, user.id, new Date(Date.now() + INVITE_DAYS * 86400_000)]
  )
  const inviteUrl = `${config.appUrl}/app#/accept-invite?token=${token}`
  let emailed = false
  if (mailer.configured) {
    try {
      await mailer.send({
        to: email,
        subject: `${user.name} invited you to ${org.name} on TrustiqLegal`,
        text: `${user.name} has invited you to join ${org.name} on TrustiqLegal.\n\nAccept the invitation within ${INVITE_DAYS} days:\n${inviteUrl}\n\nتمت دعوتك للانضمام إلى ${org.name} على منصة TrustiqLegal. لقبول الدعوة افتح الرابط أعلاه.`
      })
      emailed = true
    } catch (err) {
      log.warn('invite email failed; admin can share the link manually', { err })
    }
  }
  await audit(c, 'member.invited', 'invite', email, { role })
  // The link is returned so admins can share it directly when email is unavailable.
  return c.json({ invite_url: inviteUrl, emailed }, 201)
})

orgRoutes.delete('/invites/:handle', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const handle = c.req.param('handle')
  if (!/^[0-9a-f]{16}$/.test(handle)) throw badRequest('Invalid invitation id')
  const rows = await c.get('deps').db.query(
    `DELETE FROM auth_tokens WHERE org_id = $1 AND kind = 'invite' AND used_at IS NULL AND left(id, 16) = $2 RETURNING email`, [org.id, handle])
  if (!rows.length) throw notFound('Invitation')
  await audit(c, 'member.invite_revoked', 'invite', rows[0].email)
  return c.json({ ok: true })
})

// ---- Branding ----

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #1a365d')

orgRoutes.get('/branding', async (c) => {
  const { org } = auth(c)
  const row = await c.get('deps').db.one(
    `SELECT firm_name, firm_name_ar, primary_color, accent_color, address, phone, email, website, footer_text,
            (logo IS NOT NULL) AS has_logo, updated_at FROM branding WHERE org_id = $1`, [org.id])
  return c.json({ branding: row ?? { primary_color: '#1a365d', accent_color: '#d69e2e', has_logo: false } })
})

orgRoutes.put('/branding', jsonBody(z.object({
  firm_name: optText(160),
  firm_name_ar: optText(160),
  primary_color: hexColor,
  accent_color: hexColor,
  address: optText(500),
  phone: optText(60),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')).transform((v) => v || null),
  website: optText(200),
  footer_text: optText(500)
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const b = c.req.valid('json')
  await c.get('deps').db.query(
    `INSERT INTO branding (org_id, firm_name, firm_name_ar, primary_color, accent_color, address, phone, email, website, footer_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (org_id) DO UPDATE SET firm_name = $2, firm_name_ar = $3, primary_color = $4, accent_color = $5,
       address = $6, phone = $7, email = $8, website = $9, footer_text = $10, updated_at = now()`,
    [org.id, b.firm_name, b.firm_name_ar, b.primary_color, b.accent_color, b.address, b.phone, b.email, b.website, b.footer_text]
  )
  await audit(c, 'branding.updated', 'organization', org.id)
  return c.json({ ok: true })
})

orgRoutes.post('/branding/logo', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a multipart form upload.') })
  const file = form.get('logo')
  if (!(file instanceof File)) throw badRequest('Choose a logo image to upload.')
  if (!LOGO_TYPES[file.type]) throw badRequest('Logo must be a PNG, JPEG or WebP image.')
  if (file.size > LOGO_MAX_BYTES) throw badRequest('Logo must be smaller than 1 MB.')
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!sniffImage(bytes, file.type)) throw badRequest('The file does not look like a valid image.')
  await c.get('deps').db.query(
    `INSERT INTO branding (org_id, logo, logo_mime) VALUES ($1, $2, $3)
     ON CONFLICT (org_id) DO UPDATE SET logo = $2, logo_mime = $3, updated_at = now()`, [org.id, bytes, file.type])
  await audit(c, 'branding.logo_uploaded', 'organization', org.id)
  return c.json({ ok: true })
})

orgRoutes.delete('/branding/logo', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  await c.get('deps').db.query('UPDATE branding SET logo = NULL, logo_mime = NULL, updated_at = now() WHERE org_id = $1', [org.id])
  await audit(c, 'branding.logo_removed', 'organization', org.id)
  return c.json({ ok: true })
})

orgRoutes.get('/branding/logo', async (c) => {
  const { org } = auth(c)
  const row = await c.get('deps').db.one('SELECT logo, logo_mime FROM branding WHERE org_id = $1 AND logo IS NOT NULL', [org.id])
  if (!row) throw notFound('Logo')
  return new Response(Buffer.from(row.logo), { headers: { 'content-type': row.logo_mime, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } })
})

function sniffImage(b: Buffer, mime: string) {
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8
  if (mime === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  return false
}

// ---- Audit log & data export ----

orgRoutes.get('/audit', queryParams(z.object({ ...pageSchema, pageSize: z.coerce.number().int().min(1).max(200).default(50) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const { page, pageSize } = c.req.valid('query')
  const { db } = c.get('deps')
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1', [org.id])
  const items = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.meta, a.ip, a.created_at, u.name AS user_name, u.email AS user_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.org_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`,
    [org.id, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

// Full JSON export of the organisation's records (excluding binary files and secrets) for data portability.
orgRoutes.get('/export', async (c) => {
  requireRole(c, 'owner')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const q = (sql: string) => db.query(sql, [org.id])
  const data = {
    exported_at: new Date().toISOString(),
    organization: await db.one('SELECT id, name, plan, default_jurisdiction, default_currency, created_at FROM organizations WHERE id = $1', [org.id]),
    users: await q('SELECT id, email, name, role, locale, created_at, deactivated_at FROM users WHERE org_id = $1'),
    clients: await q('SELECT * FROM clients WHERE org_id = $1'),
    cases: await q('SELECT * FROM cases WHERE org_id = $1'),
    case_activity: await q('SELECT * FROM case_activity WHERE org_id = $1'),
    documents: await q('SELECT id, case_id, client_id, title, doc_type, language, jurisdiction, status, source, content, version, file_name, mime_type, file_size, created_by, created_at, updated_at FROM documents WHERE org_id = $1'),
    document_versions: await q('SELECT * FROM document_versions WHERE org_id = $1'),
    document_analyses: await q('SELECT * FROM document_analyses WHERE org_id = $1'),
    events: await q('SELECT * FROM events WHERE org_id = $1'),
    ai_conversations: await q('SELECT * FROM ai_conversations WHERE org_id = $1'),
    ai_messages: await q('SELECT * FROM ai_messages WHERE org_id = $1')
  }
  await audit(c, 'org.exported', 'organization', org.id)
  c.header('content-disposition', `attachment; filename="trustiqlegal-export-${new Date().toISOString().slice(0, 10)}.json"`)
  return c.json(data)
})

export default orgRoutes
