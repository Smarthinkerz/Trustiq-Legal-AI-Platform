import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { getCookie, deleteCookie, setCookie } from 'hono/cookie'
import type { Config } from '../config'
import type { AppEnv, Ctx, Deps } from '../context'
import type { Db, Queryable } from '../db'
import { HttpError } from '../lib/errors'
import { open, seal } from '../lib/secret-box'
import { SESSION_COOKIE } from '../middleware/session'
import { validateDemoCode, type DemoVerdict } from './hub-demo'

// ---------------------------------------------------------------------------
// Demo workspaces for SmarThinkerz sales hires. A hire signs in with their Hub access code; each
// session opens its own invented firm (organizations.is_demo), seeded with sample data. The code is
// checked by the Hub and never stored by TrustIQ: the browser keeps it sealed in an HttpOnly cookie,
// so the server can ask the Hub again and end the session soon after the code is revoked.
// ---------------------------------------------------------------------------

export const DEMO_COOKIE = 'tq_demo'
// Marks the app's own seeding requests (random per process, never sent to a browser).
export const INTERNAL_SEED_TOKEN = randomUUID()
export const DEMO_EMAIL_DOMAIN = 'demo.trustiq.invalid'
// The Hub may be briefly unreachable during a demo; after this long without a good answer the session ends.
const HUB_GRACE_MS = 10 * 60_000

const demoSecret = (config: Config) => config.encryptionKey ?? config.hub.partnerSecret ?? null
export const demoAvailable = (config: Config) => !!(config.hub.partnerSecret && demoSecret(config))

export const hubDemoConfig = (config: Config) => ({ url: config.hub.demoValidateUrl, appId: config.hub.appId, secret: config.hub.partnerSecret ?? '' })

export function checkCode(deps: Pick<Deps, 'config' | 'hubFetch'>, code: string): Promise<DemoVerdict> {
  if (!demoAvailable(deps.config)) return Promise.resolve({ ok: false, reason: 'validator_unavailable' })
  return validateDemoCode(hubDemoConfig(deps.config), code, deps.hubFetch ?? fetch)
}

const PURPOSE = 'demo-code:'
export const sealCode = (config: Config, code: string) => seal(PURPOSE + code, demoSecret(config)!)
export function openCode(config: Config, sealed: string | undefined | null) {
  const secret = demoSecret(config)
  if (!sealed || !secret) return null
  const plain = open(sealed, secret)
  return plain?.startsWith(PURPOSE) ? plain.slice(PURPOSE.length) : null
}

export function setDemoCookie(c: Ctx, code: string, expires: Date) {
  const { config } = c.get('deps')
  setCookie(c, DEMO_COOKIE, sealCode(config, code), { httpOnly: true, secure: config.isProduction, sameSite: 'Lax', path: '/', expires })
}

// ---------- Creating, resetting and ending a demo firm ----------

export type DemoRequest = (method: string, path: string, body: unknown, headers: Record<string, string>) => Promise<Response>

// A new invented firm with one owner, seeded through the app's own API as that owner.
export async function createDemoFirm(db: Db, opts: { hireName: string | null; locale: 'en' | 'ar'; expires: Date }) {
  const { DEMO_FIRM } = await import('./demo-seed')
  const firm = DEMO_FIRM.en
  const org = await db.one(
    `INSERT INTO organizations (name, plan, plan_expires_at, is_demo, default_jurisdiction, default_currency) VALUES ($1, 'enterprise', $2, true, 'oman', 'OMR') RETURNING id`,
    [firm, opts.expires])
  await db.query('INSERT INTO branding (org_id, firm_name, firm_name_ar) VALUES ($1, $2, $3)', [org!.id, firm, DEMO_FIRM.ar])
  const email = `demo-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`
  // No password anyone knows: a demo user can only be reached through a Hub code.
  const user = await db.one(
    `INSERT INTO users (org_id, email, name, password_hash, role, locale, notify_email) VALUES ($1, $2, $3, $4, 'owner', $5, false) RETURNING id`,
    [org!.id, email, opts.hireName ? `${opts.hireName} (demo)` : 'Demo user', `!demo:${randomUUID()}`, opts.locale])
  return { orgId: org!.id as string, userId: user!.id as string }
}

export async function newLoginSession(db: Queryable, userId: string, expires: Date) {
  const { hashToken, newToken } = await import('../lib/crypto')
  const token = newToken()
  await db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expires])
  return token
}

