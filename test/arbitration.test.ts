import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeTimetable, stage } from '../src/services/arbitration'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const gulfDay = (days: number) => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })) + days * 86_400_000).toISOString().slice(0, 10)

describe('arbitration', () => {
  it('works out the stage and cleans an AI timetable', () => {
    const open = { constituted_on: null, award_on: null, award_result: null }
    expect(stage(open, [])).toBe('commenced')
    expect(stage(open, [{ role: 'co_arbitrator' }])).toBe('commenced')
    expect(stage(open, [{ role: 'chair' }])).toBe('constituted')
    expect(stage({ ...open, award_on: '2026-01-01', award_result: 'won' }, [])).toBe('awarded')
    expect(stage({ ...open, award_result: 'settled' }, [])).toBe('ended')
    const t = normalizeTimetable({
      steps: [
        { kind: 'hearing', title: 'Evidentiary hearing', party: 'both', due_on: '2027-03-10' },
        { kind: 'submission', title: 'Statement of Defence', party: 'us', due_on: '2027-01-15' },
        { kind: 'nonsense', title: 'Odd', party: 'someone', due_on: '2027-02-01' },
        { kind: 'submission', title: 'No date', party: 'us', due_on: 'within 14 days' },
        { kind: 'award', title: '', party: 'tribunal', due_on: '2027-05-01' }
      ],
      skipped: ['Post-hearing briefs: 30 days after the hearing']
    })
    expect(t.steps.map((s: any) => [s.title, s.kind, s.party])).toEqual([
      ['Statement of Defence', 'submission', 'us'], ['Odd', 'other', 'both'], ['Evidentiary hearing', 'hearing', 'both']
    ])
    expect(t.skipped).toEqual(['Post-hearing briefs: 30 days after the hearing'])
  })

  it('tracks an arbitration, its tribunal and the procedural timetable on the calendar', async () => {
    const { c: owner } = await registered(ctx.app)
    const k = (await owner.post('/api/cases', { title: 'Construction dispute', jurisdiction: 'oman', practice_area: 'arbitration' })).data.case

    expect((await owner.get(`/api/arbitration/case/${k.id}`)).data.arbitration).toBeNull()
    // Steps need the arbitration first.
    expect((await owner.post(`/api/arbitration/case/${k.id}/steps`, { steps: [{ title: 'Reply', due_on: gulfDay(5) }] })).status).toBe(400)
    expect((await owner.put(`/api/arbitration/case/${k.id}`, { institution: 'ocac', commenced_on: '2026-05-01', constituted_on: '2026-04-01' })).status).toBe(400)

    const created = await owner.put(`/api/arbitration/case/${k.id}`, {
      institution: 'ocac', institution_ref: 'OCAC/2026/014', seat: 'Muscat', language: 'Arabic', our_side: 'respondent',
      amount_claimed: '1250000', counterclaim: '', commenced_on: '2026-05-01'
    })
    expect(created.status).toBe(201)
    expect(created.data.arbitration).toMatchObject({ institution: 'ocac', our_side: 'respondent', amount_claimed: 1250000, counterclaim: null, currency: 'OMR' })

    await owner.post(`/api/arbitration/case/${k.id}/members`, { name: 'Dr. Hamad Al Rawahi', role: 'co_arbitrator', nominated_by: 'us' })
    expect((await owner.get(`/api/arbitration/case/${k.id}`)).data.arbitration.stage).toBe('commenced')
    const chair = (await owner.post(`/api/arbitration/case/${k.id}/members`, { name: 'Prof. Laila Haddad', role: 'chair', nominated_by: 'co_arbitrators' })).data.member
    expect((await owner.get(`/api/arbitration/case/${k.id}`)).data.arbitration.stage).toBe('constituted')

    // AI reads the procedural order; nothing is saved until the lawyer confirms.
    ctx.ai.nextReply = JSON.stringify({
      steps: [
        { kind: 'submission', title: 'Statement of Defence and Counterclaim', party: 'us', due_on: gulfDay(3), notes: '' },
        { kind: 'deposit', title: 'Advance on costs', party: 'both', due_on: gulfDay(-1), notes: '' },
        { kind: 'hearing', title: 'Evidentiary hearing', party: 'both', due_on: gulfDay(60), notes: '' },
        { kind: 'submission', title: 'Reply', party: 'them', due_on: gulfDay(20), notes: '' }
      ],
      skipped: ['Post-hearing briefs']
    })
    expect((await owner.post(`/api/arbitration/case/${k.id}/timetable/read`, { text: 'short' })).status).toBe(400)
    const read = await owner.post(`/api/arbitration/case/${k.id}/timetable/read`, { text: 'Procedural Order No. 1. The Respondent shall file its Statement of Defence ...' })
    expect(read.status).toBe(200)
    expect(read.data.steps.map((s: any) => s.title)).toEqual(['Advance on costs', 'Statement of Defence and Counterclaim', 'Reply', 'Evidentiary hearing'])
    expect(ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')).toContain('Our client is the respondent')
    expect((await owner.get(`/api/arbitration/case/${k.id}`)).data.steps).toHaveLength(0)

    const saved = await owner.post(`/api/arbitration/case/${k.id}/steps`, { steps: read.data.steps, source: 'ai' })
    expect(saved.status).toBe(201)
    expect(saved.data.steps).toHaveLength(4)
    const hearing = saved.data.steps.find((s: any) => s.kind === 'hearing')
    const ev = await ctx.db.one('SELECT kind, title, case_id FROM events WHERE id = $1', [hearing.event_id])
    expect(ev).toMatchObject({ kind: 'hearing', title: `Evidentiary hearing – ${k.reference}`, case_id: k.id })

    const full = await owner.get(`/api/arbitration/case/${k.id}`)
    expect(full.data.next_step.title).toBe('Advance on costs')
    expect((await owner.get('/api/dashboard')).data.counts.arbitration_due).toBe(2)

    // The deposit is paid; the defence deadline is extended.
    const deposit = saved.data.steps.find((s: any) => s.kind === 'deposit')
    await owner.patch(`/api/arbitration/steps/${deposit.id}`, { done_on: gulfDay(0) })
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [deposit.event_id]))!.completed_at).not.toBeNull()
    const defence = saved.data.steps.find((s: any) => s.title.startsWith('Statement'))
    await owner.patch(`/api/arbitration/steps/${defence.id}`, { due_on: gulfDay(30) })
    const moved = await ctx.db.one(`SELECT to_char(starts_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') AS d FROM events WHERE id = $1`, [defence.event_id])
    expect(moved!.d).toBe(gulfDay(30))
    const log = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'arbitration' ORDER BY created_at`, [k.id])
    expect(log.map((r: any) => r.body)).toEqual([
      'Arbitration recorded: Oman Commercial Arbitration Centre (OCAC/2026/014), acting for the respondent',
      'Arbitrator added: Dr. Hamad Al Rawahi (co-arbitrator)',
      'Arbitrator added: Prof. Laila Haddad (chair)',
      'Procedural timetable: 4 steps added to the calendar',
      `Timetable changed: "Statement of Defence and Counterclaim" moved from ${gulfDay(3)} to ${gulfDay(30)}`
    ])
    expect((await owner.get('/api/dashboard')).data.counts.arbitration_due).toBe(0)

    // Register and CSV.
    const reg = await owner.get('/api/arbitration/register')
    expect(reg.data.items).toHaveLength(1)
    expect(reg.data.items[0]).toMatchObject({ stage: 'constituted', tribunal: 'Prof. Laila Haddad, Dr. Hamad Al Rawahi' })
    expect(reg.data.items[0].next_step.title).toBe('Statement of Defence and Counterclaim')
    const csv = await owner.get('/api/arbitration/register?format=csv')
    expect(csv.data).toContain('Oman Commercial Arbitration Centre,OCAC/2026/014,Muscat,respondent')

    // The award ends it; an outcome needs its date.
    expect((await owner.put(`/api/arbitration/case/${k.id}`, { institution: 'ocac', our_side: 'respondent', award_result: 'won' })).status).toBe(400)
    await owner.put(`/api/arbitration/case/${k.id}`, { institution: 'ocac', our_side: 'respondent', commenced_on: '2026-05-01', award_on: gulfDay(0), award_result: 'won' })
    expect((await owner.get(`/api/arbitration/case/${k.id}`)).data.arbitration.stage).toBe('awarded')
    expect((await owner.get('/api/arbitration/register')).data.items).toHaveLength(0)
    expect((await owner.get('/api/arbitration/register?show=all')).data.items).toHaveLength(1)

    // Removing a step removes its open calendar entry.
    const reply = saved.data.steps.find((s: any) => s.title === 'Reply')
    await owner.del(`/api/arbitration/steps/${reply.id}`)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [reply.event_id])).toBeFalsy()

    // Other firms and staff without rights cannot touch it.
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/arbitration/case/${k.id}`)).status).toBe(404)
    expect((await other.c.patch(`/api/arbitration/members/${chair.id}`, { name: 'Someone else' })).status).toBe(404)
    expect((await other.c.del(`/api/arbitration/steps/${defence.id}`)).status).toBe(404)
    expect((await client(ctx.app).get('/api/arbitration/register')).status).toBe(401)

    // Deleting the arbitration removes the open calendar entries it made.
    await owner.del(`/api/arbitration/case/${k.id}`)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [hearing.event_id])).toBeFalsy()
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [deposit.event_id])).toBeTruthy()
  })
})
