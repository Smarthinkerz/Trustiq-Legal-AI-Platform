import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { totpCode } from '../src/lib/totp'
import { runDailyDigest, runRenewalReminders } from '../src/services/jobs'
import { createLogger } from '../src/lib/logger'
import { citationLabel } from '../src/services/library'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ TAP_WEBHOOK_SECRET: 'whsec_test_secret', TAP_SECRET_KEY: 'sk_test_x' }) })

const LAW = `Royal Decree 35/2003 – Labour Law

Article 1
This law applies to all employers and workers in the private sector.

Article 40
The employer may terminate the employment contract without notice if the worker commits a serious misconduct, including assault at the workplace.

Article 43
The employer shall pay the worker an end of service gratuity upon termination of the contract.`

describe('law library and cited research', () => {
  it('indexes a law by article, searches it and cites it in AI answers', async () => {
    const { c } = await registered(ctx.app)
    const form = new FormData()
    form.set('title', 'Oman Labour Law')
    form.set('jurisdiction', 'oman')
    form.set('language', 'en')
    form.set('number', '35/2003')
    form.set('text', LAW)
    const up = await c.post('/api/library/sources', form)
    expect(up.status).toBe(201)
    expect(up.data.passages).toBeGreaterThanOrEqual(3)

    const s = await c.get('/api/library/search?q=gratuity%20termination')
    expect(s.status).toBe(200)
    expect(s.data.items[0].text).toMatch(/gratuity/)

    ctx.ai.nextReply = 'The worker is entitled to an end of service gratuity [S1].'
    const chat = await c.post('/api/ai/chat', { message: 'Is an end of service gratuity payable?', jurisdiction: 'oman' })
    expect(chat.status).toBe(200)
    expect(chat.data.library_matches).toBeGreaterThan(0)
    expect(chat.data.sources).toHaveLength(1)
    expect(chat.data.sources[0].citation).toMatch(/Labour Law/)
    // The retrieved passages were sent to the model as sources.
    const system = ctx.ai.calls.at(-1)![0]!.content as string
    expect(system).toContain('<sources>')

    // Another firm cannot see this firm's library.
    const other = await registered(ctx.app)
    expect((await other.c.get('/api/library/search?q=gratuity')).data.items).toHaveLength(0)
    // Only platform admins may add to the shared library.
    form.set('scope', 'platform')
    expect((await c.post('/api/library/sources', form)).status).toBe(403)
  })
})

describe('citation labels', () => {
  it('formats law numbers without repeating the year', () => {
    expect(citationLabel({ title: 'Labour Law', number: '35/2003', year: 2003, label: 'Article 43' } as any)).toBe('Labour Law (No. 35/2003) – Article 43')
    expect(citationLabel({ title: 'Labour Law', number: '35', year: 2003, label: null } as any)).toBe('Labour Law (No. 35/2003)')
    expect(citationLabel({ title: 'Judgment', number: null, year: 2019, label: null } as any)).toBe('Judgment (2019)')
  })
})

describe('time, expenses and invoices', () => {
  it('bills time with the jurisdiction VAT, numbers invoices and tracks payments', async () => {
    const { c } = await registered(ctx.app)
    const settings = await c.put('/api/billing/settings', { vat_rate: null, payment_terms_days: 30, vat_number: 'OM1100000000', default_hourly_rate: 60 })
    expect(settings.status).toBe(200)
    const cl = await c.post('/api/clients', { name: 'Billing Client' })
    const k = await c.post('/api/cases', { title: 'Billable matter', jurisdiction: 'oman', client_id: cl.data.client.id })
    const t = await c.post('/api/billing/time', { case_id: k.data.case.id, minutes: 90, description: 'Drafting statement of claim' })
    expect(t.status).toBe(201)
    const e = await c.post('/api/billing/expenses', { case_id: k.data.case.id, amount: 12.5, description: 'Court filing fee' })
    expect(e.status).toBe(201)

    const unbilled = await c.get(`/api/billing/unbilled?client_id=${cl.data.client.id}`)
    expect(unbilled.data.time).toHaveLength(1)
    const inv = await c.post('/api/billing/invoices', {
      client_id: cl.data.client.id, time_entry_ids: unbilled.data.time.map((x: any) => x.id), expense_ids: unbilled.data.expenses.map((x: any) => x.id),
      fixed_lines: [{ description: 'Consultation', unit_price: 50 }]
    })
    expect(inv.status).toBe(201)
    const invoice = inv.data.invoice
    // 1.5h × 60 + 12.5 + 50 = 152.5; Oman VAT 5% = 7.625
    expect(Number(invoice.subtotal)).toBeCloseTo(152.5)
    expect(Number(invoice.vat_rate)).toBe(5)
    expect(Number(invoice.total)).toBeCloseTo(160.125)
    // Entries cannot be billed twice.
    const again = await c.post('/api/billing/invoices', { client_id: cl.data.client.id, time_entry_ids: unbilled.data.time.map((x: any) => x.id) })
    expect(again.status).toBe(409)

    const issued = await c.post(`/api/billing/invoices/${invoice.id}/issue`)
    expect(issued.data.invoice.number).toMatch(/^INV-\d{4}-0001$/)
    expect((await c.post(`/api/billing/invoices/${invoice.id}/payments`, { amount: 1000 })).status).toBe(400)
    const paid = await c.post(`/api/billing/invoices/${invoice.id}/payments`, { amount: 160.125 })
    expect(paid.data.invoice.status).toBe('paid')

    const docx = await c.get(`/api/billing/invoices/${invoice.id}/export?lang=ar`)
    expect(docx.status).toBe(200)
    expect(docx.res.headers.get('content-type')).toContain('wordprocessingml')

    const report = await c.get('/api/reports')
    expect(report.status).toBe(200)
    expect(report.data.by_user[0].minutes).toBe(90)
  })
})