// Seeds a firm by calling the API as its owner with a short-lived session of its own.
export async function seedFirm(db: Queryable, request: DemoRequest, userId: string) {
  // The seeding requests run as the demo owner, flagged so the demo guard does not ask the Hub again.
  const { seedDemoFirm } = await import('./demo-seed')
  const token = await newLoginSession(db, userId, new Date(Date.now() + 10 * 60_000))
  const cookie = `${SESSION_COOKIE}=${token}`
  try {
    await seedDemoFirm(async (method, path, body) => {
      const res = await request(method, path, body, { cookie, 'x-tq-internal': INTERNAL_SEED_TOKEN })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`demo seed ${method} ${path} failed: ${res.status} ${data?.error?.code ?? ''} ${JSON.stringify(data?.error?.details ?? data?.error?.message ?? '').slice(0, 300)}`)
      return data
    })
  } finally {
    const { hashToken } = await import('../lib/crypto')
    await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)])
  }
}

export async function endDemoSession(db: Queryable, sessionRowId: string, reason: string) {
  const [s] = await db.query(
    `UPDATE demo_sessions SET ended_at = now(), end_reason = $2 WHERE id = $1 AND ended_at IS NULL RETURNING user_id`, [sessionRowId, reason])
  if (s?.user_id) await db.query('DELETE FROM sessions WHERE user_id = $1', [s.user_id])
}

// Deletes demo firms nobody can use any more (session ended or expired), keeping the session log.
export async function sweepDemoFirms(db: Queryable) {
  await db.query(`UPDATE demo_sessions SET ended_at = now(), end_reason = 'expired' WHERE ended_at IS NULL AND expires_at < now()`)
  const rows = await db.query(
    `SELECT o.id FROM organizations o WHERE o.is_demo
        AND NOT EXISTS (SELECT 1 FROM demo_sessions s WHERE s.org_id = o.id AND s.ended_at IS NULL)
        AND o.created_at < now() - interval '15 minutes' LIMIT 20`)
  for (const r of rows) await db.query('DELETE FROM organizations WHERE id = $1 AND is_demo', [r.id])
  return rows.length
}

// ---------- What a demo session may not do ----------

const NOT_IN_DEMO = 'This is turned off in the demo workspace.'
const RULES: [RegExp, string, string][] = [
  [/^\/api\/subscription(\/|$)/, 'write', 'Plans and payments are not available in the demo workspace.'],
  [/^\/api\/billing\/online-payments(\/|$)/, 'write', 'Online payment accounts cannot be connected in the demo workspace.'],
  [/^\/api\/billing\/invoices\/[^/]+\/pay-link$/, 'write', 'Payment links are not available in the demo workspace.'],
  [/^\/api\/org(\/|$)/, 'write', 'Team members, invitations and firm settings cannot be changed in the demo workspace.'],
  [/^\/api\/clients\/[^/]+\/portal-invite$/, 'write', 'Client portal invitations are not available in the demo workspace.'],
  [/^\/api\/auth\/(calendar-token|change-password|2fa\/.*)$/, 'write', 'Account security settings cannot be changed in the demo workspace.'],
  [/^\/api\/(integrations|whatsapp)(\/|$)/, 'write', 'Outside connections are not available in the demo workspace.'],
  [/^\/api\/website\/site$/, 'write', 'Publishing a public website is not available in the demo workspace.'],
  [/^\/api\/admin(\/|$)/, 'any', NOT_IN_DEMO]
]

export async function demoBlock(c: Ctx): Promise<string | null> {
  const method = c.req.method
  const path = c.req.path
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  for (const [re, when, message] of RULES) if (re.test(path) && (when === 'any' || write)) return message
  // The profile can switch language and date style, but never take over the account (email, name).
  if (path === '/api/auth/me' && method === 'PATCH') {
    const body = await c.req.json().catch(() => ({}))
    if (Object.keys(body ?? {}).some((k) => !['locale', 'hijri_dates'].includes(k))) return 'The demo profile cannot be changed.'
  }
  return null
}

// Nothing leaves the app from a demo request: no email, no WhatsApp, no calls to the Hub checkout.
function demoDeps(deps: Deps): Deps {
  const refuse = async () => { throw new HttpError(403, 'demo_blocked', 'Sending messages outside the app is turned off in the demo workspace.') }
  return {
    ...deps,
    mailer: { configured: true, send: refuse },
    waFetch: refuse as unknown as typeof fetch,
    hubFetch: refuse as unknown as typeof fetch
  }
}

const sectionOf = (path: string) => path.split('/')[2]?.replace(/[^\w-]/g, '').slice(0, 40) || null
const seen = new Map<string, Set<string>>()

