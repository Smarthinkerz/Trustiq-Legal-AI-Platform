import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeJudgment, normalizeNotice } from '../src/services/ai-read'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const JUDGMENT = 'حكمت المحكمة الابتدائية بمسقط في الدعوى رقم 123/2026 بإلزام المدعى عليها شركة البناء الخليجية بأن تؤدي للمدعية مبلغ 45,000 ريال عماني مع المصاريف.'
const NOTICE = 'إنذار رسمي موجه إلى شركة النور للتجارة بسداد مبلغ 12,500 ريال عماني خلال خمسة عشر يوماً من تاريخ الاستلام، وإلا سيتم اتخاذ الإجراءات القانونية.'

describe('AI reading of judgments and notices', () => {
  it('keeps only well-formed fields', () => {
    expect(normalizeJudgment({ judgment_date: '2026-09-30', court: 'Primary Court, Muscat', degree: 'first_instance', judgment_no: '123/2026', result: 'won',
      operative_part: 'إلزام المدعى عليها بأداء 45,000 ر.ع', amount_awarded: '45,000', costs_awarded: null, currency: 'omr', notes: '' })).toEqual({
      judgment_date: '2026-09-30', court: 'Primary Court, Muscat', degree: 'first_instance', judgment_no: '123/2026', result: 'won',
      summary: 'إلزام المدعى عليها بأداء 45,000 ر.ع', amount_awarded: 45000, costs_awarded: null, currency: 'OMR', notes: ''
    })
    expect(normalizeJudgment({ judgment_date: '30/09/2026', degree: 'magic', result: 'victory', amount_awarded: -5, currency: 'XYZ' })).toMatchObject({
      judgment_date: '', degree: '', result: '', amount_awarded: null, currency: ''
    })
    expect(normalizeNotice({ direction: 'incoming', party: 'Gulf Builders', response_days: 15.5, method: 'fax', demands: 'Pay 12,500', notes: 'Hijri date converted' })).toMatchObject({
      direction: 'incoming', response_days: null, method: '', notes: 'Pay 12,500\nHijri date converted'
    })
    expect(normalizeNotice(null)).toMatchObject({ direction: '', party: '', response_days: null })
  })

  it('reads a judgment and a notice from the matter\'s documents', async () => {
    const { c: owner } = await registered(ctx.app)
    const cl = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Trading LLC' })).data.client
    const k = (await owner.post('/api/cases', { title: 'Supply dispute', jurisdiction: 'oman', client_id: cl.id, opposing_party: 'Gulf Builders LLC' })).data.case
    const judgment = (await owner.post('/api/documents', { title: 'Judgment 123/2026', content: JUDGMENT, case_id: k.id, doc_type: 'other' })).data.document
    const notice = (await owner.post('/api/documents', { title: 'Notice received', content: NOTICE, case_id: k.id, doc_type: 'other' })).data.document
    const blank = (await owner.post('/api/documents', { title: 'Blank scan', content: 'x', case_id: k.id, doc_type: 'other' })).data.document
    const elsewhere = (await owner.post('/api/documents', { title: 'Other matter', content: JUDGMENT, doc_type: 'other' })).data.document

    ctx.ai.nextReply = JSON.stringify({ judgment_date: '2026-09-30', court: 'المحكمة الابتدائية بمسقط', degree: 'first_instance', judgment_no: '123/2026', result: 'won',
      operative_part: 'إلزام المدعى عليها بأداء 45,000 ر.ع مع المصاريف', amount_awarded: 45000, costs_awarded: null, currency: 'OMR', notes: '',
      evidence: { judgment_date: '30/09/2026', court: 'المحكمة الابتدائية بمسقط', judgment_no: 'رقم 123/2026', amount_awarded: 'مبلغ 45,000 ريال عماني' } })
    const r = await owner.post(`/api/judgments/case/${k.id}/read`, { document_id: judgment.id })
    expect(r.status).toBe(200)
    expect(r.data.fields).toMatchObject({ judgment_no: '123/2026', result: 'won', amount_awarded: 45000, currency: 'OMR', court: 'المحكمة الابتدائية بمسقط' })
    // The judgment text gives no date: the date the model "read" is dropped, never used for an appeal deadline.
    expect(r.data.fields.judgment_date).toBe('')
    expect(r.data.unverified).toEqual(['judgment_date'])
    const prompt = ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')
    expect(prompt).toContain('Our client is "Al Noor Trading LLC"; the other side is "Gulf Builders LLC"')
    expect(prompt).toContain('45,000 ريال عماني')
    // Nothing was saved.
    expect((await owner.get(`/api/judgments/case/${k.id}`)).data.items).toHaveLength(0)

    ctx.ai.nextReply = JSON.stringify({ direction: 'incoming', party: 'Gulf Builders LLC', subject: 'إنذار بالسداد', notice_date: '2026-10-01', reference_no: '', method: 'notary',
      response_days: 15, amount: 12500, currency: 'OMR', demands: 'سداد 12,500 ر.ع خلال 15 يوماً', notes: '',
      evidence: { notice_date: '1 October 2026', party: 'شركة النور للتجارة', response_days: 'خمسة عشر يوماً', amount: 'مبلغ 12,500 ريال عماني' } })
    const n = await owner.post(`/api/notices/case/${k.id}/read`, { document_id: notice.id })
    // "خمسة عشر يوماً" (fifteen days) is read by code; the notice date is not in the notice, so it is dropped.
    expect(n.data.fields).toMatchObject({ direction: 'incoming', response_days: 15, amount: 12500, notes: 'سداد 12,500 ر.ع خلال 15 يوماً', notice_date: '' })
    expect(n.data.unverified).toContain('notice_date')

    // Unreadable, unrelated or foreign documents are refused before the AI is called.
    const calls = ctx.ai.calls.length
    expect((await owner.post(`/api/judgments/case/${k.id}/read`, { document_id: blank.id })).status).toBe(400)
    expect((await owner.post(`/api/notices/case/${k.id}/read`, { document_id: elsewhere.id })).status).toBe(400)
    expect(ctx.ai.calls.length).toBe(calls)
    ctx.ai.nextReply = 'not json at all'
    expect((await owner.post(`/api/judgments/case/${k.id}/read`, { document_id: judgment.id })).status).toBe(502)

    const other = await registered(ctx.app)
    expect((await other.c.post(`/api/judgments/case/${k.id}/read`, { document_id: judgment.id })).status).toBe(404)
    expect((await client(ctx.app).post(`/api/notices/case/${k.id}/read`, { document_id: notice.id })).status).toBe(401)
  })
})
