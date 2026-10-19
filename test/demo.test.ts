import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'
import { canonicalDemoCode, isReferralShaped, validateDemoCode } from '../src/services/hub-demo'
import { sweepDemoFirms } from '../src/services/demo'

// Invented test codes; real hire codes never appear in the repository.
const GOOD = 'DM-ABCD-EFGH-JKMN'
const OWNER = 'DM-PQRS-TUVW-XYZ2'
const SECRET = 'test-partner-secret'

// A fake SmarThinkerz Hub /api/demo/validate that checks the signature the way the Hub does.
function fakeHub() {
  const hub = {
    codes: new Map<string, { status: 'active' | 'revoked'; name: string | null; kind: 'trainee' | 'owner' }>([
      [GOOD, { status: 'active', name: 'Test Hire', kind: 'trainee' }],
      [OWNER, { status: 'active', name: null, kind: 'owner' }]
    ]),
    calls: [] as { app: string; body: any }[],
    down: false,
    killSwitch: false,
    async fetch(_url: string | URL | Request, init?: RequestInit) {
      if (hub.down) throw new Error('connect ECONNREFUSED')
      const h = new Headers(init?.headers)
      const body = String(init?.body ?? '')
      const ts = h.get('x-smarthinkerz-timestamp') ?? ''
      const expected = 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${body}`, 'utf8').digest('hex')
      if (h.get('x-smarthinkerz-signature') !== expected || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
        return Response.json({ error: 'signature does not match' }, { status: 401 })
      }
      const parsed = JSON.parse(body)
      hub.calls.push({ app: h.get('x-smarthinkerz-app')!, body: parsed })
      const row = hub.codes.get(String(parsed.code).trim().toUpperCase())
      if (!row) return Response.json({ valid: false, allowed: false, reason: 'unknown_code' })
      if (row.status !== 'active') return Response.json({ valid: false, allowed: false, reason: 'revoked', trainee: row.name ? { id: 1, name: row.name } : null })
      return Response.json({
        valid: true, allowed: !hub.killSwitch, reason: hub.killSwitch ? 'kill_switch' : null, kill_switch: hub.killSwitch,
        code_type: row.kind, trainee: row.name ? { id: 1, name: row.name } : null, app_allowed: true,
        limits: { daily_actions: 25, used_today: 0, remaining_today: 25, app_month_ceiling_usd: 50, app_month_spent_usd: 0 }
      })
    }
  }
  return hub
}

let ctx: Awaited<ReturnType<typeof setup>>
let hub: ReturnType<typeof fakeHub>
beforeAll(async () => {
  hub = fakeHub()
  ctx = await setup({ HUB_PARTNER_SECRET: SECRET, ENCRYPTION_KEY: 'test-encryption-key-demo', DEMO_RECHECK_SECONDS: '0', TRUST_PROXY: 'true', AI_PRICE_INPUT_PER_MTOK_USD: '2.5', AI_PRICE_OUTPUT_PER_MTOK_USD: '10' }, { hubFetch: hub.fetch as typeof fetch })
})

// A cookie jar that keeps every cookie (session and demo), with a fixed client address.
function browser(ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  const jar = new Map<string, string>()
  const request = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'x-forwarded-for': ip }
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const init: RequestInit = { method, headers }
    if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json' }
    const res = await ctx.app.request(path, init)
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const [k, ...v] = pair!.split('=')
      const value = v.join('=')
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) jar.delete(k!.trim())
      else jar.set(k!.trim(), value)
    }
    const data: any = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()
    return { status: res.status, data, res }
  }
  return { jar, get: (p: string) => request('GET', p), post: (p: string, b: unknown = {}) => request('POST', p, b), patch: (p: string, b: unknown) => request('PATCH', p, b), put: (p: string, b: unknown) => request('PUT', p, b), del: (p: string) => request('DELETE', p) }
}

async function demoSignIn(code = GOOD) {
  const b = browser()
  const r = await b.post('/api/demo/access', { code, locale: 'en' })
  return { b, r }
}

describe('Hub access code check (same scheme as Hala)', () => {
  it('signs the request with the partner secret and reads the hire name', async () => {
    const before = hub.calls.length
    const v = await validateDemoCode({ url: 'https://hub.test/api/demo/validate', appId: 'trustiq', secret: SECRET }, 'dm abcd efgh jkmn', hub.fetch as typeof fetch)
    expect(v).toEqual({ ok: true, hireName: 'Test Hire', codeType: 'trainee' })
    expect(hub.calls.at(-1)).toEqual({ app: 'trustiq', body: { code: GOOD, app_id: 'trustiq' } })
    const wrongSecret = await validateDemoCode({ url: 'x', appId: 'trustiq', secret: 'other' }, GOOD, hub.fetch as typeof fetch)
    expect(wrongSecret).toEqual({ ok: false, reason: 'validator_unavailable' })
    expect(hub.calls.length).toBe(before + 1)
  })

  it('never sends a referral code to the Hub, and reshapes typed codes', async () => {
    expect(isReferralShaped('MOH3X')).toBe(true)
    expect(isReferralShaped(GOOD)).toBe(false)
    expect(canonicalDemoCode('dmabcdefghjkmn')).toBe(GOOD)
    const before = hub.calls.length
    expect(await validateDemoCode({ url: 'x', appId: 'trustiq', secret: SECRET }, 'ALI3K', hub.fetch as typeof fetch)).toEqual({ ok: false, reason: 'referral_shaped' })
    expect(hub.calls.length).toBe(before)
  })
})

describe('signing in with an access code', () => {
  it('opens a seeded demo firm for the hire, without storing the code', async () => {
    const { b, r } = await demoSignIn()
    expect(r.status).toBe(201)
    expect(r.data.org).toMatchObject({ name: 'Sample Law Firm (Demo)', is_demo: true })
    expect(r.data.user.name).toBe('Test Hire (demo)')
    expect(r.data.demo).toMatchObject({ hire_name: 'Test Hire', ai_daily_cap_usd: 3 })
    expect(r.data.features).toMatchObject({ payments: false, email: false })
    expect(b.jar.has('tq_session') && b.jar.has('tq_demo')).toBe(true)
    expect(b.jar.get('tq_demo')).not.toContain('ABCD')

    expect((await b.get('/api/clients')).data.items).toHaveLength(6)
    expect((await b.get('/api/cases')).data.items).toHaveLength(6)
    const docs = (await b.get('/api/documents')).data.items
    expect(docs).toHaveLength(6)
    expect(docs.map((d: any) => d.language).sort()).toEqual(['ar', 'ar', 'ar', 'en', 'en', 'en'])
    expect((await b.get('/api/billing/invoices')).data.items.length).toBe(2)
    expect((await b.get('/api/clauses')).data.items.length).toBe(5)

    // The code is nowhere in the database or the session log.
    const dump = JSON.stringify(await ctx.db.query('SELECT * FROM demo_sessions')) + JSON.stringify(await ctx.db.query(`SELECT * FROM audit_log WHERE org_id = $1`, [r.data.org.id]))
    expect(dump).not.toContain('ABCD')
    expect(ctx.mails.some((m) => /demo\.trustiq\.invalid|example\.com/.test(m.to))).toBe(false)
  })

  it('refuses bad, revoked and paused codes with one message, then pauses after five failures', async () => {
    const b = browser('10.9.9.9')
    hub.codes.set('DM-REVO-KEDX-CODE', { status: 'revoked', name: 'Old Hire', kind: 'trainee' })
    const bad = await b.post('/api/demo/access', { code: 'DM-NOPE-NOPE-NOPE' })
    const revoked = await b.post('/api/demo/access', { code: 'DM-REVO-KEDX-CODE' })
    expect(bad.status).toBe(401)
    expect(revoked.data.error.message).toBe(bad.data.error.message)
    expect(bad.data.error.message).not.toMatch(/revoked|expired|unknown/i)
    for (let i = 0; i < 3; i++) await b.post('/api/demo/access', { code: 'DM-NOPE-NOPE-NOPE' })
    const paused = await b.post('/api/demo/access', { code: GOOD })
    expect(paused.status).toBe(429)
    // Another address is not affected.
    expect((await browser('10.9.9.10').post('/api/demo/access', { code: GOOD })).status).toBe(201)
  })

  it('fails closed with a friendly message when the Hub cannot be reached', async () => {
    hub.down = true
    const r = await browser().post('/api/demo/access', { code: GOOD })
    hub.down = false
    expect(r.status).toBe(503)
    expect(r.data.error.message).toMatch(/cannot check access codes right now/)
  })

  it('leaves normal sign-in alone', async () => {
    const { c } = await registered(ctx.app)
    const me = await c.get('/api/auth/me')
    expect(me.data.org.is_demo).toBe(false)
    expect(me.data.demo).toBeNull()
  })
})

describe('inside a demo firm', () => {
  it('cannot see or reach a real firm, and the database keeps demo and real apart', async () => {
    const real = await registered(ctx.app)
    const cl = await real.c.post('/api/clients', { name: 'Real Client For Isolation' })
    const { b, r } = await demoSignIn()
    expect(JSON.stringify((await b.get('/api/clients?q=Isolation')).data)).not.toContain('Real Client')
    expect((await b.get(`/api/clients/${cl.data.client.id}`)).status).toBe(404)
    expect(JSON.stringify((await real.c.get('/api/clients')).data)).not.toContain('Northwind')

    await expect(ctx.db.query('UPDATE organizations SET is_demo = true WHERE id = $1', [real.me.org.id])).rejects.toThrow()
    await expect(ctx.db.query(`INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1, 'x@demo.trustiq.invalid', 'X', 'x', 'lawyer')`, [real.me.org.id])).rejects.toThrow()
    await expect(ctx.db.query(`INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1, 'real@firm.test', 'X', 'x', 'lawyer')`, [r.data.org.id])).rejects.toThrow()
    await expect(ctx.db.query(`INSERT INTO demo_sessions (org_id, expires_at, ai_daily_cap_usd, price_in_per_mtok, price_out_per_mtok) VALUES ($1, now(), 1, 1, 1)`, [real.me.org.id])).rejects.toThrow()
  })

  it('refuses payments, invitations, account changes and anything leaving the app', async () => {
    const { b } = await demoSignIn()
    const inv = (await b.get('/api/billing/invoices')).data.items[0]
    const client = (await b.get('/api/clients')).data.items[0]
    const doc = (await b.get('/api/documents')).data.items[0]
    const refusals = [
      await b.post('/api/subscription/checkout', { plan: 'professional' }),
      await b.put('/api/billing/online-payments', { secret_key: 'sk_test_x' }),
      await b.post(`/api/billing/invoices/${inv.id}/pay-link`, {}),
      await b.post('/api/org/invites', { email: 'someone@firm.test', role: 'lawyer' }),
      await b.post('/api/org/api-keys', { name: 'x', access: 'read' }),
      await b.post(`/api/clients/${client.id}/portal-invite`, { email: 'c@firm.test' }),
      await b.patch('/api/auth/me', { email: 'takeover@firm.test' }),
      await b.post('/api/auth/change-password', { current_password: 'x', new_password: 'Str0ngPassw0rd1' }),
      await b.get(`/api/documents/${doc.id}/export?format=docx`)
    ]
    for (const r of refusals) {
      expect(r.status).toBe(403)
      expect(r.data.error.code).toBe('demo_blocked')
      expect(r.data.error.message).not.toMatch(/[–—]/)
    }
    expect((await b.patch('/api/auth/me', { locale: 'ar' })).status).toBe(200)
    // Ordinary work still works.
    expect((await b.post('/api/tasks', { title: 'Demo task from the hire' })).status).toBe(201)
  })

  it('caps AI per session per day and logs its cost, surviving a reset', async () => {
    const { b, r } = await demoSignIn()
    const draft = { template: 'nda', jurisdiction: 'oman', instructions: 'Mutual NDA between two invented companies for a logistics partnership.' }
    expect((await b.post('/api/ai/draft', draft)).status).toBe(201)
    const [s1] = await ctx.db.query('SELECT ai_requests, ai_cost_usd FROM demo_sessions WHERE org_id = $1', [r.data.org.id])
    expect(s1.ai_requests).toBeGreaterThan(0)
    expect(Number(s1.ai_cost_usd)).toBeGreaterThan(0)
    await ctx.db.query('UPDATE demo_sessions SET ai_day_cost_usd = ai_daily_cap_usd WHERE org_id = $1', [r.data.org.id])
    const capped = await b.post('/api/ai/draft', draft)
    expect(capped.status).toBe(429)
    expect(capped.data.error.code).toBe('demo_ai_cap')
    const reset = await b.post('/api/demo/reset')
    expect(reset.status).toBe(200)
    expect((await b.post('/api/ai/draft', draft)).status).toBe(429)
  })

  it('resets the sample data in a fresh firm and deletes the old one', async () => {
    const { b, r } = await demoSignIn()
    const first = (await b.get('/api/clients')).data.items[0]
    expect((await b.del(`/api/clients/${first.id}`)).status).toBe(200)
    expect((await b.get('/api/clients')).data.items).toHaveLength(5)
    const reset = await b.post('/api/demo/reset')
    expect(reset.status).toBe(200)
    expect(reset.data.org.id).not.toBe(r.data.org.id)
    expect((await b.get('/api/clients')).data.items).toHaveLength(6)
    expect(await ctx.db.query('SELECT 1 FROM organizations WHERE id = $1', [r.data.org.id])).toHaveLength(0)
    const [s] = await ctx.db.query('SELECT resets, org_id FROM demo_sessions WHERE org_id = $1', [reset.data.org.id])
    expect(s.resets).toBe(1)
  })

  it('ends at the next request once the Hub revokes the code, and keeps the session log', async () => {
    const code = 'DM-HJKM-NPQR-STUV'
    hub.codes.set(code, { status: 'active', name: 'Leaving Hire', kind: 'trainee' })
    const { b, r } = await demoSignIn(code)
    expect(r.status).toBe(201)
    await b.get('/api/cases')
    expect((await b.get('/api/clients')).status).toBe(200)
    hub.codes.get(code)!.status = 'revoked'
    const ended = await b.get('/api/clients')
    expect(ended.status).toBe(401)
    expect(ended.data.error.code).toBe('demo_ended')
    expect((await b.get('/api/clients')).status).toBe(401)
    const [s] = await ctx.db.query(`SELECT hire_name, end_reason, features_used, started_at FROM demo_sessions WHERE hire_name = 'Leaving Hire'`)
    expect(s).toMatchObject({ hire_name: 'Leaving Hire', end_reason: 'hub_revoked' })
    expect(s.features_used).toEqual(expect.arrayContaining(['cases', 'clients']))

    // The ended firm is cleaned up; the log stays.
    await ctx.db.query(`UPDATE organizations SET created_at = now() - interval '1 hour' WHERE id = $1`, [r.data.org.id])
    await sweepDemoFirms(ctx.db)
    expect(await ctx.db.query('SELECT 1 FROM organizations WHERE id = $1', [r.data.org.id])).toHaveLength(0)
    expect(await ctx.db.query(`SELECT 1 FROM demo_sessions WHERE hire_name = 'Leaving Hire'`)).toHaveLength(1)
  })

  it('a demo session without its code cookie ends', async () => {
    const { b } = await demoSignIn()
    b.jar.delete('tq_demo')
    expect((await b.get('/api/clients')).data.error.code).toBe('demo_ended')
  })
})