async function trackFeature(db: Queryable, sessionRowId: string, path: string) {
  const section = sectionOf(path)
  if (!section || ['auth', 'demo', 'reference', 'dashboard'].includes(section)) return
  let set = seen.get(sessionRowId)
  if (!set) { set = new Set(); seen.set(sessionRowId, set); if (seen.size > 2000) seen.delete(seen.keys().next().value!) }
  if (set.has(section)) return
  set.add(section)
  await db.query(`UPDATE demo_sessions SET features_used = array_append(features_used, $2) WHERE id = $1 AND NOT ($2 = ANY(features_used))`, [sessionRowId, section])
}

export const demoEnded = () => new HttpError(401, 'demo_ended', 'This demo session has ended. Sign in again with your access code.')

// Runs on every API request of a demo firm: ends the session when its code is no longer live,
// refuses what a demo may not do, and keeps the session log.
export const demoGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const org = c.get('org')
  if (!org?.is_demo) return next()
  const deps = c.get('deps')
  const { db, config, log } = deps
  const s = await db.one(`SELECT id, expires_at, last_ok_at FROM demo_sessions WHERE org_id = $1 AND ended_at IS NULL`, [org.id])
  const end = async (reason: string) => {
    if (s) await endDemoSession(db, s.id, reason)
    else await db.query('DELETE FROM sessions WHERE user_id = $1', [c.get('user')!.id])
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    deleteCookie(c, DEMO_COOKIE, { path: '/' })
    log.info('demo session ended', { reason, demoSession: s?.id ?? null })
    return demoEnded()
  }
  if (!s || new Date(s.expires_at).getTime() <= Date.now()) throw await end('expired')
  if (c.req.header('x-tq-internal') === INTERNAL_SEED_TOKEN) return next()
  // One request per interval (across instances) asks the Hub again; the others go ahead.
  const [claim] = await db.query(
    `UPDATE demo_sessions SET last_checked_at = now() WHERE id = $1 AND last_checked_at <= now() - ($2::int * interval '1 second') RETURNING id`,
    [s.id, config.demo.recheckSeconds])
  if (claim) {
    const code = openCode(config, getCookie(c, DEMO_COOKIE))
    if (!code) throw await end('code_missing')
    const verdict = await checkCode(deps, code)
    if (verdict.ok) await db.query('UPDATE demo_sessions SET last_ok_at = now() WHERE id = $1', [s.id])
    else if (verdict.reason !== 'validator_unavailable') throw await end(`hub_${verdict.reason}`)
    else if (Date.now() - new Date(s.last_ok_at).getTime() > HUB_GRACE_MS) throw await end('hub_unreachable')
    else log.warn('demo recheck: the Hub could not be reached', { demoSession: s.id })
  }
  const blocked = await demoBlock(c)
  if (blocked) throw new HttpError(403, 'demo_blocked', blocked)
  await trackFeature(db, s.id, c.req.path).catch(() => {})
  c.set('deps', demoDeps(deps))
  await next()
  if (c.req.path === '/api/auth/logout' && c.res.ok) await endDemoSession(db, s.id, 'signed_out')
  // Nothing is downloaded out of a demo firm.
  if (/attachment/i.test(c.res.headers.get('content-disposition') ?? '')) {
    c.res = new Response(JSON.stringify({ error: { code: 'demo_blocked', message: 'Downloads and exports are turned off in the demo workspace.' } }),
      { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  }
}

// ---------- AI allowance ----------

export async function assertDemoAiAllowance(db: Queryable, orgId: string) {
  const [s] = await db.query(
    `SELECT ai_daily_cap_usd, CASE WHEN ai_day = (timezone('UTC', now()) + interval '4 hours')::date THEN ai_day_cost_usd ELSE 0 END AS today
       FROM demo_sessions WHERE org_id = $1 AND ended_at IS NULL`, [orgId])
  if (!s) throw demoEnded()
  if (Number(s.today) >= Number(s.ai_daily_cap_usd)) {
    throw new HttpError(429, 'demo_ai_cap', 'This demo workspace has used today\'s AI allowance. Everything else keeps working, and the AI is available again tomorrow.')
  }
}

export async function demoInfo(db: Queryable, orgId: string) {
  const [s] = await db.query(
    `SELECT hire_name, started_at, expires_at, ai_daily_cap_usd, ai_cost_usd,
            CASE WHEN ai_day = (timezone('UTC', now()) + interval '4 hours')::date THEN ai_day_cost_usd ELSE 0 END AS ai_today_usd
       FROM demo_sessions WHERE org_id = $1 AND ended_at IS NULL`, [orgId])
  return s ? { hire_name: s.hire_name, started_at: s.started_at, expires_at: s.expires_at, ai_daily_cap_usd: Number(s.ai_daily_cap_usd), ai_today_usd: Number(s.ai_today_usd) } : null
}
