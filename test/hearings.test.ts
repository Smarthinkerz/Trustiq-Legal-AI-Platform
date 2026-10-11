import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'
import { clientUpdateText } from '../src/services/hearings'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('hearing records', () => {
  it('records an outcome, books the next hearing, creates tasks and updates the client', async () => {
    const { c } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { name: 'Hearing Client' })
    const k = await c.post('/api/cases', { title: 'Contract dispute', jurisdiction: 'oman', client_id: cl.data.client.id })
    const caseId = k.data.case.id
    const email = `h-${crypto.randomUUID().slice(0, 6)}@example.test`
    const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email })
    const portal = client(ctx.app)
    await portal.post('/api/auth/accept-invite', { token: new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!, name: 'Client', password: 'Str0ngPassw0rd' })

    const past = new Date(Date.now() - 2 * 86400e3).toISOString()
    const hearing = await c.post('/api/events', { title: 'First instance hearing', kind: 'hearing', starts_at: past, case_id: caseId, location: 'Muscat Primary Court' })
    const meeting = await c.post('/api/events', { title: 'Client call', kind: 'meeting', starts_at: past, case_id: caseId })
    const awaiting = await c.get('/api/hearings/awaiting')
    expect(awaiting.data.items.map((e: any) => e.id)).toEqual([hearing.data.event.id])

    expect((await c.post('/api/hearings', { event_id: meeting.data.event.id, outcome: 'other', summary: 'x' })).status).toBe(400)
    expect((await c.post('/api/hearings', { event_id: hearing.data.event.id, outcome: 'adjourned', summary: 'x', next_hearing: { starts_at: new Date(Date.now() - 5 * 86400e3).toISOString() } })).status).toBe(400)

    const next = new Date(Date.now() + 14 * 86400e3)
    next.setUTCHours(5, 30, 0, 0)
    const rec = await c.post('/api/hearings', {
      event_id: hearing.data.event.id, outcome: 'adjourned', summary: 'Judge asked the defendant to submit the expert report.',
      next_steps: 'Review expert report', next_hearing: { starts_at: next.toISOString() },
      tasks: [{ title: 'File reply memorandum', due_date: '2030-01-10' }], notify_client: true
    })
    expect(rec.status).toBe(201)
    expect(rec.data.record).toMatchObject({ outcome: 'adjourned', shared_with_client: true, next_hearing_location: 'Muscat Primary Court' })
    expect(rec.data.record.client_message).toContain('The hearing was adjourned')
    expect(rec.data.record.client_message).toContain('تم تأجيل الجلسة')
    expect(rec.data.record.client_message).toContain('09:30') // Muscat time
    expect((await c.post('/api/hearings', { event_id: hearing.data.event.id, outcome: 'other', summary: 'again' })).status).toBe(409)

    // The hearing is done, the next one is booked, the task exists and the client was messaged.
    expect((await c.get('/api/hearings/awaiting')).data.items).toHaveLength(0)
    const events = await c.get(`/api/events?case_id=${caseId}`)
    const nextEvent = events.data.items.find((e: any) => e.id === rec.data.record.next_event_id)
    expect(nextEvent).toMatchObject({ kind: 'hearing', title: 'First instance hearing', location: 'Muscat Primary Court' })
    expect(events.data.items.find((e: any) => e.id === hearing.data.event.id).completed_at).toBeTruthy()
    const tasks = await c.get(`/api/tasks?case_id=${caseId}`)
    expect(tasks.data.items.map((t: any) => t.title)).toContain('File reply memorandum')
    expect(ctx.mails.some((m) => m.to === email && m.text.includes('The hearing was adjourned'))).toBe(true)
    const msgs = await portal.get('/api/portal/messages')
    expect(msgs.data.items.some((m: any) => m.body.includes('Next hearing'))).toBe(true)

    // The portal shows the outcome and update, never the internal summary.
    const pc = await portal.get(`/api/portal/cases/${caseId}`)
    expect(pc.data.hearings).toHaveLength(1)
    expect(JSON.stringify(pc.data.hearings)).not.toContain('expert report')

    const list = await c.get(`/api/hearings?case_id=${caseId}`)
    expect(list.data.items[0].summary).toContain('expert report')
    const edited = await c.patch(`/api/hearings/${list.data.items[0].id}`, { summary: 'Corrected summary', next_steps: null })
    expect(edited.data.record).toMatchObject({ summary: 'Corrected summary', next_steps: null })

    // Another firm cannot see or record.
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/hearings?case_id=${caseId}`)).data.items).toHaveLength(0)
    expect((await other.c.post('/api/hearings', { event_id: rec.data.record.next_event_id, outcome: 'other', summary: 'x' })).status).toBe(404)
  })

  it('writes the update in the court country time zone', () => {
    const text = clientUpdateText({
      outcome: 'reserved', caseRef: '2026-0001', caseTitle: 'Dispute', hearingAt: new Date('2026-10-01T06:00:00Z'), hearingAllDay: false, jurisdiction: 'ksa',
      next: { at: new Date('2026-11-01T07:00:00Z'), allDay: false, location: 'Riyadh General Court' }
    })
    expect(text).toContain('09:00') // Riyadh is UTC+3
    expect(text).toContain('10:00')
    expect(text).toContain('حُجزت الدعوى للحكم')
  })
})
