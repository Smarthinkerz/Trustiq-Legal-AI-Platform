import { beforeAll, describe, expect, it } from 'vitest'
import { nextYear, ownership, renderRegisterDocx, warnings } from '../src/services/corporate'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const gulfDay = (days: number) => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })) + days * 86_400_000).toISOString().slice(0, 10)

describe('company secretarial', () => {
  it('rolls dates forward a year, keeping 29 February valid', () => {
    expect(nextYear('2026-03-31')).toBe('2027-03-31')
    expect(nextYear('2028-02-29')).toBe('2029-02-28')
  })

  it('works out ownership and what is missing', () => {
    const p = (o: any) => ({ id: crypto.randomUUID(), name_ar: null, is_entity: false, nationality: null, id_number: null, shares: null, position: null, signing_authority: null, appointed_on: null, ceased_on: null, ...o })
    const people = [p({ name: 'A', role: 'shareholder', shares: 700 }), p({ name: 'B', role: 'shareholder', shares: 300 }), p({ name: 'C', role: 'shareholder', shares: 50, ceased_on: '2020-01-01' })]
    const own = ownership(people, 1000, '2026-10-15')
    expect(own.holders.map((h) => h.percent)).toEqual([70, 30])
    expect(warnings(people, 1000, '2026-10-15')).toEqual(['no_management', 'no_signatory'])
    expect(warnings(people, 1200, '2026-10-15')).toContain('shares_mismatch')
    expect(warnings([], null, '2026-10-15')).toContain('no_shareholders')
  })

  it('keeps a company record, its people and its yearly filings on the calendar', async () => {
    const { c: owner } = await registered(ctx.app)
    const co = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Trading LLC', name_ar: 'شركة النور للتجارة' })).data.client
    await owner.post('/api/credentials', { client_id: co.id, kind: 'commercial_registration', number: '1234567', expires_on: gulfDay(40) })

    const empty = await owner.get(`/api/corporate/client/${co.id}`)
    expect(empty.status).toBe(200)
    expect(empty.data.profile).toBeNull()
    expect(empty.data.suggestion).toMatchObject({ kind: 'cr_renewal', due_on: gulfDay(40), number: '1234567' })

    const saved = await owner.put(`/api/corporate/client/${co.id}`, { legal_form: 'llc', cr_number: '1234567', capital: '150000', currency: 'OMR', total_shares: '1000', fiscal_year_end: 12, registered_address: 'Muscat' })
    expect(saved.data.profile).toMatchObject({ legal_form: 'llc', capital: 150000, total_shares: 1000 })
    // Empty numbers stay empty rather than becoming zero.
    expect((await owner.put(`/api/corporate/client/${co.id}`, { legal_form: 'llc', cr_number: '1234567', capital: '', total_shares: '1000' })).data.profile).toMatchObject({ capital: null, currency: null })

    const a = (await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Salim Al Harthy', role: 'shareholder', shares: '600', nationality: 'Omani', appointed_on: '2020-01-01' })).data.person
    await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Gulf Holding SAOC', role: 'shareholder', is_entity: true, shares: '400' })
    const m = await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Omar', role: 'manager', shares: '10', signing_authority: 'Up to OMR 50,000 alone' })
    expect(m.data.person.shares).toBeNull()
    expect((await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Late', role: 'director', appointed_on: '2024-05-01', ceased_on: '2024-01-01' })).status).toBe(400)

    const full = await owner.get(`/api/corporate/client/${co.id}`)
    expect(full.data.ownership.holders.map((h: any) => [h.name, h.percent])).toEqual([['Salim Al Harthy', 60], ['Gulf Holding SAOC', 40]])
    expect(full.data.warnings).toEqual([])

    // A transfer: the first shareholder leaves, so the shares no longer add up.
    await owner.patch(`/api/corporate/people/${a.id}`, { ceased_on: gulfDay(-1) })
    expect((await owner.get(`/api/corporate/client/${co.id}`)).data.warnings).toEqual(['shares_mismatch'])

    // Filings: the renewal goes on the calendar and rolls forward a year when done.
    const ob = (await owner.post(`/api/corporate/client/${co.id}/obligations`, { kind: 'cr_renewal', due_on: gulfDay(-2) })).data.obligation
    expect(ob).toMatchObject({ title: 'Commercial registration renewal', days_left: -2, recurs_yearly: true })
    const ev = await ctx.db.one('SELECT title, kind, case_id, completed_at FROM events WHERE id = $1', [ob.event_id])
    expect(ev).toMatchObject({ title: 'Commercial registration renewal – Al Noor Trading LLC', kind: 'deadline', case_id: null, completed_at: null })
    expect((await owner.get(`/api/corporate/client/${co.id}`)).data.suggestion).toBeNull()
    expect((await owner.get('/api/dashboard')).data.counts.corporate_due).toBe(1)

    expect((await owner.post(`/api/corporate/obligations/${ob.id}/done`, { done_on: gulfDay(5) })).status).toBe(400)
    const done = await owner.post(`/api/corporate/obligations/${ob.id}/done`, { done_on: gulfDay(0) })
    expect(done.data.obligation.done_on).toBe(gulfDay(0))
    expect(done.data.next).toMatchObject({ kind: 'cr_renewal', due_on: nextYear(gulfDay(-2)) })
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [ob.event_id]))!.completed_at).not.toBeNull()
    expect((await owner.post(`/api/corporate/obligations/${ob.id}/done`, { done_on: gulfDay(0) })).status).toBe(400)

    const agm = (await owner.post(`/api/corporate/client/${co.id}/obligations`, { kind: 'agm', due_on: gulfDay(10), recurs_yearly: false })).data.obligation
    await owner.patch(`/api/corporate/obligations/${agm.id}`, { due_on: gulfDay(12), title: 'AGM 2026' })
    const agmEvent = await ctx.db.one(`SELECT title, to_char(starts_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') AS d FROM events WHERE id = $1`, [agm.event_id])
    expect(agmEvent).toMatchObject({ title: 'AGM 2026 – Al Noor Trading LLC', d: gulfDay(12) })

    const reg = await owner.get('/api/corporate/register?show=open')
    expect(reg.data.items.map((r: any) => r.title)).toEqual(['AGM 2026', 'Commercial registration renewal'])
    expect(reg.data.counts).toMatchObject({ open: 2, overdue: 0, due_soon: 1, companies: 1 })
    const csv = await owner.get('/api/corporate/register?format=csv&show=all')
    expect(csv.data).toContain('Al Noor Trading LLC,1234567,AGM 2026')

    const docx = await owner.get(`/api/corporate/client/${co.id}/register`)
    expect(docx.status).toBe(200)
    expect(docx.res.headers.get('content-type')).toContain('wordprocessingml')

    await owner.del(`/api/corporate/obligations/${agm.id}`)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [agm.event_id])).toBeFalsy()

    // Other firms cannot read or change the record; clients have no access.
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/corporate/client/${co.id}`)).status).toBe(404)
    expect((await other.c.patch(`/api/corporate/people/${a.id}`, { name: 'Someone else' })).status).toBe(404)
    expect((await client(ctx.app).get(`/api/corporate/client/${co.id}`)).status).toBe(401)
  })

  it('prints a bilingual register', async () => {
    const buf = await renderRegisterDocx({
      firmName: 'Firm', letterhead: null, date: '2026-10-15', today: '2026-10-15', company: { name: 'Co', name_ar: 'شركة' },
      profile: { legal_form: 'llc', cr_number: '1', registered_on: null, capital: 1000, currency: 'OMR', total_shares: 100, registered_address: null },
      people: [{ id: 'p', name: 'A', name_ar: null, role: 'shareholder', is_entity: false, nationality: null, id_number: null, shares: 100, position: null, signing_authority: null, appointed_on: null, ceased_on: null }],
      percents: new Map([['p', 100]])
    })
    const JSZip = (await import('jszip')).default
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')
    expect(xml).toContain('Register of shareholders and officers')
    expect(xml).toContain('سجل الشركاء والمسؤولين')
    expect(xml).toContain('100%')
  })
})
