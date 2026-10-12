import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, conflict, HttpError, unavailable } from '../lib/errors'
import { jsonBody } from '../lib/http'
import { paymentSecret } from '../services/invoice-payments'
import {
  normalizePhone, sampleParams, sealWaToken, sendTemplate, TEMPLATES, verifyWaAccount, WA_KINDS, waAccount, WaError, waSettings
} from '../services/whatsapp'

// ---------------- /api/whatsapp: the firm's WhatsApp Business connection and reminders ----------------

const whatsappRoutes = new Hono<AppEnv>()

whatsappRoutes.get('/', async (c) => {
  const { org } = auth(c)
  const { db, config } = c.get('deps')
  const [o] = await db.query('SELECT wa_token_sealed, wa_phone_number_id, wa_display_phone, wa_connected_at, wa_settings FROM organizations WHERE id = $1', [org.id])
  const acct = waAccount(config, o)
  const [messages, [stats]] = await Promise.all([
    db.query(
      `SELECT m.id, m.kind, m.status, m.error, m.language, m.template, m.created_at, m.to_phone, cl.id AS client_id, cl.name AS client_name
         FROM whatsapp_messages m LEFT JOIN clients cl ON cl.id = m.client_id WHERE m.org_id = $1 ORDER BY m.created_at DESC LIMIT 50`, [org.id]),
    db.query(
      `SELECT count(*) FILTER (WHERE whatsapp_opt_in_at IS NOT NULL)::int AS opted_in,
              count(*) FILTER (WHERE whatsapp_opt_in_at IS NOT NULL AND (phone IS NULL OR phone = ''))::int AS opted_in_no_phone
         FROM clients WHERE org_id = $1 AND archived_at IS NULL`, [org.id])
  ])
  return c.json({
    available: !!paymentSecret(config),
    connected: !!acct,
    needs_reconnect: !!o.wa_token_sealed && !acct,
    phone_number_id: acct ? o.wa_phone_number_id : null,
    display_phone: acct ? o.wa_display_phone : null,
    connected_at: acct ? o.wa_connected_at : null,
    settings: waSettings(o.wa_settings),
    templates: TEMPLATES,
    messages,
    stats
  })
})

whatsappRoutes.put('/connect', jsonBody(z.object({
  phone_number_id: z.string().trim().regex(/^\d{6,30}$/, 'The phone number ID is the long number shown under your WhatsApp number in Meta\'s API setup page.'),
  access_token: z.string().trim().min(20).max(1000)
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const b = c.req.valid('json')
  const deps = c.get('deps')
  if (!paymentSecret(deps.config)) throw unavailable('encryption_key_missing', 'WhatsApp needs ENCRYPTION_KEY to be set on the server before an access token can be stored.')
  let info
  try {
    info = await verifyWaAccount(deps.waFetch ?? fetch, b.phone_number_id, b.access_token)
  } catch (err) {
    if (err instanceof WaError && err.status < 500) throw badRequest(`WhatsApp did not accept these details: ${err.message}`)
    throw unavailable('whatsapp_unavailable', 'WhatsApp could not be reached. Please try again.')
  }
  await deps.db.query(
    `UPDATE organizations SET wa_token_sealed = $2, wa_phone_number_id = $3, wa_display_phone = $4, wa_connected_at = now(), updated_at = now() WHERE id = $1`,
    [org.id, sealWaToken(deps.config, b.access_token), b.phone_number_id, info.display_phone || null])
  await audit(c, 'whatsapp.connected', 'organization', org.id, { display_phone: info.display_phone })
  return c.json({ ok: true, display_phone: info.display_phone, verified_name: info.verified_name })
})

whatsappRoutes.delete('/', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  await c.get('deps').db.query(
    `UPDATE organizations SET wa_token_sealed = NULL, wa_phone_number_id = NULL, wa_display_phone = NULL, wa_connected_at = NULL, updated_at = now() WHERE id = $1`, [org.id])
  await audit(c, 'whatsapp.disconnected', 'organization', org.id)
  return c.json({ ok: true })
})

const templateName = z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Template names use lowercase letters, numbers and underscores.')
whatsappRoutes.patch('/settings', jsonBody(z.object(
  Object.fromEntries(WA_KINDS.map((k) => [k, z.object({ enabled: z.boolean(), template: templateName }).optional()]))
)), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const [o] = await db.query('SELECT wa_settings FROM organizations WHERE id = $1', [org.id])
  const next = { ...waSettings(o.wa_settings), ...c.req.valid('json') }
  await db.query('UPDATE organizations SET wa_settings = $2, updated_at = now() WHERE id = $1', [org.id, JSON.stringify(next)])
  await audit(c, 'whatsapp.settings_updated', 'organization', org.id, next)
  return c.json({ settings: waSettings(next) })
})

// Sends one template with sample values, to check it has been approved in Meta's WhatsApp Manager.
whatsappRoutes.post('/test', jsonBody(z.object({
  phone: z.string().trim().min(6).max(40),
  kind: z.enum(WA_KINDS),
  language: z.enum(['en', 'ar'])
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org, user } = auth(c)
  const b = c.req.valid('json')
  const deps = c.get('deps')
  const [o] = await deps.db.query(
    `SELECT o.wa_token_sealed, o.wa_phone_number_id, o.wa_display_phone, o.wa_settings, b.firm_name, b.firm_name_ar FROM organizations o
       LEFT JOIN branding b ON b.org_id = o.id WHERE o.id = $1`, [org.id])
  const acct = waAccount(deps.config, o)
  if (!acct) throw conflict('Connect your WhatsApp Business number first.')
  const to = normalizePhone(b.phone, org.default_jurisdiction)
  if (!to) throw badRequest('Enter a mobile number with its country code, e.g. +968 9123 4567.')
  const template = waSettings(o.wa_settings)[b.kind].template
  const firm = (b.language === 'ar' ? o.firm_name_ar || o.firm_name : o.firm_name) || org.name
  const [row] = await deps.db.query(
    `INSERT INTO whatsapp_messages (org_id, kind, to_phone, template, language, sent_by) VALUES ($1, 'test', $2, $3, $4, $5) RETURNING id`,
    [org.id, to, template, b.language, user.id])
  try {
    const wamid = await sendTemplate(deps.waFetch ?? fetch, acct, to, template, b.language, sampleParams(b.kind, b.language, firm, deps.config.appUrl))
    await deps.db.query(`UPDATE whatsapp_messages SET status = 'sent', wamid = $2 WHERE id = $1`, [row.id, wamid])
  } catch (err) {
    const message = (err as Error).message
    await deps.db.query(`UPDATE whatsapp_messages SET status = 'failed', error = $2 WHERE id = $1`, [row.id, message.slice(0, 500)])
    if (err instanceof WaError && err.status < 500) throw badRequest(`WhatsApp refused the message: ${message}`)
    throw new HttpError(503, 'whatsapp_unavailable', 'WhatsApp could not be reached. Please try again.')
  }
  await audit(c, 'whatsapp.test_sent', 'organization', org.id, { kind: b.kind, language: b.language })
  return c.json({ ok: true })
})

export default whatsappRoutes
