import { beforeAll, describe, expect, it } from 'vitest'
import { normalizePhone, runWhatsAppReminders } from '../src/services/whatsapp'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ ENCRYPTION_KEY: 'test-encryption-key-for-whatsapp' }) })

const TOKEN = 'EAAG' + 'x'.repeat(60)
const run = (now = new Date()) => runWhatsAppReminders({ db: ctx.db, config: ctx.config, log: ctx.log, waFetch: ctx.wa.fetch as typeof fetch }, now)
const sentTo = (phone: string) => ctx.wa.requests.filter((r) => r.method === 'POST' && r.body?.to === phone)

async function connectedFirm() {
  const firm = await registered(ctx.app)
  const r = await firm.c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })
  expect(r.status).toBe(200)
  return firm
}

describe('phone numbers', () => {
  it('turns local and international formats into E.164 digits', () => {
    expect(normalizePhone('+968 9123 4567', 'oman')).toBe('96891234567')
    expect(normalizePhone('9123 4567', 'oman')).toBe('96891234567')
    expect(normalizePhone('050 123 4567', 'uae')).toBe('971501234567')
    expect(normalizePhone('0096650 123 4567', 'oman')).toBe('966501234567')
    expect(normalizePhone('966501234567', 'oman')).toBe('966501234567')
    expect(normalizePhone('12', 'oman')).toBeNull()
    expect(normalizePhone('', 'oman')).toBeNull()
    expect(normalizePhone('5551234', 'international')).toBeNull()
  })
})

