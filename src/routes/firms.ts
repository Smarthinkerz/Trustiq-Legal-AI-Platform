import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { COUNTRIES, MAX_SUPPORT, quoteFirm, type FirmOption, type FirmQuote } from '../../public/static/site/firm-pricing.js'
import { clientIp, type AppEnv, type Deps } from '../context'
import { RateLimiter } from '../lib/rate-limit'

// ---------------------------------------------------------------------------
// Firm sign-up from the pricing page ("Have more lawyers on your team?").
// The browser shows a live quote, but the server always recalculates it from the
// submitted inputs and never trusts any price sent by the client.
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  firm_name: z.string().trim().min(2).max(200),
  country: z.enum(COUNTRIES as [string, ...string[]]),
  contact_name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().regex(/^\+?[\d\s-]{6,20}$/, 'Enter a valid phone number'),
  lawyers: z.coerce.number().int().min(1).max(10000),
  support: z.coerce.number().int().min(0).max(MAX_SUPPORT).default(0),
  cycle: z.enum(['monthly', 'annual']),
  plan: z.enum(['starter', 'professional']).nullish(),
  lang: z.enum(['en', 'ar']).default('en')
})

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}`

function summary(b: z.infer<typeof requestSchema>, q: FirmQuote, chosen: FirmOption | null) {
  const lines = [
    `Firm: ${b.firm_name}`, `Country: ${b.country}`, `Contact: ${b.contact_name}`, `Email: ${b.email}`, `Phone: ${b.phone}`,
    `Lawyers: ${b.lawyers}`, `Support staff: ${b.support}`, `Billing: ${b.cycle}`
  ]
  if (chosen) {
    lines.push(
      `Plan: ${chosen.plan} (${chosen.included_seats} seats included, ${chosen.extra_seats} extra at ${money(chosen.seat_price, q.currency)})`,
      `Monthly: ${money(chosen.monthly, q.currency)}`,
      `${b.cycle === 'annual' ? `Annual (pay ${chosen.months_billed}, get ${chosen.months_covered})` : 'Due now'}: ${money(chosen.total, q.currency)} excluding VAT`,
      `AI requests per month: ${chosen.ai_requests}`
    )
  }
  return lines.join('\n')
}

export function firmRoutes(deps: Deps) {
  const { config, db, mailer, log } = deps
  const app = new Hono<AppEnv>()
  const perIp = new RateLimiter(10, 60 * 60_000)

  app.post('/request', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(config.appUrl).origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: { code: 'forbidden', message: 'Cross-origin request blocked.' } }, 403)
    }
    const ip = clientIp(c)
    const r = perIp.take(ip)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests. Please try again later.' } }, 429)
    }
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: { code: 'validation_error', message: 'Please check the form.', details: parsed.error.flatten().fieldErrors } }, 400)
    }
    const b = parsed.data
    const q = quoteFirm({ country: b.country, lawyers: b.lawyers, support: b.support, cycle: b.cycle })
    if (!q) return c.json({ error: { code: 'validation_error', message: 'Please check the form.' } }, 400)
    const chosen = q.enterprise ? null : q.options.find((o) => o.plan === (b.plan ?? q.recommended)) ?? null
    if (!q.enterprise && !chosen) return c.json({ error: { code: 'validation_error', message: 'That plan is not available for this number of lawyers.' } }, 400)

    const kind = q.enterprise ? 'enterprise' : 'self_serve'
    const [row] = await db.query(
      `INSERT INTO firm_signups (kind, firm_name, country, contact_name, email, phone, lawyers, support_seats, cycle, currency, plan, total, ai_requests, quote, lang, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [kind, b.firm_name, b.country, b.contact_name, b.email, b.phone, b.lawyers, b.support, b.cycle, q.currency,
        chosen?.plan ?? null, chosen?.total ?? null, chosen?.ai_requests ?? null, JSON.stringify(q), b.lang, ip])

    // Every request reaches the team, so no firm is lost while online checkout is pending.
    await mailer.send({
      to: config.firmRequestsEmail,
      replyTo: b.email,
      subject: q.enterprise ? `Enterprise quote request: ${b.firm_name} (${b.lawyers} lawyers)` : `Firm sign-up: ${b.firm_name} (${b.lawyers} lawyers, ${chosen!.plan})`,
      text: `${summary(b, q, chosen)}\n\nRequest id: ${row.id}`
    }).catch((err) => log.warn('firm request email failed', { err }))

    return c.json({ id: row.id, kind, quote: q, plan: chosen?.plan ?? null }, 201)
  })

  return app
}
