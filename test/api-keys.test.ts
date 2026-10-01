import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

// Calls the public API with a bearer key (no cookies).
function withKey(key: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` }
    const init: RequestInit = { method, headers }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json' }
    const res = await ctx.app.request(`/api/v1${path}`, init)
    const data: any = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()
    return { status: res.status, data, res }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}) => call('POST', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p)
  }
}

describe('public API keys', () => {
  it('owners create keys that read and write firm data, shown once and stored hashed', async () => {
    const { c, me } = await registered(ctx.app)
    const created = await c.post('/api/org/api-keys', { name: 'Accounting sync', access: 'read_write', expires_in_days: 365 })
    expect(created.status).toBe(201)
    const key: string = created.data.key
    expect(key).toMatch(/^tq_live_[A-Za-z0-9_-]{40,}$/)
    const [row] = await ctx.db.query('SELECT key_hash, prefix FROM api_keys WHERE id = $1', [created.data.api_key.id])
    expect(row.key_hash).not.toContain(key)
    expect(key.startsWith(row.prefix)).toBe(true)
    const list = await c.get('/api/org/api-keys')
    expect(JSON.stringify(list.data)).not.toContain(key)

    const api = withKey(key)
    const who = await api.get('/me')
    expect(who.status).toBe(200)
    expect(who.data.organization.id).toBe(me.org.id)
    expect(who.data.api_key.access).toBe('read_write')

    const cl = await api.post('/clients', { kind: 'company', name: 'API Client LLC' })
    expect(cl.status).toBe(201)
    const k = await api.post('/cases', { title: 'Created over the API', jurisdiction: 'oman', client_id: cl.data.client.id })
    expect(k.status).toBe(201)
    const t = await api.post('/billing/time', { case_id: k.data.case.id, minutes: 30, description: 'Call with client' })
    expect(t.status).toBe(201)
    const form = new FormData()
    form.set('file', new File(['Engagement letter text for the client.'], 'letter.txt', { type: 'text/plain' }))
    form.set('case_id', k.data.case.id)
    const up = await api.post('/documents/upload', form)
    expect(up.status).toBe(201)

    const cases = await api.get('/cases?q=API')
    expect(cases.data.items.map((x: any) => x.title)).toEqual(['Created over the API'])
    // The same records are visible in the app, and the audit log names the key.
    expect((await c.get('/api/clients?q=API')).data.total).toBe(1)
    const [log] = await ctx.db.query(`SELECT meta FROM audit_log WHERE action = 'client.created' AND entity_id = $1`, [cl.data.client.id])
    expect(log.meta.via_api_key.name).toBe('Accounting sync')
    const [used] = await ctx.db.query('SELECT last_used_at FROM api_keys WHERE id = $1', [created.data.api_key.id])
    expect(used.last_used_at).toBeTruthy()
  })

  it('read-only keys cannot change data, and revoked or bad keys are rejected', async () => {
    const { c } = await registered(ctx.app)
    const ro = (await c.post('/api/org/api-keys', { name: 'Reporting', access: 'read' })).data
    const api = withKey(ro.key)
    expect((await api.get('/clients')).status).toBe(200)
    const denied = await api.post('/clients', { name: 'Should fail' })
    expect(denied.status).toBe(403)
    expect(denied.data.error.message).toMatch(/read-only/)

    expect((await c.del(`/api/org/api-keys/${ro.api_key.id}`)).status).toBe(200)
    const revoked = await api.get('/clients')
    expect(revoked.status).toBe(401)
    expect(revoked.res.headers.get('www-authenticate')).toContain('Bearer')
    expect((await withKey('tq_live_' + 'x'.repeat(43)).get('/clients')).status).toBe(401)
    expect((await ctx.app.request('/api/v1/clients')).status).toBe(401)
  })

  it('keys are scoped to their own firm and never use browser cookies', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    const secret = await a.c.post('/api/clients', { name: 'Firm A secret client' })
    const bKey = (await b.c.post('/api/org/api-keys', { name: 'B key', access: 'read_write' })).data.key
    const api = withKey(bKey)
    expect((await api.get('/clients')).data.total).toBe(0)
    expect((await api.get(`/clients/${secret.data.client.id}`)).status).toBe(404)
    expect((await api.patch(`/clients/${secret.data.client.id}`, { name: 'Hijacked' })).status).toBe(404)
    // A signed-in browser session is not accepted on /api/v1.
    expect((await a.c.get('/api/v1/clients')).status).toBe(401)
    // API keys cannot reach the in-app API (e.g. to mint more keys).
    const res = await ctx.app.request('/api/org/api-keys', { headers: { authorization: `Bearer ${bKey}` } })
    expect(res.status).toBe(401)
  })

  it('only owners and admins manage keys; keys stop working when their creator is removed', async () => {
    const { c } = await registered(ctx.app)
    const invite = await c.post('/api/org/invites', { email: `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const lawyer = client(ctx.app)
    const acc = await lawyer.post('/api/auth/accept-invite', { token, name: 'Lawyer Person', password: 'Str0ngPassw0rd' })
    expect(acc.status).toBe(201)
    expect((await lawyer.post('/api/org/api-keys', { name: 'Mine' })).status).toBe(403)
    expect((await lawyer.get('/api/org/api-keys')).status).toBe(403)

    // An admin's key dies with the admin's membership.
    await c.patch(`/api/org/members/${acc.data.user.id}`, { role: 'admin' })
    const adminKey = (await lawyer.post('/api/org/api-keys', { name: 'Admin key' })).data.key
    expect((await withKey(adminKey).get('/clients')).status).toBe(200)
    expect((await c.del(`/api/org/members/${acc.data.user.id}`)).status).toBe(200)
    expect((await withKey(adminKey).get('/clients')).status).toBe(401)
  })

  it('serves the developer documentation', async () => {
    const res = await ctx.app.request('/developers')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Authorization: Bearer')
    expect(body).toContain('/documents/upload')
  })
})
