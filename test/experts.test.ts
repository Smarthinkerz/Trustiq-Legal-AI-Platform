import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const muscatToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const eventsOf = (ids: Record<string, string>) => ctx.db.query(
  `SELECT id, title, completed_at, to_char(starts_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') AS day FROM events WHERE id = ANY($1::uuid[]) ORDER BY starts_at`, [Object.values(ids)])

describe('expert referrals', () => {
  it('keeps each expert deadline on the calendar through fee, report and objections', async () => {
    const { c } = await registered(ctx.app)
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Construction defects claim', jurisdiction: 'uae', currency: 'AED', court: 'Dubai Courts' })
    const today = muscatToday()

    const created = await c.post(`/api/experts/case/${k.id}`, {
      expert_name: 'Eng. Khalid Al Mansoori', expert_type: 'engineering', court_ref: '1234/2026', referral_date: plus(today, -5),
      scope: 'Inspect the villa and assess the cost of remedial works.', fee_amount: 15000, fee_payer: 'client',
      fee_due: plus(today, 2), memo_due: plus(today, 10), report_due: plus(today, 40)
    })
    expect(created.status).toBe(201)
    const r = created.data.referral
    expect(r).toMatchObject({ stage: 'appointed', currency: 'AED', fee_amount: 15000, next_deadline: { key: 'fee', date: plus(today, 2), days_left: 2 } })
    let evs = await eventsOf(r.event_ids)
    expect(evs.map((e: any) => [e.title, e.day, !!e.completed_at])).toEqual([
      [`Expert fee deposit due – ${k.reference}`, plus(today, 2), false],
      [`Submissions to the expert due – ${k.reference}`, plus(today, 10), false],
      [`Expert report due – ${k.reference}`, plus(today, 40), false]
    ])
    expect((await c.get('/api/dashboard')).data.counts.expert_deadlines).toBe(1)

    // Fee paid: that deadline is done and the next one is the memorandum.
    const paid = await c.patch(`/api/experts/${r.id}`, { fee_paid_on: today })
    expect(paid.data.referral).toMatchObject({ stage: 'in_progress', next_deadline: { key: 'memo', days_left: 10 } })
    expect((await c.get('/api/dashboard')).data.counts.expert_deadlines).toBe(0)

    // The report is filed: report and memo deadlines complete, objections run from the report date.
    const filed = await c.patch(`/api/experts/${r.id}`, { report_filed_on: today, objection_days: 7, report_result: 'partly', report_summary: 'Defects confirmed; cost lower than claimed.' })
    expect(filed.data.referral).toMatchObject({ stage: 'report_filed', objection_due: plus(today, 7), next_deadline: { key: 'objection', days_left: 7 } })
    evs = await eventsOf(filed.data.referral.event_ids)
    expect(evs.filter((e: any) => !e.completed_at).map((e: any) => e.title)).toEqual([`Objections to expert report due – ${k.reference}`])

    // Moving the report date moves the objections deadline; a typed deadline wins.
    expect((await c.patch(`/api/experts/${r.id}`, { report_filed_on: plus(today, -1) })).data.referral.objection_due).toBe(plus(today, 6))
    expect((await c.patch(`/api/experts/${r.id}`, { objection_due: plus(today, 9) })).data.referral.objection_due).toBe(plus(today, 9))
    expect((await c.patch(`/api/experts/${r.id}`, { notes: 'Call the expert.' })).data.referral.objection_due).toBe(plus(today, 9))

    const done = await c.patch(`/api/experts/${r.id}`, { objections_filed_on: today })
    expect(done.data.referral).toMatchObject({ stage: 'objections_filed', next_deadline: null })
    evs = await eventsOf(done.data.referral.event_ids)
    expect(evs.every((e: any) => e.completed_at)).toBe(true)

    const reg = await c.get('/api/experts/register')
    expect(reg.data.counts).toEqual({ open: 1, due_soon: 0, overdue: 0, awaiting_report: 0 })
    await c.patch(`/api/experts/${r.id}`, { closed: true })
    expect((await c.get('/api/experts/register')).data.items).toEqual([])
    const all = await c.get('/api/experts/register?show=all&format=csv')
    expect(all.res.headers.get('content-type')).toContain('text/csv')

    const activity = (await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'expert' ORDER BY created_at`, [k.id])).map((a: any) => a.body)
    expect(activity).toEqual([
      `Expert appointed: Eng. Khalid Al Mansoori (engineering) on ${plus(today, -5)}`,
      'Expert referral (Eng. Khalid Al Mansoori): appointed → in_progress',
      'Expert referral (Eng. Khalid Al Mansoori): in_progress → report_filed',
      'Expert referral (Eng. Khalid Al Mansoori): report_filed → objections_filed',
      'Expert referral (Eng. Khalid Al Mansoori): objections_filed → closed'
    ])
  })

  it('validates dates and documents, keeps empty fields unset and cleans up on delete', async () => {
    const { c } = await registered(ctx.app)
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Medical negligence', jurisdiction: 'oman' })
    const { data: { case: other } } = await c.post('/api/cases', { title: 'Other', jurisdiction: 'oman' })
    const { data: { document: foreign } } = await c.post('/api/documents', { title: 'Elsewhere', content: 'x', case_id: other.id })
    const today = muscatToday()
    const base = { expert_type: 'medical', referral_date: today }

    expect((await c.post(`/api/experts/case/${k.id}`, { ...base, report_due: plus(today, -1) })).status).toBe(400)
    expect((await c.post(`/api/experts/case/${k.id}`, { ...base, objections_filed_on: today })).status).toBe(400)
    expect((await c.post(`/api/experts/case/${k.id}`, { ...base, report_document_id: foreign.id })).status).toBe(400)

    const r = (await c.post(`/api/experts/case/${k.id}`, { ...base, referral_date: plus(today, -5), fee_amount: '', objection_days: '', report_due: today })).data.referral
    expect(r).toMatchObject({ fee_amount: null, currency: null, objection_days: null, stage: 'appointed', next_deadline: { key: 'report', days_left: 0 } })
    // Removing a date removes its calendar entry.
    const reportEvent = r.event_ids.report
    const cleared = await c.patch(`/api/experts/${r.id}`, { report_due: '' })
    expect(cleared.data.referral.event_ids.report).toBeUndefined()
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [reportEvent])).toBeFalsy()

    const again = await c.patch(`/api/experts/${r.id}`, { fee_due: plus(today, -3) })
    expect(again.data.referral.next_deadline).toEqual({ key: 'fee', date: plus(today, -3), days_left: -3 })
    expect((await c.get('/api/experts/register')).data.counts).toMatchObject({ overdue: 1, awaiting_report: 1 })
    const feeEvent = again.data.referral.event_ids.fee
    expect((await c.del(`/api/experts/${r.id}`)).status).toBe(200)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [feeEvent])).toBeFalsy()
    expect((await c.get(`/api/experts/case/${k.id}`)).data.items).toEqual([])
  })
})
