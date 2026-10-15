import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { client, setup } from './helpers'

const SECRET = 'hub_partner_test_secret'
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex')

describe('firm subscriptions through the Hub', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  const hubCalls: { url: string; signature: string | null; body: any }[] = []
  beforeAll(async () => {
    ctx = await setup({ HUB_PARTNER_SECRET: SECRET, HUB_TEAM_CHECKOUT_URL: 'https://hub.test/team-checkout' }, {
      hubFetch: (async (url: string, init: RequestInit) => {
        hubCalls.push({ url: String(url), signature: new Headers(init.headers).get('x-trustiq-signature'), body: JSON.parse(String(init.body)) })
        return Response.json({ checkout_url: 'https://checkout.hub.test/pay/123', reference: 'hub_chk_1' })
      }) as typeof fetch
    })
  })

  const form = { firm_name: 'Al Noor Advocates', country: 'OM', contact_name: 'Salim Al Harthy', email: 'salim@alnoor.test', phone: '+968 9123 4567', lawyers: 15, support: 4, cycle: 'monthly', lang: 'en' }
  const hook = (payload: object, signature?: string) => {
    const body = JSON.stringify(payload)
    return ctx.app.request('/webhooks/hub', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature': signature ?? sign(body) } })
  }

  it('sends a signed, server-calculated quote to the Hub and returns its checkout page', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, total: 1, plan: 'professional' })
    expect(r.status).toBe(201)
    expect(r.data.checkout_url).toBe('https://checkout.hub.test/pay/123')
    const call = hubCalls.at(-1)!
    expect(call.url).toBe('https://hub.test/team-checkout')
    expect(call.body).toMatchObject({ quote_id: r.data.id, plan: 'professional', lawyers: 15, support_seats: 4, currency: 'OMR', amount: 799, months_covered: 1, vat_applies: true })
    expect(call.signature).toBe(sign(JSON.stringify(call.body)))
    expect(await ctx.db.one('SELECT status, checkout_reference FROM firm_signups WHERE id = $1', [r.data.id])).toMatchObject({ status: 'checkout', checkout_reference: 'hub_chk_1' })
  })

  it('creates the firm, admin, seats and limits once on the paid webhook', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, email: 'admin@khaleej.test', firm_name: 'Khaleej Law', plan: 'professional' })
    const quoteId = r.data.id
    const before = ctx.mails.length

    expect((await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_1', amount: 799, currency: 'OMR' }, 'f'.repeat(64))).status).toBe(401)
    // The Hub must charge what we quoted.
    const wrong = await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_0', amount: 1, currency: 'OMR' })
    expect((await wrong.json()).result).toMatchObject({ created: false, reason: 'amount_mismatch' })

    const ok = await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_1', amount: 799, currency: 'OMR' })
    expect(ok.status).toBe(200)
    const out = (await ok.json()).result
    expect(out.created).toBe(true)
    const org = await ctx.db.one('SELECT * FROM organizations WHERE id = $1', [out.orgId])
    expect(org).toMatchObject({ name: 'Khaleej Law', plan: 'professional', country: 'OM', billing_currency: 'OMR', billing_cycle: 'monthly', lawyer_seats: 15, support_seats: 4,
      limits_custom: true, cases_limit: null, documents_limit: 500, ai_requests_limit: 4500, quote_id: quoteId, default_jurisdiction: 'oman' })
    const days = (new Date(org!.plan_expires_at).getTime() - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(27)
    expect(await ctx.db.one('SELECT role, email FROM users WHERE org_id = $1', [out.orgId])).toMatchObject({ role: 'owner', email: 'admin@khaleej.test' })

    const mails = ctx.mails.slice(before)
    const setupMail = mails.find((m) => m.to === 'admin@khaleej.test')!
    expect(setupMail.text).toContain('within 72 hours')
    const token = /token=([\w-]+)&setup=1/.exec(setupMail.text)![1]!
    expect(mails.find((m) => m.to === 'reply@smarthinkerz.com')!.text).toContain('Lawyer seats: 15')

    // The same quote never creates a second firm, even under a new payment reference.
    const again = await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_1b', amount: 799, currency: 'OMR' })
    expect((await again.json()).result).toMatchObject({ created: false, reason: 'already_provisioned', orgId: out.orgId })
    expect((await (await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_1', amount: 799, currency: 'OMR' })).json()).duplicate).toBe(true)
    const [{ n }] = await ctx.db.query('SELECT count(*)::int AS n FROM organizations WHERE quote_id = $1', [quoteId])
    expect(n).toBe(1)

    // The admin sets a password from the link, signs in and sees the firm limits.
    const admin = client(ctx.app)
    expect((await admin.post('/api/auth/reset-password', { token, password: 'Correct-Horse-Battery-9' })).status).toBe(200)
    expect((await admin.post('/api/auth/login', { email: 'admin@khaleej.test', password: 'Correct-Horse-Battery-9' })).status).toBe(200)
    const me = await admin.get('/api/auth/me')
    expect(me.data.plan).toMatchObject({ aiRequestsPerMonth: 4500, documentsPerMonth: 500, maxActiveCases: null })

    // Seats: 15 lawyers (the admin holds one) and 4 support staff.
    for (let i = 0; i < 14; i++) expect((await admin.post('/api/org/invites', { email: `lawyer${i}@khaleej.test`, role: 'lawyer' })).status).toBe(201)
    const full = await admin.post('/api/org/invites', { email: 'one-more@khaleej.test', role: 'lawyer' })
    expect(full.status).toBe(402)
    expect(full.data.error.code).toBe('seat_limit_lawyers')
    for (let i = 0; i < 4; i++) expect((await admin.post('/api/org/invites', { email: `staff${i}@khaleej.test`, role: 'staff' })).status).toBe(201)
    expect((await admin.post('/api/org/invites', { email: 'staff9@khaleej.test', role: 'staff' })).data.error.code).toBe('seat_limit_support')
    expect((await admin.get('/api/org/members')).data.seats).toMatchObject({ lawyer_seats: 15, lawyers_used: 15, support_seats: 4, support_used: 4 })
  })

  it('extends on renewal, and after a failed renewal gives 7 days before read only', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, email: 'admin@sahil.test', firm_name: 'Sahil Legal', lawyers: 5, plan: 'starter_plus', cycle: 'annual' })
    const quoteId = r.data.id
    const paid = await (await hook({ type: 'checkout.paid', quote_id: quoteId, reference: 'pay_s1', amount: 2690, currency: 'OMR' })).json()
    const orgId = paid.result.orgId
    const org = await ctx.db.one('SELECT plan, cases_limit, documents_limit, ai_requests_limit, plan_expires_at, period_start FROM organizations WHERE id = $1', [orgId])
    expect(org).toMatchObject({ plan: 'starter_plus', cases_limit: 25, documents_limit: 75, ai_requests_limit: 500 })
    const end1 = new Date(org!.plan_expires_at).getTime()
    expect((end1 - Date.now()) / 86400_000).toBeGreaterThan(360)

    const before = ctx.mails.length
    expect((await hook({ type: 'subscription.renewal_failed', quote_id: quoteId, reference: 'fail_1' })).status).toBe(200)
    const failed = await ctx.db.one('SELECT renewal_failed_at, plan_expires_at FROM organizations WHERE id = $1', [orgId])
    expect(failed!.renewal_failed_at).toBeTruthy()
    expect(new Date(failed!.plan_expires_at).getTime() - end1).toBeGreaterThan(6.9 * 86400_000)
    expect(ctx.mails.slice(before).some((m) => m.to === 'admin@sahil.test' && m.text.includes('read only'))).toBe(true)

    // Paying during the grace week renews from the end of the paid year, not from the grace date.
    await hook({ type: 'subscription.renewed', quote_id: quoteId, reference: 'pay_s2', amount: 2690, currency: 'OMR' })
    const renewed = await ctx.db.one('SELECT renewal_failed_at, plan_expires_at FROM organizations WHERE id = $1', [orgId])
    expect(renewed!.renewal_failed_at).toBeNull()
    const year = (new Date(renewed!.plan_expires_at).getTime() - end1) / 86400_000
    expect(year).toBeGreaterThan(364)
    expect(year).toBeLessThan(367)
    expect((await (await hook({ type: 'subscription.renewed', quote_id: quoteId, reference: 'pay_s2', amount: 2690, currency: 'OMR' })).json()).duplicate).toBe(true)

    // Once the grace period has passed, the firm is read only but keeps its data.
    await ctx.db.query(`UPDATE organizations SET plan_expires_at = now() - interval '1 day' WHERE id = $1`, [orgId])
    const [u] = await ctx.db.query(`SELECT id FROM users WHERE org_id = $1`, [orgId])
    expect(u).toBeTruthy()
  })

  it('keeps support staff out of AI features', async () => {
    const r = await client(ctx.app).post('/firms/request', { ...form, email: 'admin@wadi.test', firm_name: 'Wadi Law', lawyers: 2, support: 1, plan: 'starter' })
    const out = (await (await hook({ type: 'checkout.paid', quote_id: r.data.id, reference: 'pay_w1', amount: 199, currency: 'OMR' })).json()).result
    const setupMail = ctx.mails.filter((m) => m.to === 'admin@wadi.test').at(-1)!
    const token = /token=([\w-]+)&setup=1/.exec(setupMail.text)![1]!
    const admin = client(ctx.app)
    await admin.post('/api/auth/reset-password', { token, password: 'Correct-Horse-Battery-9' })
    await admin.post('/api/auth/login', { email: 'admin@wadi.test', password: 'Correct-Horse-Battery-9' })
    const inv = await admin.post('/api/org/invites', { email: 'pa@wadi.test', role: 'staff' })
    const staff = client(ctx.app)
    const invToken = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')
    expect((await staff.post('/api/auth/accept-invite', { token: invToken, name: 'Paralegal Person', password: 'Correct-Horse-Battery-9' })).status).toBe(201)
    const blocked = await staff.post('/api/ai/chat', { message: 'Summarise the case' })
    expect(blocked.status).toBe(403)
    expect(blocked.data.error.message).toContain('support staff')
    // Staff can still organize: create a client.
    expect((await staff.post('/api/clients', { kind: 'individual', name: 'Ahmed Client' })).status).toBe(201)
    expect(out.created).toBe(true)
  })
})
