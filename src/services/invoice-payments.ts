import { randomBytes } from 'node:crypto'
import type { Config } from '../config'
import type { Deps } from '../context'
import type { Db, Queryable } from '../db'
import { newToken } from '../lib/crypto'
import { open, seal } from '../lib/secret-box'
import { roundMoney } from './billing'
import { createTapClient, mapTapStatus, TAP_CURRENCIES, type TapCharge, type TapClient } from './tap'
import { createThawaniClient, sessionAsCharge, THAWANI_MIN_OMR, type ThawaniClient, type ThawaniMode } from './thawani'

// ---------------------------------------------------------------------------
// Online invoice payments. Each firm connects its own Tap account and, in Oman,
// its own Thawani account, so client money goes straight to the firm; the
// platform only keeps the keys (sealed) and reconciles each charge against the invoice.
// ---------------------------------------------------------------------------

export const TAP_KEY_RE = /^sk_(live|test)_[A-Za-z0-9]{8,200}$/

// Firm keys are sealed with ENCRYPTION_KEY, falling back to another server secret so a deployment
// that only set those still works. Without any of them, keys cannot be stored.
export const paymentSecret = (config: Config) => config.encryptionKey ?? config.google?.clientSecret ?? config.tap.secretKey ?? null

export const sealTapKey = (config: Config, key: string) => seal(key, paymentSecret(config)!)

export function firmTapClient(deps: Pick<Deps, 'config' | 'log' | 'firmTap'>, sealed: string | null | undefined): TapClient | null {
  const secret = paymentSecret(deps.config)
  if (!sealed || !secret) return null
  const key = open(sealed, secret)
  if (!key) return null
  return deps.firmTap ? deps.firmTap(key) : createTapClient(deps.config, deps.log, fetch, key)
}

export type ThawaniRow = { thawani_secret_sealed?: string | null; thawani_publishable_key?: string | null; thawani_mode?: string | null }

export function firmThawaniClient(deps: Pick<Deps, 'config' | 'log' | 'firmThawani'>, row: ThawaniRow | null | undefined): ThawaniClient | null {
  const secret = paymentSecret(deps.config)
  if (!row?.thawani_secret_sealed || !row.thawani_publishable_key || !secret) return null
  const key = open(row.thawani_secret_sealed, secret)
  if (!key) return null
  const keys = { secretKey: key, publishableKey: row.thawani_publishable_key, mode: (row.thawani_mode === 'live' ? 'live' : 'test') as ThawaniMode }
  return deps.firmThawani ? deps.firmThawani(keys) : createThawaniClient(keys, deps.log)
}

export async function onlinePaymentSettings(db: Queryable, config: Config, orgId: string) {
  const [o] = await db.query(
    `SELECT tap_secret_sealed, tap_key_mode, tap_key_hint, tap_connected_at,
            thawani_secret_sealed, thawani_publishable_key, thawani_mode, thawani_key_hint, thawani_connected_at FROM organizations WHERE id = $1`, [orgId])
  const secret = paymentSecret(config)
  const readable = !!(o?.tap_secret_sealed && secret && open(o.tap_secret_sealed, secret))
  const thawani = !!(o?.thawani_secret_sealed && o.thawani_publishable_key && secret && open(o.thawani_secret_sealed, secret))
  return {
    available: !!secret,
    connected: readable,
    // Stored with a key the server no longer has (e.g. ENCRYPTION_KEY changed): the firm must reconnect.
    needs_reconnect: !!o?.tap_secret_sealed && !readable,
    mode: readable ? o.tap_key_mode : null,
    key_hint: readable ? o.tap_key_hint : null,
    connected_at: readable ? o.tap_connected_at : null,
    thawani: {
      connected: thawani,
      needs_reconnect: !!o?.thawani_secret_sealed && !thawani,
      mode: thawani ? o.thawani_mode : null,
      key_hint: thawani ? o.thawani_key_hint : null,
      connected_at: thawani ? o.thawani_connected_at : null
    }
  }
}

export const supportsOnline = (currency: string) => (TAP_CURRENCIES as readonly string[]).includes(currency)
// Thawani takes Omani rials only.
export const thawaniSupports = (currency: string, amount?: number) => currency === 'OMR' && (amount === undefined || amount >= THAWANI_MIN_OMR)

// The gateways a firm can take this invoice's currency through, Tap first.
export function onlineProviders(s: { connected: boolean; thawani: { connected: boolean } }, currency: string, amount?: number): ('tap' | 'thawani')[] {
  const out: ('tap' | 'thawani')[] = []
  if (s.connected && supportsOnline(currency)) out.push('tap')
  if (s.thawani.connected && thawaniSupports(currency, amount)) out.push('thawani')
  return out
}
export const canPayOnline = (s: Parameters<typeof onlineProviders>[0], currency: string) => onlineProviders(s, currency).length > 0

