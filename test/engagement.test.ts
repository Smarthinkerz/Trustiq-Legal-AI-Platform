import { beforeAll, describe, expect, it } from 'vitest'
import { defaultLaw, fmtMoney, letterStatus, renderEngagementLetter, termsSchema } from '../src/services/engagement'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const base = {
  scope: '1. Review the lease and advise on termination.\n2. Send a legal notice to the landlord.',
  fee_arrangement: 'fixed', currency: 'OMR', fixed_fee: 1500, retainer_amount: 500, payment_terms_days: 15, vat_rate: 5, law: 'oman'
}
const party = { firm: 'Al Noor Advocates', client: 'Gulf Trading LLC', caseRef: 'C-2026-0001', caseTitle: 'Lease dispute', lawyer: 'Salim Al Harthy' }

describe('engagement letter template', () => {
  it('writes the fee, advance, VAT and law sections from the terms, in English and Arabic', () => {
    const t = termsSchema.parse(base)
    const en = renderEngagementLetter('en', party, t, new Date('2026-10-13T08:00:00Z'))
    expect(en.title).toBe('Engagement letter - Lease dispute')
    expect(en.content).toContain('Date: 13 October 2026')
    expect(en.content).toContain('a fixed fee of OMR 1,500.000')
    expect(en.content).toContain('an advance of OMR 500.000')
    expect(en.content).toContain('value added tax at 5%')
    expect(en.content).toContain('payable within 15 days')
    expect(en.content).toContain('governed by the laws of the Sultanate of Oman')
    expect(en.content).toMatch(/^4\. Advance payment$/m)
    expect(en.content).toContain('Name: Salim Al Harthy')

    const ar = renderEngagementLetter('ar', party, termsSchema.parse({ ...base, fee_arrangement: 'contingency', fixed_fee: null, contingency_percent: 10, retainer_amount: null, vat_rate: 0 }))
    expect(ar.title).toBe('خطاب تكليف - Lease dispute')
    expect(ar.content).toContain('بنسبة 10%')
    expect(ar.content).toContain('قوانين سلطنة عُمان')
    expect(ar.content).not.toContain('الدفعة المقدمة')
    expect(ar.content).toMatch(/^4\. المصروفات والرسوم الرسمية$/m)
  })

  it('validates the fee fields for each arrangement and formats money per currency', () => {
    expect(termsSchema.safeParse({ ...base, fixed_fee: null }).success).toBe(false)
    expect(termsSchema.safeParse({ ...base, fee_arrangement: 'capped' }).success).toBe(false)
    expect(termsSchema.safeParse({ ...base, fee_arrangement: 'hourly', fixed_fee: '' }).success).toBe(true)
    expect(fmtMoney(1234.5, 'AED')).toBe('AED 1,234.50')
    expect(fmtMoney(1234.5, 'KWD')).toBe('KWD 1,234.500')
    expect(defaultLaw('gcc', 'uae')).toBe('uae')
    expect(defaultLaw('ksa', 'uae')).toBe('ksa')
    expect(defaultLaw('gcc', 'gcc')).toBe('oman')
    expect(letterStatus(null)).toBe('draft')
    expect(letterStatus({ status: 'pending', expires_at: new Date(Date.now() - 1000) })).toBe('expired')
    expect(letterStatus({ status: 'completed', expires_at: new Date() })).toBe('signed')
  })
})

describe('engagement letters on a matter', () => {
  it('prepares a letter from the matter, updates its fee terms and tracks the signature', async () => {
    const { c } = await registered(ctx.app)
    const { data: { case: bare } } = await c.post('/api/cases', { title: 'No client yet', jurisdiction: 'oman' })
    expect((await c.post(`/api/engagements/case/${bare.id}`, { terms: base })).status).toBe(400)

    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company', email: 'gm@gulf.test' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Lease dispute', jurisdiction: 'uae', client_id: client.id, description: 'Landlord refuses to return the deposit.' })

    const first = await c.get(`/api/engagements/case/${k.id}`)
    expect(first.data).toMatchObject({ status: 'none', letters: [], defaults: { law: 'uae', fee_arrangement: 'hourly', payment_terms_days: 30 } })

    expect((await c.post(`/api/engagements/case/${k.id}`, { terms: { ...base, fixed_fee: null } })).status).toBe(400)
    const made = await c.post(`/api/engagements/case/${k.id}`, { language: 'en', terms: { ...base, currency: 'AED', law: 'uae' } })
    expect(made.status).toBe(201)
    expect(made.data.document).toMatchObject({ case_id: k.id, client_id: client.id, doc_type: 'contract' })
    expect(made.data.document.content).toContain('a fixed fee of AED 1,500.00')
    expect(made.data.document.content).toContain('Dear Gulf Trading LLC,')

    const kase = (await c.get(`/api/cases/${k.id}`)).data.case
    expect(kase.fee_arrangement).toBe('fixed')
    expect(Number(kase.fee_amount)).toBe(1500)

    let state = (await c.get(`/api/engagements/case/${k.id}`)).data
    expect(state.status).toBe('draft')
    expect(state.defaults).toMatchObject({ fixed_fee: 1500, currency: 'AED' })

    const sig = await c.post('/api/signatures', { document_id: made.data.document.id, signers: [{ name: 'Gulf Trading LLC', email: 'gm@gulf.test', client_id: client.id }], send_email: false })
    expect(sig.status).toBe(201)
    state = (await c.get(`/api/engagements/case/${k.id}`)).data
    expect(state.letters[0]).toMatchObject({ status: 'sent', signature_id: sig.data.id })
    await ctx.db.query(`UPDATE signature_requests SET status = 'completed', completed_at = now() WHERE id = $1`, [sig.data.id])
    expect((await c.get(`/api/engagements/case/${k.id}`)).data.status).toBe('signed')

    ctx.ai.nextReply = JSON.stringify({ scope: '1. Send a legal notice.\n2. File the claim.', exclusions: 'Appeals.' })
    const scope = await c.post(`/api/engagements/case/${k.id}/scope`, { language: 'en' })
    expect(scope.data).toEqual({ scope: '1. Send a legal notice.\n2. File the claim.', exclusions: 'Appeals.', verify_marks: 0 })

    // A law the library does not hold is marked, and a marked scope cannot go into a letter.
    ctx.ai.nextReply = JSON.stringify({ scope: 'Advise under Royal Decree 77/2099 on the deposit.', exclusions: '' })
    const marked = await c.post(`/api/engagements/case/${k.id}/scope`, { language: 'en' })
    expect(marked.data.verify_marks).toBe(1)
    expect(marked.data.scope).toMatch(/\[verify/)
    expect((await c.post(`/api/engagements/case/${k.id}`, { language: 'en', terms: { ...base, scope: marked.data.scope } })).status).toBe(400)
    expect(ctx.ai.calls.at(-1)![1]!.content).toContain('Landlord refuses to return the deposit.')

    const b = await registered(ctx.app)
    expect((await b.c.get(`/api/engagements/case/${k.id}`)).status).toBe(404)
    expect((await b.c.post(`/api/engagements/case/${k.id}`, { terms: base })).status).toBe(404)
  })
})
