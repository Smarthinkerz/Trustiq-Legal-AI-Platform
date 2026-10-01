import { Hono } from 'hono'
import { z } from 'zod'
import QRCode from 'qrcode'
import { audit, auth, clientIp, type AppEnv, type Ctx } from '../context'
import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from '../lib/crypto'
import { badRequest, conflict, HttpError, tooMany, unauthorized } from '../lib/errors'
import { jsonBody } from '../lib/http'
import { PLAN_PRICES, planOf, subscriptionExpired, TRIAL_DAYS, trialExpired } from '../lib/plans'
import { newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from '../lib/totp'
import { createSession, destroySession, loadUserContext } from '../middleware/session'
import { usageThisMonth } from '../services/usage'

const MAX_FAILED_LOGINS = 8
const LOCK_MINUTES = 15
const RESET_TOKEN_HOURS = 2
const MFA_TOKEN_MINUTES = 5

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(10, 'Password must be at least 10 characters').max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Password must contain letters and numbers')
const name = z.string().trim().min(2).max(120)
const locale = z.enum(['en', 'ar'])
const otp = z.string().trim().min(6).max(20)

function rateLimit(c: Ctx, bucket: string) {
  const r = c.get('deps').limiters.auth.take(`${bucket}:${clientIp(c)}`)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('Too many attempts. Please wait a few minutes and try again.')
  }
}

export async function mePayload(c: Ctx) {
  const { user, org } = auth(c)
  const { config, ai, db, mailer } = c.get('deps')
  const [usage, branding, client] = await Promise.all([
    usageThisMonth(db, org.id),
    db.one('SELECT firm_name, firm_name_ar, primary_color, accent_color, (logo IS NOT NULL) AS has_logo FROM branding WHERE org_id = $1', [org.id]),
    user.client_id ? db.one('SELECT id, name, name_ar FROM clients WHERE id = $1', [user.client_id]) : Promise.resolve(null)
  ])
  return {
    user,
    org: { ...org, trial_expired: trialExpired(org), subscription_expired: subscriptionExpired(org) },
    plan: { id: org.plan, ...planOf(org) },
    usage,
    branding: branding ?? null,
    client: client ?? null,
    features: { ai: ai.configured, email: mailer.configured, payments: c.get('deps').tap.configured },
    prices: PLAN_PRICES,
    is_platform_admin: user.role !== 'client' && config.platformAdminEmails.includes(user.email.toLowerCase()),
    support_email: config.supportEmail,
    sales_email: config.salesEmail
  }
}

async function recordFailure(c: Ctx, userId: string, failedLogins: number) {
  const failed = failedLogins + 1
  const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null
  await c.get('deps').db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [userId, lock ? 0 : failed, lock])
}

const lockedError = () =>
  new HttpError(423, 'account_locked', 'This account is temporarily locked after too many failed attempts. Try again later or reset your password.')

async function completeLogin(c: Ctx, userId: string) {
  await c.get('deps').db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [userId])
  await createSession(c, userId)
  await loadUserContext(c, userId)
  await audit(c, 'auth.login', 'user', userId)
  return c.json(await mePayload(c))
}

const authRoutes = new Hono<AppEnv>()

authRoutes.post('/register', jsonBody(z.object({
  name, email, password, locale: locale.default('en'),
  firm_name: z.string().trim().min(2).max(160),
  accept_terms: z.literal(true, { message: 'You must accept the terms of service' })
})), async (c) => {
  rateLimit(c, 'register')
  const body = c.req.valid('json')
  const { db } = c.get('deps')
  const passwordHash = await hashPassword(body.password)
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400_000)
  let ids: { userId: string; orgId: string }
  try {
    ids = await db.tx(async (q) => {
      const org = await q.one('INSERT INTO organizations (name, plan, trial_ends_at) VALUES ($1, $2, $3) RETURNING id', [body.firm_name, 'trial', trialEnds])
      await q.query('INSERT INTO branding (org_id, firm_name) VALUES ($1, $2)', [org!.id, body.firm_name])
      const u = await q.one(
        'INSERT INTO users (org_id, email, name, password_hash, role, locale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [org!.id, body.email, body.name, passwordHash, 'owner', body.locale]
      )
      return { userId: u!.id as string, orgId: org!.id as string }
    })
  } catch (err: any) {
    if (err?.code === '23505') throw conflict('An account with this email already exists.')
    throw err
  }
  await createSession(c, ids.userId)
  await loadUserContext(c, ids.userId)
  await audit(c, 'auth.register', 'organization', ids.orgId)
  return c.json(await mePayload(c), 201)
})

