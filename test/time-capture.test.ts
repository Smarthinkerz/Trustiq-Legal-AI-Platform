import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const LONG = 'The Contractor shall complete the works in accordance with the specifications. '.repeat(40)

describe('time capture from activity', () => {
  it('suggests entries from the day\'s work, logs accepted ones once and remembers dismissals', async () => {
    const { c, me } = await registered(ctx.app)
    await ctx.db.query('UPDATE users SET hourly_rate = 60 WHERE id = $1', [me.user.id])
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company', email: 'gm@gulf.test' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Supply dispute', jurisdiction: 'oman', client_id: client.id, court: 'Primary Court, Muscat' })

    // A hearing that started an hour ago, a drafted document revised twice, client messages and a signature request.
    const hearing = await c.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k.id, starts_at: new Date(Date.now() - 3600e3).toISOString() })
    const { data: { document: d } } = await c.post('/api/documents', { title: 'Statement of claim', content: LONG, case_id: k.id })
    await c.patch(`/api/documents/${d.id}`, { content: LONG + ' Revised.' })
    await c.patch(`/api/documents/${d.id}`, { content: LONG + ' Revised twice.' })
    await c.post(`/api/clients/${client.id}/messages`, { body: 'Please send the delivery notes.', case_id: k.id })
    await c.post(`/api/clients/${client.id}/messages`, { body: 'The hearing went well; next session in two weeks.', case_id: k.id })
    await c.post('/api/signatures', { document_id: d.id, signers: [{ name: 'Gulf Trading LLC', email: 'gm@gulf.test' }], send_email: false })
    // Work without a matter is not suggested.
    await c.post('/api/documents', { title: 'Internal memo', content: 'No matter linked here.' })

    const r = await c.get('/api/time-suggestions')
    expect(r.status).toBe(200)
    const byKind = Object.fromEntries(r.data.items.map((s: any) => [s.kind, s]))
    expect(Object.keys(byKind).sort()).toEqual(['draft', 'hearing', 'messages', 'revise', 'signature'])
    expect(byKind.hearing).toMatchObject({ key: `hearing:${hearing.data.event.id}`, minutes: 120, description: 'Attendance at hearing – Primary Court, Muscat', case_reference: k.reference })
    expect(byKind.draft.description).toBe('Drafting: Statement of claim')
    expect(byKind.draft.minutes).toBeGreaterThan(30)
    expect(byKind.revise).toMatchObject({ detail: '2×', minutes: 42 })
    expect(byKind.messages).toMatchObject({ detail: '2×', description: 'Correspondence with client' })
    expect(r.data.items.every((s: any) => s.minutes % 6 === 0)).toBe(true)

    // Accept two (one edited), dismiss one.
    const acc = await c.post('/api/time-suggestions/accept', { items: [
      { ...byKind.hearing, minutes: 90, description: 'Attendance at first hearing' },
      byKind.draft
    ] })
    expect(acc.data).toEqual({ created: 2, skipped: 0 })
    const again = await c.post('/api/time-suggestions/accept', { items: [byKind.draft] })
    expect(again.data).toEqual({ created: 0, skipped: 1 })
    await c.post('/api/time-suggestions/dismiss', { keys: [byKind.signature.key] })

    const after = (await c.get('/api/time-suggestions')).data.items.map((s: any) => s.kind).sort()
    expect(after).toEqual(['messages', 'revise'])
    const logged = (await c.get('/api/billing/time')).data.items
    expect(logged.find((t: any) => t.description === 'Attendance at first hearing')).toMatchObject({ minutes: 90, billable: true })
    expect(Number(logged[0].rate)).toBe(60)

    // Arabic descriptions for an Arabic-speaking lawyer; nothing for someone else.
    await ctx.db.query(`UPDATE users SET locale = 'ar' WHERE id = $1`, [me.user.id])
    expect((await c.get('/api/time-suggestions')).data.items.find((s: any) => s.kind === 'messages').description).toBe('مراسلات مع الموكل')
    const other = await registered(ctx.app)
    expect((await other.c.get('/api/time-suggestions')).data.items).toEqual([])
    expect((await other.c.post('/api/time-suggestions/accept', { items: [byKind.revise] })).status).toBe(400)
    expect((await c.get('/api/time-suggestions?from=2026-01-01&to=2026-06-01')).status).toBe(400)
  })
})
