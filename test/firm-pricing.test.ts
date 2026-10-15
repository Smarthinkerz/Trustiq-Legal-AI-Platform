import { beforeAll, describe, expect, it } from 'vitest'
import { aiPackPrice, limitsFor, quoteFirm } from '../public/static/site/firm-pricing.js'
import { client, setup } from './helpers'

describe('firm pricing', () => {
  it('prices the example: 15 lawyers in Oman on Professional monthly', () => {
    const q = quoteFirm({ country: 'OM', lawyers: 15, support: 4, cycle: 'monthly' })!
    expect(q).toMatchObject({ currency: 'OMR', enterprise: false, recommended: 'professional', support_seats: 4 })
    expect(q.options).toHaveLength(1)
    expect(q.options[0]).toMatchObject({ plan: 'professional', extra_seats: 5, seat_price: 30, monthly: 799, total: 799, annual: 7990, ai_requests: 4500 })
  })

  it('uses Starter for 1 to 3 lawyers, in OMR for Oman and USD elsewhere', () => {
    expect(quoteFirm({ country: 'OM', lawyers: 1, cycle: 'monthly' })!.options).toEqual([expect.objectContaining({ plan: 'starter', monthly: 199, extra_seats: 0, ai_requests: 300, documents: 50, cases: 5 })])
    const ae = quoteFirm({ country: 'AE', lawyers: 3, cycle: 'monthly' })!
    expect(ae.currency).toBe('USD')
    expect(ae.options).toEqual([expect.objectContaining({ plan: 'starter', monthly: 519 })])
    // A small firm that needs a Professional feature sees Professional too.
    const pro = quoteFirm({ country: 'OM', lawyers: 2, cycle: 'monthly', features: ['advanced_reviews'] })!
    expect(pro.options.map((o) => o.plan)).toEqual(['starter', 'professional'])
    expect(pro.recommended).toBe('professional')
  })

  it('shows Starter Plus beside Professional for 4 to 10 lawyers', () => {
    const prices = [4, 5, 6, 10].map((n) => quoteFirm({ country: 'OM', lawyers: n, cycle: 'monthly' })!.options[0]!.monthly)
    expect(prices).toEqual([234, 269, 304, 444])
    const q5 = quoteFirm({ country: 'OM', lawyers: 5, cycle: 'monthly' })!
    expect(q5.options.map((o) => [o.plan, o.monthly, o.cases, o.documents, o.ai_requests])).toEqual([['starter_plus', 269, 25, 75, 500], ['professional', 649, null, 500, 3000]])
    expect(q5.recommended).toBe('starter_plus')
    const q10 = quoteFirm({ country: 'SA', lawyers: 10, cycle: 'monthly' })!
    expect(q10.options.map((o) => [o.plan, o.monthly])).toEqual([['starter_plus', 1149], ['professional', 1690]])
    expect(q10.recommended).toBe('starter_plus')
    expect(quoteFirm({ country: 'OM', lawyers: 6, cycle: 'monthly', features: ['playbook_review', 'bogus'] })).toMatchObject({ recommended: 'professional', features: ['playbook_review'] })
  })

  it('sets Enterprise fair use limits per lawyer with a minimum', () => {
    expect(limitsFor('enterprise', 30)).toEqual({ cases: null, documents: 2400, ai_requests: 12000 })
    expect(limitsFor('enterprise', 10)).toEqual({ cases: null, documents: 2000, ai_requests: 10000 })
    expect(aiPackPrice('OMR')).toEqual({ requests: 500, amount: 25, currency: 'OMR' })
    expect(aiPackPrice('AED')).toEqual({ requests: 500, amount: 65, currency: 'USD' })
  })

  it('charges 10 months for a year on annual billing', () => {
    const q = quoteFirm({ country: 'QA', lawyers: 12, cycle: 'annual' })!
    expect(q.options[0]).toMatchObject({ plan: 'professional', monthly: 1848, total: 18480, months_billed: 10, months_covered: 12, ai_requests: 3600 })
  })

  it('asks for an Enterprise quote above 25 lawyers and rejects bad input', () => {
    expect(quoteFirm({ country: 'OM', lawyers: 25, cycle: 'monthly' })!.options[0]!.monthly).toBe(1099)
    expect(quoteFirm({ country: 'OM', lawyers: 26, cycle: 'monthly' })).toMatchObject({ enterprise: true, options: [], recommended: null })
    expect(quoteFirm({ country: 'XX', lawyers: 3, cycle: 'monthly' })).toBeNull()
    expect(quoteFirm({ country: 'OM', lawyers: 0, cycle: 'monthly' })).toBeNull()
    expect(quoteFirm({ country: 'OM', lawyers: 2.5, cycle: 'monthly' })).toBeNull()
    expect(quoteFirm({ country: 'OM', lawyers: 3, support: -1, cycle: 'monthly' })).toBeNull()
    expect(quoteFirm({ country: 'OM', lawyers: 3, cycle: 'weekly' })).toBeNull()
  })
})

