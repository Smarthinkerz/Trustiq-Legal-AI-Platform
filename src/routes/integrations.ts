import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { timingSafeEqual } from 'node:crypto'
import { audit, auth, type AppEnv, type Ctx } from '../context'
import { tooMany, unavailable } from '../lib/errors'
import { newToken } from '../lib/crypto'
import { authorizationUrl, connectWithCode, redirectUri, disconnect, GoogleError, syncNow, type GoogleDeps } from '../services/google-calendar'

const STATE_COOKIE = 'tq_google_state'
const STATE_PATH = '/api/integrations/google'

const integrationsRoutes = new Hono<AppEnv>()

const googleDeps = (c: Ctx): GoogleDeps => {
  const { db, config, log, googleFetch } = c.get('deps')
  return { db, config, log, fetch: googleFetch }
}

const requireGoogle = (c: Ctx) => {
  if (!c.get('deps').config.google) throw unavailable('google_not_configured', 'Google Calendar sync is not set up on this server.')
}

integrationsRoutes.get('/google', async (c) => {
  const { user } = auth(c)
  const { db, config } = c.get('deps')
  const conn = await db.one(
    `SELECT account_email, calendar_id, last_synced_at, last_error, needs_sync, created_at,
            (SELECT count(*)::int FROM calendar_sync_items i WHERE i.user_id = c.user_id) AS items
       FROM calendar_connections c WHERE user_id = $1`, [user.id])
  // Owners and admins see setup problems so they can fix the server variables.
  const setup = user.role === 'owner' || user.role === 'admin'
    ? { client_id: config.google?.clientId ?? null, redirect_uri: config.google ? redirectUri(config) : null, problems: config.google?.problems ?? [] }
    : undefined
  return c.json({ configured: !!config.google, connected: !!conn, connection: conn ?? null, setup })
})

integrationsRoutes.post('/google/connect', async (c) => {
  requireGoogle(c)
  auth(c)
  const state = newToken()
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: c.get('deps').config.isProduction, sameSite: 'Lax', path: STATE_PATH, maxAge: 600 })
  return c.json({ url: authorizationUrl(c.get('deps').config, state) })
})

// Google redirects the browser here after consent. Always lands back in the app.
integrationsRoutes.get('/google/callback', async (c) => {
  const back = (result: string) => c.redirect(`/app#/settings?tab=profile&google=${result}`, 302)
  requireGoogle(c)
  const { user } = auth(c)
  const expected = getCookie(c, STATE_COOKIE) ?? ''
  const state = c.req.query('state') ?? ''
  deleteCookie(c, STATE_COOKIE, { path: STATE_PATH })
  const sameState = expected.length > 0 && expected.length === state.length && timingSafeEqual(Buffer.from(expected), Buffer.from(state))
  if (!sameState) return back('expired')
  if (c.req.query('error')) return back('denied')
  const code = c.req.query('code')
  if (!code) return back('error')
  const d = googleDeps(c)
  try {
    const { email } = await connectWithCode(d, user, code)
    await audit(c, 'integration.google_connected', 'user', user.id, { email })
  } catch (err) {
    d.log.warn('google connect failed', { err })
    return back(err instanceof GoogleError && err.code === 'scope' ? 'scope' : 'error')
  }
  // First sync in the background; the settings page shows progress.
  syncNow(d, user.id).catch(() => {})
  return back('connected')
})

integrationsRoutes.post('/google/sync', async (c) => {
  requireGoogle(c)
  const { user } = auth(c)
  const r = c.get('deps').limiters.ai.take(`gsync:${user.id}`)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('Please wait a moment before syncing again.')
  }
  const d = googleDeps(c)
  if (!(await d.db.one('SELECT 1 FROM calendar_connections WHERE user_id = $1', [user.id]))) return c.json({ error: { code: 'not_connected', message: 'Google Calendar is not connected.' } }, 404)
  try {
    const stats = await syncNow(d, user.id)
    if (!stats) return c.json({ ok: true, busy: true, created: 0, updated: 0, deleted: 0 })
    return c.json({ ok: true, ...stats })
  } catch (err) {
    const row = await d.db.one('SELECT last_error FROM calendar_connections WHERE user_id = $1', [user.id])
    return c.json({ error: { code: 'sync_failed', message: row?.last_error ?? 'Sync failed.' } }, 502)
  }
})

integrationsRoutes.delete('/google', async (c) => {
  const { user } = auth(c)
  const removed = await disconnect(googleDeps(c), user.id)
  if (removed) await audit(c, 'integration.google_disconnected', 'user', user.id)
  return c.json({ ok: true })
})

export default integrationsRoutes
