import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ ENCRYPTION_KEY: 'test-encryption-key-for-whatsapp' }) })

const TOKEN = 'EAAG' + 'x'.repeat(60)

async function firmWithPortalClient(phone: string | null) {
  const firm = await registered(ctx.app)
  const c = firm.c
  const cl = await c.post('/api/clients', { name: 'Al Noor Trading', name_ar: 'النور للتجارة', phone, language: 'ar' })
  const k = await c.post('/api/cases', { title: 'Unpaid invoices claim', jurisdiction: 'oman', client_id: cl.data.client.id })
  const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email: `wa-${crypto.randomUUID().slice(0, 6)}@example.test` })
  const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
  expect((await client(ctx.app).post('/api/auth/accept-invite', { token, name: 'Client Person', password: 'Str0ngPassw0rd' })).status).toBe(201)
  return { c, clientId: cl.data.client.id as string, caseId: k.data.case.id as string, reference: k.data.case.reference as string }
}

const publish = async (c: any, caseId: string, title: string, body: Record<string, unknown> = {}) => {
  const d = await c.post(`/api/client-updates/case/${caseId}`, { language: 'ar', title, body: 'حددت المحكمة موعد الجلسة الأولى.' })
  return c.post(`/api/client-updates/${d.data.update.id}/publish`, { email: false, ...body })
}

describe('WhatsApp notice for client updates', () => {
  it('is off until the firm switches it on, then reaches opted-in clients once, in their language', async () => {
    const { c, clientId, caseId, reference } = await firmWithPortalClient('9123 4567')
    expect((await c.get(`/api/client-updates/case/${caseId}`)).data.whatsapp).toBe('not_connected')
    expect((await c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })).status).toBe(200)

    // Connected, but the new template is off by default (it must be approved by Meta first).
    expect((await c.get('/api/whatsapp')).data.settings.case_update).toEqual({ enabled: false, template: 'case_update_notice' })
    expect((await c.get('/api/whatsapp')).data.settings.hearing.enabled).toBe(true)
    expect((await publish(c, caseId, 'Update 1')).data.whatsapp).toBe('disabled')

    await c.patch('/api/whatsapp/settings', { case_update: { enabled: true, template: 'case_update_notice' } })
    expect((await c.get(`/api/client-updates/case/${caseId}`)).data.whatsapp).toBe('no_opt_in')
    expect((await publish(c, caseId, 'Update 2')).data.whatsapp).toBe('no_opt_in')

    await c.patch(`/api/clients/${clientId}`, { whatsapp_opt_in: true })
    expect((await c.get(`/api/client-updates/case/${caseId}`)).data.whatsapp).toBe('ready')
    const before = ctx.wa.requests.length
    const r = await publish(c, caseId, 'تحديد موعد الجلسة الأولى')
    expect(r.data.whatsapp).toBe('sent')
    const sent = ctx.wa.requests.slice(before).filter((q) => q.method === 'POST')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.body).toMatchObject({ to: '96891234567', template: { name: 'case_update_notice', language: { code: 'ar' } } })
    expect(sent[0]!.body.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      'النور للتجارة', expect.any(String), reference, 'تحديد موعد الجلسة الأولى', `${ctx.config.appUrl}/app#/portal/cases/${caseId}`
    ])
    const list = (await c.get(`/api/client-updates/case/${caseId}`)).data.items
    expect(list.find((u: any) => u.id === r.data.update.id).whatsapp_status).toBe('sent')
    expect(list.find((u: any) => u.title === 'Update 1').whatsapp_status).toBeNull()

    // The lawyer can leave it out; a failure is reported, not hidden.
    expect((await publish(c, caseId, 'Quiet update', { whatsapp: false })).data.whatsapp).toBeNull()
    ctx.wa.fail = { status: 400, message: 'Template name does not exist in the translation' }
    const failed = await publish(c, caseId, 'Update 5')
    ctx.wa.fail = null
    expect(failed.data.whatsapp).toBe('failed')
    const [m] = await ctx.db.query(`SELECT status, error FROM whatsapp_messages WHERE kind = 'case_update' AND entity_id = $1`, [failed.data.update.id])
    expect(m).toMatchObject({ status: 'failed', error: expect.stringContaining('Template name') })
  })

  it('needs a usable phone number and portal access', async () => {
    const { c, clientId, caseId } = await firmWithPortalClient('12')
    await c.put('/api/whatsapp/connect', { phone_number_id: '1234567890', access_token: TOKEN })
    await c.patch('/api/whatsapp/settings', { case_update: { enabled: true, template: 'case_update_notice' } })
    await c.patch(`/api/clients/${clientId}`, { whatsapp_opt_in: true })
    expect((await publish(c, caseId, 'Update')).data.whatsapp).toBe('no_phone')

    // Without portal access the notice would link nowhere, so it is not offered.
    const { data: { client: other } } = await c.post('/api/clients', { name: 'Walk-in', phone: '9123 4567', whatsapp_opt_in: true })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Advice', jurisdiction: 'oman', client_id: other.id })
    expect((await c.get(`/api/client-updates/case/${k.id}`)).data.whatsapp).toBeNull()
    expect((await publish(c, k.id, 'Update')).data.whatsapp).toBeNull()
  })
})