describe('connecting WhatsApp', () => {
  it('checks the details with WhatsApp, stores the token sealed and never returns it', async () => {
    const { c, me } = await registered(ctx.app)
    ctx.wa.fail = { status: 401, message: 'Invalid OAuth access token.' }
    const bad = await c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })
    ctx.wa.fail = null
    expect(bad.status).toBe(400)
    expect(bad.data.error.message).toContain('Invalid OAuth access token')

    const ok = await c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })
    expect(ok.data.display_phone).toBe('+968 2400 0000')
    expect(ctx.wa.requests.at(-1)!.auth).toBe(`Bearer ${TOKEN}`)
    const [o] = await ctx.db.query('SELECT wa_token_sealed FROM organizations WHERE id = $1', [me.org.id])
    expect(o.wa_token_sealed).toMatch(/^v1\./)
    const info = await c.get('/api/whatsapp')
    expect(info.data).toMatchObject({ connected: true, display_phone: '+968 2400 0000' })
    expect(JSON.stringify(info.data)).not.toContain(TOKEN)
    expect(info.data.templates.hearing.ar).toContain('{{1}}')
    expect((await c.del('/api/whatsapp')).status).toBe(200)
    expect((await c.get('/api/whatsapp')).data.connected).toBe(false)
  })

  it('needs an encryption key on the server, and only owners and admins can connect', async () => {
    const plain = await setup()
    const { c } = await registered(plain.app)
    expect((await c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })).status).toBe(503)

    const { c: owner } = await registered(ctx.app)
    const inv = await owner.post('/api/org/invites', { email: `l-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const lawyer = client(ctx.app)
    await lawyer.post('/api/auth/accept-invite', { token: new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token'), name: 'Lawyer', password: 'Str0ngPassw0rd' })
    expect((await lawyer.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })).status).toBe(403)
    expect((await lawyer.patch('/api/whatsapp/settings', { hearing: { enabled: false, template: 'x' } })).status).toBe(403)
  })

  it('sends a test with sample values using the configured template name', async () => {
    const { c } = await connectedFirm()
    await c.patch('/api/whatsapp/settings', { invoice: { enabled: true, template: 'firm_invoice_v2' } })
    const r = await c.post('/api/whatsapp/test', { phone: '+968 9111 2222', kind: 'invoice', language: 'ar' })
    expect(r.status).toBe(200)
    const req = sentTo('96891112222').at(-1)!
    expect(req.url).toBe('https://graph.facebook.com/v21.0/1234567890/messages')
    expect(req.body.template).toMatchObject({ name: 'firm_invoice_v2', language: { code: 'ar' } })
    expect(req.body.template.components[0].parameters).toHaveLength(6)
    ctx.wa.fail = { status: 400, message: 'Template name does not exist in the translation' }
    const refused = await c.post('/api/whatsapp/test', { phone: '+968 9111 2222', kind: 'hearing', language: 'en' })
    ctx.wa.fail = null
    expect(refused.status).toBe(400)
    expect(refused.data.error.message).toContain('Template name does not exist')
    const log = (await c.get('/api/whatsapp')).data.messages
    expect(log.map((m: any) => m.status)).toEqual(['failed', 'sent'])
  })
})

describe('automatic reminders', () => {
  it('reminds opted-in clients of tomorrow\'s hearing once, in their language, and again if it moves', async () => {
    const { c } = await connectedFirm()
    const yes = await c.post('/api/clients', { name: 'Fatima Al Balushi', name_ar: 'فاطمة البلوشية', phone: '9123 4567', whatsapp_opt_in: true })
    expect(yes.data.client.whatsapp_opt_in_at).toBeTruthy()
    const no = await c.post('/api/clients', { name: 'No Consent', phone: '9765 4321' })
    const k1 = await c.post('/api/cases', { title: 'Appeal', jurisdiction: 'oman', client_id: yes.data.client.id, court: 'Court of Appeal, Muscat' })
    const k2 = await c.post('/api/cases', { title: 'Other', jurisdiction: 'oman', client_id: no.data.client.id })
    const at = new Date(Date.now() + 20 * 3600_000)
    const ev = await c.post('/api/events', { title: 'Appeal hearing', kind: 'hearing', case_id: k1.data.case.id, starts_at: at.toISOString() })
    expect(ev.status).toBe(201)
    await c.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k2.data.case.id, starts_at: at.toISOString() })
    // Too far ahead: not yet.
    await c.post('/api/events', { title: 'Later hearing', kind: 'hearing', case_id: k1.data.case.id, starts_at: new Date(Date.now() + 5 * 86400_000).toISOString() })

    await run()
    const msgs = sentTo('96891234567')
    expect(msgs).toHaveLength(1)
    const tpl = msgs[0]!.body.template
    expect(tpl).toMatchObject({ name: 'hearing_reminder', language: { code: 'ar' } })
    const params = tpl.components[0].parameters.map((p: any) => p.text)
    expect(params[0]).toBe('فاطمة البلوشية')
    expect(params[2]).toBe(k1.data.case.reference)
    expect(params[4]).toBe('Court of Appeal, Muscat')
    expect(sentTo('96897654321')).toHaveLength(0)

    await run()
    expect(sentTo('96891234567')).toHaveLength(1)
    // Rescheduled: a new reminder.
    await c.patch(`/api/events/${ev.data.event.id}`, { starts_at: new Date(at.getTime() + 3600_000).toISOString() })
    await run()
    expect(sentTo('96891234567')).toHaveLength(2)

    // English when the client prefers it; consent can be withdrawn.
    await c.patch(`/api/clients/${yes.data.client.id}`, { language: 'en' })
    await c.post('/api/events', { title: 'Another', kind: 'hearing', case_id: k1.data.case.id, starts_at: new Date(Date.now() + 10 * 3600_000).toISOString() })
    await run()
    expect(sentTo('96891234567').at(-1)!.body.template.language.code).toBe('en')
    await c.patch(`/api/clients/${yes.data.client.id}`, { whatsapp_opt_in: false })
    await c.post('/api/events', { title: 'Third', kind: 'hearing', case_id: k1.data.case.id, starts_at: new Date(Date.now() + 12 * 3600_000).toISOString() })
    await run()
    expect(sentTo('96891234567')).toHaveLength(3)
  })

  it('chases overdue invoices weekly with the payment link, at most three times', async () => {
    const { c } = await connectedFirm()
    await c.put('/api/billing/online-payments', { secret_key: 'sk_test_AbCdEf1234567890' })
    const cl = await c.post('/api/clients', { name: 'Late Payer', phone: '+968 9555 0000', whatsapp_opt_in: true, language: 'en' })
    const draft = await c.post('/api/billing/invoices', { client_id: cl.data.client.id, fixed_lines: [{ description: 'Advice', quantity: 1, unit_price: 100 }] })
    const id = draft.data.invoice.id
    await c.post(`/api/billing/invoices/${id}/issue`)
    await run()
    expect(sentTo('96895550000')).toHaveLength(0)
    await ctx.db.query(`UPDATE invoices SET due_date = CURRENT_DATE - 2 WHERE id = $1`, [id])
    await run()
    const first = sentTo('96895550000')
    expect(first).toHaveLength(1)
    const params = first[0]!.body.template.components[0].parameters.map((p: any) => p.text)
    expect(params[3]).toBe('105 OMR')
    expect(params[5]).toMatch(/^http:\/\/localhost:8080\/pay\/[\w-]{40,}$/)
    await run()
    expect(sentTo('96895550000')).toHaveLength(1)
    const day = 86400_000
    await run(new Date(Date.now() + 8 * day))
    await run(new Date(Date.now() + 16 * day))
    await run(new Date(Date.now() + 24 * day))
    expect(sentTo('96895550000')).toHaveLength(3)
    // Paid invoices are not chased.
    await c.post(`/api/billing/invoices/${id}/payments`, { amount: 105 })
    expect((await ctx.db.query(`SELECT count(*)::int AS n FROM whatsapp_messages WHERE entity_id = $1`, [id]))[0].n).toBe(3)
  })

  it('reminds portal clients about documents still needed, and records failures', async () => {
    const { c } = await connectedFirm()
    const cl = await c.post('/api/clients', { name: 'Doc Client', phone: '+968 9666 0000', whatsapp_opt_in: true })
    const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email: `d-${crypto.randomUUID().slice(0, 6)}@example.test` })
    const portal = client(ctx.app)
    await portal.post('/api/auth/accept-invite', { token: new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token'), name: 'Doc', password: 'Str0ngPassw0rd' })
    const req = await c.post('/api/document-requests', { client_id: cl.data.client.id, title: 'Residency', items: [{ label: 'Passport copy' }, { label: 'Photo' }] })
    await run()
    expect(sentTo('96896660000')).toHaveLength(0)
    await ctx.db.query(`UPDATE document_requests SET created_at = now() - interval '4 days' WHERE id = $1`, [req.data.request.id])
    ctx.wa.fail = { status: 400, message: 'Recipient phone number not in allowed list' }
    await run()
    ctx.wa.fail = null
    const [failed] = await ctx.db.query(`SELECT status, error FROM whatsapp_messages WHERE entity_id = $1`, [req.data.request.id])
    expect(failed).toMatchObject({ status: 'failed', error: 'Recipient phone number not in allowed list' })
    const later = new Date(Date.now() + 5 * 86400_000)
    await run(later)
    const msg = sentTo('96896660000').at(-1)!
    const params = msg.body.template.components[0].parameters.map((p: any) => p.text)
    expect(params[2]).toBe('Residency')
    expect(params[3]).toBe('Passport copy, Photo')
    expect(params[4]).toBe('http://localhost:8080/app#/portal')
    // No preferred language on the client: the portal user's language is used.
    expect(msg.body.template.language.code).toBe('en')
  })
})
