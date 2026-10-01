import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Config } from '../config'
import type { Db } from '../db'
import { HttpError, unavailable } from '../lib/errors'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// Tap Payments client (hosted, redirect-based checkout).
// Follows the SmarThinkerz Hub integration scheme: create charge -> redirect to
// transaction.url -> reconcile on return (authoritative) and via webhook.
// ---------------------------------------------------------------------------

export type TapCharge = {
  id: string
  status: string
  amount: number
  currency: string
  transaction?: { url?: string; created?: string | number }
  reference?: { transaction?: string; order?: string; gateway?: string; payment?: string }
  metadata?: Record<string, string>
  response?: { code?: string; message?: string }
}

export interface TapClient {
  configured: boolean
  createCharge(body: Record<string, unknown>): Promise<TapCharge>
  retrieveCharge(id: string): Promise<TapCharge>
}

export function createTapClient(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): TapClient {
  const { secretKey, apiUrl } = config.tap
  if (secretKey && !secretKey.startsWith('sk_')) log.warn('TAP_SECRET_KEY does not start with sk_ – it looks like a publishable key')
  const call = async (method: string, path: string, body?: unknown): Promise<TapCharge> => {
    if (!secretKey) throw unavailable('payments_not_configured', 'Online payments are not enabled for this deployment.')
    let res: Response
    try {
      res = await fetchImpl(`${apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000)
      })
    } catch (err) {
      log.error('tap request failed', { err, path })
      throw unavailable('payments_unavailable', 'The payment provider could not be reached. Please try again.')
    }
    const data: any = await res.json().catch(() => null)
    if (!res.ok || !data) {
      // Never log request bodies or keys; the provider's error message is safe to log.
      log.error('tap error', { status: res.status, path, errors: data?.errors })
      throw new HttpError(502, 'payments_error', 'The payment provider returned an error. Please try again.')
    }
    return data as TapCharge
  }
  return {
    configured: !!secretKey,
    createCharge: (body) => call('POST', '/charges', body),
    retrieveCharge: (id) => call('GET', `/charges/${encodeURIComponent(id)}`)
  }
}

export type PaymentStatus = 'initiated' | 'paid' | 'failed' | 'cancelled'

export function mapTapStatus(status: string): PaymentStatus {
  const s = (status || '').toUpperCase()
  if (s === 'CAPTURED' || s === 'AUTHORIZED') return 'paid'
  if (s === 'INITIATED' || s === 'IN_PROGRESS' || s === 'PENDING') return 'initiated'
  if (s === 'CANCELLED') return 'cancelled'
  return 'failed'
}

// Webhook signatures: the Hub scheme signs the raw body with TAP_WEBHOOK_SECRET; Tap's native scheme
// signs selected charge fields with the secret key. Either is accepted, compared in constant time.
export function verifyTapSignature(opts: { rawBody: string; header: string | undefined; webhookSecret: string; secretKey?: string; payload: any }): boolean {
  const given = (opts.header ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(given)) return false
  const eq = (hex: string) => timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(given, 'hex'))
  if (eq(createHmac('sha256', opts.webhookSecret).update(opts.rawBody).digest('hex'))) return true
  if (opts.secretKey && opts.payload) {
    const p = opts.payload
    const amount = Number(p.amount).toFixed(['KWD', 'BHD', 'OMR', 'JOD'].includes(p.currency) ? 3 : 2)
    const s = `x_id${p.id}x_amount${amount}x_currency${p.currency}x_gateway_reference${p.reference?.gateway ?? ''}` +
      `x_payment_reference${p.reference?.payment ?? ''}x_status${p.status}x_created${p.transaction?.created ?? ''}`
    if (eq(createHmac('sha256', opts.secretKey).update(s).digest('hex'))) return true
  }
  return false
}

export function payloadTimestamp(payload: any): number | null {
  const v = payload?.transaction?.created ?? payload?.transaction?.asof ?? payload?.created
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n
  const d = Date.parse(String(v))
  return Number.isFinite(d) ? d : null
}

// ---------------------------------------------------------------------------
// Reconciliation: the single place where a charge's outcome changes our state.
// Idempotent and safe to call from the return handler and the webhook concurrently.
// ---------------------------------------------------------------------------

export async function reconcileCharge(deps: { db: Db; mailer: Mailer; config: Config; log: Logger }, charge: TapCharge) {
  const { db } = deps
  const status = mapTapStatus(charge.status)
  const outcome = await db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM payments WHERE provider = $1 AND charge_id = $2 FOR UPDATE', ['tap', charge.id])
    if (!p) return { status, payment: null, becamePaid: false }
    if (['paid', 'refunded', 'partially_refunded', 'refunding'].includes(p.status)) return { status: p.status, payment: p, becamePaid: false }
    // Guard against a charge being re-used for a different order or amount.
    const amountOk = Math.abs(Number(charge.amount) - Number(p.amount)) < 0.0005 && charge.currency === p.currency
    const orgOk = !charge.metadata?.org_id || charge.metadata.org_id === p.org_id
    if (status === 'paid' && (!amountOk || !orgOk)) {
      await q.query(`UPDATE payments SET status = 'failed', provider_status = $2, failure_message = $3, updated_at = now() WHERE id = $1`,
        [p.id, charge.status, 'Charge amount, currency or owner did not match the order'])
      deps.log.error('tap charge mismatch', { payment: p.id, charge: charge.id })
      return { status: 'failed' as const, payment: p, becamePaid: false }
    }
    if (status === 'paid') {
      const [org] = await q.query(
        `UPDATE organizations SET plan = $2, plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '1 month',
                renewal_reminded_for = NULL, updated_at = now() WHERE id = $1 RETURNING plan_expires_at`, [p.org_id, p.plan])
      await q.query(`UPDATE payments SET status = 'paid', provider_status = $2, paid_at = now(), period_end = $3, updated_at = now() WHERE id = $1`,
        [p.id, charge.status, org.plan_expires_at])
      await q.query(`INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta) VALUES ($1, $2, 'billing.subscription_paid', 'payment', $3, $4)`,
        [p.org_id, p.user_id, p.id, JSON.stringify({ plan: p.plan, amount: p.amount, currency: p.currency, charge: charge.id })])
      return { status, payment: { ...p, period_end: org.plan_expires_at }, becamePaid: true }
    }
    await q.query(`UPDATE payments SET status = $2, provider_status = $3, failure_message = $4, updated_at = now() WHERE id = $1`,
      [p.id, status, charge.status, status === 'failed' ? charge.response?.message ?? null : null])
    return { status, payment: p, becamePaid: false }
  })
  if (outcome.becamePaid && outcome.payment) await sendReceipt(deps, outcome.payment.id)
  return outcome
}

async function sendReceipt(deps: { db: Db; mailer: Mailer; config: Config; log: Logger }, paymentId: string) {
  const { db, mailer, config, log } = deps
  if (!mailer.configured) return
  // Claim the receipt so it is sent once per charge even if reconciliation runs twice.
  const [p] = await db.query(
    `UPDATE payments SET receipt_sent_at = now() WHERE id = $1 AND receipt_sent_at IS NULL
     RETURNING id, org_id, user_id, plan, amount, currency, period_end, charge_id`, [paymentId])
  if (!p) return
  const [u] = await db.query('SELECT u.email, u.name, u.locale, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1', [p.user_id])
  if (!u) return
  const until = new Date(p.period_end).toISOString().slice(0, 10)
  const ar = u.locale === 'ar'
  await mailer.send({
    to: u.email,
    subject: ar ? 'إيصال الدفع - TrustiqLegal' : 'Payment receipt – TrustiqLegal',
    text: ar
      ? `مرحباً ${u.name}،\n\nتم استلام دفعتك بنجاح.\n\nالمؤسسة: ${u.org_name}\nالباقة: ${p.plan}\nالمبلغ: ${p.amount} ${p.currency}\nصالحة حتى: ${until}\nمرجع العملية: ${p.charge_id}\n\n${config.appUrl}/app#/settings?tab=plan`
      : `Hello ${u.name},\n\nThank you – your payment was received.\n\nOrganization: ${u.org_name}\nPlan: ${p.plan}\nAmount: ${p.amount} ${p.currency}\nActive until: ${until}\nTransaction reference: ${p.charge_id}\n\n${config.appUrl}/app#/settings?tab=plan`
  }).catch((err) => log.warn('receipt email failed', { err }))
}
