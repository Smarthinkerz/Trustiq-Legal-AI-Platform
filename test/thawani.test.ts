import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'
import { sweepThawaniPayments } from '../src/services/invoice-payments'
import { createThawaniClient, sessionAsCharge, toBaisa } from '../src/services/thawani'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ ENCRYPTION_KEY: 'test-encryption-key-for-payments' }) })

const KEYS = { secret_key: 'thw_sk_Secret1234567890abcdWXYZ', publishable_key: 'thw_pk_Public1234567890abcdef', mode: 'test' }
const TAP_KEY = 'sk_live_AbCdEf1234567890'

async function firmWithInvoice(opts: { thawani?: boolean; tap?: boolean; currency?: string; clientEmail?: string } = {}) {
  const firm = await registered(ctx.app)
  const c = firm.c
  const cl = await c.post('/api/clients', { name: 'Salim Al Harthy', email: opts.clientEmail })
  const clientId = cl.data.client.id as string
  const draft = await c.post('/api/billing/invoices', { client_id: clientId, currency: opts.currency, fixed_lines: [{ description: 'Advice', quantity: 1, unit_price: 100 }] })
  const id = draft.data.invoice.id as string
  expect((await c.post(`/api/billing/invoices/${id}/issue`)).status).toBe(200)
  if (opts.thawani !== false) expect((await c.put('/api/billing/online-payments/thawani', KEYS)).status).toBe(200)
  if (opts.tap) expect((await c.put('/api/billing/online-payments', { secret_key: TAP_KEY })).status).toBe(200)
  return { ...firm, c, id, clientId }
}

const tokenOf = (url: string) => url.split('/pay/')[1]!
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const lastSession = () => [...ctx.firmThawani.sessions.values()].at(-1)!
const refOf = (url: string) => new URL(url).searchParams.get('ref')!