authRoutes.post('/login', jsonBody(z.object({ email, password: z.string().min(1).max(200) })), async (c) => {
  rateLimit(c, 'login')
  const { email: em, password: pw } = c.req.valid('json')
  const { db } = c.get('deps')
  const u = await db.one('SELECT id, org_id, email, password_hash, failed_logins, locked_until, deactivated_at, totp_enabled_at FROM users WHERE lower(email) = $1', [em])
  if (!u || u.deactivated_at) {
    await verifyPassword(pw, DUMMY_HASH)
    throw unauthorized('Incorrect email or password.')
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) throw lockedError()
  if (!(await verifyPassword(pw, u.password_hash))) {
    await recordFailure(c, u.id, u.failed_logins)
    throw unauthorized('Incorrect email or password.')
  }
  if (u.totp_enabled_at) {
    // Password is correct; issue a short-lived ticket that must be exchanged with a 2FA code.
    const ticket = newToken()
    await db.query(
      `INSERT INTO auth_tokens (id, kind, org_id, user_id, email, expires_at) VALUES ($1, 'mfa', $2, $3, $4, $5)`,
      [hashToken(ticket), u.org_id, u.id, u.email, new Date(Date.now() + MFA_TOKEN_MINUTES * 60_000)])
    return c.json({ mfa_required: true, mfa_token: ticket })
  }
  return completeLogin(c, u.id)
})

authRoutes.post('/login/mfa', jsonBody(z.object({ mfa_token: z.string().min(20).max(200), code: otp })), async (c) => {
  rateLimit(c, 'mfa')
  const { mfa_token, code } = c.req.valid('json')
  const { db } = c.get('deps')
  const t = await db.one(
    `SELECT t.user_id, u.totp_secret, u.totp_recovery_codes, u.failed_logins, u.locked_until
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.id = $1 AND t.kind = 'mfa' AND t.used_at IS NULL AND t.expires_at > now() AND u.deactivated_at IS NULL`,
    [hashToken(mfa_token)])
  if (!t) throw unauthorized('Your sign-in session expired. Please sign in again.')
  if (t.locked_until && new Date(t.locked_until).getTime() > Date.now()) throw lockedError()
  let ok = verifyTotp(t.totp_secret, code)
  if (!ok) {
    // Recovery codes are single-use.
    const hashed = hashToken(code.toUpperCase().replace(/\s/g, ''))
    if ((t.totp_recovery_codes ?? []).includes(hashed)) {
      await db.query('UPDATE users SET totp_recovery_codes = array_remove(totp_recovery_codes, $2) WHERE id = $1', [t.user_id, hashed])
      ok = true
    }
  }
  if (!ok) {
    await recordFailure(c, t.user_id, t.failed_logins)
    throw unauthorized('That code is not correct. Check your authenticator app and try again.')
  }
  await db.query(`UPDATE auth_tokens SET used_at = now() WHERE id = $1`, [hashToken(mfa_token)])
  return completeLogin(c, t.user_id)
})

