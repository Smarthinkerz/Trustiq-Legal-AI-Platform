import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const muscatToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const plusYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`

describe('closing a matter', () => {
  it('lists what is still open, refuses to close without an override, then closes with a letter and a retention date', async () => {
    const { c, me } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', name_ar: 'الخليج للتجارة' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Supply dispute', jurisdiction: 'oman', client_id: client.id })
    await c.post('/api/tasks', { title: 'File the final memo', case_id: k.id })
    await c.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k.id, starts_at: new Date(Date.now() + 5 * 86400e3).toISOString() })
    await c.post('/api/billing/time', { case_id: k.id, work_date: muscatToday(), minutes: 60, description: 'Review', rate: 50 })
    const orig = await c.post('/api/originals', { client_id: client.id, case_id: k.id, received_on: muscatToday(), items: [{ kind: 'contract', description: 'Original contract' }] })

    const check = await c.get(`/api/closing/case/${k.id}`)
    expect(check.data.ready).toBe(false)
    const open = Object.fromEntries(check.data.checklist.filter((i: any) => !i.ok).map((i: any) => [i.key, i]))
    expect(Object.keys(open).sort()).toEqual(['deadlines', 'originals', 'tasks', 'unbilled'])
    expect(open.unbilled.amounts).toEqual([{ amount: 50, currency: 'OMR' }])
    expect(check.data).toMatchObject({ retention_years: 10, suggested_retain_until: plusYears(muscatToday(), 10) })

    const refused = await c.post(`/api/closing/case/${k.id}`, { outcome: 'settled' })
    expect(refused.status).toBe(409)
    expect(refused.data.error.code).toBe('closing_items_open')
    expect((await c.get(`/api/cases/${k.id}`)).data.case.status).not.toBe('closed')

    // Return the original; the rest is closed with an override and recorded.
    await c.post('/api/originals/return', { ids: [orig.data.items[0].id], on_date: muscatToday(), party: 'Mr. Ahmed' })
    const closed = await c.post(`/api/closing/case/${k.id}`, {
      outcome: 'settled', note: 'The dispute was settled by agreement dated 1 October 2026.', override: true, letter: { language: 'ar', share_with_client: true }
    })
    expect(closed.status).toBe(200)
    expect(closed.data.case).toMatchObject({ status: 'closed', closing_outcome: 'settled', closed_on: muscatToday(), retain_until: plusYears(muscatToday(), 10), closed_by_name: me.user.name })
    const doc = (await c.get(`/api/documents/${closed.data.document.id}`)).data.document
    expect(doc).toMatchObject({ language: 'ar', shared_with_client: true, case_id: k.id })
    expect(doc.content).toContain('السادة/ الخليج للتجارة المحترمين')
    expect(doc.content).toContain('The dispute was settled by agreement')
    expect(doc.content).toContain('وقد سلّمناكم جميع أصول المستندات')
    expect(doc.content).toContain('لمدة 10 سنوات')
    expect((await c.post(`/api/closing/case/${k.id}`, { outcome: 'settled' })).status).toBe(409)
    const [a] = await ctx.db.query(`SELECT meta AS details FROM audit_log WHERE action = 'case.closed' AND entity_id = $1`, [k.id])
    expect(a.details.open_items.map((i: any) => i.key).sort()).toEqual(['deadlines', 'tasks', 'unbilled'])

    // Reopening clears the closing.
    await c.patch(`/api/cases/${k.id}`, { status: 'active' })
    expect((await c.get(`/api/closing/case/${k.id}`)).data.case).toMatchObject({ closed_on: null, retain_until: null, closing_outcome: null })
  })

  it('keeps a retention register, with the firm period and quick closes covered', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.put('/api/closing/settings', { retention_years: 7 })).data).toEqual({ retention_years: 7 })
    const { data: { case: a } } = await c.post('/api/cases', { title: 'Old advice', jurisdiction: 'oman' })
    const { data: { case: b } } = await c.post('/api/cases', { title: 'Quick close', jurisdiction: 'oman' })
    const r = await c.post(`/api/closing/case/${a.id}`, { outcome: 'advice_given', retain_until: plusYears(muscatToday(), 2) })
    expect(r.data.case.retain_until).toBe(plusYears(muscatToday(), 2))
    expect((await c.post(`/api/closing/case/${b.id}`, { outcome: 'other', retain_until: '2020-01-01' })).status).toBe(400)
    // Closing through the status menu still sets a retention date from the firm period.
    await c.patch(`/api/cases/${b.id}`, { status: 'closed' })
    expect((await c.get(`/api/closing/case/${b.id}`)).data.case.retain_until).toBe(plusYears(new Date().toISOString().slice(0, 10), 7))

    expect((await c.get('/api/closing/retention')).data).toMatchObject({ items: [], due: 0, retention_years: 7 })
    await ctx.db.query(`UPDATE cases SET retain_until = '2025-01-01' WHERE id = $1`, [a.id])
    const due = await c.get('/api/closing/retention')
    expect(due.data.items.map((x: any) => x.reference)).toEqual([a.reference])
    expect(due.data.due).toBe(1)
    expect((await c.get('/api/dashboard')).data.counts.retention_due).toBe(1)
    expect((await c.get('/api/closing/retention?show=all')).data.items).toHaveLength(2)
    expect((await c.get('/api/closing/retention?format=csv')).res.headers.get('content-type')).toContain('text/csv')
  })
})
