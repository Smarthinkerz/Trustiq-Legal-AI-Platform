import { createHmac } from 'node:crypto'
import { limitsFor, type FirmOption, type FirmQuote } from '../../public/static/site/firm-pricing.js'
import type { Config } from '../config'
import type { Db } from '../db'
import { hashPassword, hashToken, newToken } from '../lib/crypto'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// Firm subscriptions bought through the SmarThinkerz Hub Team Checkout:
// creating the firm when the first payment arrives, extending it on renewal and
// moving it to read only after a grace period when a renewal fails.
// Every step is idempotent: the same quote never creates a second firm and the
// same payment reference is never applied twice.
// ---------------------------------------------------------------------------

export const SETUP_LINK_HOURS = 72
export const RENEWAL_GRACE_DAYS = 7

type Deps = { db: Db; mailer: Mailer; config: Config; log: Logger }

const JURISDICTION_BY_COUNTRY: Record<string, [string, string]> = {
  OM: ['oman', 'OMR'], AE: ['uae', 'AED'], SA: ['ksa', 'SAR'], QA: ['qatar', 'QAR'], KW: ['kuwait', 'KWD'], BH: ['bahrain', 'BHD'],
  EG: ['egypt', 'EGP'], JO: ['jordan', 'JOD'], LB: ['lebanon', 'LBP'], IQ: ['iraq', 'IQD'], MA: ['morocco', 'MAD'], TN: ['tunisia', 'TND']
}

// The quote the Hub is asked to charge, signed with the partner secret so the Hub
// can tell it was issued by TrustiqLegal and was not changed in the browser.
export function signedQuote(config: Config, signup: { id: string; firm_name: string; email: string; contact_name: string; phone: string }, q: FirmQuote, o: FirmOption) {
  const payload = {
    quote_id: signup.id,
    product: 'trustiqlegal',
    plan: o.plan,
    lawyers: q.lawyers,
    support_seats: q.support_seats,
    cycle: q.cycle,
    months_covered: o.months_covered,
    currency: q.currency,
    amount: o.total,
    vat_applies: true,
    customer: { firm_name: signup.firm_name, name: signup.contact_name, email: signup.email, phone: signup.phone, country: q.country },
    issued_at: new Date().toISOString()
  }
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', config.hub.partnerSecret ?? '').update(body).digest('hex')
  return { body, signature, payload }
}

const periodInterval = (cycle: string) => (cycle === 'annual' ? `interval '12 months'` : `interval '1 month'`)

export type PaidEvent = { quoteId: string; reference: string; amount: number; currency: string }

// First payment for a quote: creates the firm, its admin, seats and limits in one transaction.
export async function provisionFirm(deps: Deps, ev: PaidEvent): Promise<{ orgId: string | null; created: boolean; reason?: string }> {
  const { db, log } = deps
  const result = await db.tx(async (q) => {
    const [s] = await q.query('SELECT * FROM firm_signups WHERE id = $1 FOR UPDATE', [ev.quoteId])
    if (!s) return { orgId: null, created: false, reason: 'unknown_quote' }
    if (s.org_id) return { orgId: s.org_id as string, created: false, reason: 'already_provisioned' }
    if (s.kind !== 'self_serve' || !s.plan) return { orgId: null, created: false, reason: 'not_self_serve' }
    // The amount charged must be the amount we quoted, in the quoted currency.
    if (ev.currency !== s.currency || Math.abs(Number(ev.amount) - Number(s.total)) > 0.0005) {
      log.error('hub payment does not match quote', { quote: s.id, reference: ev.reference })
      return { orgId: null, created: false, reason: 'amount_mismatch' }
    }
    const limits = limitsFor(s.plan, s.lawyers)!
    const [jurisdiction, localCurrency] = JURISDICTION_BY_COUNTRY[s.country] ?? ['international', 'USD']
    const [org] = await q.query(
      `INSERT INTO organizations (name, plan, country, billing_currency, billing_cycle, period_start, plan_expires_at, lawyer_seats, support_seats,
         limits_custom, cases_limit, documents_limit, ai_requests_limit, quote_id, default_jurisdiction, default_currency)
       VALUES ($1, $2, $3, $4, $5, now(), now() + ${periodInterval(s.cycle)}, $6, $7, true, $8, $9, $10, $11, $12, $13)
       RETURNING id, plan_expires_at`,
      [s.firm_name, s.plan, s.country, s.currency, s.cycle, s.lawyers, s.support_seats, limits.cases, limits.documents, limits.ai_requests, s.id, jurisdiction, localCurrency])
    await q.query('INSERT INTO branding (org_id, firm_name) VALUES ($1, $2)', [org.id, s.firm_name])

    // The firm admin signs in by choosing a password from the setup link; an existing account is never taken over.
    let adminId: string | null = null
    let setupToken: string | null = null
    const taken = await q.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [s.email])
    if (!taken.length) {
      const [u] = await q.query(
        'INSERT INTO users (org_id, email, name, password_hash, role, locale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [org.id, s.email.toLowerCase(), s.contact_name, await hashPassword(newToken()), 'owner', s.lang === 'ar' ? 'ar' : 'en'])
      adminId = u.id
      setupToken = newToken()
      await q.query(`INSERT INTO auth_tokens (id, kind, org_id, user_id, email, expires_at) VALUES ($1, 'password_reset', $2, $3, $4, now() + interval '${SETUP_LINK_HOURS} hours')`,
        [hashToken(setupToken), org.id, adminId, s.email.toLowerCase()])
    }
    const [pay] = await q.query(
      `INSERT INTO payments (org_id, user_id, provider, charge_id, reference_order, plan, cycle, amount, currency, status, provider_status, paid_at, period_end)
       VALUES ($1, $2, 'hub', $3, $4, $5, $6, $7, $8, 'paid', 'paid', now(), $9) RETURNING id`,
      [org.id, adminId, ev.reference, s.id, s.plan, s.cycle, s.total, s.currency, org.plan_expires_at])
    await q.query(`UPDATE firm_signups SET status = 'paid', org_id = $2, paid_at = now(), checkout_reference = COALESCE(checkout_reference, $3) WHERE id = $1`, [s.id, org.id, ev.reference])
    await q.query(`INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta) VALUES ($1, $2, 'billing.firm_created', 'payment', $3, $4)`,
      [org.id, adminId, pay.id, JSON.stringify({ quote: s.id, plan: s.plan, lawyers: s.lawyers, support_seats: s.support_seats, amount: s.total, currency: s.currency })])
    return { orgId: org.id as string, created: true, signup: s, limits, setupToken, periodEnd: org.plan_expires_at as Date, adminTaken: !!taken.length }
  })
  if (result.created) await sendFirmCreatedEmails(deps, result as any)
  return { orgId: result.orgId, created: result.created, reason: result.reason }
}