describe('firm Thawani account', () => {
  it('stores the secret key sealed, keeps the publishable key, and checks the key with Thawani', async () => {
    const { c, me } = await registered(ctx.app)
    expect((await c.put('/api/billing/online-payments/thawani', { ...KEYS, publishable_key: KEYS.secret_key })).status).toBe(400)
    expect((await c.put('/api/billing/online-payments/thawani', { ...KEYS, secret_key: 'short' })).status).toBe(400)
    const rejected = await c.put('/api/billing/online-payments/thawani', { ...KEYS, secret_key: 'thw_sk_Rejected1234567890abcd' })
    expect(rejected.status).toBe(400)
    expect(rejected.data.error.message).toMatch(/test mode/)

    const ok = await c.put('/api/billing/online-payments/thawani', KEYS)
    expect(ok.status).toBe(200)
    expect(ok.data.thawani).toMatchObject({ connected: true, mode: 'test', key_hint: 'WXYZ' })
    expect(ok.data.connected).toBe(false) // Tap stays as it was
    expect(ctx.firmThawani.keys.at(-1)).toEqual({ secretKey: KEYS.secret_key, publishableKey: KEYS.publishable_key, mode: 'test' })
    const [row] = await ctx.db.query('SELECT thawani_secret_sealed, thawani_publishable_key FROM organizations WHERE id = $1', [me.org.id])
    expect(row.thawani_secret_sealed).toMatch(/^v1\./)
    expect(row.thawani_secret_sealed).not.toContain('Secret1234')
    expect(JSON.stringify((await c.get('/api/billing/settings')).data)).not.toContain(KEYS.secret_key)

    expect((await c.del('/api/billing/online-payments/thawani')).data.thawani.connected).toBe(false)
  })

  it('only owners and admins connect it', async () => {
    const { c: owner } = await registered(ctx.app)
    const email = `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`
    const invite = await owner.post('/api/org/invites', { email, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const lawyer = client(ctx.app)
    await lawyer.post('/api/auth/accept-invite', { token, name: 'Lawyer', password: 'Str0ngPassw0rd' })
    expect((await lawyer.put('/api/billing/online-payments/thawani', KEYS)).status).toBe(403)
  })
})

describe('paying an invoice with Thawani', () => {
  it('sends the client to Thawani in baisa, settles the invoice on return, once', async () => {
    const { c, id, me } = await firmWithInvoice({ clientEmail: 'salim@example.test' })
    const inv0 = await c.get(`/api/billing/invoices/${id}`)
    expect(inv0.data.online).toMatchObject({ connected: true, providers: ['thawani'], can_pay: true, mode: 'test' })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)

    const page = await ctx.app.request(`/pay/${token}`)
    const html = await page.text()
    expect(html).toContain('value="thawani"')
    expect(html).not.toContain('value="tap"')
    expect(html).toContain('Test mode')
    expect(page.headers.get('content-security-policy')).toContain('https://uatcheckout.thawani.om')

    const start = await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ provider: 'thawani', email: '', lang: 'en' }) })
    expect(start.status).toBe(303)
    const s = lastSession()
    expect(start.headers.get('location')).toBe(`https://uatcheckout.thawani.om/pay/${s.session_id}?key=${KEYS.publishable_key}`)
    expect(s.products).toEqual([{ name: expect.stringMatching(/^Invoice /), quantity: 1, unit_amount: 105000 }])
    expect(s.metadata).toMatchObject({ invoice_id: id })
    const ref = refOf(s.success_url)
    expect(s.cancel_url).toBe(`${s.success_url}&cancelled=1`)

    const pending = await ctx.app.request(`/pay/thawani/return?ref=${ref}&lang=en`)
    expect(pending.headers.get('location')).toBe(`/pay/${token}?result=pending&lang=en`)

    s.payment_status = 'paid'
    const done = await ctx.app.request(`/pay/thawani/return?ref=${ref}&lang=ar`)
    expect(done.headers.get('location')).toBe(`/pay/${token}?result=success&lang=ar`)
    const inv = await c.get(`/api/billing/invoices/${id}`)
    expect(inv.data.invoice.status).toBe('paid')
    expect(Number(inv.data.invoice.amount_paid)).toBe(105)
    expect(inv.data.payments).toMatchObject([{ method: 'online', provider: 'thawani', status: 'paid', charge_id: s.session_id }])

    await ctx.app.request(`/pay/thawani/return?ref=${ref}`)
    await sweepThawaniPayments({ db: ctx.db, config: ctx.config, log: ctx.log, mailer: { configured: true, send: async (m) => { ctx.mails.push(m) } }, firmThawani: ctx.firmThawani.forKeys }, { minAgeMs: 0 })
    expect(ctx.mails.filter((m) => m.to === me.user.email && m.subject.includes('paid invoice'))).toHaveLength(1)
  })

  it('offers both gateways when both are connected, Tap by default', async () => {
    const { c, id } = await firmWithInvoice({ tap: true, clientEmail: 'salim@example.test' })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    const html = await (await ctx.app.request(`/pay/${token}`)).text()
    expect(html).toContain('value="tap"')
    expect(html).toContain('value="thawani"')
    const tap = await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ email: '' }) })
    expect(tap.headers.get('location')).toMatch(/^https:\/\/checkout\.tap\.test\//)
    const thawani = await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ provider: 'thawani', email: '' }) })
    expect(thawani.headers.get('location')).toMatch(/^https:\/\/uatcheckout\.thawani\.om\/pay\/checkout_/)
    const rows = await ctx.db.query('SELECT provider FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at', [id])
    expect(rows.map((r) => r.provider)).toEqual(['tap', 'thawani'])
  })

  it('a cancelled payment takes nothing and the client can try again', async () => {
    const { c, id } = await firmWithInvoice()
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ provider: 'thawani' }) })
    const s = lastSession()
    const back = await ctx.app.request(`/pay/thawani/return?ref=${refOf(s.success_url)}&cancelled=1`)
    expect(back.headers.get('location')).toBe(`/pay/${token}?result=failed&lang=en`)
    s.payment_status = 'cancelled'
    await ctx.app.request(`/pay/thawani/return?ref=${refOf(s.success_url)}&cancelled=1`)
    const [p] = await ctx.db.query('SELECT status FROM invoice_payments WHERE charge_id = $1', [s.session_id])
    expect(p.status).toBe('cancelled')
    expect((await c.get(`/api/billing/invoices/${id}`)).data.invoice.status).toBe('issued')
    expect(await (await ctx.app.request(`/pay/${token}?result=failed`)).text()).toContain('value="thawani"')
  })

  it('refuses a session whose amount does not match, and other currencies', async () => {
    const { c, id } = await firmWithInvoice()
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ provider: 'thawani' }) })
    const s = lastSession()
    s.payment_status = 'paid'
    s.total_amount = 100
    await ctx.app.request(`/pay/thawani/return?ref=${refOf(s.success_url)}`)
    expect((await c.get(`/api/billing/invoices/${id}`)).data.invoice.status).toBe('issued')

    const usd = await firmWithInvoice({ currency: 'USD' })
    expect((await usd.c.get(`/api/billing/invoices/${usd.id}`)).data.online).toMatchObject({ connected: true, can_pay: false, currency_supported: false })
    expect((await usd.c.post(`/api/billing/invoices/${usd.id}/pay-link`, {})).status).toBe(400)
    expect((await ctx.app.request('/pay/thawani/return?ref=inv_1_deadbeef')).status).toBe(404)
  })

  it('the sweep settles clients who paid but never came back, and closes stale sessions', async () => {
    const { c, id } = await firmWithInvoice()
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    const deps = { db: ctx.db, config: ctx.config, log: ctx.log, mailer: { configured: false, send: async () => {} }, firmThawani: ctx.firmThawani.forKeys }
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ provider: 'thawani' }) })
    const paid = lastSession()
    paid.payment_status = 'paid'
    expect(await sweepThawaniPayments(deps)).toBe(0) // too recent: the return page usually gets there first
    expect(await sweepThawaniPayments(deps, { minAgeMs: 0 })).toBeGreaterThanOrEqual(1)
    expect((await c.get(`/api/billing/invoices/${id}`)).data.invoice.status).toBe('paid')

    const other = await firmWithInvoice()
    const t2 = tokenOf((await other.c.post(`/api/billing/invoices/${other.id}/pay-link`, {})).data.url)
    await ctx.app.request(`/pay/${t2}`, { method: 'POST', body: form({ provider: 'thawani' }) })
    const stale = lastSession()
    await ctx.db.query(`UPDATE invoice_payments SET created_at = now() - interval '2 days' WHERE charge_id = $1`, [stale.session_id])
    await sweepThawaniPayments(deps)
    const [p] = await ctx.db.query('SELECT status FROM invoice_payments WHERE charge_id = $1', [stale.session_id])
    expect(p.status).toBe('cancelled')
  })

  it('a Thawani-only firm shows Pay now in the client portal', async () => {
    const { c, id, clientId } = await firmWithInvoice()
    const email = `portal-${crypto.randomUUID().slice(0, 6)}@example.test`
    const invite = await c.post(`/api/clients/${clientId}/portal-invite`, { email })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const portal = client(ctx.app)
    expect((await portal.post('/api/auth/accept-invite', { token, name: 'Salim', password: 'Str0ngPassw0rd' })).status).toBe(201)
    const home = await portal.get('/api/portal/overview')
    const mine = (home.data.invoices ?? []).find((i: any) => i.id === id)
    expect(mine?.can_pay).toBe(true)
  })
})