export const outstanding = (inv: Record<string, any>) =>
  roundMoney(Math.max(0, Number(inv.total) - Number(inv.amount_paid)), inv.currency)

export const payUrl = (config: Config, token: string) => `${config.appUrl}/pay/${token}`

export async function ensurePayToken(db: Queryable, orgId: string, invoiceId: string): Promise<string> {
  const [row] = await db.query('SELECT pay_token FROM invoices WHERE id = $1 AND org_id = $2', [invoiceId, orgId])
  if (row?.pay_token) return row.pay_token
  const token = newToken()
  const [set] = await db.query(
    'UPDATE invoices SET pay_token = COALESCE(pay_token, $3) WHERE id = $1 AND org_id = $2 RETURNING pay_token', [invoiceId, orgId, token])
  return set.pay_token
}

export async function invoiceByPayToken(db: Queryable, token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null
  const [inv] = await db.query(
    `SELECT i.id, i.org_id, i.number, i.status, i.currency, i.total, i.amount_paid, i.due_date, i.client_id,
            cl.name AS client_name, cl.email AS client_email,
            o.name AS org_name, o.tap_secret_sealed, o.tap_key_mode, o.thawani_secret_sealed, o.thawani_publishable_key, o.thawani_mode,
            b.firm_name, b.firm_name_ar, b.primary_color
       FROM invoices i JOIN clients cl ON cl.id = i.client_id JOIN organizations o ON o.id = i.org_id
       LEFT JOIN branding b ON b.org_id = i.org_id
      WHERE i.pay_token = $1`, [token])
  return inv ?? null
}

export type InvoiceChargeOutcome = { status: string; invoiceId: string | null; orgId: string | null; becamePaid: boolean; needsRefund: boolean }

// The single place where an online charge changes an invoice. Idempotent; safe from the return page and the webhook at once.
export async function reconcileInvoiceCharge(db: Db, charge: TapCharge): Promise<InvoiceChargeOutcome> {
  const status = mapTapStatus(charge.status)
  return db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM invoice_payments WHERE charge_id = $1 FOR UPDATE', [charge.id])
    if (!p) return { status, invoiceId: null, orgId: null, becamePaid: false, needsRefund: false }
    const base = { invoiceId: p.invoice_id as string, orgId: p.org_id as string }
    if (p.status === 'paid') return { ...base, status: 'paid', becamePaid: false, needsRefund: p.needs_refund }
    if (status === 'paid') {
      const matches = Math.abs(Number(charge.amount) - Number(p.amount)) < 0.0005 && charge.currency === p.currency &&
        (!charge.metadata?.invoice_id || charge.metadata.invoice_id === p.invoice_id)
      if (!matches) {
        await q.query(`UPDATE invoice_payments SET status = 'failed', provider_status = $2, failure_message = $3, updated_at = now() WHERE id = $1`,
          [p.id, charge.status, 'Charge amount, currency or invoice did not match'])
        return { ...base, status: 'failed', becamePaid: false, needsRefund: false }
      }
      const [inv] = await q.query('SELECT status, total, amount_paid, currency FROM invoices WHERE id = $1 FOR UPDATE', [p.invoice_id])
      // Money was taken but the invoice was voided or already settled meanwhile: keep the record and flag it for a refund.
      const due = inv && inv.status === 'issued' ? outstanding(inv) : 0
      const applied = Math.min(Number(p.amount), due)
      const needsRefund = Number(p.amount) - applied > 0.0005
      if (applied > 0) {
        const paid = roundMoney(Number(inv.amount_paid) + applied, inv.currency)
        const full = paid >= Number(inv.total) - 1e-9
        await q.query(
          `UPDATE invoices SET amount_paid = $2, status = $3, paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE paid_at END, updated_at = now() WHERE id = $1`,
          [p.invoice_id, paid, full ? 'paid' : 'issued'])
      }
      await q.query(
        `UPDATE invoice_payments SET status = 'paid', provider_status = $2, paid_at = now(), needs_refund = $3, updated_at = now() WHERE id = $1`,
        [p.id, charge.status, needsRefund])
      await q.query(`INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta) VALUES ($1, NULL, 'billing.online_payment_received', 'invoice', $2, $3)`,
        [p.org_id, p.invoice_id, JSON.stringify({ amount: Number(p.amount), currency: p.currency, charge: charge.id, needs_refund: needsRefund })])
      return { ...base, status: 'paid', becamePaid: true, needsRefund }
    }
    await q.query(`UPDATE invoice_payments SET status = $2, provider_status = $3, failure_message = $4, updated_at = now() WHERE id = $1`,
      [p.id, status, charge.status, status === 'failed' ? charge.response?.message?.slice(0, 500) ?? null : null])
    return { ...base, status, becamePaid: false, needsRefund: false }
  })
}

