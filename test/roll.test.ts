import { beforeAll, describe, expect, it } from 'vitest'
import { groupRoll, type RollItem } from '../src/services/roll'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

// A Muscat wall-clock time on a given day offset, as an ISO instant.
const muscat = (offsetDays: number, hhmm: string) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
  return { day: d, iso: new Date(`${d}T${hhmm}:00+04:00`).toISOString() }
}

describe('court roll grouping', () => {
  it('groups by day, then by court, falling back to the location', () => {
    const it = (day: string, court: string | null, location: string | null, id: string) => ({ id, day, court, location } as RollItem)
    const g = groupRoll([it('2026-10-14', 'Primary Court Muscat', null, 'a'), it('2026-10-14', 'Primary Court Muscat', null, 'b'), it('2026-10-14', null, 'Seeb', 'c'), it('2026-10-15', null, null, 'd')])
    expect(g.map((d) => [d.day, d.courts.map((c) => [c.court, c.hearings.length])])).toEqual([
      ['2026-10-14', [['Primary Court Muscat', 2], ['Seeb', 1]]], ['2026-10-15', [['', 1]]]
    ])
  })
})

describe('court roll', () => {
  it('lists hearings with the last outcome, sets who attends, filters by lawyer and exports Word', async () => {
    const { c, me } = await registered(ctx.app)
    const { data: { client: cl } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Deposit refund', jurisdiction: 'oman', client_id: cl.id, court: 'Primary Court Muscat', opposing_party: 'Landlord LLC' })
    const past = muscat(-7, '09:00')
    const next = muscat(1, '10:30')
    const first = await c.post('/api/events', { title: 'First hearing', kind: 'hearing', starts_at: past.iso, case_id: k.id })
    const rec = await c.post('/api/hearings', {
      event_id: first.data.event.id, outcome: 'adjourned', summary: 'Court asked the landlord for the inspection report.',
      next_steps: 'File the photos of the flat.', next_hearing: { starts_at: next.iso }
    })
    expect(rec.status).toBe(201)
    await c.post('/api/events', { title: 'Meeting', kind: 'meeting', starts_at: next.iso, case_id: k.id })

    const r = await c.get(`/api/roll?from=${next.day}&to=${next.day}`)
    expect(r.status).toBe(200)
    expect(r.data.total).toBe(1)
    const h = r.data.days[0].courts[0].hearings[0]
    expect(r.data.days[0]).toMatchObject({ day: next.day, courts: [{ court: 'Primary Court Muscat' }] })
    expect(h).toMatchObject({
      time: '10:30', reference: k.reference, client_name: 'Gulf Trading LLC', opposing_party: 'Landlord LLC', lawyer_name: 'Owner Person',
      last_outcome: 'adjourned', last_date: past.day, last_next_steps: 'File the photos of the flat.', attendee_id: null
    })

    // A junior attends for the partner.
    const invite = await c.post('/api/org/invites', { email: `junior-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const junior = client(ctx.app)
    const acc = await junior.post('/api/auth/accept-invite', { token, name: 'Junior Lawyer', password: 'Str0ngPassw0rd' })
    expect(acc.status).toBe(201)
    const juniorId = acc.data.user.id
    expect((await c.patch(`/api/roll/${h.id}`, { attendee_id: juniorId })).data.attendee_id).toBe(juniorId)
    expect((await junior.get(`/api/roll?from=${next.day}&to=${next.day}&who=me`)).data.total).toBe(1)
    expect((await c.get(`/api/roll?from=${next.day}&to=${next.day}&who=me`)).data.total).toBe(0)
    expect((await c.get(`/api/roll?from=${next.day}&to=${next.day}&who=${me.user.id}`)).data.total).toBe(0)
    expect((await c.patch(`/api/roll/${h.id}`, { attendee_id: null })).data.attendee_id).toBeNull()
    expect((await c.get(`/api/roll?from=${next.day}&to=${next.day}&who=me`)).data.total).toBe(1)

    const doc = await c.get(`/api/roll?from=${past.day}&to=${next.day}&format=docx&lang=ar`)
    expect(doc.status).toBe(200)
    expect(doc.res.headers.get('content-type')).toContain('wordprocessingml')

    expect((await c.get(`/api/roll?from=${next.day}&to=${past.day}`)).status).toBe(400)
    expect((await c.get('/api/roll?from=2026-01-01&to=2026-06-01')).status).toBe(400)

    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/roll?from=${next.day}&to=${next.day}`)).data.total).toBe(0)
    expect((await other.c.patch(`/api/roll/${h.id}`, { attendee_id: null })).status).toBe(404)
    expect((await c.patch(`/api/roll/${h.id}`, { attendee_id: other.me.user.id })).status).toBe(400)
  })
})
