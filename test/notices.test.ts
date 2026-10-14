import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const muscatToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

describe('legal notices', () => {
  it('tracks an outgoing notice from service to response, with the deadline on the calendar', async () => {
    const { c } = await registered(ctx.app)
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Unpaid supply invoices', jurisdiction: 'uae', currency: 'AED' })
    const { data: { document: d } } = await c.post('/api/documents', { title: 'Demand notice', content: 'We demand payment within 15 days.', case_id: k.id })
    const today = muscatToday()

    const created = await c.post(`/api/notices/case/${k.id}`, {
      direction: 'outgoing', party: 'Desert Builders LLC', subject: 'Demand for payment of unpaid invoices', method: 'notary', reference_no: 'NT-2026-4411',
      notice_date: plus(today, -3), response_days: 15, amount: 125000, document_id: d.id
    })
    expect(created.status).toBe(201)
    const n = created.data.notice
    // Not delivered yet: the period runs from the notice date.
    expect(n).toMatchObject({ status: 'sent', response_due: plus(today, 12), days_left: 12, currency: 'AED', amount: 125000, document_title: 'Demand notice' })
    const ev = await ctx.db.one('SELECT title, kind, completed_at, starts_at FROM events WHERE id = $1', [n.deadline_event_id])
    expect(ev).toMatchObject({ title: `Notice response period ends – ${k.reference}`, kind: 'deadline', completed_at: null })

    // Delivery moves the deadline and the status.
    const delivered = await c.patch(`/api/notices/${n.id}`, { delivered_on: plus(today, -1) })
    expect(delivered.data.notice).toMatchObject({ status: 'delivered', response_due: plus(today, 14) })
    const moved = await ctx.db.one(`SELECT to_char(starts_at AT TIME ZONE 'Asia/Muscat', 'YYYY-MM-DD') AS day FROM events WHERE id = $1`, [n.deadline_event_id])
    expect(moved!.day).toBe(plus(today, 14))

    // Editing other fields leaves the deadline alone; a date typed in wins.
    expect((await c.patch(`/api/notices/${n.id}`, { notes: 'Called their accountant.' })).data.notice.response_due).toBe(plus(today, 14))
    expect((await c.patch(`/api/notices/${n.id}`, { response_due: plus(today, 20) })).data.notice.response_due).toBe(plus(today, 20))

    const reg = await c.get('/api/notices/register')
    expect(reg.data.counts).toEqual({ open: 1, due_soon: 0, overdue: 0 })
    expect(reg.data.items[0]).toMatchObject({ reference: k.reference, party: 'Desert Builders LLC' })

    // A response closes it and completes the calendar deadline.
    const answered = await c.patch(`/api/notices/${n.id}`, { response_on: today, response_summary: 'They dispute half the amount.' })
    expect(answered.data.notice.status).toBe('responded')
    expect((await ctx.db.one('SELECT completed_at FROM events WHERE id = $1', [n.deadline_event_id]))!.completed_at).not.toBeNull()
    expect((await c.get('/api/notices/register')).data.items).toEqual([])
    expect((await c.get('/api/notices/register?show=all')).data.items).toHaveLength(1)
    const csv = await c.get('/api/notices/register?show=all&format=csv')
    expect(csv.res.headers.get('content-type')).toContain('text/csv')

    const activity = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'notice' ORDER BY created_at`, [k.id])
    expect(activity.map((a: any) => a.body)).toEqual([
      `Notice sent to Desert Builders LLC on ${plus(today, -3)}: Demand for payment of unpaid invoices`,
      'Notice to/from Desert Builders LLC: sent → delivered',
      'Notice to/from Desert Builders LLC: delivered → responded'
    ])
  })

  it('puts our reply deadline for a received notice on the dashboard and validates input', async () => {
    const { c } = await registered(ctx.app)
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Lease termination', jurisdiction: 'oman' })
    const { data: { case: other } } = await c.post('/api/cases', { title: 'Other', jurisdiction: 'oman' })
    const { data: { document: foreign } } = await c.post('/api/documents', { title: 'Elsewhere', content: 'x', case_id: other.id })
    const today = muscatToday()
    const base = { direction: 'incoming', party: 'Landlord', subject: 'Notice to vacate', method: 'courier', notice_date: plus(today, -10) }

    expect((await c.post(`/api/notices/case/${k.id}`, { ...base, document_id: foreign.id })).status).toBe(400)
    expect((await c.post(`/api/notices/case/${k.id}`, { ...base, delivered_on: plus(today, -11) })).status).toBe(400)

    const r = await c.post(`/api/notices/case/${k.id}`, { ...base, delivered_on: plus(today, -10), response_days: 13 })
    expect(r.data.notice).toMatchObject({ status: 'delivered', response_due: plus(today, 3), days_left: 3 })
    expect((await ctx.db.one('SELECT title FROM events WHERE id = $1', [r.data.notice.deadline_event_id]))!.title).toBe(`Reply to notice due – ${k.reference}`)
    expect((await c.get('/api/dashboard')).data.counts.notices_due).toBe(1)
    expect((await c.get('/api/notices/register?direction=outgoing')).data.items).toEqual([])
    expect((await c.get('/api/notices/register')).data.counts).toEqual({ open: 1, due_soon: 1, overdue: 0 })

    // Withdrawn by hand: off the dashboard. Deleting removes the calendar entry too.
    await c.patch(`/api/notices/${r.data.notice.id}`, { status: 'withdrawn' })
    expect((await c.get('/api/dashboard')).data.counts.notices_due).toBe(0)
    const second = await c.post(`/api/notices/case/${k.id}`, { ...base, response_due: plus(today, 5) })
    expect(second.data.notice).toMatchObject({ status: 'sent', response_due: plus(today, 5), response_days: null, amount: null, currency: null })
    const blank = await c.patch(`/api/notices/${second.data.notice.id}`, { amount: '', response_days: '', reference_no: '' })
    expect(blank.data.notice).toMatchObject({ amount: null, response_days: null, response_due: plus(today, 5) })
    expect((await c.del(`/api/notices/${second.data.notice.id}`)).status).toBe(200)
    expect(await ctx.db.one('SELECT 1 FROM events WHERE id = $1', [second.data.notice.deadline_event_id])).toBeFalsy()
    expect((await c.get(`/api/notices/case/${k.id}`)).data.items).toHaveLength(1)
  })
})
