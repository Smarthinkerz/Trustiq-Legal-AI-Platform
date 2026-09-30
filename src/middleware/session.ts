import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { clientIp, type AppEnv, type Ctx } from '../context'
import { hashToken, newToken } from '../lib/crypto'
import { paymentRequired } from '../lib/errors'
import { subscriptionExpired, trialExpired } from '../lib/plans'

export const SESSION_COOKIE = 'tq_session'
export const SESSION_DAYS = 14
const TOUCH_INTERVAL_MS = 10 * 60 * 1000

const USER_COLUMNS = `u.id, u.org_id, u.email, u.name, u.role, u.locale, u.client_id, (u.totp_enabled_at IS NOT NULL) AS two_factor,
  o.name AS org_name, o.plan, o.trial_ends_at, o.plan_expires_at, o.default_jurisdiction, o.default_currency`

function setUserContext(c: Ctx, row: any) {
  c.set('user', {
    id: row.id, org_id: row.org_id, email: row.email, name: row.name, role: row.role, locale: row.locale,
    client_id: row.client_id ?? null, two_factor: !!row.two_factor
  })
  c.set('org', {
    id: row.org_id, name: row.org_name, plan: row.plan, trial_ends_at: row.trial_ends_at, plan_expires_at: row.plan_expires_at ?? null,
    default_jurisdiction: row.default_jurisdiction, default_currency: row.default_currency
  })
}

// Loads a user and their organization into the request context (after sign-in, registration, etc.).
export async function loadUserContext(c: Ctx, userId: string) {
  const row = await c.get('deps').db.one(
    `SELECT ${USER_COLUMNS} FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [userId])
  if (!row) throw new Error('user not found')
  setUserContext(c, row)
}

export async function createSession(c: Ctx, userId: string) {
  const { db, config } = c.get('deps')
  const token = newToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await db.query(
    'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), userId, expires, clientIp(c), c.req.header('user-agent')?.slice(0, 300) ?? null]
  )
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'Lax',
    path: '/',
    expires
  })
}

export async function destroySession(c: Ctx) {
  const id = c.get('sessionId')
  if (id) await c.get('deps').db.query('DELETE FROM sessions WHERE id = $1', [id])
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

// Resolves the session cookie into c.var.user / c.var.org. Never throws for anonymous requests.
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const { db } = c.get('deps')
    const id = hashToken(token)
    const row = await db.one(
      `SELECT s.id AS session_id, s.last_seen_at, ${USER_COLUMNS}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organizations o ON o.id = u.org_id
        WHERE s.id = $1 AND s.expires_at > now() AND u.deactivated_at IS NULL`,
      [id]
    )
    if (row) {
      c.set('sessionId', row.session_id)
      setUserContext(c, row)
      if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
        await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id])
      }
    } else {
      deleteCookie(c, SESSION_COOKIE, { path: '/' })
    }
  }
  await next()
}

// Expired trials keep read access (and data export) but cannot create or modify records.
export const requireActiveSubscription: MiddlewareHandler<AppEnv> = async (c, next) => {
  const org = c.get('org')
  if (org && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (trialExpired(org)) throw paymentRequired('trial_expired', 'Your free trial has ended. Choose a plan to continue making changes.')
    if (subscriptionExpired(org)) throw paymentRequired('subscription_expired', 'Your subscription has ended. Renew your plan to continue making changes.')
  }
  await next()
}
