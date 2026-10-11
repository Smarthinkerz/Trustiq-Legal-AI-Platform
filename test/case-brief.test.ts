import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const BRIEF = {
  overview: 'The client claims unpaid end-of-service gratuity from a former employer.',
  status: 'Adjourned; the employer must file payroll records.',
  parties: [{ role: 'Client', name: 'Fatima Al Balushi' }, { role: 'Opposing party', name: 'Gulf Trading LLC' }],
  key_facts: ['Employed 2018-2025', 'Dismissed without notice'],
  procedural_history: [{ date: '2026-10-01', event: 'First hearing adjourned' }],
  next_steps: [{ action: 'File reply memorandum', due: '2026-10-20', owner: 'Test' }],
  deadlines: [{ date: '2026-11-01', item: 'Next hearing' }],
  risks: [{ severity: 'severe', risk: 'Employer may dispute the salary figure' }],
  open_questions: ['Copy of the employment contract?'],
  injected: 'ignored'
}

describe('AI case brief', () => {
  it('builds the brief from the whole case file, stores it and saves it as a document', async () => {
    const { c } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { name: 'Fatima Al Balushi' })
    const k = await c.post('/api/cases', { title: 'Gratuity claim', jurisdiction: 'oman', client_id: cl.data.client.id, opposing_party: 'Gulf Trading LLC', court: 'Muscat Primary Court', description: 'Claim for unpaid gratuity.' })
    const id = k.data.case.id
    await c.post(`/api/cases/${id}/notes`, { body: 'Client says salary was 900 OMR.' })
    await c.post('/api/tasks', { title: 'Collect payslips', case_id: id, due_date: '2026-10-15' })
    const h = await c.post('/api/events', { title: 'Labour court hearing', kind: 'hearing', starts_at: new Date(Date.now() - 86400e3).toISOString(), case_id: id })
    await c.post('/api/hearings', { event_id: h.data.event.id, outcome: 'adjourned', summary: 'Employer asked for time to file payroll records.' })
    await c.post('/api/documents', { title: 'Employment contract', content: 'This employment contract is made between Gulf Trading LLC and Fatima Al Balushi. Monthly salary: 900 OMR.', case_id: id })
    await c.post('/api/document-requests', { client_id: cl.data.client.id, case_id: id, title: 'Evidence', items: [{ label: 'Bank statements' }] })

    expect((await c.get(`/api/ai/cases/${id}/brief`)).data.brief).toBeNull()
    ctx.ai.nextReply = JSON.stringify(BRIEF)
    const r = await c.post(`/api/ai/cases/${id}/brief`, { language: 'en' })
    expect(r.status).toBe(201)
    expect(r.data.brief.content).toMatchObject({ overview: BRIEF.overview, risks: [{ severity: 'medium' }] })
    expect(r.data.brief.content.injected).toBeUndefined()
    expect(r.data.sources).toMatchObject({ hearings: 1, tasks: 1, documents: 1 })

    // The model saw the whole case file, wrapped as data.
    const prompt = JSON.stringify(ctx.ai.calls.at(-1))
    for (const s of ['Gratuity claim', 'Muscat Primary Court', 'salary was 900 OMR', 'Collect payslips', 'adjourned. Employer asked', 'Monthly salary: 900 OMR', 'Bank statements', 'Fees: hourly'])
      expect(prompt).toContain(s)
    expect(prompt).toContain('<case>')

    const latest = await c.get(`/api/ai/cases/${id}/brief`)
    expect(latest.data).toMatchObject({ brief: { id: r.data.brief.id }, stale: false })
    await c.post(`/api/cases/${id}/notes`, { body: 'New development.' })
    expect((await c.get(`/api/ai/cases/${id}/brief`)).data.stale).toBe(true)
    expect((await c.get(`/api/ai/cases/${id}/brief?language=ar`)).data.brief).toBeNull()

    const saved = await c.post(`/api/ai/cases/${id}/brief/${r.data.brief.id}/save`)
    expect(saved.status).toBe(201)
    const doc = await c.get(`/api/documents/${saved.data.document.id}`)
    expect(doc.data.document).toMatchObject({ case_id: id, source: 'ai', doc_type: 'legal_memo' })
    expect(doc.data.document.content).toContain('Next steps')
    expect(doc.data.document.content).toContain('• File reply memorandum (2026-10-20) – Test')
    // Saving twice returns the same document.
    expect((await c.post(`/api/ai/cases/${id}/brief/${r.data.brief.id}/save`)).data.document.id).toBe(saved.data.document.id)

    ctx.ai.nextReply = 'not json at all'
    expect((await c.post(`/api/ai/cases/${id}/brief`, { language: 'ar' })).status).toBe(502)
    const other = await registered(ctx.app)
    expect((await other.c.post(`/api/ai/cases/${id}/brief`, { language: 'en' })).status).toBe(404)
    expect((await other.c.get(`/api/ai/cases/${id}/brief`)).status).toBe(404)
  })
})
