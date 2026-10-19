import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { clientIp, type AppEnv, type Ctx, type Deps } from '../context'
import { tooMany } from '../lib/errors'
import { RateLimiter } from '../lib/rate-limit'
import { payPage, type PayResult } from '../pages/pay-page'
import { open } from '../lib/secret-box'
import { firmTapClient, firmThawaniClient, invoiceByPayToken, newOrderRef, notifyFirmOfPayment, outstanding, paymentSecret, reconcileInvoiceCharge, supportsOnline, thawaniSupports } from '../services/invoice-payments'
import { sessionAsCharge, toBaisa } from '../services/thawani'
import { payloadTimestamp, verifyTapSignature } from '../services/tap'

// ---------------------------------------------------------------------------
// Public invoice payment at /pay/:token (the token is the link's credential:
// it can only show the amount due and start a payment to the firm's own Tap or Thawani account).
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function payRoutes(deps: Deps, assetVersion: string) {
  const { db, config, log } = deps
  const app = new Hono<AppEnv>()
  const views = new RateLimiter(120, 10 * 60_000, 'pay:views')
  const posts = new RateLimiter(15, 10 * 60_000, 'pay:posts')

  app.use('*', async (c, next) => {
    const r = (c.req.method === 'POST' ? posts : views).take(clientIp(c))
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      throw tooMany()
    }
    await next()
    c.header('cache-control', 'no-store')
    c.header('x-robots-tag', 'noindex, nofollow')
  })

  const langOf = (c: Ctx, fromForm?: unknown): 'en' | 'ar' => {
    const q = fromForm ?? c.req.query('lang')
    if (q === 'ar' || q === 'en') return q
    return /^ar\b/i.test(c.req.header('accept-language') ?? '') ? 'ar' : 'en'
  }

  type Inv = NonNullable<Awaited<ReturnType<typeof invoiceByPayToken>>>
  // Gateways that can take this invoice now, Tap first.
  const providersFor = (inv: Inv, due: number) => {
    const out: ('tap' | 'thawani')[] = []
    if (supportsOnline(inv.currency) && firmTapClient(deps, inv.tap_secret_sealed)) out.push('tap')
    if (thawaniSupports(inv.currency, due) && firmThawaniClient(deps, inv)) out.push('thawani')
    return out
  }
  const render = (c: Ctx, token: string, inv: Inv | null, lang: 'en' | 'ar', extra: { result?: PayResult; error?: 'email' } = {}) => {
    if (!inv || inv.status === 'draft' || inv.status === 'void') return c.html(payPage({ state: 'invalid', lang, assetVersion }), 404)
    const due = outstanding(inv)
    const providers = providersFor(inv, due)
    const state = inv.status === 'paid' || due <= 0 ? 'paid' : providers.length ? 'pay' : 'unavailable'
    const fix = (n: unknown) => Number(n).toFixed(['KWD', 'BHD', 'OMR', 'JOD'].includes(inv.currency) ? 3 : 2)
    return c.html(payPage({
      state, lang, assetVersion, token, result: extra.result ?? null, error: extra.error,
      firmName: (lang === 'ar' ? inv.firm_name_ar || inv.firm_name : inv.firm_name) || inv.org_name, color: inv.primary_color,
      number: inv.number, dueDate: inv.due_date ? new Date(inv.due_date).toISOString().slice(0, 10) : null, currency: inv.currency,
      total: fix(inv.total), paid: fix(inv.amount_paid), outstanding: fix(due), providers,
      testMode: providers.some((p) => (p === 'tap' ? inv.tap_key_mode : inv.thawani_mode) === 'test')
    }), extra.error ? 400 : 200)
  }

  // Tap sends the payer back here. The charge is re-fetched with the firm's key rather than trusting the query string.
  app.get('/return', async (c) => {
    const id = c.req.query('tap_id') ?? ''
    const lang = langOf(c)
    if (!/^[\w-]{4,100}$/.test(id)) return c.html(payPage({ state: 'invalid', lang, assetVersion }), 404)
    const [row] = await db.query(
      `SELECT i.pay_token, o.tap_secret_sealed FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN organizations o ON o.id = p.org_id
        WHERE p.charge_id = $1`, [id])
    if (!row?.pay_token) return c.html(payPage({ state: 'invalid', lang, assetVersion }), 404)
    let result: PayResult = 'failed'
    try {
      const tap = firmTapClient(deps, row.tap_secret_sealed)
      if (tap) {
        const outcome = await reconcileInvoiceCharge(db, await tap.retrieveCharge(id))
        await notifyFirmOfPayment(deps, outcome)
        result = outcome.status === 'paid' ? 'success' : outcome.status === 'initiated' ? 'pending' : 'failed'
      }
    } catch (err) {
      log.error('invoice payment return failed', { err })
      result = 'pending'
    }
    return c.redirect(`/pay/${row.pay_token}?result=${result}&lang=${lang}`, 303)
  })

  // Thawani sends the payer back here (success or cancel). The session is read back from Thawani.
  app.get('/thawani/return', async (c) => {
    const ref = c.req.query('ref') ?? ''
    const lang = langOf(c)
    if (!/^inv_\d+_[0-9a-f]{8}$/.test(ref)) return c.html(payPage({ state: 'invalid', lang, assetVersion }), 404)
    const [row] = await db.query(
      `SELECT p.charge_id, i.pay_token, o.thawani_secret_sealed, o.thawani_publishable_key, o.thawani_mode
         FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN organizations o ON o.id = p.org_id
        WHERE p.provider_ref = $1 AND p.provider = 'thawani'`, [ref])
    if (!row?.pay_token) return c.html(payPage({ state: 'invalid', lang, assetVersion }), 404)
    let result: PayResult = 'failed'
    try {
      const thawani = firmThawaniClient(deps, row)
      if (thawani) {
        const outcome = await reconcileInvoiceCharge(db, sessionAsCharge(await thawani.retrieveSession(row.charge_id)))
        await notifyFirmOfPayment(deps, outcome)
        // A client who pressed cancel has not paid; an unpaid session after "success" is still being confirmed.
        result = outcome.status === 'paid' ? 'success' : outcome.status === 'initiated' && !c.req.query('cancelled') ? 'pending' : 'failed'
      }
    } catch (err) {
      log.error('thawani payment return failed', { err })
      result = 'pending'
    }
    return c.redirect(`/pay/${row.pay_token}?result=${result}&lang=${lang}`, 303)
  })

  app.get('/:token', async (c) => {
    const token = c.req.param('token')
    const r = c.req.query('result')
    const result: PayResult = r === 'success' || r === 'pending' || r === 'failed' ? r : null
    return render(c, token, await invoiceByPayToken(db, token), langOf(c), { result })
  })

  app.post('/:token', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const token = c.req.param('token')
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(config.appUrl).origin && origin !== new URL(c.req.url).origin) return c.text('Cross-origin request blocked.', 403)
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    const lang = langOf(c, form.lang)
    const inv = await invoiceByPayToken(db, token)
    const amount = inv ? outstanding(inv) : 0
    const providers = inv ? providersFor(inv, amount) : []
    const provider = form.provider === 'thawani' && providers.includes('thawani') ? 'thawani' : providers.includes('tap') ? 'tap' : providers[0]
    if (!inv || !provider || inv.status !== 'issued' || amount <= 0) return render(c, token, inv, lang)
    const typed = typeof form.email === 'string' ? form.email.trim().toLowerCase().slice(0, 254) : ''
    const email = typed && EMAIL_RE.test(typed) ? typed : !typed && inv.client_email ? inv.client_email : null
    if (provider === 'thawani') return startThawani(c, token, inv, lang, amount, email)
    const tap = firmTapClient(deps, inv.tap_secret_sealed)!
    if (!email) return render(c, token, inv, lang, { error: 'email' })
    const orderRef = newOrderRef()
    const [first, ...rest] = String(inv.client_name).trim().split(/\s+/)
    const charge = await tap.createCharge({
      amount,
      currency: inv.currency,
      threeDSecure: true,
      save_card: false,
      description: `Invoice ${inv.number}`,
      metadata: { invoice_id: inv.id, org_id: inv.org_id, invoice_number: inv.number, product: 'trustiqlegal-invoice' },
      reference: { transaction: `txn_${inv.number}_${Date.now()}`.slice(0, 50), order: orderRef },
      receipt: { email: true, sms: false },
      customer: { first_name: first || 'Client', last_name: rest.join(' ') || first || 'Client', email },
      source: { id: 'src_all' },
      redirect: { url: `${config.appUrl}/pay/return?lang=${lang}` },
      post: { url: `${config.appUrl}/webhooks/tap/invoices` }
    })
    if (!charge.transaction?.url) return render(c, token, inv, lang, { result: 'failed' })
    await db.query(
      `INSERT INTO invoice_payments (org_id, invoice_id, method, provider, charge_id, amount, currency, status, provider_status, payer_email)
       VALUES ($1, $2, 'online', 'tap', $3, $4, $5, 'initiated', $6, $7)`, [inv.org_id, inv.id, charge.id, amount, inv.currency, charge.status, email])
    await db.query(`INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta, ip) VALUES ($1, NULL, 'billing.online_payment_started', 'invoice', $2, $3, $4)`,
      [inv.org_id, inv.id, JSON.stringify({ amount, currency: inv.currency, charge: charge.id }), clientIp(c)]).catch(() => {})
    return c.redirect(charge.transaction.url, 303)
  })

  // Thawani takes the receipt email on its own page, so the email here is optional.
  const startThawani = async (c: Ctx, token: string, inv: Inv, lang: 'en' | 'ar', amount: number, email: string | null) => {
    const thawani = firmThawaniClient(deps, inv)!
    const orderRef = newOrderRef()
    const back = `${config.appUrl}/pay/thawani/return?ref=${orderRef}&lang=${lang}`
    let session
    try {
      session = await thawani.createSession({
        client_reference_id: orderRef,
        // One line for the amount due, so part payments and rounding never disagree with Thawani's total.
        products: [{ name: `Invoice ${inv.number}`.slice(0, 40), quantity: 1, unit_amount: toBaisa(amount) }],
        success_url: back,
        cancel_url: `${back}&cancelled=1`,
        metadata: { invoice_id: inv.id, org_id: inv.org_id, invoice_number: inv.number, product: 'trustiqlegal-invoice' }
      })
    } catch (err) {
      log.error('thawani session failed', { err })
      return render(c, token, inv, lang, { result: 'failed' })
    }
    if (!session?.session_id) return render(c, token, inv, lang, { result: 'failed' })
    await db.query(
      `INSERT INTO invoice_payments (org_id, invoice_id, method, provider, provider_ref, charge_id, amount, currency, status, provider_status, payer_email)
       VALUES ($1, $2, 'online', 'thawani', $3, $4, $5, $6, 'initiated', $7, $8)`,
      [inv.org_id, inv.id, orderRef, session.session_id, amount, inv.currency, session.payment_status ?? 'unpaid', email])
    await db.query(`INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta, ip) VALUES ($1, NULL, 'billing.online_payment_started', 'invoice', $2, $3, $4)`,
      [inv.org_id, inv.id, JSON.stringify({ amount, currency: inv.currency, charge: session.session_id, provider: 'thawani' }), clientIp(c)]).catch(() => {})
    return c.redirect(thawani.payUrl(session.session_id), 303)
  }

  return app
}

