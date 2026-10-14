import { beforeAll, describe, expect, it } from 'vitest'
import { prepText } from '../src/services/hearing-prep'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('hearing preparation', () => {
  it('gathers the facts for a hearing, drafts a note with AI and keeps a checklist', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Bounced cheques', jurisdiction: 'oman', client_id: client.id, court: 'Primary Court, Muscat', opposing_party: 'Desert Builders' })
    const past = await c.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k.id, starts_at: new Date(Date.now() - 10 * 86400e3).toISOString() })
    await c.post('/api/hearings', { event_id: past.data.event.id, outcome: 'adjourned', summary: 'Court asked for the original cheques.', next_steps: 'Bring the originals and the bank return memo.' })
    const next = await c.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k.id, starts_at: new Date(Date.now() + 5 * 86400e3).toISOString() })
    await c.post('/api/tasks', { title: 'Get the bank return memo', case_id: k.id })
    await c.post('/api/originals', { client_id: client.id, case_id: k.id, received_on: '2026-10-01', items: [{ kind: 'cheque', description: 'Cheque no. 000123' }] })
    await c.post('/api/documents', { title: 'Reply memo', content: 'The defendant admits the debt but disputes the interest.', case_id: k.id })
    await c.put(`/api/settlement/case/${k.id}/authority`, { position: 'receive', amount: 1000 })
    await c.post(`/api/settlement/case/${k.id}`, { direction: 'theirs', amount: 900, made_on: '2026-10-10' })
    const id = next.data.event.id

    const g = await c.get(`/api/hearing-prep/${id}`)
    expect(g.status).toBe(200)
    expect(g.data.last).toMatchObject({ outcome: 'adjourned', next_steps: 'Bring the originals and the bank return memo.' })
    expect(g.data.tasks.map((t: any) => t.title)).toEqual(['Get the bank return memo'])
    expect(g.data.originals[0]).toMatchObject({ description: 'Cheque no. 000123', status: 'held' })
    expect(g.data.prep).toBeNull()
    expect(g.data.checklist.map((x: any) => x.text)).toEqual(expect.arrayContaining(['Finish: Get the bank return memo', 'Bring the original: Cheque no. 000123']))
    expect(g.data.text).toBeUndefined()

    // Tick one item before the AI note: it stays ticked afterwards.
    const ticked = g.data.checklist.map((x: any, i: number) => ({ ...x, done: i === 0 }))
    expect((await c.put(`/api/hearing-prep/${id}/checklist`, { checklist: ticked })).status).toBe(200)

    ctx.ai.nextReply = JSON.stringify({
      summary: 'The claim is on the cheques; the court wants the originals.', objectives: ['Get the originals accepted'], arguments: ['The debt is admitted in the reply memo'],
      requests: ['Ask for judgment on the admitted amount'], bring: ['Original cheque 000123'], risks: ['Interest may be refused'], open_questions: ['Has the bank memo arrived?'],
      checklist: ['Bring the original: Cheque no. 000123', 'Print three copies of the memo']
    })
    const r = await c.post(`/api/hearing-prep/${id}/ai`, { language: 'en' })
    expect(r.status).toBe(201)
    expect(r.data.prep.content.objectives).toEqual(['Get the originals accepted'])
    const texts = r.data.prep.checklist.map((x: any) => x.text)
    expect(texts.filter((t: string) => t === 'Bring the original: Cheque no. 000123')).toHaveLength(1)
    expect(texts).toContain('Print three copies of the memo')
    expect(r.data.prep.checklist[0].done).toBe(true)
    const prompt = ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')
    for (const s of ['Court asked for the original cheques.', 'Get the bank return memo', 'Cheque no. 000123', 'admits the debt', 'their offer 900 OMR']) expect(prompt).toContain(s)

    const again = await c.get(`/api/hearing-prep/${id}`)
    expect(again.data.prep).toMatchObject({ language: 'en', content: { requests: ['Ask for judgment on the admitted amount'] } })
    const doc = await c.get(`/api/hearing-prep/${id}/docx`)
    expect(doc.status).toBe(200)
    expect(doc.res.headers.get('content-type')).toContain('wordprocessingml')

    // Only hearings, only this firm.
    const meeting = await c.post('/api/events', { title: 'Client meeting', kind: 'meeting', case_id: k.id, starts_at: new Date(Date.now() + 86400e3).toISOString() })
    expect((await c.get(`/api/hearing-prep/${meeting.data.event.id}`)).status).toBe(404)
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/hearing-prep/${id}`)).status).toBe(404)
  })

  it('writes the preparation sheet in Arabic with the checklist ticks', () => {
    const text = prepText({
      lang: 'ar', reference: '2026-0001', title: 'شيكات مرتجعة', date: '2026-10-20', court: 'المحكمة الابتدائية بمسقط',
      note: { summary: 'الدعوى قائمة على الشيكات.', objectives: ['قبول الأصول'], arguments: [], requests: [], bring: ['الشيك الأصلي'], risks: [], open_questions: [], checklist: [] },
      checklist: [{ text: 'إحضار الأصل', done: true }, { text: 'طباعة المذكرة', done: false }], last: { date: '2026-10-04', outcome: 'adjourned', next_steps: null }
    })
    expect(text).toContain('تحضير الجلسة – 2026-0001 شيكات مرتجعة')
    expect(text).toContain('الأهداف\n• قبول الأصول')
    expect(text).toContain('☑ إحضار الأصل\n☐ طباعة المذكرة')
  })
})
