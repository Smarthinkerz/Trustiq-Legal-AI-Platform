import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const muscatDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })

describe('judgments and enforcement', () => {
  it('records a judgment, puts the appeal deadline on the calendar, tracks collections and the register', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Unpaid invoices', jurisdiction: 'oman', client_id: client.id, court: 'Primary Court, Muscat', opposing_party: 'Debtor LLC' })

    const judgmentDate = muscatDay(-10)
    const made = await c.post(`/api/judgments/case/${k.id}`, {
      judgment_date: judgmentDate, result: 'won', judgment_no: '512/2026', amount_awarded: 12000, costs_awarded: '500', appeal_days: 30, summary: 'Debtor ordered to pay.'
    })
    expect(made.status).toBe(201)
    const j = made.data.judgment
    expect(j).toMatchObject({ currency: 'OMR', court: 'Primary Court, Muscat', amount_awarded: 12000, costs_awarded: 500, collected: 0, outstanding: 12500, appeal_days_left: 20 })
    expect(j.appeal_deadline).toBe(muscatDay(20))

    // The deadline is an all-day calendar item on the case.
    const ev = await ctx.db.one('SELECT title, kind, all_day, completed_at FROM events WHERE id = $1', [j.appeal_event_id])
    expect(ev).toMatchObject({ title: `Appeal deadline – ${k.reference}`, kind: 'deadline', all_day: true, completed_at: null })

    // Deciding not to appeal clears it from the to-do list; moving the date updates it.
    await c.patch(`/api/judgments/${j.id}`, { appeal_decision: 'no_appeal' })
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [j.appeal_event_id]))!.completed_at).not.toBeNull()
    await c.patch(`/api/judgments/${j.id}`, { appeal_decision: 'pending', appeal_deadline: muscatDay(5) })
    const moved = await ctx.db.one(`SELECT completed_at, to_char(starts_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') AS d FROM events WHERE id = $1`, [j.appeal_event_id])
    expect(moved).toMatchObject({ completed_at: null, d: muscatDay(5) })
    expect((await c.patch(`/api/judgments/${j.id}`, { appeal_deadline: muscatDay(-30) })).status).toBe(400)

    // Collections: partial, then full payment closes the enforcement.
    await c.patch(`/api/judgments/${j.id}`, { enforcement_status: 'filed', enforcement_file_no: 'EX-77/2026', enforcement_court: 'Execution Department, Muscat' })
    const first = await c.post(`/api/judgments/${j.id}/collections`, { collected_on: muscatDay(-2), amount: 5000, source: 'Bank attachment' })
    expect(first.data.judgment).toMatchObject({ collected: 5000, outstanding: 7500, enforcement_status: 'filed' })
    let reg = (await c.get('/api/judgments/register')).data
    expect(reg.items.map((x: any) => x.id)).toContain(j.id)
    expect(reg.totals.OMR).toEqual({ awarded: 12500, collected: 5000, outstanding: 7500 })
    expect(reg.appeals_due).toBe(1)
    const second = await c.post(`/api/judgments/${j.id}/collections`, { collected_on: muscatDay(-1), amount: 7500 })
    expect(second.data.judgment).toMatchObject({ outstanding: 0, enforcement_status: 'collected' })

    const list = (await c.get(`/api/judgments/case/${k.id}`)).data.items
    expect(list[0].collections.map((x: any) => x.amount)).toEqual([5000, 7500])
    const undone = await c.del(`/api/judgments/collections/${list[0].collections[1].id}`)
    expect(undone.data.judgment.outstanding).toBe(7500)

    // A lost judgment: nothing to collect.
    const lost = await c.post(`/api/judgments/case/${k.id}`, { judgment_date: judgmentDate, result: 'lost', degree: 'appeal' })
    expect(lost.data.judgment.outstanding).toBe(0)
    expect((await c.post(`/api/judgments/${lost.data.judgment.id}/collections`, { collected_on: judgmentDate, amount: 10 })).status).toBe(400)

    const csv = await c.get('/api/judgments/register?show=all&format=csv')
    expect(String(csv.data)).toContain('512/2026')
    reg = (await c.get('/api/judgments/register?show=all')).data
    expect(reg.total).toBe(2)

    // Deleting the judgment removes its open appeal deadline.
    await c.del(`/api/judgments/${j.id}`)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [j.appeal_event_id])).toBeFalsy()

    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/judgments/case/${k.id}`)).status).toBe(404)
    expect((await other.c.patch(`/api/judgments/${lost.data.judgment.id}`, { result: 'won' })).status).toBe(404)
    expect((await other.c.get('/api/judgments/register?show=all')).data.total).toBe(0)
  })
})
