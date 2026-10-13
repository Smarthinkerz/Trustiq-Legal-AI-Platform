import { beforeAll, describe, expect, it } from 'vitest'
import { nextReview, riskScore } from '../src/services/kyc'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const base = { pep: false, high_risk_country: false, cash_involved: false, complex_structure: false, non_face_to_face: false, sanctions_match: false, source_of_funds: 'Salary', beneficial_owners: [] }
const COMPLETE = {
  identity_verified: true, identity_method: 'in_person', nationality: 'Omani', residence_country: 'Oman', occupation: 'Trading',
  purpose: 'Commercial lease dispute', source_of_funds: 'Company revenue', sanctions_checked_on: '2026-10-12', sanctions_lists: 'UN, UAE local list, OFAC',
  beneficial_owners: [{ name: 'Ahmed Al Balushi', nationality: 'Omani', ownership_pct: 60 }, { name: 'Salma Al Hinai', nationality: 'Omani', ownership_pct: 40 }]
}

describe('KYC risk scoring', () => {
  it('scores the recognised risk factors', () => {
    expect(riskScore(base, 'individual')).toMatchObject({ score: 0, level: 'low' })
    expect(riskScore({ ...base, source_of_funds: '' }, 'company')).toMatchObject({ score: 3, level: 'medium', factors: [{ factor: 'no_beneficial_owners', points: 2 }, { factor: 'no_source_of_funds', points: 1 }] })
    expect(riskScore({ ...base, beneficial_owners: [{ name: 'X', pep: true }] }, 'company').level).toBe('medium')
    expect(riskScore({ ...base, pep: true, cash_involved: true }, 'individual')).toMatchObject({ score: 5, level: 'high' })
    expect(riskScore({ ...base, sanctions_match: true }, 'individual').level).toBe('high')
    expect([nextReview('2026-10-13', 'high'), nextReview('2026-10-13', 'medium'), nextReview('2026-10-13', 'low')]).toEqual(['2027-10-13', '2028-10-13', '2029-10-13'])
  })
})

describe('client due diligence', () => {
  it('records due diligence, blocks approval until complete and reopens on change', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company' })
    const made = await c.post('/api/cases', { title: 'Lease dispute', client_id: client.id, jurisdiction: 'oman' })
    expect(made.status, JSON.stringify(made.data)).toBe(201)
    expect((await c.get(`/api/kyc/client/${client.id}`)).data).toMatchObject({ status: 'not_started', kyc: null, risk: { effective: 'medium' } })
    expect((await c.get('/api/dashboard')).data.counts.kyc_attention).toBe(1)
    expect((await c.get('/api/clients')).data.items[0]).toMatchObject({ kyc_status: 'not_started', kyc_risk: null })

    // Incomplete: approval is refused with the reason.
    await c.put(`/api/kyc/client/${client.id}`, { identity_verified: true, source_of_funds: 'Revenue' })
    const refused = await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved' })
    expect(refused.status).toBe(422)
    expect(refused.data.error).toMatchObject({ code: 'kyc_incomplete', message: 'Record the sanctions screening first.' })

    const saved = await c.put(`/api/kyc/client/${client.id}`, COMPLETE)
    expect(saved.data).toMatchObject({ status: 'in_progress', blockers: [], risk: { score: 0, level: 'low', effective: 'low' } })
    const approved = await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved', note: 'Standard CDD complete' })
    expect(approved.data.status).toBe('approved')
    expect(approved.data.kyc).toMatchObject({ decision_note: 'Standard CDD complete', decided_by_name: expect.any(String) })
    expect(approved.data.kyc.next_review_on).toMatch(/^20(29|30)-/)
    expect((await c.get('/api/dashboard')).data.counts.kyc_attention).toBe(0)

    // A material change reopens the file; a PEP owner raises the risk to high, which needs a written reason.
    const changed = await c.put(`/api/kyc/client/${client.id}`, { ...COMPLETE, cash_involved: true, beneficial_owners: [{ name: 'Ahmed Al Balushi', ownership_pct: 100, pep: true }] })
    expect(changed.data).toMatchObject({ status: 'in_progress', risk: { score: 5, level: 'high' }, kyc: { decided_at: null } })
    expect((await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved' })).status).toBe(400)
    const edd = await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved', note: 'EDD: source of wealth verified from audited accounts' })
    expect(edd.data.kyc.next_review_on).toMatch(/^202(7|8)-/)

    // Overrides need a reason; a sanctions match cannot be approved.
    expect((await c.put(`/api/kyc/client/${client.id}`, { ...COMPLETE, risk_override: 'low' })).status).toBe(400)
    const over = await c.put(`/api/kyc/client/${client.id}`, { ...COMPLETE, sanctions_match: true, risk_override: 'medium', override_reason: 'Name match only' })
    expect(over.data.risk).toMatchObject({ level: 'high', effective: 'medium' })
    expect((await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved', note: 'x' })).data.error.message).toContain('sanctions match')
    expect((await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'rejected', note: 'Possible sanctions match' })).data.status).toBe('rejected')
  })

  it('flags reviews that have fallen due and exports the register', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Fatma Al Balushi' })
    await c.put(`/api/kyc/client/${client.id}`, { ...COMPLETE, beneficial_owners: [] })
    await c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved' })
    await ctx.db.query(`UPDATE client_kyc SET next_review_on = '2026-01-01' WHERE client_id = $1`, [client.id])
    expect((await c.get(`/api/kyc/client/${client.id}`)).data.status).toBe('review_due')
    await c.post('/api/clients', { name: 'Zayed Holdings', kind: 'company' })

    const reg = (await c.get('/api/kyc/register')).data
    expect(reg.summary).toMatchObject({ total: 2, review_due: 1, not_started: 1 })
    expect(reg.items.map((r: any) => [r.name, r.status, r.risk])).toEqual([['Fatma Al Balushi', 'review_due', 'low'], ['Zayed Holdings', 'not_started', null]])
    const csv = await ctx.app.request('/api/kyc/register?format=csv', { headers: { cookie: c.cookie } })
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text).toContain('Client,Type,Open cases,KYC status')
    expect(text).toContain('Fatma Al Balushi,individual,0,review_due,low')
  })

  it('limits decisions to partners and keeps firms apart', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    const { data: { client } } = await a.c.post('/api/clients', { name: 'Private Client' })
    expect((await b.c.get(`/api/kyc/client/${client.id}`)).status).toBe(404)
    expect((await b.c.put(`/api/kyc/client/${client.id}`, COMPLETE)).status).toBe(404)
    expect((await b.c.get('/api/kyc/register')).data.items).toEqual([])
    expect((await a.c.post(`/api/kyc/client/${client.id}/decision`, { decision: 'approved' })).data.error.message).toBe('Fill in the due diligence first.')
  })
})
