import type { Config } from '../config'
import type { Queryable } from '../db'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'
import { PLAN_PRICES, type PlanId } from '../lib/plans'

// ---------------------------------------------------------------------------
// Grandfathered prices: an existing customer keeps the price they signed up at
// until a date, after which the current list price applies. Renewals inside the
// period charge the locked price automatically.
// ---------------------------------------------------------------------------

export const PRICE_NOTICE_DAYS = 30

type Lock = { locked_plan: string | null; locked_amount: string | number | null; locked_currency: string | null; locked_until: Date | string | null }

export const lockActive = (o: Lock, plan: string, now = Date.now()) =>
  o.locked_plan === plan && o.locked_amount != null && !!o.locked_until && new Date(o.locked_until).getTime() > now

// The prices this organization pays, with any active lock applied.
export async function orgPrices(db: Queryable, orgId: string) {
  const [o] = await db.query<any>('SELECT locked_plan, locked_amount, locked_currency, locked_until FROM organizations WHERE id = $1', [orgId])
  const prices: Partial<Record<PlanId, { amount: number; currency: string; locked_until?: string; list_amount?: number }>> = { ...PLAN_PRICES }
  if (o) {
    for (const plan of Object.keys(PLAN_PRICES) as PlanId[]) {
      if (lockActive(o, plan)) {
        prices[plan] = { amount: Number(o.locked_amount), currency: o.locked_currency ?? PLAN_PRICES[plan]!.currency, locked_until: new Date(o.locked_until).toISOString(), list_amount: PLAN_PRICES[plan]!.amount }
      }
    }
  }
  return prices
}

// The price-change notice, 30 days before a lock ends. Off unless PRICE_NOTICE_EMAILS is set to on.
export function priceNoticeEmail(o: { name: string; plan: string; locked_amount: number; locked_currency: string; locked_until: Date | string }, to: { name: string; locale: string }, appUrl: string) {
  const from = new Date(o.locked_until).toISOString().slice(0, 10)
  const list = PLAN_PRICES[o.plan as PlanId]
  const link = `${appUrl}/app#/settings?tab=plan`
  if (to.locale === 'ar') {
    return {
      subject: 'تغيير سعر باقة TrustiqLegal الاحترافية',
      text: `مرحباً ${to.name}،\n\nشكراً لثقتكم بنا. عند رفع سعر الباقة الاحترافية أبقينا سعر ${o.name} عند ${o.locked_amount} ${o.locked_currency} شهرياً لمدة اثني عشر شهراً.\n\nتنتهي هذه الفترة في ${from}. ابتداءً من أول تجديد بعد هذا التاريخ يصبح السعر ${list?.amount} ${list?.currency} شهرياً (لا يشمل ضريبة القيمة المضافة). لا تغيير في الميزات أو الحدود.\n\nلا يلزمكم القيام بأي إجراء. إذا كانت لديكم أي أسئلة أو رغبتم في مناقشة الخيارات المتاحة، فقط ردوا على هذه الرسالة.\n\n${link}\n\nفريق TrustiqLegal`
    }
  }
  return {
    subject: 'A change to your TrustiqLegal Professional price',
    text: `Hello ${to.name},\n\nThank you for being a TrustiqLegal customer. When the Professional plan price went up, we kept ${o.name} at ${o.locked_currency} ${o.locked_amount} a month for twelve months.\n\nThat period ends on ${from}. From your first renewal after that date, the price will be ${list?.currency} ${list?.amount} a month (excluding VAT). Your features and limits stay the same.\n\nYou do not need to do anything. If you have questions or would like to discuss your options, just reply to this email.\n\n${link}\n\nThe TrustiqLegal team`
  }
}

export async function runPriceNotices(db: Queryable, mailer: Mailer, config: Config, log: Logger) {
  if (!config.priceNoticeEmails || !mailer.configured) return 0
  let sent = 0
  for (;;) {
    const [o] = await db.query<any>(
      `UPDATE organizations SET price_notice_sent_at = now()
        WHERE id = (SELECT id FROM organizations WHERE locked_until IS NOT NULL AND price_notice_sent_at IS NULL AND plan = locked_plan
                      AND locked_until <= now() + make_interval(days => $1) AND locked_until > now() LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, name, plan, locked_amount, locked_currency, locked_until`, [PRICE_NOTICE_DAYS])
    if (!o) break
    const admins = await db.query<any>(`SELECT email, name, locale FROM users WHERE org_id = $1 AND role IN ('owner', 'admin') AND deactivated_at IS NULL`, [o.id])
    for (const a of admins) {
      const m = priceNoticeEmail({ ...o, locked_amount: Number(o.locked_amount) }, a, config.appUrl)
      await mailer.send({ to: a.email, replyTo: config.salesEmail, ...m }).then(() => { sent++ }).catch((err) => log.warn('price notice failed', { err, org: o.id }))
    }
  }
  return sent
}