describe('tasks, conflicts, search and templates', () => {
  it('works end to end', async () => {
    const { c, me } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { name: 'Gulf Petroleum Services', kind: 'company' })
    const k = await c.post('/api/cases', { title: 'Gulf Petroleum v Contractor', jurisdiction: 'uae', client_id: cl.data.client.id })
    const applied = await c.post('/api/tasks/apply-checklist', { case_id: k.data.case.id, checklist: 'litigation' })
    expect(applied.status).toBe(201)
    expect(applied.data.created).toBeGreaterThan(3)
    const task = await c.post('/api/tasks', { title: 'Call the client', case_id: k.data.case.id, assigned_to: me.user.id, due_date: '2020-01-01' })
    expect(task.status).toBe(201)
    const mine = await c.get('/api/tasks?scope=mine')
    expect(mine.data.items.some((t: any) => t.title === 'Call the client')).toBe(true)
    expect((await c.patch(`/api/tasks/${task.data.task.id}`, { status: 'done' })).data.task.status).toBe('done')

    const conflicts = await c.get('/api/workspace/conflicts?name=gulf%20petroleum')
    expect(conflicts.data.clients[0].name).toBe('Gulf Petroleum Services')

    const found = await c.get('/api/workspace/search?q=petroleum')
    expect(found.data.clients).toHaveLength(1)
    expect(found.data.cases).toHaveLength(1)

    const tpl = await c.post('/api/workspace/templates', { name: 'Engagement letter', content: 'Dear {{client.name}}, re {{case.reference}} – {{firm.name}}. {{unknown.field}}' })
    expect(tpl.status).toBe(201)
    const gen = await c.post(`/api/workspace/templates/${tpl.data.template.id}/generate`, { case_id: k.data.case.id })
    expect(gen.status).toBe(201)
    const doc = await c.get(`/api/documents/${gen.data.document.id}`)
    expect(doc.data.document.content).toContain('Dear Gulf Petroleum Services')
    expect(doc.data.document.content).toContain(k.data.case.reference)
    expect(doc.data.document.content).toContain('{{unknown.field}}')
  })
})