describe('Thawani HTTP client', () => {
  const keys = { secretKey: 'sk_secret_value_1234567890', publishableKey: 'pk_public_value_1234567890', mode: 'test' as const }
  const fakeFetch = (status: number, body: unknown, seen: { url: string; init: RequestInit }[] = []) =>
    (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }) }) as unknown as typeof fetch

  it('creates sessions on the right host with the secret key header', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const live = createThawaniClient({ ...keys, mode: 'live' }, ctx.log, fakeFetch(200, { success: true, code: 2004, data: { session_id: 'checkout_abc', payment_status: 'unpaid' } }, seen))
    const s = await live.createSession({ client_reference_id: 'inv_1_abcdef12', products: [{ name: 'Invoice 1', quantity: 1, unit_amount: 1000 }], success_url: 'https://x/s', cancel_url: 'https://x/c' })
    expect(s.session_id).toBe('checkout_abc')
    expect(seen[0]!.url).toBe('https://checkout.thawani.om/api/v1/checkout/session')
    expect(new Headers(seen[0]!.init.headers).get('thawani-api-key')).toBe(keys.secretKey)
    expect(JSON.parse(String(seen[0]!.init.body))).toMatchObject({ mode: 'payment', client_reference_id: 'inv_1_abcdef12' })
    expect(live.payUrl('checkout_abc')).toBe(`https://checkout.thawani.om/pay/checkout_abc?key=${keys.publishableKey}`)
    expect(createThawaniClient(keys, ctx.log).payUrl('checkout_abc')).toMatch(/^https:\/\/uatcheckout\.thawani\.om\/pay\//)
  })

  it('treats only authentication errors as a wrong key', async () => {
    expect(await createThawaniClient(keys, ctx.log, fakeFetch(401, { success: false, code: 4001 })).verifyKey()).toBe(false)
    expect(await createThawaniClient(keys, ctx.log, fakeFetch(404, { success: false })).verifyKey()).toBe(true)
    expect(await createThawaniClient(keys, ctx.log, fakeFetch(200, { success: true, data: [] })).verifyKey()).toBe(true)
    await expect(createThawaniClient(keys, ctx.log, fakeFetch(503, {})).verifyKey()).rejects.toThrow(/503/)
  })
})

describe('Thawani helpers', () => {
  it('converts rials to baisa and sessions to the reconciler shape', () => {
    expect(toBaisa(105)).toBe(105000)
    expect(toBaisa(0.1)).toBe(100)
    expect(toBaisa(12.345)).toBe(12345)
    expect(sessionAsCharge({ session_id: 'checkout_1', payment_status: 'paid', total_amount: 105000, currency: 'OMR' })).toMatchObject({ id: 'checkout_1', status: 'CAPTURED', amount: 105, currency: 'OMR' })
    expect(sessionAsCharge({ session_id: 'c', payment_status: 'unpaid' }).status).toBe('INITIATED')
    expect(sessionAsCharge({ session_id: 'c', payment_status: 'cancelled' }).status).toBe('CANCELLED')
    expect(sessionAsCharge({ session_id: 'c', payment_status: 'weird' }).status).toBe('FAILED')
  })
})