// Tells the firm (owners, admins, the invoice's author and the matter's lawyer) that a client paid online.
export async function notifyFirmOfPayment(deps: Pick<Deps, 'db' | 'mailer' | 'config' | 'log'>, outcome: InvoiceChargeOutcome) {
  const { db, mailer, config, log } = deps
  if (!mailer.configured || !outcome.becamePaid || !outcome.invoiceId) return
  const [inv] = await db.query(
    `SELECT i.id, i.number, i.status, i.currency, i.total, i.amount_paid, i.created_by, cl.name AS client_name, k.assigned_to,
            (SELECT amount FROM invoice_payments WHERE invoice_id = i.id AND method = 'online' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1) AS last_amount,
            (SELECT provider FROM invoice_payments WHERE invoice_id = i.id AND method = 'online' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1) AS last_provider
       FROM invoices i JOIN clients cl ON cl.id = i.client_id LEFT JOIN cases k ON k.id = i.case_id WHERE i.id = $1`, [outcome.invoiceId])
  if (!inv) return
  const to = await db.query(
    `SELECT DISTINCT email FROM users WHERE org_id = $1 AND deactivated_at IS NULL AND role <> 'client' AND notify_email
        AND (role IN ('owner', 'admin') OR id = $2 OR id = $3)`, [outcome.orgId, inv.created_by, inv.assigned_to])
  const amount = `${Number(inv.last_amount)} ${inv.currency}`
  const subject = outcome.needsRefund
    ? `Action needed: online payment on ${inv.number} must be refunded`
    : `${inv.client_name} paid invoice ${inv.number} online (${amount})`
  const text = (outcome.needsRefund
    ? `${inv.client_name} paid ${amount} online for invoice ${inv.number}, but the invoice had already been paid or voided. Refund the extra amount from your ${inv.last_provider === 'thawani' ? 'Thawani' : 'Tap'} dashboard.`
    : `${inv.client_name} paid ${amount} online for invoice ${inv.number}. ${inv.status === 'paid' ? 'The invoice is now fully paid.' : `Balance remaining: ${outstanding(inv)} ${inv.currency}.`}`) +
    `\n\n${config.appUrl}/app#/billing/invoices/${inv.id}`
  for (const r of to.slice(0, 10)) await mailer.send({ to: r.email, subject, text }).catch((err) => log.warn('payment notification failed', { err }))
}

export const newOrderRef = () => `inv_${Date.now()}_${randomBytes(4).toString('hex')}`


// Thawani has no signed callback here, so open Thawani payments are read back from Thawani: on the
// client's return and by this sweep, which catches clients who closed the page after paying.
// Sessions left unpaid for a day are marked cancelled.
export async function sweepThawaniPayments(deps: Pick<Deps, 'db' | 'config' | 'log' | 'firmThawani' | 'mailer'>, opts: { minAgeMs?: number; limit?: number } = {}) {
  const { db, log } = deps
  const rows = await db.query(
    `SELECT p.id, p.charge_id, p.created_at, o.thawani_secret_sealed, o.thawani_publishable_key, o.thawani_mode
       FROM invoice_payments p JOIN organizations o ON o.id = p.org_id
      WHERE p.provider = 'thawani' AND p.status = 'initiated' AND p.charge_id IS NOT NULL AND p.created_at < now() - ($1::int * interval '1 millisecond')
      ORDER BY p.created_at LIMIT $2`, [opts.minAgeMs ?? 120_000, opts.limit ?? 50])
  let settled = 0
  for (const r of rows) {
    try {
      const thawani = firmThawaniClient(deps, r)
      const outcome = thawani ? await reconcileInvoiceCharge(db, sessionAsCharge(await thawani.retrieveSession(r.charge_id))) : null
      if (outcome) await notifyFirmOfPayment(deps, outcome)
      if (outcome && outcome.status !== 'initiated') settled++
      else if (Date.now() - new Date(r.created_at).getTime() > 86400_000) {
        await db.query(`UPDATE invoice_payments SET status = 'cancelled', failure_message = $2, updated_at = now() WHERE id = $1 AND status = 'initiated'`,
          [r.id, thawani ? 'Not paid within a day' : 'Thawani account disconnected'])
      }
    } catch (err) {
      log.warn('thawani payment check failed', { err, payment: r.id })
    }
  }
  return settled
}