// Webhook for charges made on firms' own Tap accounts. Signed with the firm's secret key (Tap's hashstring scheme).
export function invoiceWebhookRoutes(deps: Deps) {
  const { db, log, config } = deps
  const app = new Hono<AppEnv>()
  const global = new RateLimiter(120, 60_000, 'pay:webhook_global')
  app.post('/webhooks/tap/invoices', async (c) => {
    if (!deps.limiters.webhook.take(`inv:${clientIp(c)}`).ok || !global.take('global').ok) {
      c.header('Retry-After', '60')
      throw tooMany()
    }
    const rawBody = await c.req.text()
    let payload: any
    try { payload = JSON.parse(rawBody) } catch { payload = null }
    if (!payload || typeof payload.id !== 'string' || !/^[\w-]{4,100}$/.test(payload.id)) return c.json({ error: 'invalid_payload' }, 400)
    const [row] = await db.query(
      `SELECT o.tap_secret_sealed FROM invoice_payments p JOIN organizations o ON o.id = p.org_id WHERE p.charge_id = $1`, [payload.id])
    const tap = row ? firmTapClient(deps, row.tap_secret_sealed) : null
    if (!tap) return c.json({ error: 'unknown_charge' }, 404)
    const secretKey = open(row.tap_secret_sealed, paymentSecret(config)!) ?? undefined
    if (!verifyTapSignature({ rawBody, header: c.req.header('hashstring'), secretKey, payload })) return c.json({ error: 'invalid_signature' }, 401)
    const ts = payloadTimestamp(payload)
    if (ts !== null && Math.abs(Date.now() - ts) > config.tap.toleranceMs) return c.json({ error: 'stale' }, 400)
    try {
      // Authoritative state comes from Tap, not from the webhook body.
      const outcome = await reconcileInvoiceCharge(db, await tap.retrieveCharge(payload.id))
      await notifyFirmOfPayment(deps, outcome)
    } catch (err) {
      log.error('invoice webhook processing failed', { err })
      return c.json({ error: 'processing_error' }, 500)
    }
    return c.json({ received: true })
  })
  return app
}
