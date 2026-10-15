import { beforeAll, describe, expect, it } from 'vitest'
import { addMonths, noticeBy, renderNoticeDocx, rentSchedule } from '../src/services/leases'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const gulfDay = (days: number) => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })) + days * 86_400_000).toISOString().slice(0, 10)

describe('leases', () => {
  it('builds the rent schedule and the notice date', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    const monthly = rentSchedule('2026-01-01', '2026-12-31', 12000, 'monthly')
    expect(monthly).toHaveLength(12)
    expect(monthly[0]).toEqual({ due_on: '2026-01-01', amount: 1000 })
    expect(monthly.at(-1)).toEqual({ due_on: '2026-12-01', amount: 1000 })
    expect(rentSchedule('2026-01-01', '2026-12-31', 12000, 'quarterly').map((s) => s.due_on)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
    // A 14-month term paid half-yearly: the last instalment covers two months only.
    expect(rentSchedule('2026-01-01', '2027-02-28', 12000, 'semiannual')).toEqual([
      { due_on: '2026-01-01', amount: 6000 }, { due_on: '2026-07-01', amount: 6000 }, { due_on: '2027-01-01', amount: 2000 }
    ])
    expect(noticeBy('2026-12-31', 90)).toBe('2026-10-02')
    expect(noticeBy('2026-12-31', 0)).toBeNull()
  })

  it('tracks a lease, its rent, its notice deadline and renewal', async () => {
    const { c: owner } = await registered(ctx.app)
    const cl = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Properties LLC', name_ar: 'شركة النور العقارية' })).data.client
    const k = (await owner.post('/api/cases', { title: 'Al Khuwair portfolio', jurisdiction: 'oman', client_id: cl.id })).data.case
    const base = { property: 'Shop 4, Al Khuwair Tower', use: 'commercial', counterparty: 'Gulf Coffee LLC', annual_rent: '24000', frequency: 'quarterly', notice_days: '60', case_id: k.id }

    expect((await owner.post(`/api/leases/client/${cl.id}`, { ...base, starts_on: gulfDay(10), ends_on: gulfDay(5) })).status).toBe(400)
    // Started 100 days ago, ends in 20 days: notice was due 40 days ago; a full quarter and the short final month are due.
    const res = await owner.post(`/api/leases/client/${cl.id}`, { ...base, starts_on: gulfDay(-100), ends_on: gulfDay(20), registration_no: 'MUN/2026/778', deposit: '2000' })
    expect(res.status).toBe(201)
    const lease = res.data.lease
    expect(lease).toMatchObject({ currency: 'OMR', notice_by: gulfDay(-40), days_to_end: 20, arrears: 8000, collected: 0 })
    const ev = await ctx.db.query(`SELECT title, kind, case_id FROM events WHERE id = ANY($1::uuid[]) ORDER BY starts_at`, [[lease.end_event_id, lease.notice_event_id]])
    expect(ev.map((e: any) => e.title)).toEqual([
      'Last day for lease notice – Shop 4, Al Khuwair Tower (Al Noor Properties LLC)', 'Lease expires – Shop 4, Al Khuwair Tower (Al Noor Properties LLC)'
    ])
    expect(ev.every((e: any) => e.kind === 'deadline' && e.case_id === k.id)).toBe(true)
    expect((await owner.get('/api/dashboard')).data.counts.leases_notice).toBe(1)

    // Rent comes in; the schedule cannot then be rewritten.
    const list = await owner.get(`/api/leases/client/${cl.id}`)
    const first = list.data.items[0].payments[0]
    expect(list.data.items[0].payments).toHaveLength(2)
    expect((await owner.post(`/api/leases/payments/${first.id}`, { amount: '13000', paid_on: gulfDay(0) })).status).toBe(400)
    const paid = await owner.post(`/api/leases/payments/${first.id}`, { amount: '6000', paid_on: gulfDay(0), method: 'cheque', reference: '000451' })
    expect(paid.data.lease).toMatchObject({ arrears: 2000, collected: 6000 })
    expect((await owner.patch(`/api/leases/${lease.id}`, { annual_rent: '30000' })).status).toBe(409)
    expect((await owner.patch(`/api/leases/${lease.id}`, { notes: 'Tenant asked for a rent holiday' })).status).toBe(200)

    // Notices.
    expect((await owner.get(`/api/leases/${lease.id}/notice?kind=renewal_terms`)).status).toBe(400)
    const notice = await owner.get(`/api/leases/${lease.id}/notice?kind=renewal_terms&new_rent=26400`)
    expect(notice.status).toBe(200)
    expect(notice.res.headers.get('content-type')).toContain('wordprocessingml')

    // The register lists it for attention (notice due and arrears) with arrears by currency.
    const reg = await owner.get('/api/leases/register')
    expect(reg.data.items.map((r: any) => r.id)).toEqual([lease.id])
    expect(reg.data.counts).toMatchObject({ active: 1, notice_soon: 1, in_arrears: 1 })
    expect(reg.data.arrears).toEqual({ OMR: 2000 })
    expect((await owner.get('/api/leases/register?format=csv&show=all')).data).toContain('"Shop 4, Al Khuwair Tower",commercial,Gulf Coffee LLC,MUN/2026/778')

    // Renewal: old lease closed and off the calendar, new one from the next day with its own schedule.
    const renewed = await owner.post(`/api/leases/${lease.id}/renew`, { ends_on: gulfDay(385), annual_rent: '26400' })
    expect(renewed.status).toBe(201)
    expect(renewed.data.lease).toMatchObject({ starts_on: gulfDay(21), ends_on: gulfDay(385), annual_rent: 26400, status: 'active', arrears: 0 })
    const old = await ctx.db.one('SELECT status FROM leases WHERE id = $1', [lease.id])
    expect(old!.status).toBe('renewed')
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [lease.end_event_id]))!.completed_at).not.toBeNull()
    expect((await owner.post(`/api/leases/${lease.id}/renew`, { ends_on: gulfDay(400) })).status).toBe(409)
    expect((await owner.get('/api/dashboard')).data.counts.leases_notice).toBe(0)
    const log = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'lease' ORDER BY created_at`, [k.id])
    expect(log.map((r: any) => r.body)).toContain(`Lease of Shop 4, Al Khuwair Tower renewed to ${gulfDay(385)} at 26400 OMR a year`)

    // Isolation.
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/leases/client/${cl.id}`)).status).toBe(404)
    expect((await other.c.post(`/api/leases/payments/${first.id}`, { amount: '1', paid_on: gulfDay(0) })).status).toBe(404)
    expect((await other.c.get(`/api/leases/${lease.id}/notice?kind=non_renewal`)).status).toBe(404)
    expect((await client(ctx.app).get('/api/leases/register')).status).toBe(401)
  })

  it('writes the non-renewal notice from the right side', async () => {
    const JSZip = (await import('jszip')).default
    const text = async (role: 'landlord' | 'tenant') => {
      const buf = await renderNoticeDocx({ firmName: 'F', firmNameAr: null, letterhead: null, date: '2026-10-15', kind: 'non_renewal', clientRole: role, client: 'Al Noor',
        clientAr: 'النور', counterparty: 'Gulf Coffee', property: 'Shop 4', endsOn: '2026-12-31', registrationNo: null, newRent: null, currency: 'OMR', terms: null })
      return (await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, ' ')
    }
    const landlord = await text('landlord')
    expect(landlord).toContain('Notice of non-renewal of lease')
    expect(landlord).toContain('You are therefore requested to vacate the property')
    expect(landlord).toContain('إخلاء العين المؤجرة')
    expect(await text('tenant')).toContain('Our client will vacate and hand over the property on 31/12/2026')
  })
})
