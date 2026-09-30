import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, clientIp, type AppEnv, type Ctx } from '../context'
import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from '../lib/crypto'
import { badRequest, conflict, HttpError, tooMany, unauthorized } from '../lib/errors'
import { jsonBody } from '../lib/http'
import { planOf, TRIAL_DAYS, trialExpired } from '../lib/plans'
import { createSession, destroySession } from '../middleware/session'
import { usageThisMonth } from '../services/usage'

const MAX_FAILED_LOGINS = 8
const LOCK_MINUTES = 15
const RESET_TOKEN_HOURS = 2

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(10, 'Password must be at least 10 characters').max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Password must contain letters and numbers')
const name = z.string().trim().min(2).max(120)
const locale = z.enum(['en', 'ar'])

function rateLimit(c: Ctx, bucket: string) {
  const r = c.get('deps').limiters.auth.take(`${bucket}:${clientIp(c)}`)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('Too many attempts. Please wait a few minutes and try again.')
  }
}

export async function mePayload(c: Ctx) {
  const { user, org } = auth(c)
  const { config, ai, db } = c.get('deps')
  const usage = await usageThisMonth(db, org.id)
  const branding = await db.one('SELECT firm_name, firm_name_ar, primary_color, accent_color, (logo IS NOT NULL) AS has_logo FROM branding WHERE org_id = $1', [org.id])
  return {
    user,
    org: { ...org, trial_expired: trialExpired(org) },
    plan: { id: org.plan, ...planOf(org) },
    usage,
    branding: branding ?? null,
    features: { ai: ai.configured, email: c.get('deps').mailer.configured },
    is_platform_admin: config.platformAdminEmails.includes(user.email.toLowerCase()),
    support_email: config.supportEmail,
    sales_email: config.salesEmail
  }
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
  c.set('user', { id: ids.userId, org_id: ids.orgId, email: body.email, name: body.name, role: 'owner', locale: body.locale })
  c.set('org', await db.one('SELECT id, name, plan, trial_ends_at, default_jurisdiction, default_currency FROM organizations WHERE id = $1', [ids.orgId]) as any)
  await audit(c, 'auth.register', 'organization', ids.orgId)
  return c.json(await mePayload(c), 201)
})

authRoutes.post('/login', jsonBody(z.object({ email, password: z.string().min(1).max(200) })), async (c) => {
  rateLimit(c, 'login')
  const { email: em, password: pw } = c.req.valid('json')
  const { db } = c.get('deps')
  const u = await db.one('SELECT id, password_hash, failed_logins, locked_until, deactivated_at FROM users WHERE lower(email) = $1', [em])
  if (!u || u.deactivated_at) {
    await verifyPassword(pw, DUMMY_HASH)
    throw unauthorized('Incorrect email or password.')
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    throw new HttpError(423, 'account_locked', 'This account is temporarily locked after too many failed attempts. Try again later or reset your password.')
  }
  if (!(await verifyPassword(pw, u.password_hash))) {
    const failed = u.failed_logins + 1
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null
    await db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [u.id, lock ? 0 : failed, lock])
    throw unauthorized('Incorrect email or password.')
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id])
  await createSession(c, u.id)
  const full = await db.one(
    `SELECT u.id, u.org_id, u.email, u.name, u.role, u.locale, o.name AS org_name, o.plan, o.trial_ends_at, o.default_jurisdiction, o.default_currency
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [u.id])
  c.set('user', { id: full!.id, org_id: full!.org_id, email: full!.email, name: full!.name, role: full!.role, locale: full!.locale })
  c.set('org', { id: full!.org_id, name: full!.org_name, plan: full!.plan, trial_ends_at: full!.trial_ends_at, default_jurisdiction: full!.default_jurisdiction, default_currency: full!.default_currency })
  await audit(c, 'auth.login', 'user', u.id)
  return c.json(await mePayload(c))
})

authRoutes.post('/logout', async (c) => {
  if (c.get('user')) await audit(c, 'auth.logout', 'user', c.get('user')!.id)
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', async (c) => c.json(await mePayload(c)))

authRoutes.patch('/me', jsonBody(z.object({ name: name.optional(), locale: locale.optional() })), async (c) => {
  const { user } = auth(c)
  const body = c.req.valid('json')
  await c.get('deps').db.query(
    'UPDATE users SET name = COALESCE($2, name), locale = COALESCE($3, locale), updated_at = now() WHERE id = $1',
    [user.id, body.name ?? null, body.locale ?? null]
  )
  if (body.name) user.name = body.name
  if (body.locale) user.locale = body.locale
  return c.json(await mePayload(c))
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
  const u = await db.one('SELECT id, org_id, email, name, role, locale FROM users WHERE id = $1', [userId])
  c.set('user', u as any)
  await audit(c, 'auth.password_reset', 'user', userId)
  return c.json({ ok: true })
})

authRoutes.get('/invite/:token', async (c) => {
  const row = await c.get('deps').db.one(
    `SELECT t.email, t.role, o.name AS org_name FROM auth_tokens t JOIN organizations o ON o.id = t.org_id
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
        `UPDATE auth_tokens SET used_at = now() WHERE id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now() RETURNING org_id, email, role`,
        [hashToken(body.token)]
      )
      if (!t) return null
      const u = await q.one(
        'INSERT INTO users (org_id, email, name, password_hash, role, locale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [t.org_id, t.email, body.name, hash, t.role, body.locale]
      )
      return u!.id as string
    })
  } catch (err: any) {
    if (err?.code === '23505') throw conflict('An account with this email already exists. Sign in instead.')
    throw err
  }
  if (!userId) throw badRequest('This invitation is invalid or has expired. Ask your administrator for a new one.')
  await createSession(c, userId)
  const u = await db.one(
    `SELECT u.id, u.org_id, u.email, u.name, u.role, u.locale, o.name AS org_name, o.plan, o.trial_ends_at, o.default_jurisdiction, o.default_currency
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [userId])
  c.set('user', { id: u!.id, org_id: u!.org_id, email: u!.email, name: u!.name, role: u!.role, locale: u!.locale })
  c.set('org', { id: u!.org_id, name: u!.org_name, plan: u!.plan, trial_ends_at: u!.trial_ends_at, default_jurisdiction: u!.default_jurisdiction, default_currency: u!.default_currency })
  await audit(c, 'auth.invite_accepted', 'user', userId)
  return c.json(await mePayload(c), 201)
})

export default authRoutes
