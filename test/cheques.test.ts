import { beforeAll, describe, expect, it } from 'vitest'
import { outstanding, renderDemandDocx, status } from '../src/services/cheques'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const gulfDay = (days: number) => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })) + days * 86_400_000).toISOString().slice(0, 10)

describe('returned cheques', () => {
  it('works out where a cheque stands', () => {
    const base = { amount: 1000, recovered: 0, written_off: false, presented_on: null, returned_on: null, complaint_on: null }
    expect(status(base)).toBe('held')
    expect(status({ ...base, presented_on: '2026-01-01' })).toBe('presented')
    expect(status({ ...base, returned_on: '2026-01-02' })).toBe('returned')
    expect(status({ ...base, returned_on: '2026-01-02', recovered: 200 })).toBe('part_paid')
    expect(status({ ...base, returned_on: '2026-01-02', complaint_on: '2026-01-05' })).toBe('complaint')
    expect(status({ ...base, recovered: 1000 })).toBe('paid')
    expect(status({ ...base, written_off: true })).toBe('written_off')
    expect(outstanding({ amount: 1000, recovered: 250.5, written_off: false })).toBe(749.5)
    expect(outstanding({ amount: 1000, recovered: 0, written_off: true })).toBe(0)
  })

  it('tracks cheques on a matter, recoveries, the demand letter and the firm register', async () => {
    const { c: owner } = await registered(ctx.app)
    const cl = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Trading LLC', name_ar: 'شركة النور للتجارة' })).data.client
    const k = (await owner.post('/api/cases', { title: 'Recovery from Gulf Builders', jurisdiction: 'oman', client_id: cl.id })).data.case
    const orig = (await owner.post('/api/originals', { client_id: cl.id, case_id: k.id, received_on: gulfDay(-20), items: [{ kind: 'cheque', description: 'Cheque 000123' }] })).data.items[0]

    const base = { drawer: 'Gulf Builders LLC', bank: 'Bank Muscat', amount: '5000', cheque_date: gulfDay(-30) }
    expect((await owner.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '1', presented_on: gulfDay(-5), returned_on: gulfDay(-6) })).status).toBe(400)
    expect((await owner.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '1', complaint_on: gulfDay(-1) })).status).toBe(400)
    const c1 = (await owner.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '000123', returned_on: gulfDay(-10), return_reason: 'insufficient_funds', original_id: orig.id })).data.cheque
    expect(c1).toMatchObject({ status: 'returned', outstanding: 5000, currency: 'OMR', presented_on: gulfDay(-10), original_id: orig.id })
    const c2 = (await owner.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '000124', amount: '2500.5', returned_on: gulfDay(-2), return_reason: 'account_closed' })).data.cheque
    await owner.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '000125', cheque_date: gulfDay(30) })

    // One cheque returned 10 days ago with nothing done: the dashboard says so.
    expect((await owner.get('/api/dashboard')).data.counts.cheques_unactioned).toBe(1)

    // Part payment, then a complaint on the other.
    expect((await owner.post(`/api/cheques/${c1.id}/recovered`, { amount: '6000', on: gulfDay(0) })).status).toBe(400)
    const part = await owner.post(`/api/cheques/${c1.id}/recovered`, { amount: '2000', on: gulfDay(0) })
    expect(part.data.cheque).toMatchObject({ status: 'part_paid', recovered: 2000, outstanding: 3000 })
    expect((await owner.get('/api/dashboard')).data.counts.cheques_unactioned).toBe(0)
    const filed = await owner.patch(`/api/cheques/${c2.id}`, { complaint_on: gulfDay(0), complaint_ref: 'ROP/2026/551' })
    expect(filed.data.cheque.status).toBe('complaint')
    expect((await owner.patch(`/api/cheques/${c1.id}`, { amount: '1000' })).status).toBe(400)

    const list = await owner.get(`/api/cheques/case/${k.id}`)
    expect(list.data.items.map((r: any) => r.cheque_no)).toEqual(['000123', '000124', '000125'])
    expect(list.data.totals.OMR).toEqual({ amount: 12500.5, recovered: 2000, outstanding: 10500.5 })

    const log = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'cheque' ORDER BY created_at`, [k.id])
    expect(log.map((r: any) => r.body)).toContain('Recovered 2000 OMR on cheque no. 000123, 3000 OMR still owed')
    expect(log.map((r: any) => r.body)).toContain('Cheque no. 000124: returned → complaint')

    // Demand letter: only the drawer's unpaid returned cheques.
    const demand = await owner.get(`/api/cheques/case/${k.id}/demand?drawer=${encodeURIComponent('Gulf Builders LLC')}&days=10`)
    expect(demand.status).toBe(200)
    expect(demand.res.headers.get('content-type')).toContain('wordprocessingml')
    expect((await owner.get(`/api/cheques/case/${k.id}/demand?drawer=Nobody`)).status).toBe(400)

    // Paying the rest closes it; the register keeps only what is owed.
    await owner.post(`/api/cheques/${c1.id}/recovered`, { amount: '3000', on: gulfDay(0) })
    const reg = await owner.get('/api/cheques/register')
    expect(reg.data.items.map((r: any) => r.cheque_no).sort()).toEqual(['000124', '000125'])
    expect(reg.data.outstanding).toEqual({ OMR: 7500.5 })
    expect((await owner.get('/api/cheques/register?show=all')).data.items).toHaveLength(3)
    const csv = await owner.get('/api/cheques/register?format=csv&show=all')
    expect(csv.data).toContain('Gulf Builders LLC,Bank Muscat,000123')

    // Isolation.
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/cheques/case/${k.id}`)).status).toBe(404)
    expect((await other.c.patch(`/api/cheques/${c2.id}`, { written_off: true })).status).toBe(404)
    expect((await other.c.post(`/api/cheques/case/${k.id}`, { ...base, cheque_no: '9' })).status).toBe(404)
    // Another firm's original cannot be linked.
    const otherCase = (await other.c.post('/api/cases', { title: 'Other firm matter', jurisdiction: 'oman' })).data.case
    expect((await other.c.post(`/api/cheques/case/${otherCase.id}`, { ...base, cheque_no: '9', original_id: orig.id })).status).toBe(400)
    expect((await client(ctx.app).get('/api/cheques/register')).status).toBe(401)
  })

  it('prints a bilingual demand letter with the unpaid total', async () => {
    const buf = await renderDemandDocx({
      firmName: 'Firm', firmNameAr: null, letterhead: null, date: '2026-10-15', days: 7, drawer: 'Gulf Builders LLC', client: 'Al Noor', clientAr: 'النور', reference: '2026-0001',
      cheques: [{ cheque_no: '000123', bank: 'Bank Muscat', cheque_date: '2026-09-15', returned_on: '2026-10-01', return_reason: 'insufficient_funds', amount: 5000, recovered: 2000, currency: 'OMR' }]
    })
    const JSZip = (await import('jszip')).default
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')
    expect(xml).toContain('Demand for payment of returned cheques')
    expect(xml).toContain('إنذار بسداد قيمة شيكات مرتجعة')
    expect(xml).toContain('The total unpaid is 3,000.000 OMR.')
    expect(xml).toContain('عدم كفاية الرصيد')
  })
})