describe('firm sign-up requests', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeAll(async () => { ctx = await setup() })
  const form = { firm_name: 'Al Noor Advocates', country: 'OM', contact_name: 'Salim Al Harthy', email: 'Salim@AlNoor.test', phone: '+968 9123 4567', lawyers: 15, support: 4, cycle: 'monthly', lang: 'en' }

  it('recalculates the quote on the server and ignores prices sent by the browser', async () => {
    const before = ctx.mails.length
    const r = await client(ctx.app).post('/firms/request', { ...form, plan: 'professional', total: 1, monthly: 1, currency: 'USD' })
    expect(r.status).toBe(201)
    expect(r.data).toMatchObject({ kind: 'self_serve', plan: 'professional' })
    expect(r.data.quote.options[0]).toMatchObject({ monthly: 799, ai_requests: 4500 })
    const row = await ctx.db.one('SELECT * FROM firm_signups WHERE id = $1', [r.data.id])
    expect(row).toMatchObject({ email: 'salim@alnoor.test', currency: 'OMR', plan: 'professional', ai_requests: 4500, support_seats: 4, kind: 'self_serve', status: 'requested' })
    expect(Number(row!.total)).toBe(799)
    const mail = ctx.mails.at(-1)!
    expect(ctx.mails.length).toBe(before + 1)
    expect(mail.to).toBe('reply@smarthinkerz.com')
    expect(mail.replyTo).toBe('salim@alnoor.test')
    expect(mail.text).toContain('Monthly: OMR 799')
    expect(mail.text).toContain('AI requests per month: 4500')
  })

  it('charges annual billing as 10 months and lets the firm pick Starter Plus for 4 to 10 lawyers', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, country: 'AE', lawyers: 5, cycle: 'annual', plan: 'starter_plus' })
    expect(r.data.plan).toBe('starter_plus')
    const row = await ctx.db.one('SELECT currency, total, ai_requests FROM firm_signups WHERE id = $1', [r.data.id])
    expect(row).toMatchObject({ currency: 'USD', ai_requests: 500 })
    expect(Number(row!.total)).toBe(6990)
  })

  it('turns more than 25 lawyers into an Enterprise quote request', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, lawyers: 40, plan: 'professional' })
    expect(r.status).toBe(201)
    expect(r.data).toMatchObject({ kind: 'enterprise', plan: null })
    expect(ctx.mails.at(-1)!.subject).toBe('Enterprise quote request: Al Noor Advocates (40 lawyers)')
  })

  it('rejects a plan that does not fit, bad input and other origins', async () => {
    expect((await client(ctx.app).post('/firms/request', { ...form, plan: 'starter' })).status).toBe(400)
    expect((await client(ctx.app).post('/firms/request', { ...form, country: 'XX' })).status).toBe(400)
    expect((await client(ctx.app).post('/firms/request', { ...form, email: 'nope' })).status).toBe(400)
    const cross = await ctx.app.request('/firms/request', { method: 'POST', body: JSON.stringify(form), headers: { 'content-type': 'application/json', origin: 'https://evil.test' } })
    expect(cross.status).toBe(403)
  })
})