authRoutes.post('/logout', async (c) => {
  if (c.get('user')) await audit(c, 'auth.logout', 'user', c.get('user')!.id)
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', async (c) => c.json(await mePayload(c)))

authRoutes.patch('/me', jsonBody(z.object({ name: name.optional(), locale: locale.optional(), notify_email: z.boolean().optional() })), async (c) => {
  const { user } = auth(c)
  const body = c.req.valid('json')
  await c.get('deps').db.query(
    'UPDATE users SET name = COALESCE($2, name), locale = COALESCE($3, locale), notify_email = COALESCE($4, notify_email), updated_at = now() WHERE id = $1',
    [user.id, body.name ?? null, body.locale ?? null, body.notify_email ?? null]
  )
  await loadUserContext(c, user.id)
  return c.json(await mePayload(c))
})

authRoutes.get('/preferences', async (c) => {
  const { user } = auth(c)
  const { db, config } = c.get('deps')
  const row = await db.one('SELECT notify_email, calendar_token, totp_enabled_at, cardinality(totp_recovery_codes) AS recovery_left FROM users WHERE id = $1', [user.id])
  return c.json({
    notify_email: row!.notify_email,
    calendar_url: row!.calendar_token ? `${config.appUrl}/calendar/${row!.calendar_token}.ics` : null,
    two_factor: !!row!.totp_enabled_at,
    recovery_codes_left: row!.recovery_left ?? 0
  })
})

authRoutes.post('/calendar-token', async (c) => {
  const { user } = auth(c)
  const token = newToken()
  await c.get('deps').db.query('UPDATE users SET calendar_token = $2 WHERE id = $1', [user.id, token])
  await audit(c, 'auth.calendar_feed_reset', 'user', user.id)
  return c.json({ calendar_url: `${c.get('deps').config.appUrl}/calendar/${token}.ics` })
})

authRoutes.post('/change-password', jsonBody(z.object({ current_password: z.string().min(1), new_password: password })), async (c) => {
  const { user } = auth(c)
  rateLimit(c, 'change-password')
  const { current_password, new_password } = c.req.valid('json')
  const { db } = c.get('deps')
  const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [user.id])
  if (!row || !(await verifyPassword(current_password, row.password_hash))) throw badRequest('Current password is incorrect.')
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, await hashPassword(new_password)])
  // Sign out every other device.
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, c.get('sessionId')])
  await audit(c, 'auth.password_changed', 'user', user.id)
  return c.json({ ok: true })
})

// ---- Two-factor authentication ----

authRoutes.post('/2fa/setup', async (c) => {
  const { user } = auth(c)
  const { db } = c.get('deps')
  const row = await db.one('SELECT totp_enabled_at FROM users WHERE id = $1', [user.id])
  if (row!.totp_enabled_at) throw conflict('Two-factor authentication is already enabled.')
  const secret = newTotpSecret()
  await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [user.id, secret])
  const uri = otpauthUri(secret, user.email)
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
  return c.json({ secret, otpauth_uri: uri, qr_data_url: qr })
})

authRoutes.post('/2fa/enable', jsonBody(z.object({ code: otp })), async (c) => {
  const { user } = auth(c)
  rateLimit(c, '2fa')
  const { db } = c.get('deps')
  const row = await db.one('SELECT totp_secret, totp_enabled_at FROM users WHERE id = $1', [user.id])
  if (row!.totp_enabled_at) throw conflict('Two-factor authentication is already enabled.')
  if (!row!.totp_secret || !verifyTotp(row!.totp_secret, c.req.valid('json').code)) throw badRequest('That code is not correct. Scan the QR code again and enter the current 6-digit code.')
  const codes = newRecoveryCodes()
  await db.query('UPDATE users SET totp_enabled_at = now(), totp_recovery_codes = $2 WHERE id = $1', [user.id, codes.map((x) => hashToken(x))])
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, c.get('sessionId')])
  await audit(c, 'auth.2fa_enabled', 'user', user.id)
  return c.json({ ok: true, recovery_codes: codes })
})

authRoutes.post('/2fa/disable', jsonBody(z.object({ password: z.string().min(1), code: otp })), async (c) => {
  const { user } = auth(c)
  rateLimit(c, '2fa')
  const body = c.req.valid('json')
  const { db } = c.get('deps')
  const row = await db.one('SELECT password_hash, totp_secret, totp_enabled_at FROM users WHERE id = $1', [user.id])
  if (!row!.totp_enabled_at) throw badRequest('Two-factor authentication is not enabled.')
  if (!(await verifyPassword(body.password, row!.password_hash))) throw badRequest('Current password is incorrect.')
  if (!verifyTotp(row!.totp_secret, body.code)) throw badRequest('That code is not correct.')
  await db.query('UPDATE users SET totp_enabled_at = NULL, totp_secret = NULL, totp_recovery_codes = NULL WHERE id = $1', [user.id])
  await audit(c, 'auth.2fa_disabled', 'user', user.id)
  return c.json({ ok: true })
})

// ---- Password reset ----

