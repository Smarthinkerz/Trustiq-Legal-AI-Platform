import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ ENCRYPTION_KEY: 'test-encryption-key-for-payments' }) })

const LIVE_KEY = 'sk_live_AbCdEf1234567890'

async function firmWithInvoice(opts: { connect?: boolean; portal?: boolean; clientEmail?: string } = {}) {
  const firm = await registered(ctx.app)
  const c = firm.c
  const cl = await c.post('/api/clients', { name: 'Fatima Al Balushi', email: opts.clientEmail })
  const clientId = cl.data.client.id as string
  const draft = await c.post('/api/billing/invoices', { client_id: clientId, fixed_lines: [{ description: 'Advice', quantity: 1, unit_price: 100 }] })
  const id = draft.data.invoice.id as string
  expect((await c.post(`/api/billing/invoices/${id}/issue`)).status).toBe(200)
  if (opts.connect !== false) expect((await c.put('/api/billing/online-payments', { secret_key: LIVE_KEY })).status).toBe(200)
  let portal: ReturnType<typeof client> | null = null
  if (opts.portal) {
    const email = `pay-${crypto.randomUUID().slice(0, 6)}@example.test`
    const inv = await c.post(`/api/clients/${clientId}/portal-invite`, { email })
    const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
    portal = client(ctx.app)
    expect((await portal.post('/api/auth/accept-invite', { token, name: 'Fatima', password: 'Str0ngPassw0rd' })).status).toBe(201)
  }
  return { ...firm, c, id, clientId, portal }
}