async function sendFirmCreatedEmails(deps: Deps, r: { orgId: string; signup: any; limits: any; setupToken: string | null; periodEnd: Date; adminTaken: boolean }) {
  const { mailer, config, log } = deps
  const s = r.signup
  const until = new Date(r.periodEnd).toISOString().slice(0, 10)
  if (r.setupToken) {
    const link = `${config.appUrl}/app#/reset-password?token=${r.setupToken}&setup=1`
    const ar = s.lang === 'ar'
    await mailer.send({
      to: s.email,
      subject: ar ? `مرحباً بكم في TrustiqLegal: إعداد حساب ${s.firm_name}` : `Welcome to TrustiqLegal: set up ${s.firm_name}`,
      text: ar
        ? `مرحباً ${s.contact_name}،\n\nشكراً لاشتراككم. تم إنشاء مساحة عمل ${s.firm_name} وأنت مسؤولها.\n\nاختر كلمة المرور من هذا الرابط خلال ${SETUP_LINK_HOURS} ساعة:\n${link}\n\nبعد ذلك ادعُ فريقك من الإعدادات > الفريق.\nالمقاعد: ${s.lawyers} محامين و${s.support_seats} موظفين مساندين. الاشتراك ساري حتى ${until}.`
        : `Hello ${s.contact_name},\n\nThank you for subscribing. The ${s.firm_name} workspace is ready and you are its admin.\n\nChoose your password with this link within ${SETUP_LINK_HOURS} hours:\n${link}\n\nThen invite your team in Settings > Team.\nSeats: ${s.lawyers} lawyers and ${s.support_seats} support staff. Your subscription is active until ${until}.`
    }).catch((err) => log.warn('firm setup email failed', { err }))
  }
  const L = r.limits
  await mailer.send({
    to: config.firmRequestsEmail,
    subject: `New firm: ${s.firm_name} (${s.plan}, ${s.lawyers} lawyers)`,
    text: [
      `Firm: ${s.firm_name}`, `Country: ${s.country}`, `Admin: ${s.contact_name} <${s.email}>`, `Phone: ${s.phone}`,
      `Plan: ${s.plan}, ${s.cycle}`, `Paid: ${s.currency} ${Number(s.total)}`, `Active until: ${until}`,
      `Lawyer seats: ${s.lawyers}`, `Support staff seats: ${s.support_seats}`,
      `Limits per month: ${L.ai_requests} AI requests, ${L.documents} new documents, ${L.cases ?? 'unlimited'} open cases`,
      r.adminTaken ? 'ACTION NEEDED: the contact email already has a TrustiqLegal account, so no admin was created. Add an admin to this firm in the platform admin console.' : 'Setup link sent to the admin.',
      `Organization id: ${r.orgId}`, `Quote id: ${s.id}`
    ].join('\n')
  }).catch((err) => log.warn('firm summary email failed', { err }))
}

