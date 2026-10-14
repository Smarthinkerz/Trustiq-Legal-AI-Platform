import { beforeAll, describe, expect, it } from 'vitest'
import { outsideAuthority, standing } from '../src/services/settlement'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const muscatToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

describe('settlement rules', () => {
  it('checks offers against the client instructions and measures the gap', () => {
    const receive = { position: 'receive' as const, amount: 80000, currency: 'AED' }
    expect(outsideAuthority(receive, { amount: 75000, currency: 'AED' })).toBe(true)
    expect(outsideAuthority(receive, { amount: 85000, currency: 'AED' })).toBe(false)
    expect(outsideAuthority(receive, { amount: 75000, currency: 'OMR' })).toBe(false)
    const pay = { position: 'pay' as const, amount: 20000, currency: 'OMR' }
    expect(outsideAuthority(pay, { amount: 25000, currency: 'OMR' })).toBe(true)
    expect(outsideAuthority(null, { amount: 1, currency: 'OMR' })).toBe(false)

    const s = standing([
      { direction: 'ours', amount: 120000, currency: 'AED', status: 'countered', made_on: '2026-09-01' },
      { direction: 'theirs', amount: 60000, currency: 'AED', status: 'countered', made_on: '2026-09-10' },
      { direction: 'ours', amount: 100000, currency: 'AED', status: 'open', made_on: '2026-09-20' },
      { direction: 'theirs', amount: 85000, currency: 'AED', status: 'open', made_on: '2026-09-25' }
    ], 'receive')
    expect(s).toMatchObject({ ours: { amount: 100000 }, theirs: { amount: 85000 }, gap: 15000, crossed: false, settled: false })
  })
})

describe('settlement negotiations', () => {
  it('records offers both ways, keeps expiries on the calendar and guards acceptance outside instructions', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client: cl } } = await c.post('/api/clients', { name: 'Gulf Trading LLC' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Unpaid invoices', jurisdiction: 'uae', currency: 'AED', client_id: cl.id })
    const today = muscatToday()

    const auth = await c.put(`/api/settlement/case/${k.id}/authority`, { position: 'receive', amount: 80000, given_on: today, note: 'Email from the CEO' })
    expect(auth.data.authority).toMatchObject({ position: 'receive', amount: 80000, currency: 'AED' })

    const ours = await c.post(`/api/settlement/case/${k.id}`, { direction: 'ours', amount: 100000, made_on: plus(today, -10), expires_on: plus(today, -3), status: 'countered' })
    expect(ours.data.offer).toMatchObject({ currency: 'AED', outside_authority: false, without_prejudice: true, responded_on: null })
    const low = await c.post(`/api/settlement/case/${k.id}`, { direction: 'theirs', amount: 70000, made_on: plus(today, -2), expires_on: plus(today, 2), terms: 'Payment in 3 instalments' })
    expect(low.data.offer).toMatchObject({ status: 'open', outside_authority: true, days_left: 2 })
    const ev = await ctx.db.one('SELECT title, completed_at FROM events WHERE id = $1', [low.data.offer.event_id])
    expect(ev).toMatchObject({ title: `Settlement offer expires – ${k.reference}`, completed_at: null })
    expect((await c.get('/api/dashboard')).data.counts.offers_expiring).toBe(1)

    const view = await c.get(`/api/settlement/case/${k.id}`)
    expect(view.data.offers).toHaveLength(2)
    expect(view.data.standing).toMatchObject({ ours: { amount: 100000 }, theirs: { amount: 70000 }, gap: 30000, crossed: false })

    // Accepting below the client's minimum needs a confirmation; then the expiry is done.
    const blocked = await c.patch(`/api/settlement/${low.data.offer.id}`, { status: 'accepted' })
    expect(blocked.status).toBe(409)
    expect(blocked.data.error.code).toBe('outside_authority')
    const accepted = await c.patch(`/api/settlement/${low.data.offer.id}`, { status: 'accepted', confirm_outside_authority: true })
    expect(accepted.data.offer).toMatchObject({ status: 'accepted', responded_on: today })
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [low.data.offer.event_id]))!.completed_at).not.toBeNull()
    expect((await c.get(`/api/settlement/case/${k.id}`)).data.standing.settled).toBe(true)
    expect((await c.get('/api/dashboard')).data.counts.offers_expiring).toBe(0)
    const [a] = await ctx.db.query(`SELECT meta FROM audit_log WHERE action = 'settlement.offer_accepted' AND entity_id = $1`, [k.id])
    expect(a.meta).toMatchObject({ outside_authority: true })

    // Changing the instructions re-checks the offers.
    await c.put(`/api/settlement/case/${k.id}/authority`, { position: 'receive', amount: 60000 })
    expect((await c.get(`/api/settlement/case/${k.id}`)).data.offers.find((o: any) => o.id === low.data.offer.id).outside_authority).toBe(false)

    const reg = await c.get('/api/settlement/register?show=all')
    expect(reg.data.items).toHaveLength(2)
    expect((await c.get('/api/settlement/register')).data.counts).toEqual({ open: 0, expiring: 0, lapsed: 0 })
    expect((await c.get('/api/settlement/register?format=csv')).res.headers.get('content-type')).toContain('text/csv')
    expect((await c.post(`/api/settlement/case/${k.id}`, { direction: 'ours', amount: 1, made_on: today, expires_on: plus(today, -1) })).status).toBe(400)
    expect((await c.del(`/api/settlement/${ours.data.offer.id}`)).status).toBe(200)
  })

  it('keeps the client instructions away from other firms and the client portal', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client: cl } } = await c.post('/api/clients', { name: 'Portal Client' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Claim', jurisdiction: 'oman', client_id: cl.id })
    await c.put(`/api/settlement/case/${k.id}/authority`, { position: 'pay', amount: 5000 })
    const inv = await c.post(`/api/clients/${cl.id}/portal-invite`, { email: `st-${crypto.randomUUID().slice(0, 6)}@example.test` })
    const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
    const portal = client(ctx.app)
    await portal.post('/api/auth/accept-invite', { token, name: 'Client', password: 'Str0ngPassw0rd' })
    expect((await portal.get(`/api/settlement/case/${k.id}`)).status).toBe(403)
    expect(JSON.stringify((await portal.get(`/api/portal/cases/${k.id}`)).data)).not.toContain('5000')
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/settlement/case/${k.id}`)).status).toBe(404)
  })
})
