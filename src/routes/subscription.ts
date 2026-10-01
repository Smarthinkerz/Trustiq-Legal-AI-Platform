import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { audit, auth, clientIp, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, tooMany } from '../lib/errors'
import { jsonBody } from '../lib/http'
import { RateLimiter } from '../lib/rate-limit'
import { PLAN_PRICES, type PlanId } from '../lib/plans'
import { roundMoney } from '../services/billing'
import { payloadTimestamp, reconcileCharge, verifyTapSignature } from '../services/tap'

// ---------------- Authenticated API: /api/subscription ----------------

export const subscriptionRoutes = new Hono<AppEnv>()

subscriptionRoutes.get('/', async (c) => {
  const { org } = auth(c)
  const { db, config, tap } = c.get('deps')
  const payments = await db.query(
    `SELECT id, plan, cycle, amount, currency, status, provider_status, paid_at, period_end, created_at
       FROM payments WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`, [org.id])
  return c.json({
    plan: org.plan, plan_expires_at: org.plan_expires_at, payments,
    online_payments: tap.configured, prices: PLAN_PRICES, vat_percent: config.platformVatPercent
  })
})

subscriptionRoutes.post('/checkout', jsonBody(z.object({
  plan: z.enum(Object.keys(PLAN_PRICES) as [PlanId, ...PlanId[]]),
  phone_country_code: z.string().regex(/^\d{1,4}$/).nullish(),
  phone: z.string().regex(/^\d{6,15}$/, 'Enter the phone number digits only').nullish()
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, config, tap } = c.get('deps')
  const price = PLAN_PRICES[b.plan]!
  const amount = roundMoney(price.amount * (1 + config.platformVatPercent / 100), price.currency)
  const ts = Date.now()
  const orderRef = `ord_${ts}_${randomBytes(4).toString('hex')}`
  const [first, ...rest] = user.name.split(/\s+/)
  const charge = await tap.createCharge({
    amount,
    currency: price.currency,
    threeDSecure: true,
    save_card: false,
    description: `TrustiqLegal ${b.plan} plan – 1 month${config.platformVatPercent ? ` (incl. ${config.platformVatPercent}% VAT)` : ''}`,
    statement_descriptor: 'TrustiqLegal',
    metadata: { org_id: org.id, plan: b.plan, cycle: 'monthly', product: 'trustiqlegal', plan_name: b.plan },
    reference: { transaction: `txn_${b.plan}_monthly_${ts}`, order: orderRef },
    receipt: { email: true, sms: false },
    customer: {
      first_name: first, last_name: rest.join(' ') || first, email: user.email,
      ...(b.phone ? { phone: { country_code: b.phone_country_code ?? '968', number: b.phone } } : {})
    },
    source: { id: 'src_all' },
    redirect: { url: `${config.appUrl}/billing/tap/return` },
    post: { url: `${config.appUrl}/webhooks/tap` }
  })
  if (!charge.transaction?.url) throw badRequest('The payment provider did not return a checkout page. Please try again.')
  await db.query(
    `INSERT INTO payments (org_id, user_id, charge_id, reference_order, plan, amount, currency, provider_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [org.id, user.id, charge.id, orderRef, b.plan, amount, price.currency, charge.status])
  await audit(c, 'billing.checkout_started', 'payment', charge.id, { plan: b.plan, amount })
  return c.json({ checkout_url: charge.transaction.url })
})

// ---------------- Public: return page and webhook ----------------

export const tapPublicRoutes = new Hono<AppEnv>()

// Per-IP limits come from deps; this caps all webhook traffic together.
const globalWebhookLimiter = new RateLimiter(120, 60_000)

// Tap sends the customer back here; the charge is re-fetched from Tap rather than trusting the query string.
tapPublicRoutes.get('/billing/tap/return', async (c) => {
  const id = c.req.query('tap_id') ?? ''
  const deps = c.get('deps')
  let result = 'failed'
  if (/^[\w-]{4,100}$/.test(id)) {
    try {
      const charge = await deps.tap.retrieveCharge(id)
      const outcome = await reconcileCharge(deps, charge)
      result = outcome.status === 'paid' ? 'success' : outcome.status === 'initiated' ? 'pending' : 'failed'
    } catch (err) {
      deps.log.error('tap return reconciliation failed', { err })
    }
  }
  return c.redirect(`/app#/settings?tab=plan&payment=${result}`, 303)
})

async function webhookAudit(c: Ctx, result: string, chargeId: string | null, detail?: string) {
  await c.get('deps').db.query('INSERT INTO webhook_events (provider, charge_id, result, detail, ip) VALUES ($1, $2, $3, $4, $5)',
    ['tap', chargeId, result, detail?.slice(0, 500) ?? null, clientIp(c)]).catch(() => {})
}

tapPublicRoutes.post('/webhooks/tap', async (c) => {
  const deps = c.get('deps')
  const { config, db, log } = deps
  const ip = clientIp(c)
  if (!deps.limiters.webhook.take(`ip:${ip}`).ok || !globalWebhookLimiter.take('global').ok) {
    c.header('Retry-After', '60')
    throw tooMany()
  }
  if (!config.tap.webhookSecret) {
    await webhookAudit(c, 'not_configured', null)
    return c.json({ error: 'not_configured' }, 503)
  }
  const rawBody = await c.req.text()
  let payload: any
  try { payload = JSON.parse(rawBody) } catch { payload = null }
  if (!verifyTapSignature({ rawBody, header: c.req.header('hashstring'), webhookSecret: config.tap.webhookSecret, secretKey: config.tap.secretKey, payload })) {
    await webhookAudit(c, 'invalid_signature', payload?.id ?? null)
    return c.json({ error: 'invalid_signature' }, 401)
  }
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') {
    await webhookAudit(c, 'rejected', null, 'missing charge id')
    return c.json({ error: 'invalid_payload' }, 400)
  }
  const ts = payloadTimestamp(payload)
  if (ts !== null && Math.abs(Date.now() - ts) > config.tap.toleranceMs) {
    await webhookAudit(c, 'rejected', payload.id, 'stale timestamp')
    return c.json({ error: 'stale' }, 400)
  }
  const key = `${payload.id}:${payload.status ?? ''}`
  const inserted = await db.query('INSERT INTO processed_webhook_events (event_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_key', [key])
  if (!inserted.length) {
    await webhookAudit(c, 'duplicate', payload.id)
    return c.json({ received: true, duplicate: true })
  }
  try {
    // Authoritative state comes from Tap, not from the webhook body.
    const charge = await deps.tap.retrieveCharge(payload.id)
    await reconcileCharge(deps, charge)
    await webhookAudit(c, 'received', payload.id, charge.status)
  } catch (err) {
    // Allow Tap to retry this event.
    await db.query('DELETE FROM processed_webhook_events WHERE event_key = $1', [key])
    await webhookAudit(c, 'processing_error', payload.id, (err as Error).message)
    log.error('tap webhook processing failed', { err })
    return c.json({ error: 'processing_error' }, 500)
  }
  return c.json({ received: true })
})