// A renewal payment extends the period from its current end and clears any failed renewal.
export async function renewFirm(deps: Deps, ev: PaidEvent): Promise<{ orgId: string | null; applied: boolean; reason?: string }> {
  const { db } = deps
  return db.tx(async (q) => {
    const [o] = await q.query('SELECT id, plan, billing_cycle, billing_currency FROM organizations WHERE quote_id = $1 FOR UPDATE', [ev.quoteId])
    if (!o) return { orgId: null, applied: false, reason: 'unknown_firm' }
    if ((await q.query(`SELECT 1 FROM payments WHERE provider = 'hub' AND charge_id = $1`, [ev.reference])).length) return { orgId: o.id, applied: false, reason: 'duplicate' }
    // The new period starts where the paid one ended (the grace week is not free time);
    // a firm that lapsed for longer starts a fresh period today.
    const [org] = await q.query(
      `WITH n AS (
         SELECT CASE WHEN period_start IS NOT NULL AND period_start + ${periodInterval(o.billing_cycle)} >= now() - interval '${RENEWAL_GRACE_DAYS} days'
                     THEN period_start + ${periodInterval(o.billing_cycle)} ELSE now() END AS start
           FROM organizations WHERE id = $1)
       UPDATE organizations SET period_start = n.start, plan_expires_at = n.start + ${periodInterval(o.billing_cycle)},
              renewal_failed_at = NULL, renewal_reminded_for = NULL, updated_at = now()
         FROM n WHERE id = $1 RETURNING plan_expires_at`, [o.id])
    await q.query(
      `INSERT INTO payments (org_id, provider, charge_id, reference_order, plan, cycle, amount, currency, status, provider_status, paid_at, period_end)
       VALUES ($1, 'hub', $2, $3, $4, $5, $6, $7, 'paid', 'paid', now(), $8)`,
      [o.id, ev.reference, ev.quoteId, o.plan, o.billing_cycle, ev.amount, ev.currency, org.plan_expires_at])
    await q.query(`INSERT INTO audit_log (org_id, action, entity_type, entity_id, meta) VALUES ($1, 'billing.subscription_renewed', 'organization', $2, $3)`,
      [o.id, o.id, JSON.stringify({ reference: ev.reference, amount: ev.amount, currency: ev.currency, until: org.plan_expires_at })])
    return { orgId: o.id as string, applied: true }
  })
}

// A failed renewal keeps all data; after the grace period the firm becomes read only until it pays.
export async function renewalFailed(deps: Deps, ev: { quoteId: string; reference: string }): Promise<{ orgId: string | null; applied: boolean }> {
  const { db, mailer, config, log } = deps
  const r: any = await db.tx(async (q) => {
    const [o] = await q.query('SELECT id, name, renewal_failed_at FROM organizations WHERE quote_id = $1 FOR UPDATE', [ev.quoteId])
    if (!o) return { orgId: null, applied: false }
    if (o.renewal_failed_at) return { orgId: o.id as string, applied: false }
    const [org] = await q.query(
      `UPDATE organizations SET renewal_failed_at = now(), plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '${RENEWAL_GRACE_DAYS} days', updated_at = now()
        WHERE id = $1 RETURNING plan_expires_at`, [o.id])
    await q.query(`INSERT INTO audit_log (org_id, action, entity_type, entity_id, meta) VALUES ($1, 'billing.renewal_failed', 'organization', $2, $3)`,
      [o.id, o.id, JSON.stringify({ reference: ev.reference, read_only_from: org.plan_expires_at })])
    const admins = await q.query(`SELECT email, name, locale FROM users WHERE org_id = $1 AND role IN ('owner', 'admin') AND deactivated_at IS NULL`, [o.id])
    return { orgId: o.id as string, applied: true, name: o.name, until: org.plan_expires_at as Date, admins }
  })
  if (r.applied) {
    const until = new Date(r.until).toISOString().slice(0, 10)
    for (const a of r.admins as any[]) {
      const ar = a.locale === 'ar'
      await mailer.send({
        to: a.email,
        subject: ar ? 'تعذر تجديد اشتراك TrustiqLegal' : 'Your TrustiqLegal renewal payment did not go through',
        text: ar
          ? `مرحباً ${a.name}،\n\nتعذر تحصيل دفعة تجديد اشتراك ${r.name}. بياناتكم محفوظة بالكامل.\nإذا لم تتم الدفعة بحلول ${until} ستصبح مساحة العمل للقراءة فقط حتى التجديد.\n\nللمساعدة راسلونا على ${config.firmRequestsEmail}.`
          : `Hello ${a.name},\n\nThe renewal payment for ${r.name} did not go through. All your data is kept.\nIf payment is not made by ${until}, the workspace becomes read only until the subscription is renewed.\n\nFor help, email ${config.firmRequestsEmail}.`
      }).catch((err) => log.warn('renewal failure email failed', { err }))
    }
  }
  return { orgId: r.orgId, applied: r.applied }
}