describe('two-factor authentication', () => {
  it('requires a TOTP code at sign-in and accepts a single-use recovery code', async () => {
    const { c, email } = await registered(ctx.app)
    const s = await c.post('/api/auth/2fa/setup')
    expect(s.data.qr_data_url).toMatch(/^data:image\/png/)
    expect((await c.post('/api/auth/2fa/enable', { code: '000000' })).status).toBe(400)
    const en = await c.post('/api/auth/2fa/enable', { code: totpCode(s.data.secret) })
    expect(en.status).toBe(200)
    expect(en.data.recovery_codes).toHaveLength(8)

    const fresh = client(ctx.app)
    const step1 = await fresh.post('/api/auth/login', { email, password: 'Str0ngPassw0rd' })
    expect(step1.data.mfa_required).toBe(true)
    expect((await fresh.get('/api/auth/me')).status).toBe(401)
    expect((await fresh.post('/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: '123456' })).status).toBe(401)
    const ok = await fresh.post('/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: totpCode(s.data.secret) })
    expect(ok.status).toBe(200)
    expect(ok.data.user.two_factor).toBe(true)

    const fresh2 = client(ctx.app)
    const t2 = await fresh2.post('/api/auth/login', { email, password: 'Str0ngPassw0rd' })
    const rc = en.data.recovery_codes[0]
    expect((await fresh2.post('/api/auth/login/mfa', { mfa_token: t2.data.mfa_token, code: rc })).status).toBe(200)
    const fresh3 = client(ctx.app)
    const t3 = await fresh3.post('/api/auth/login', { email, password: 'Str0ngPassw0rd' })
    expect((await fresh3.post('/api/auth/login/mfa', { mfa_token: t3.data.mfa_token, code: rc })).status).toBe(401)
  })
})

describe('client portal', () => {
  it('gives clients a scoped view of their own matters only', async () => {
    const { c } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { name: 'Portal Client' })
    const other = await c.post('/api/clients', { name: 'Other Client' })
    const k = await c.post('/api/cases', { title: 'Portal matter', jurisdiction: 'oman', client_id: cl.data.client.id })
    await c.post('/api/cases', { title: 'Someone else matter', jurisdiction: 'oman', client_id: other.data.client.id })
    const shared = await c.post('/api/documents', { title: 'Shared advice', content: 'Advice text', client_id: cl.data.client.id, case_id: k.data.case.id, shared_with_client: true })
    expect(shared.status).toBe(201)
    await c.post('/api/documents', { title: 'Internal memo', content: 'Privileged', client_id: cl.data.client.id, case_id: k.data.case.id })

    const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email: `client-${crypto.randomUUID().slice(0, 6)}@example.test` })
    expect(inv.status).toBe(201)
    const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
    const portal = client(ctx.app)
    const acc = await portal.post('/api/auth/accept-invite', { token, name: 'Client Person', password: 'Str0ngPassw0rd' })
    expect(acc.status).toBe(201)
    expect(acc.data.user.role).toBe('client')

    const ov = await portal.get('/api/portal/overview')
    expect(ov.status).toBe(200)
    expect(ov.data.cases.map((x: any) => x.title)).toEqual(['Portal matter'])
    expect(ov.data.documents.map((x: any) => x.title)).toEqual(['Shared advice'])
    // Firm APIs are closed to portal users.
    for (const p of ['/api/cases', '/api/clients', '/api/documents', '/api/billing/invoices', '/api/library/sources']) {
      expect((await portal.get(p)).status).toBe(403)
    }
    expect((await portal.post('/api/portal/messages', { body: 'When is the next hearing?' })).status).toBe(201)
    const msgs = await c.get(`/api/clients/${cl.data.client.id}/messages`)
    expect(msgs.data.items[0].body).toBe('When is the next hearing?')
    // Staff cannot use the portal API.
    expect((await c.get('/api/portal/overview')).status).toBe(403)
  })
})

describe('calendar feed and reminders', () => {
  it('serves an ICS feed by secret token and sends one digest per day', async () => {
    const { c, me } = await registered(ctx.app)
    await c.post('/api/events', { title: 'Hearing at Primary Court', kind: 'hearing', starts_at: new Date(Date.now() + 3600_000).toISOString() })
    await c.post('/api/tasks', { title: 'File memo', assigned_to: me.user.id, due_date: new Date().toISOString().slice(0, 10) })
    const tok = await c.post('/api/auth/calendar-token')
    const path = new URL(tok.data.calendar_url).pathname
    const res = await ctx.app.request(path)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('Hearing at Primary Court')
    expect((await ctx.app.request('/calendar/not-a-real-token-aaaaaaaaaaaa.ics')).status).toBe(404)

    const log = createLogger('error', true)
    const noon = new Date(); noon.setUTCHours(12)
    const before = ctx.mails.length
    await runDailyDigest(ctx.db, { configured: true, send: async (m) => { ctx.mails.push(m) } }, ctx.config, log, noon)
    const mine = ctx.mails.slice(before).filter((m) => m.to === me.user.email)
    expect(mine).toHaveLength(1)
    await runDailyDigest(ctx.db, { configured: true, send: async (m) => { ctx.mails.push(m) } }, ctx.config, log, noon)
    expect(ctx.mails.slice(before).filter((m) => m.to === me.user.email)).toHaveLength(1)
  })
})

describe('Tap subscription payments', () => {
  const sign = (body: string) => createHmac('sha256', 'whsec_test_secret').update(body).digest('hex')

  it('creates a hosted checkout, reconciles on return and extends the plan once', async () => {
    const { c, me } = await registered(ctx.app)
    const co = await c.post('/api/subscription/checkout', { plan: 'professional' })
    expect(co.status).toBe(200)
    expect(co.data.checkout_url).toMatch(/^https:\/\/checkout\.tap\.test\//)
    const body = ctx.tap.created.at(-1)!
    expect(body.amount).toBe(499)
    expect(body.currency).toBe('OMR')
    expect(body.metadata.org_id).toBe(me.org.id)
    expect(body.redirect.url).toBe('http://localhost:8080/billing/tap/return')

    const charge = [...ctx.tap.charges.values()].at(-1)!
    const pending = await ctx.app.request(`/billing/tap/return?tap_id=${charge.id}`)
    expect(pending.headers.get('location')).toContain('payment=pending')

    charge.status = 'CAPTURED'
    const ret = await ctx.app.request(`/billing/tap/return?tap_id=${charge.id}`)
    expect(ret.status).toBe(303)
    expect(ret.headers.get('location')).toContain('payment=success')
    const after = await c.get('/api/auth/me')
    expect(after.data.org.plan).toBe('professional')
    const expires = new Date(after.data.org.plan_expires_at).getTime()
    expect(expires).toBeGreaterThan(Date.now() + 27 * 86400_000)

    // Webhook for the same charge is idempotent and does not extend again.
    const payload = JSON.stringify({ id: charge.id, status: 'CAPTURED', amount: 499, currency: 'OMR' })
    const wh = await ctx.app.request('/webhooks/tap', { method: 'POST', body: payload, headers: { hashstring: sign(payload), 'content-type': 'application/json' } })
    expect(wh.status).toBe(200)
    const dup = await ctx.app.request('/webhooks/tap', { method: 'POST', body: payload, headers: { hashstring: sign(payload), 'content-type': 'application/json' } })
    expect((await dup.json()).duplicate).toBe(true)
    const final = await c.get('/api/auth/me')
    expect(new Date(final.data.org.plan_expires_at).getTime()).toBe(expires)
    const hist = await c.get('/api/subscription')
    expect(hist.data.payments[0].status).toBe('paid')
    expect(ctx.mails.filter((m) => m.to === me.user.email && /receipt/i.test(m.subject))).toHaveLength(1)
  })

  it('rejects bad signatures and tampered amounts', async () => {
    const payload = JSON.stringify({ id: 'chg_unknown', status: 'CAPTURED' })
    const bad = await ctx.app.request('/webhooks/tap', { method: 'POST', body: payload, headers: { hashstring: 'a'.repeat(64) } })
    expect(bad.status).toBe(401)
    const none = await ctx.app.request('/webhooks/tap', { method: 'POST', body: payload })
    expect(none.status).toBe(401)

    const { c } = await registered(ctx.app)
    await c.post('/api/subscription/checkout', { plan: 'starter' })
    const charge = [...ctx.tap.charges.values()].at(-1)!
    charge.status = 'CAPTURED'
    charge.amount = 1
    const ret = await ctx.app.request(`/billing/tap/return?tap_id=${charge.id}`)
    expect(ret.headers.get('location')).toContain('payment=failed')
    expect((await c.get('/api/auth/me')).data.org.plan).toBe('trial')
  })

  it('only owners and admins can start checkout; expired plans become read-only and get reminders', async () => {
    const { c, me } = await registered(ctx.app)
    await ctx.db.query(`UPDATE organizations SET plan = 'starter', plan_expires_at = now() - interval '1 day' WHERE id = $1`, [me.org.id])
    const me2 = await c.get('/api/auth/me')
    expect(me2.data.org.subscription_expired).toBe(true)
    expect((await c.post('/api/clients', { name: 'Blocked' })).status).toBe(402)
    expect((await c.get('/api/clients')).status).toBe(200)
    // Checkout stays reachable so the firm can renew.
    expect((await c.post('/api/subscription/checkout', { plan: 'starter' })).status).toBe(200)

    const before = ctx.mails.length
    const mailer = { configured: true, send: async (m: any) => { ctx.mails.push(m) } }
    await runRenewalReminders(ctx.db, mailer, ctx.config, createLogger('error', true))
    await runRenewalReminders(ctx.db, mailer, ctx.config, createLogger('error', true))
    expect(ctx.mails.slice(before).filter((m) => m.to === me.user.email)).toHaveLength(1)
  })

  it('returns 503 when the webhook secret is not configured', async () => {
    const plain = await setup()
    const res = await plain.app.request('/webhooks/tap', { method: 'POST', body: '{}' })
    expect(res.status).toBe(503)
  })
})