const tokenOf = (url: string) => url.split('/pay/')[1]!
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe('firm Tap account', () => {
  it('stores the secret key sealed, shows only a hint and validates it with Tap', async () => {
    const { c, me } = await registered(ctx.app)
    expect((await c.put('/api/billing/online-payments', { secret_key: 'pk_live_123456789012' })).data.error.message).toMatch(/publishable/)
    expect((await c.put('/api/billing/online-payments', { secret_key: 'sk_live_Rejected123456' })).status).toBe(400)
    const ok = await c.put('/api/billing/online-payments', { secret_key: LIVE_KEY })
    expect(ok.status).toBe(200)
    expect(ok.data).toMatchObject({ connected: true, mode: 'live', key_hint: '7890' })
    const [row] = await ctx.db.query('SELECT tap_secret_sealed FROM organizations WHERE id = $1', [me.org.id])
    expect(row.tap_secret_sealed).toMatch(/^v1\./)
    expect(row.tap_secret_sealed).not.toContain('AbCdEf')
    const settings = await c.get('/api/billing/settings')
    expect(JSON.stringify(settings.data)).not.toContain(LIVE_KEY)
    expect(settings.data.online_payments.connected).toBe(true)

    const del = await c.del('/api/billing/online-payments')
    expect(del.data.connected).toBe(false)
  })

  it('is refused without a server encryption key, and only owners and admins can connect', async () => {
    const plain = await setup()
    const { c } = await registered(plain.app)
    const r = await c.put('/api/billing/online-payments', { secret_key: LIVE_KEY })
    expect(r.status).toBe(503)
    expect((await c.get('/api/billing/settings')).data.online_payments.available).toBe(false)

    const { c: owner } = await registered(ctx.app)
    const email = `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`
    const invite = await owner.post('/api/org/invites', { email, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const lawyer = client(ctx.app)
    await lawyer.post('/api/auth/accept-invite', { token, name: 'Lawyer', password: 'Str0ngPassw0rd' })
    expect((await lawyer.put('/api/billing/online-payments', { secret_key: LIVE_KEY })).status).toBe(403)
  })
})

describe('paying an invoice online', () => {
  it('pays through the public link, reconciles once and tells the firm', async () => {
    const { c, id, me } = await firmWithInvoice({ clientEmail: 'fatima@example.test' })
    const link = await c.post(`/api/billing/invoices/${id}/pay-link`, {})
    expect(link.status).toBe(200)
    expect(link.data.url).toMatch(/^http:\/\/localhost:8080\/pay\/[\w-]{40,}$/)
    const token = tokenOf(link.data.url)
    // The same link is returned every time.
    expect((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url).toBe(link.data.url)

    const page = await ctx.app.request(`/pay/${token}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('105.000')
    expect(html).not.toContain('fatima@example.test')
    expect(page.headers.get('content-security-policy')).toContain('form-action \'self\' https://*.tap.company')
    expect((await ctx.app.request('/')).headers.get('content-security-policy')).not.toContain('tap.company')

    const start = await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ email: '', lang: 'en' }) })
    expect(start.status).toBe(303)
    expect(start.headers.get('location')).toMatch(/^https:\/\/checkout\.tap\.test\//)
    expect(ctx.firmTap.keys.at(-1)).toBe(LIVE_KEY)
    const body = ctx.firmTap.tap.created.at(-1)!
    expect(body).toMatchObject({ amount: 105, currency: 'OMR', customer: { email: 'fatima@example.test', first_name: 'Fatima' } })
    expect(body.metadata.invoice_id).toBe(id)
    expect(body.redirect.url).toBe('http://localhost:8080/pay/return?lang=en')
    expect(body.post.url).toBe('http://localhost:8080/webhooks/tap/invoices')

    const charge = [...ctx.firmTap.tap.charges.values()].at(-1)!
    const pending = await ctx.app.request(`/pay/return?tap_id=${charge.id}`)
    expect(pending.headers.get('location')).toBe(`/pay/${token}?result=pending&lang=en`)

    charge.status = 'CAPTURED'
    const done = await ctx.app.request(`/pay/return?tap_id=${charge.id}&lang=ar`)
    expect(done.headers.get('location')).toBe(`/pay/${token}?result=success&lang=ar`)
    const inv = await c.get(`/api/billing/invoices/${id}`)
    expect(inv.data.invoice.status).toBe('paid')
    expect(Number(inv.data.invoice.amount_paid)).toBe(105)
    expect(inv.data.invoice.pay_token).toBeUndefined()
    expect(inv.data.payments).toMatchObject([{ method: 'online', status: 'paid', charge_id: charge.id, needs_refund: false }])
    expect(inv.data.online.can_pay).toBe(false)
    const notices = ctx.mails.filter((m) => m.to === me.user.email && m.subject.includes('paid invoice'))
    expect(notices).toHaveLength(1)

    // Returning again, or the webhook, changes nothing.
    await ctx.app.request(`/pay/return?tap_id=${charge.id}`)
    const paidPage = await (await ctx.app.request(`/pay/${token}?result=success&lang=ar`)).text()
    expect(paidPage).toContain('تم استلام دفعتك')
    expect(paidPage).not.toContain('<form')
    expect(ctx.mails.filter((m) => m.to === me.user.email && m.subject.includes('paid invoice'))).toHaveLength(1)
    const audit = await ctx.db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'billing.online_payment_received' AND entity_id = $1`, [id])
    expect(audit[0].n).toBe(1)
  })

  it('accepts webhooks signed with the firm key and rejects others', async () => {
    const { c, id } = await firmWithInvoice({ clientEmail: 'client@example.test' })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ email: 'payer@example.test' }) })
    const charge = [...ctx.firmTap.tap.charges.values()].at(-1)!
    charge.status = 'CAPTURED'
    const payload = { id: charge.id, amount: 105, currency: 'OMR', status: 'CAPTURED', reference: { gateway: 'g1', payment: 'p1' }, transaction: { created: Date.now() } }
    const raw = JSON.stringify(payload)
    const hash = (key: string) => createHmac('sha256', key).update(
      `x_id${payload.id}x_amount105.000x_currencyOMRx_gateway_referenceg1x_payment_referencep1x_statusCAPTUREDx_created${payload.transaction.created}`).digest('hex')
    const bad = await ctx.app.request('/webhooks/tap/invoices', { method: 'POST', body: raw, headers: { hashstring: hash('sk_live_SomeoneElse12345') } })
    expect(bad.status).toBe(401)
    expect((await c.get(`/api/billing/invoices/${id}`)).data.invoice.status).toBe('issued')
    const unknown = await ctx.app.request('/webhooks/tap/invoices', { method: 'POST', body: JSON.stringify({ ...payload, id: 'chg_nope' }), headers: { hashstring: hash(LIVE_KEY) } })
    expect(unknown.status).toBe(404)
    const good = await ctx.app.request('/webhooks/tap/invoices', { method: 'POST', body: raw, headers: { hashstring: hash(LIVE_KEY) } })
    expect(good.status).toBe(200)
    const inv = await c.get(`/api/billing/invoices/${id}`)
    expect(inv.data.invoice.status).toBe('paid')
    expect(inv.data.payments[0]).toMatchObject({ method: 'online', status: 'paid' })
  })

  it('charges only the balance after a part payment, and flags a payment that arrives after the invoice was settled', async () => {
    const { c, id } = await firmWithInvoice({ clientEmail: 'client@example.test' })
    await c.post(`/api/billing/invoices/${id}/payments`, { amount: 40 })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    expect(await (await ctx.app.request(`/pay/${token}`)).text()).toContain('65.000')
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({}) })
    const charge = [...ctx.firmTap.tap.charges.values()].at(-1)!
    expect(charge.amount).toBe(65)
    // The firm records the rest by hand while the client is still on Tap's page.
    await c.post(`/api/billing/invoices/${id}/payments`, { amount: 65 })
    charge.status = 'CAPTURED'
    await ctx.app.request(`/pay/return?tap_id=${charge.id}`)
    const inv = await c.get(`/api/billing/invoices/${id}`)
    expect(Number(inv.data.invoice.amount_paid)).toBe(105)
    const online = inv.data.payments.find((p: any) => p.method === 'online')
    expect(online).toMatchObject({ status: 'paid', needs_refund: true })
    expect(inv.data.payments.filter((p: any) => p.method === 'manual')).toHaveLength(2)
    expect(ctx.mails.some((m) => m.subject.startsWith('Action needed: online payment'))).toBe(true)
  })

  it('rejects tampered charges and failed payments leave the invoice open', async () => {
    const { c, id } = await firmWithInvoice({ clientEmail: 'client@example.test' })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({}) })
    const declined = [...ctx.firmTap.tap.charges.values()].at(-1)!
    declined.status = 'DECLINED'
    expect((await ctx.app.request(`/pay/return?tap_id=${declined.id}`)).headers.get('location')).toContain('result=failed')
    const failedPage = await (await ctx.app.request(`/pay/${token}?result=failed`)).text()
    expect(failedPage).toContain('did not go through')
    expect(failedPage).toContain('<form')

    await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({}) })
    const tampered = [...ctx.firmTap.tap.charges.values()].at(-1)!
    tampered.status = 'CAPTURED'
    tampered.amount = 1
    await ctx.app.request(`/pay/return?tap_id=${tampered.id}`)
    const inv = await c.get(`/api/billing/invoices/${id}`)
    expect(inv.data.invoice.status).toBe('issued')
    expect(Number(inv.data.invoice.amount_paid)).toBe(0)
    expect(inv.data.payments.map((p: any) => p.status)).toEqual(['failed', 'failed'])
  })

  it('needs an email for the receipt, a connected account and an issued invoice', async () => {
    const { c, id, me } = await firmWithInvoice({ connect: false })
    expect((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).status).toBe(409)
    await c.put('/api/billing/online-payments', { secret_key: LIVE_KEY })
    const token = tokenOf((await c.post(`/api/billing/invoices/${id}/pay-link`, {})).data.url)
    const noEmail = await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ email: 'not-an-email' }) })
    expect(noEmail.status).toBe(400)
    expect(await noEmail.text()).toContain('enter your email')
    // Disconnecting turns the page into a notice.
    await c.del('/api/billing/online-payments')
    expect(await (await ctx.app.request(`/pay/${token}`)).text()).toContain('not available')
    expect((await ctx.app.request(`/pay/${token}`, { method: 'POST', body: form({ email: 'a@b.test' }) })).headers.get('location')).toBeNull()
    expect((await ctx.app.request('/pay/not-a-real-token')).status).toBe(404)
    expect((await ctx.app.request(`/pay/${'x'.repeat(43)}`)).status).toBe(404)
    expect(me.org.id).toBeTruthy()
  })

  it('emails the link to the client in Arabic and English', async () => {
    const { c, id } = await firmWithInvoice({ clientEmail: 'fatima@example.test' })
    const r = await c.post(`/api/billing/invoices/${id}/pay-link`, { send: true })
    expect(r.data.emailed).toBe(true)
    const mail = ctx.mails.filter((m) => m.to === 'fatima@example.test').at(-1)!
    expect(mail.subject).toMatch(/pay online/)
    expect(mail.text).toContain(r.data.url)
    expect(mail.text).toContain('105 OMR')
    expect(mail.text).toContain('يمكنك الدفع بأمان')
  })

  it('shows Pay now in the client portal for the client\'s own invoices', async () => {
    const { id, portal } = await firmWithInvoice({ portal: true })
    const o = await portal!.get('/api/portal/overview')
    expect(o.data.invoices[0]).toMatchObject({ id, can_pay: true })
    const r = await portal!.post(`/api/portal/invoices/${id}/pay`)
    expect(r.data.url).toMatch(/^\/pay\/[\w-]{40,}$/)
    expect((await ctx.app.request(r.data.url)).status).toBe(200)

    const other = await firmWithInvoice({})
    expect((await portal!.post(`/api/portal/invoices/${other.id}/pay`)).status).toBe(404)
  })
})
