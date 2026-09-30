import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('registration and login', () => {
  it('registers a firm with an owner, trial plan and session cookie', async () => {
    const { c, me } = await registered(ctx.app)
    expect(me.user.role).toBe('owner')
    expect(me.org.plan).toBe('trial')
    expect(new Date(me.org.trial_ends_at).getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000)
    expect(c.cookie).toMatch(/^tq_session=/)
    const r = await c.get('/api/auth/me')
    expect(r.status).toBe(200)
    expect(r.data.user.email).toBe(me.user.email)
  })

  it('never stores plaintext passwords', async () => {
    const { email } = await registered(ctx.app)
    const row = await ctx.db.one('SELECT password_hash FROM users WHERE lower(email) = $1', [email])
    expect(row!.password_hash).toMatch(/^\$2[aby]\$12\$/)
  })

  it('rejects weak passwords, duplicate emails and missing terms acceptance', async () => {
    const c = client(ctx.app)
    const weak = await c.post('/api/auth/register', { name: 'A B', email: 'weak@x.test', password: 'short', firm_name: 'Firm', accept_terms: true })
    expect(weak.status).toBe(400)
    const noTerms = await c.post('/api/auth/register', { name: 'A B', email: 'nt@x.test', password: 'Str0ngPassw0rd', firm_name: 'Firm' })
    expect(noTerms.status).toBe(400)
    const { email } = await registered(ctx.app)
    const dup = await c.post('/api/auth/register', { name: 'A B', email: email.toUpperCase(), password: 'Str0ngPassw0rd', firm_name: 'Firm', accept_terms: true })
    expect(dup.status).toBe(409)
  })

  it('logs in with correct credentials and rejects wrong ones generically', async () => {
    const { email } = await registered(ctx.app)
    const c = client(ctx.app)
    const bad = await c.post('/api/auth/login', { email, password: 'wrong-password1' })
    expect(bad.status).toBe(401)
    const unknown = await c.post('/api/auth/login', { email: 'nobody@x.test', password: 'wrong-password1' })
    expect(unknown.status).toBe(401)
    expect(unknown.data.error.message).toBe(bad.data.error.message)
    const ok = await c.post('/api/auth/login', { email, password: 'Str0ngPassw0rd' })
    expect(ok.status).toBe(200)
    expect((await c.get('/api/dashboard')).status).toBe(200)
  })

  it('locks the account after repeated failures', async () => {
    const { email } = await registered(ctx.app)
    const c = client(ctx.app)
    for (let i = 0; i < 8; i++) await c.post('/api/auth/login', { email, password: 'wrong-password1' })
    const locked = await c.post('/api/auth/login', { email, password: 'Str0ngPassw0rd' })
    expect(locked.status).toBe(423)
  })

  it('logout revokes the session server-side', async () => {
    const { c } = await registered(ctx.app)
    const cookie = c.cookie
    await c.post('/api/auth/logout')
    const r = await ctx.app.request('/api/auth/me', { headers: { cookie } })
    expect(r.status).toBe(401)
  })

  it('rejects forged or legacy base64 tokens', async () => {
    const forged = Buffer.from(JSON.stringify({ userId: 1, exp: 9999999999 })).toString('base64')
    for (const headers of [{ cookie: `tq_session=${forged}` }, { authorization: `Bearer ${forged}` }] as Record<string, string>[]) {
      const r = await ctx.app.request('/api/cases', { headers })
      expect(r.status).toBe(401)
    }
  })
})

describe('password reset', () => {
  it('emails a single-use link, resets the password and signs out other sessions', async () => {
    const { c, email } = await registered(ctx.app)
    const anon = client(ctx.app)
    expect((await anon.post('/api/auth/forgot-password', { email })).status).toBe(200)
    expect((await anon.post('/api/auth/forgot-password', { email: 'ghost@x.test' })).status).toBe(200)
    const mail = ctx.mails.filter((m) => m.to === email).pop()!
    const token = mail.text.match(/token=([\w-]+)/)![1]
    expect((await anon.post('/api/auth/reset-password', { token, password: 'N3wPassword!!' })).status).toBe(200)
    expect((await anon.post('/api/auth/reset-password', { token, password: 'An0therPass!!' })).status).toBe(400)
    expect((await c.get('/api/auth/me')).status).toBe(401)
    expect((await anon.post('/api/auth/login', { email, password: 'N3wPassword!!' })).status).toBe(200)
  })

  it('change-password requires the current password', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.post('/api/auth/change-password', { current_password: 'nope', new_password: 'N3wPassword!!' })).status).toBe(400)
    expect((await c.post('/api/auth/change-password', { current_password: 'Str0ngPassw0rd', new_password: 'N3wPassword!!' })).status).toBe(200)
  })
})

describe('team invitations and roles', () => {
  it('owner invites a lawyer who joins the same organization', async () => {
    const { c, me } = await registered(ctx.app)
    const inv = await c.post('/api/org/invites', { email: 'new.lawyer@firm.test', role: 'lawyer' })
    expect(inv.status).toBe(201)
    expect(inv.data.emailed).toBe(true)
    const token = new URL(inv.data.invite_url.replace('#/', '')).searchParams.get('token')!
    const anon = client(ctx.app)
    const info = await anon.get(`/api/auth/invite/${token}`)
    expect(info.data.org_name).toBe(me.org.name)
    const joined = await anon.post('/api/auth/accept-invite', { token, name: 'New Lawyer', password: 'Str0ngPassw0rd' })
    expect(joined.status).toBe(201)
    expect(joined.data.user.role).toBe('lawyer')
    expect(joined.data.org.id).toBe(me.org.id)
    // Lawyers cannot manage the team.
    expect((await anon.post('/api/org/invites', { email: 'x@firm.test', role: 'staff' })).status).toBe(403)
    // Invitations are single-use.
    expect((await client(ctx.app).post('/api/auth/accept-invite', { token, name: 'Again', password: 'Str0ngPassw0rd' })).status).toBe(400)
  })

  it('keeps at least one owner and deactivated members lose access', async () => {
    const { c, me } = await registered(ctx.app)
    expect((await c.patch(`/api/org/members/${me.user.id}`, { role: 'admin' })).status).toBe(400)
    const inv = await c.post('/api/org/invites', { email: `staff-${Date.now()}@firm.test`, role: 'staff' })
    const token = new URL(inv.data.invite_url.replace('#/', '')).searchParams.get('token')!
    const staff = client(ctx.app)
    const joined = await staff.post('/api/auth/accept-invite', { token, name: 'Staff Member', password: 'Str0ngPassw0rd' })
    expect((await staff.get('/api/cases')).status).toBe(200)
    expect((await c.del(`/api/org/members/${joined.data.user.id}`)).status).toBe(200)
    expect((await staff.get('/api/cases')).status).toBe(401)
  })
})
