import { beforeAll, describe, expect, it } from 'vitest'
import { gaps, summarize, type OnboardingRow } from '../src/services/onboarding'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const KYC = {
  identity_verified: true, identity_method: 'in_person', nationality: 'Omani', residence_country: 'Oman', occupation: 'Trading',
  purpose: 'Commercial lease dispute', source_of_funds: 'Company revenue', sanctions_checked_on: new Date().toISOString().slice(0, 10), sanctions_lists: 'UN',
  beneficial_owners: [{ name: 'Ahmed Al Balushi', nationality: 'Omani', ownership_pct: 100 }]
}
const TERMS = { scope: '1. Advise on the lease and send a legal notice.', fee_arrangement: 'fixed', currency: 'OMR', fixed_fee: 900, law: 'oman' }

const row = (checks: OnboardingRow['checks']) => ({ checks } as OnboardingRow)

describe('onboarding rules', () => {
  it('counts only the required checks and accepts overrides, fallbacks and expiring powers of attorney', () => {
    const all = ['conflict', 'kyc', 'poa', 'engagement']
    expect(gaps(row({ conflict: 'override', kyc: 'approved', poa: 'expiring', engagement: 'signed' }), all)).toEqual([])
    expect(gaps(row({ conflict: 'missing', kyc: 'review_due', poa: 'expired', engagement: 'sent' }), all)).toEqual(all)
    expect(gaps(row({ conflict: 'clear', kyc: 'no_client', poa: 'no_client', engagement: 'no_client' }), ['conflict', 'engagement'])).toEqual(['engagement'])
    expect(summarize([row({ conflict: 'clear', kyc: 'approved', poa: 'missing', engagement: 'none' })], ['conflict', 'kyc']))
      .toEqual({ total: 1, ready: 1, not_ready: 0, conflict: 0, kyc: 0, poa: 0, engagement: 0 })
  })
})

describe('matter onboarding register', () => {
  it('tracks every check per open matter, exports CSV, and follows the firm settings', async () => {
    const { c, me } = await registered(ctx.app)
    const { data: { client: cl } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company', email: 'gm@gulf.test' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Lease dispute', jurisdiction: 'oman', client_id: cl.id })
    const { data: { case: noClient } } = await c.post('/api/cases', { title: 'Internal research', jurisdiction: 'oman' })
    await c.post('/api/cases', { title: 'Finished matter', jurisdiction: 'oman', client_id: cl.id, status: 'closed' })
    // A matter imported without a conflict check.
    await ctx.db.query(`INSERT INTO cases (org_id, reference, title, jurisdiction, client_id) VALUES ($1, 'IMP-1', 'Imported', 'oman', $2)`, [me.org.id, cl.id])

    let r = (await c.get('/api/onboarding')).data
    expect(r.required).toEqual(['conflict', 'kyc', 'poa', 'engagement'])
    expect(r.items).toHaveLength(3)
    const lease = () => r.items.find((x: any) => x.id === k.id)
    expect(lease().checks).toEqual({ conflict: 'clear', kyc: 'not_started', poa: 'missing', engagement: 'none' })
    expect(lease().gaps).toEqual(['kyc', 'poa', 'engagement'])
    expect(r.items.find((x: any) => x.id === noClient.id).checks).toMatchObject({ kyc: 'no_client', poa: 'no_client', engagement: 'no_client' })
    expect(r.items.find((x: any) => x.reference === 'IMP-1').checks.conflict).toBe('missing')
    expect(r.summary).toMatchObject({ total: 3, ready: 0, not_ready: 3 })
    expect((await c.get('/api/dashboard')).data.counts.onboarding_gaps).toBe(3)

    // Clear every check for the lease matter.
    await c.put(`/api/kyc/client/${cl.id}`, KYC)
    expect((await c.post(`/api/kyc/client/${cl.id}/decision`, { decision: 'approved' })).status).toBe(200)
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    expect((await c.post('/api/credentials', { client_id: cl.id, kind: 'power_of_attorney', number: 'POA-1', expires_on: soon, all_cases: false, case_ids: [k.id] })).status).toBe(201)
    const letter = await c.post(`/api/engagements/case/${k.id}`, { terms: TERMS })
    const sig = await c.post('/api/signatures', { document_id: letter.data.document.id, signers: [{ name: 'Gulf Trading LLC', email: 'gm@gulf.test' }], send_email: false })
    r = (await c.get('/api/onboarding')).data
    expect(lease().checks).toEqual({ conflict: 'clear', kyc: 'approved', poa: 'expiring', engagement: 'sent' })
    await ctx.db.query(`UPDATE signature_requests SET status = 'completed', completed_at = now() WHERE id = $1`, [sig.data.id])
    r = (await c.get('/api/onboarding')).data
    expect(lease().gaps).toEqual([])
    expect(lease().poa_expires_on).toBe(soon)
    expect(r.summary).toMatchObject({ ready: 1, not_ready: 2 })
    expect((await c.get('/api/onboarding?show=not_ready')).data.items.map((x: any) => x.id)).not.toContain(k.id)

    const csv = await c.get('/api/onboarding?format=csv')
    expect(csv.status).toBe(200)
    expect(String(csv.data)).toContain('Reference,Matter,Client')
    expect(String(csv.data)).toMatch(/Lease dispute,Gulf Trading LLC.*,clear,approved,expiring,.*,signed,yes,/)

    // A firm that only requires the conflict check.
    expect((await c.put('/api/onboarding/settings', { required: ['conflict', 'conflict'] })).data.required).toEqual(['conflict'])
    r = (await c.get('/api/onboarding')).data
    expect(r.summary).toMatchObject({ ready: 2, not_ready: 1, conflict: 1 })
    expect((await c.get('/api/dashboard')).data.counts.onboarding_gaps).toBe(1)
    expect((await c.put('/api/onboarding/settings', { required: ['nonsense'] })).status).toBe(400)

    // Other firms see nothing; lawyers read but cannot change the settings.
    const other = await registered(ctx.app)
    expect((await other.c.get('/api/onboarding')).data.items).toEqual([])
    const invite = await c.post('/api/org/invites', { email: `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const lawyer = client(ctx.app)
    expect((await lawyer.post('/api/auth/accept-invite', { token, name: 'Lawyer Person', password: 'Str0ngPassw0rd' })).status).toBe(201)
    expect((await lawyer.get('/api/onboarding')).status).toBe(200)
    expect((await lawyer.put('/api/onboarding/settings', { required: [] })).status).toBe(403)
  })
})
