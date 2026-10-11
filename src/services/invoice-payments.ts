import { randomBytes } from 'node:crypto'
import type { Config } from '../config'
import type { Deps } from '../context'
import type { Db, Queryable } from '../db'
import { newToken } from '../lib/crypto'
import { open, seal } from '../lib/secret-box'
import { roundMoney } from './billing'
import { createTapClient, mapTapStatus, TAP_CURRENCIES, type TapCharge, type TapClient } from './tap'

// ---------------------------------------------------------------------------
// Online invoice payments. Each firm connects its own Tap account, so client
// money goes straight to the firm; the platform only keeps the key (sealed)
// and reconciles each charge against the invoice.
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

export async function onlinePaymentSettings(db: Queryable, config: Config, orgId: string) {
  const [o] = await db.query('SELECT tap_secret_sealed, tap_key_mode, tap_key_hint, tap_connected_at FROM organizations WHERE id = $1', [orgId])
  const secret = paymentSecret(config)
  const readable = !!(o?.tap_secret_sealed && secret && open(o.tap_secret_sealed, secret))
  return {
    available: !!secret,
    connected: readable,
    // Stored with a key the server no longer has (e.g. ENCRYPTION_KEY changed): the firm must reconnect.
    needs_reconnect: !!o?.tap_secret_sealed && !readable,
    mode: readable ? o.tap_key_mode : null,
    key_hint: readable ? o.tap_key_hint : null,
    connected_at: readable ? o.tap_connected_at : null
  }
}

export const supportsOnline = (currency: string) => (TAP_CURRENCIES as readonly string[]).includes(currency)

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
            o.name AS org_name, o.tap_secret_sealed, o.tap_key_mode,
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
            (SELECT amount FROM invoice_payments WHERE invoice_id = i.id AND method = 'online' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1) AS last_amount
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
    ? `${inv.client_name} paid ${amount} online for invoice ${inv.number}, but the invoice had already been paid or voided. Refund the extra amount from your Tap dashboard.`
    : `${inv.client_name} paid ${amount} online for invoice ${inv.number}. ${inv.status === 'paid' ? 'The invoice is now fully paid.' : `Balance remaining: ${outstanding(inv)} ${inv.currency}.`}`) +
    `\n\n${config.appUrl}/app#/billing/invoices/${inv.id}`
  for (const r of to.slice(0, 10)) await mailer.send({ to: r.email, subject, text }).catch((err) => log.warn('payment notification failed', { err }))
}

export const newOrderRef = () => `inv_${Date.now()}_${randomBytes(4).toString('hex')}`
