import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { z } from 'zod'
import { auth, clientIp, type AppEnv, type Deps } from '../context'
import { HttpError, unauthorized } from '../lib/errors'
import { jsonBody } from '../lib/http'
import { RateLimiter } from '../lib/rate-limit'
import { loadUserContext, SESSION_COOKIE } from '../middleware/session'
import {
  checkCode, createDemoFirm, demoEnded, demoInfo, newLoginSession, seedFirm, setDemoCookie, type DemoRequest
} from '../services/demo'
import { mePayload } from './auth'

// ---------------------------------------------------------------------------
// Signing in with a SmarThinkerz Hub access code (sales hires), resetting the demo, and its status.
// ---------------------------------------------------------------------------

// One message for every refused code: no hint about why (unknown, expired, revoked or paused).
const REFUSED = 'This access code cannot be used. Check it and try again, or ask SmarThinkerz for a new one.'
const UNAVAILABLE = 'We cannot check access codes right now. Please try again in a few minutes.'
const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.'

export function demoRoutes(deps: Deps, request: DemoRequest) {
  const { db, config, log } = deps
  const app = new Hono<AppEnv>()
  // Five failed codes per 15 minutes per address, then a pause. Successful sign-ins do not count.
  const failures = new RateLimiter(5, 15 * 60_000, 'demo:failures')

  const sessionExpiry = () => new Date(Date.now() + config.demo.sessionHours * 3600_000)

  // Signs the browser in as the demo firm's owner.
  const signIn = async (c: any, userId: string, expires: Date) => {
    const token = await newLoginSession(db, userId, expires)
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: config.isProduction, sameSite: 'Lax', path: '/', expires })
    await loadUserContext(c, userId)
  }

  app.post('/access', jsonBody(z.object({ code: z.string().trim().min(1).max(64), locale: z.enum(['en', 'ar']).default('en') })), async (c) => {
    const ip = clientIp(c)
    const pause = failures.blocked(ip)
    if (pause.blocked) {
      c.header('Retry-After', String(pause.retryAfterSec))
      throw new HttpError(429, 'too_many_requests', TOO_MANY)
    }
    const { code, locale } = c.req.valid('json')
    const verdict = await checkCode(deps, code)
    if (!verdict.ok) {
      // The reason is logged; the code never is.
      log.warn('access code refused', { reason: verdict.reason })
      if (verdict.reason === 'validator_unavailable') throw new HttpError(503, 'access_code_unavailable', UNAVAILABLE)
      failures.take(ip)
      throw new HttpError(401, 'access_code_refused', REFUSED)
    }
    const expires = sessionExpiry()
    const firm = await createDemoFirm(db, { hireName: verdict.hireName, locale, expires })
    const [row] = await db.query(
      `INSERT INTO demo_sessions (org_id, user_id, hire_name, code_type, expires_at, ai_daily_cap_usd, price_in_per_mtok, price_out_per_mtok)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [firm.orgId, firm.userId, verdict.hireName, verdict.codeType, expires, config.demo.aiDailyCapUsd, config.ai.priceInputPerMTok, config.ai.priceOutputPerMTok])
    try {
      await seedFirm(db, request, firm.userId)
    } catch (err) {
      log.error('demo seed failed', { err })
      await db.query(`UPDATE demo_sessions SET ended_at = now(), end_reason = 'seed_failed' WHERE id = $1`, [row.id])
      await db.query('DELETE FROM organizations WHERE id = $1 AND is_demo', [firm.orgId])
      throw new HttpError(500, 'demo_unavailable', 'The demo workspace could not be prepared. Please try again.')
    }
    setDemoCookie(c, code, expires)
    await signIn(c, firm.userId, expires)
    log.info('demo session started', { demoSession: row.id, hire: verdict.hireName })
    return c.json(await mePayload(c), 201)
  })

  // Restores the sample data: a fresh demo firm replaces the current one in the same session.
  app.post('/reset', async (c) => {
    const { user, org } = auth(c)
    if (!org.is_demo) throw unauthorized()
    const [s] = await db.query('SELECT id, expires_at, hire_name FROM demo_sessions WHERE org_id = $1 AND ended_at IS NULL', [org.id])
    if (!s) throw demoEnded()
    const expires = new Date(s.expires_at)
    const firm = await createDemoFirm(db, { hireName: s.hire_name, locale: user.locale === 'ar' ? 'ar' : 'en', expires })
    await db.query('UPDATE demo_sessions SET org_id = $2, user_id = $3, resets = resets + 1 WHERE id = $1', [s.id, firm.orgId, firm.userId])
    try {
      await seedFirm(db, request, firm.userId)
    } catch (err) {
      log.error('demo reset seed failed', { err })
      throw new HttpError(500, 'demo_unavailable', 'The demo workspace could not be reset. Please try again.')
    } finally {
      // The old firm, its user and its sessions go in one cascade.
      await db.query('DELETE FROM organizations WHERE id = $1 AND is_demo', [org.id])
    }
    await signIn(c, firm.userId, expires)
    return c.json(await mePayload(c))
  })

  app.get('/', async (c) => {
    const { org } = auth(c)
    if (!org.is_demo) return c.json({ demo: null })
    return c.json({ demo: await demoInfo(db, org.id) })
  })

  return app
}