authRoutes.post('/forgot-password', jsonBody(z.object({ email })), async (c) => {
  rateLimit(c, 'forgot')
  const { email: em } = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const u = await db.one('SELECT id, org_id, name, email, locale FROM users WHERE lower(email) = $1 AND deactivated_at IS NULL', [em])
  if (u) {
    const token = newToken()
    await db.query(
      `INSERT INTO auth_tokens (id, kind, org_id, user_id, email, expires_at) VALUES ($1, 'password_reset', $2, $3, $4, $5)`,
      [hashToken(token), u.org_id, u.id, u.email, new Date(Date.now() + RESET_TOKEN_HOURS * 3600_000)]
    )
    const link = `${config.appUrl}/app#/reset-password?token=${token}`
    const ar = u.locale === 'ar'
    await mailer.send({
      to: u.email,
      subject: ar ? 'إعادة تعيين كلمة المرور - TrustiqLegal' : 'Reset your TrustiqLegal password',
      text: ar
        ? `مرحباً ${u.name}،\n\nلإعادة تعيين كلمة المرور، افتح الرابط التالي خلال ساعتين:\n${link}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.`
        : `Hello ${u.name},\n\nTo reset your password, open this link within ${RESET_TOKEN_HOURS} hours:\n${link}\n\nIf you did not request this, you can ignore this email.`
    }).catch((err) => log.error('password reset email failed', { err }))
  }
  // Same response whether or not the account exists, to avoid account enumeration.
  return c.json({ ok: true })
})

authRoutes.post('/reset-password', jsonBody(z.object({ token: z.string().min(20).max(200), password })), async (c) => {
  rateLimit(c, 'reset')
  const { token, password: pw } = c.req.valid('json')
  const { db } = c.get('deps')
  const hash = await hashPassword(pw)
  const userId = await db.tx(async (q) => {
    const t = await q.one(
      `UPDATE auth_tokens SET used_at = now() WHERE id = $1 AND kind = 'password_reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [hashToken(token)]
    )
    if (!t) return null
    await q.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [t.user_id, hash])
    await q.query('DELETE FROM sessions WHERE user_id = $1', [t.user_id])
    return t.user_id as string
  })
  if (!userId) throw badRequest('This reset link is invalid or has expired. Request a new one.')
  await loadUserContext(c, userId)
  await audit(c, 'auth.password_reset', 'user', userId)
  return c.json({ ok: true })
})

// ---- Invitations (team members and client-portal users) ----

authRoutes.get('/invite/:token', async (c) => {
  const row = await c.get('deps').db.one(
    `SELECT t.email, t.role, o.name AS org_name, cl.name AS client_name FROM auth_tokens t
       JOIN organizations o ON o.id = t.org_id LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE t.id = $1 AND t.kind = 'invite' AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(c.req.param('token'))]
  )
  if (!row) throw badRequest('This invitation is invalid or has expired. Ask your administrator for a new one.')
  return c.json(row)
})

authRoutes.post('/accept-invite', jsonBody(z.object({ token: z.string().min(20).max(200), name, password, locale: locale.default('en') })), async (c) => {
  rateLimit(c, 'invite')
  const body = c.req.valid('json')
  const { db } = c.get('deps')
  const hash = await hashPassword(body.password)
  let userId: string | null
  try {
    userId = await db.tx(async (q) => {
      const t = await q.one(
        `UPDATE auth_tokens SET used_at = now() WHERE id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now() RETURNING org_id, email, role, client_id`,
        [hashToken(body.token)]
      )
      if (!t) return null
      const u = await q.one(
        'INSERT INTO users (org_id, email, name, password_hash, role, locale, client_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [t.org_id, t.email, body.name, hash, t.role, body.locale, t.client_id]
      )
      return u!.id as string
    })
  } catch (err: any) {
    if (err?.code === '23505') throw conflict('An account with this email already exists. Sign in instead.')
    throw err
  }
  if (!userId) throw badRequest('This invitation is invalid or has expired. Ask your administrator for a new one.')
  await createSession(c, userId)
  await loadUserContext(c, userId)
  await audit(c, 'auth.invite_accepted', 'user', userId)
  return c.json(await mePayload(c), 201)
})

export default authRoutes
