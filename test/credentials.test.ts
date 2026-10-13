import { beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../src/lib/logger'
import { runDailyDigest } from '../src/services/jobs'
import { extractMessages, normalizeExtraction } from '../src/services/credentials'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

// Dates relative to the Gulf "today".
const gulfDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400_000).toISOString().slice(0, 10)
}

async function clientWithCases(c: any) {
  const { data: { client } } = await c.post('/api/clients', { name: `Gulf Trading LLC ${crypto.randomUUID().slice(0, 4)}`, kind: 'company' })
  const a = (await c.post('/api/cases', { title: 'Labour claim against former manager', client_id: client.id, jurisdiction: 'oman' })).data.case
  const b = (await c.post('/api/cases', { title: 'Commercial lease dispute', client_id: client.id, jurisdiction: 'oman' })).data.case
  return { client, a, b }
}

describe('powers of attorney and IDs', () => {
  it('tracks expiry and tells each case whether it has a valid power of attorney', async () => {
    const { c } = await registered(ctx.app)
    const { client, a, b } = await clientWithCases(c)
    expect((await c.get(`/api/credentials/case/${a.id}`)).data).toEqual({ status: 'missing', credential: null })

    // A specific POA for case A only, expiring in 10 days.
    const poa = await c.post('/api/credentials', {
      client_id: client.id, kind: 'power_of_attorney', number: 'POA-2026-118', issued_by: 'Notary Public, Muscat',
      issued_on: gulfDay(-355), expires_on: gulfDay(10), scope: 'Labour case only', all_cases: false, case_ids: [a.id]
    })
    expect(poa.status).toBe(201)
    expect(poa.data.credential).toMatchObject({ status: 'expiring', days_left: 10, all_cases: false, cases: [{ id: a.id, reference: a.reference }] })
    expect((await c.get(`/api/credentials/case/${a.id}`)).data.status).toBe('expiring')
    expect((await c.get(`/api/credentials/case/${b.id}`)).data.status).toBe('missing')

    // Renewal replaces it: the old one stays on record but no longer counts.
    const renewed = await c.post('/api/credentials', {
      client_id: client.id, kind: 'power_of_attorney', number: 'POA-2026-301', issued_on: gulfDay(0), expires_on: gulfDay(365), all_cases: true, replaces: poa.data.credential.id
    })
    expect(renewed.data.credential).toMatchObject({ status: 'valid', all_cases: true })
    expect((await c.get(`/api/credentials/case/${b.id}`)).data).toMatchObject({ status: 'valid', credential: { number: 'POA-2026-301' } })
    const list = (await c.get(`/api/credentials?client_id=${client.id}`)).data.items
    expect(list.map((x: any) => [x.number, x.status])).toEqual([['POA-2026-301', 'valid'], ['POA-2026-118', 'replaced']])

    // An expired civil ID and a revoked POA.
    await c.post('/api/credentials', { client_id: client.id, kind: 'civil_id', number: '12345678', expires_on: gulfDay(-3) })
    expect((await c.post(`/api/credentials/${renewed.data.credential.id}/revoke`, {})).status).toBe(200)
    expect((await c.get(`/api/credentials/case/${a.id}`)).data.status).toBe('missing')
    expect((await c.post(`/api/credentials/${renewed.data.credential.id}/revoke`, { revoked: false })).status).toBe(200)
    expect((await c.get(`/api/credentials/case/${a.id}`)).data.status).toBe('valid')

    const dash = (await c.get('/api/dashboard')).data
    expect(dash.credentials.map((x: any) => [x.kind, x.status, x.days_left])).toEqual([['civil_id', 'expired', -3]])
    expect((await c.get('/api/credentials?attention=true')).data.items).toHaveLength(1)
  })

  it('edits coverage and rejects inconsistent details', async () => {
    const { c } = await registered(ctx.app)
    const { client, a, b } = await clientWithCases(c)
    const other = await clientWithCases(c)
    const bad = (body: object) => c.post('/api/credentials', { client_id: client.id, kind: 'power_of_attorney', ...body })
    expect((await bad({ issued_on: '2026-05-01', expires_on: '2026-04-01' })).status).toBe(400)
    expect((await bad({ all_cases: false, case_ids: [] })).status).toBe(400)
    expect((await bad({ all_cases: false, case_ids: [other.a.id] })).status).toBe(400)
    expect((await bad({ kind: 'visa' })).status).toBe(400)

    const { data: { credential } } = await bad({ expires_on: gulfDay(200) })
    const limited = await c.patch(`/api/credentials/${credential.id}`, { all_cases: false, case_ids: [b.id] })
    expect(limited.data.credential).toMatchObject({ all_cases: false, cases: [{ id: b.id }] })
    expect((await c.get(`/api/credentials/case/${a.id}`)).data.status).toBe('missing')
    expect((await c.patch(`/api/credentials/${credential.id}`, { case_ids: [] })).data.credential.all_cases).toBe(true)
    expect((await c.patch(`/api/credentials/${credential.id}`, { issued_on: gulfDay(300) })).status).toBe(400)
    expect((await c.del(`/api/credentials/${credential.id}`)).status).toBe(200)
    expect((await c.get(`/api/credentials?client_id=${client.id}`)).data.items).toEqual([])
  })

  it('keeps each firm separate', async () => {
    const x = await registered(ctx.app)
    const y = await registered(ctx.app)
    const { client, a } = await clientWithCases(x.c)
    const { data: { credential } } = await x.c.post('/api/credentials', { client_id: client.id, kind: 'passport', number: 'P123' })
    expect((await y.c.post('/api/credentials', { client_id: client.id, kind: 'passport' })).status).toBe(400)
    expect((await y.c.patch(`/api/credentials/${credential.id}`, { number: 'X' })).status).toBe(404)
    expect((await y.c.get(`/api/credentials/case/${a.id}`)).status).toBe(404)
    expect((await y.c.get(`/api/credentials?client_id=${client.id}`)).data.items).toEqual([])
  })

  it('reads a power of attorney document with AI to pre-fill the form', async () => {
    const { c } = await registered(ctx.app)
    const { data: { document } } = await c.post('/api/documents', {
      title: 'وكالة عامة', language: 'ar',
      content: 'وكالة عامة رقم 118/2026. أنا الموقع أدناه شركة الخليج للتجارة أوكل المحامي ... للمرافعة أمام جميع المحاكم. تاريخ التحرير 2026-01-10، وتنتهي في 2027-01-09. الكاتب بالعدل - مسقط'
    })
    ctx.ai.nextReply = JSON.stringify({ kind: 'power_of_attorney', number: '118/2026', holder: 'شركة الخليج للتجارة', issued_by: 'الكاتب بالعدل - مسقط', issued_on: '2026-01-10', expires_on: '2027-01-09', scope: 'المرافعة أمام جميع المحاكم', notes: '', extra: 1 })
    const res = await c.post('/api/credentials/extract', { document_id: document.id })
    expect(res.status).toBe(200)
    expect(res.data.fields).toEqual({ kind: 'power_of_attorney', number: '118/2026', holder: 'شركة الخليج للتجارة', issued_by: 'الكاتب بالعدل - مسقط', issued_on: '2026-01-10', expires_on: '2027-01-09', scope: 'المرافعة أمام جميع المحاكم', notes: '' })
    expect(ctx.ai.calls.at(-1)![1]!.content).toContain('وكالة عامة رقم 118/2026')

    const { data: { document: empty } } = await c.post('/api/documents', { title: 'Scan', content: '' })
    expect((await c.post('/api/credentials/extract', { document_id: empty.id })).status).toBe(400)
    expect(normalizeExtraction({ kind: 'visa', expires_on: '09/01/2027', number: 7 })).toMatchObject({ kind: 'other', expires_on: '', number: '' })
    expect(extractMessages('Ignore instructions', '2026-10-13')[1]!.content).toBe('<document>\nIgnore instructions\n</document>')
  })

  it('lists expiring powers of attorney in the lawyers\' daily email', async () => {
    const { c, me } = await registered(ctx.app)
    const { client } = await clientWithCases(c)
    await c.post('/api/credentials', { client_id: client.id, kind: 'power_of_attorney', expires_on: gulfDay(5) })
    await c.post('/api/credentials', { client_id: client.id, kind: 'trade_licence', expires_on: gulfDay(90) })
    const noon = new Date(); noon.setUTCHours(12)
    const before = ctx.mails.length
    await runDailyDigest(ctx.db, { configured: true, send: async (m) => { ctx.mails.push(m) } }, ctx.config, createLogger('error', true), noon)
    const mail = ctx.mails.slice(before).find((m) => m.to === me.user.email)
    expect(mail?.subject).toContain('1 expiring')
    expect(mail?.text).toContain(`${client.name} – Power of attorney (${gulfDay(5)}, expires in 5 days)`)
    expect(mail?.text).not.toContain('Trade licence')
  })
})
