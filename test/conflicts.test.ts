import { beforeAll, describe, expect, it } from 'vitest'
import { nameScore, nameTokens, splitParties } from '../src/services/conflicts'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('name matching', () => {
  it('matches Arabic and English spellings, honorifics and company suffixes', () => {
    const same: [string, string][] = [
      ['Mohammed Al-Balushi', 'محمد البلوشي'], ['Muhammad Balushi LLC', 'Mohammed Al Balushi'], ['Fatima Al Hinai', 'فاطمة الهنائية'],
      ['Abdullah Al Harthy', 'عبدالله الحارثي'], ['Yousef Al Lawati', 'يوسف اللواتي'], ['Khalid bin Saeed Al Shukaili', 'خالد بن سعيد الشكيلي'],
      ['Al Noor Trading LLC', 'Noor Trading'], ['Sultan Qaboos', 'سلطان قابوس'], ['Ahmed Al Rawahi', 'Ahmad Rawahi'], ['Aisha Al Kindi', 'عائشة الكندي']
    ]
    for (const [a, b] of same) expect(nameScore(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(0.75)
    const different: [string, string][] = [['Mohammed Al Balushi', 'Mohammed Al Harthy'], ['Oman Oil Company SAOG', 'Gulf Petroleum'], ['Ali', 'Ali Mohammed Al Balushi']]
    for (const [a, b] of different) expect(nameScore(a, b), `${a} !~ ${b}`).toBeLessThan(0.75)
    expect(nameTokens('Shaikh Ahmed bin Ali Al-Rawahi LLC')).toEqual(['hmd', 'l', 'rh'])
    expect(splitParties('Gulf Bank SAOG, Ahmed Al Rawahi and شركة النور و محمد البلوشي')).toEqual(['Gulf Bank SAOG', 'Ahmed Al Rawahi', 'شركة النور', 'محمد البلوشي'])
  })
})

describe('intake conflict checks', () => {
  it('blocks conflicting clients and cases until a partner overrides with a reason', async () => {
    const owner = await registered(ctx.app)
    const c = owner.c
    const ours = await c.post('/api/clients', { name: 'Gulf Trading Co', name_ar: 'شركة الخليج للتجارة', kind: 'company', id_number: 'CR 1234567' })
    expect(ours.status).toBe(201)
    expect(ours.data.conflict_check.decision).toBe('clear')
    const k = await c.post('/api/cases', { title: 'Debt recovery', jurisdiction: 'oman', client_id: ours.data.client.id, opposing_party: 'Mohammed Al-Balushi, Noor Est.' })
    expect(k.status).toBe(201)

    // The live check finds the opposing party in Arabic, and a duplicate by CR number.
    const check = await c.get(`/api/workspace/conflicts?name=${encodeURIComponent('محمد البلوشي')}&id_number=1234567`)
    expect(check.data.conflict).toBe(true)
    expect(check.data.cases[0]).toMatchObject({ reference: k.data.case.reference, matched_party: 'Mohammed Al-Balushi' })
    expect(check.data.clients[0]).toMatchObject({ name: 'Gulf Trading Co', reason: 'id_number' })

    // New client who is an opposing party: blocked, then overridden by the owner.
    const blocked = await c.post('/api/clients', { name: 'Muhammad Balushi' })
    expect(blocked.status).toBe(409)
    expect(blocked.data.error.code).toBe('conflict_of_interest')
    expect(blocked.data.error.details).toMatchObject({ can_override: true, conflicts: [{ type: 'client_is_opposing', reference: k.data.case.reference }] })
    expect((await c.post('/api/clients', { name: 'Muhammad Balushi', conflict_override: { reason: 'no' } })).status).toBe(400)
    const allowed = await c.post('/api/clients', { name: 'Muhammad Balushi', conflict_override: { reason: 'Different person: other CR and father name, checked by partner.' } })
    expect(allowed.status).toBe(201)
    expect(allowed.data.conflict_check.decision).toBe('override')

    // New case against one of our own clients: blocked (Arabic spelling of the client).
    const against = await c.post('/api/cases', { title: 'Claim', jurisdiction: 'oman', opposing_party: 'الخليج للتجارة' })
    expect(against.status).toBe(409)
    expect(against.data.error.details.conflicts[0]).toMatchObject({ type: 'opposing_is_client', label: 'Gulf Trading Co' })
    // The same client may of course be on our side of a new case.
    expect((await c.post('/api/cases', { title: 'Second matter', jurisdiction: 'oman', client_id: ours.data.client.id, opposing_party: 'Someone Else' })).status).toBe(201)

    // Editing the opposing party re-checks.
    const other = await c.post('/api/cases', { title: 'Lease', jurisdiction: 'oman', opposing_party: 'Landlord' })
    expect((await c.patch(`/api/cases/${other.data.case.id}`, { opposing_party: 'Gulf Trading Company' })).status).toBe(409)
    expect((await c.patch(`/api/cases/${other.data.case.id}`, { title: 'Lease renamed' })).status).toBe(200)

    // A lawyer cannot override; a partner must.
    const invite = await c.post('/api/org/invites', { email: `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const lawyer = client(ctx.app)
    await lawyer.post('/api/auth/accept-invite', { token: new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!, name: 'Lawyer', password: 'Str0ngPassw0rd' })
    const lb = await lawyer.post('/api/clients', { name: 'محمد البلوشي', conflict_override: { reason: 'I think it is fine to proceed' } })
    expect(lb.status).toBe(409)
    expect(lb.data.error.details.can_override).toBe(false)

    const log = await c.get('/api/workspace/conflicts/log')
    expect(log.data.items.some((i: any) => i.decision === 'override' && i.reason.startsWith('Different person'))).toBe(true)
    expect((await lawyer.get('/api/workspace/conflicts/log')).status).toBe(403)
    const opp = await c.get(`/api/workspace/conflicts/opposing?opposing=${encodeURIComponent('Gulf Trading LLC and Others')}`)
    expect(opp.data.conflict).toBe(true)
  })
})
