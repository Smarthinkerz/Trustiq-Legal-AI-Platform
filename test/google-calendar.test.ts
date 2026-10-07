import { beforeAll, describe, expect, it } from 'vitest'
import { googleCredentials } from '../src/config'
import { open, seal } from '../src/lib/secret-box'
import { runCalendarSync } from '../src/services/google-calendar'
import { client, registered, setup } from './helpers'

// A fake Google: OAuth token endpoint plus an in-memory Calendar API.
function fakeGoogle() {
  const calendars = new Map<string, Map<string, any>>()
  const requests: { method: string; url: string; body?: any }[] = []
  let n = 0
  let refreshFails = false
  const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body
    requests.push({ method, url, body })
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body))
      if (p.get('client_secret') !== 'test-secret') return json(401, { error: 'invalid_client' })
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') === 'no-scope') return json(200, { access_token: 'at-0', refresh_token: 'rt-0', expires_in: 3600, scope: 'openid email' })
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: idToken('lawyer@gmail.test'), scope: 'openid email https://www.googleapis.com/auth/calendar.app.created' })
      }
      if (refreshFails) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      return json(200, { access_token: `at-${++n}`, expires_in: 3600 })
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('', { status: 200 })
    const m = url.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars(?:\/([^/]+))?(?:\/events(?:\/([^/]+))?)?$/)
    if (!m) return json(404, { error: { message: 'unknown' } })
    const calId = m[1] && decodeURIComponent(m[1])
    const evId = m[2] && decodeURIComponent(m[2])
    if (!calId && method === 'POST') { const id = `cal-${++n}`; calendars.set(id, new Map()); return json(200, { id, summary: body.summary }) }
    const cal = calId ? calendars.get(calId) : undefined
    if (!cal) return json(404, { error: { message: 'Not Found' } })
    if (!url.includes('/events')) {
      if (method === 'DELETE') { calendars.delete(calId!); return new Response(null, { status: 204 }) }
      return json(200, { id: calId })
    }
    if (method === 'POST') { const id = `ev-${++n}`; cal.set(id, body); return json(200, { id, ...body }) }
    if (!cal.has(evId!)) return json(410, { error: { message: 'Gone' } })
    if (method === 'PUT') { cal.set(evId!, body); return json(200, { id: evId, ...body }) }
    if (method === 'DELETE') { cal.delete(evId!); return new Response(null, { status: 204 }) }
    return json(200, cal.get(evId!))
  }) as typeof globalThis.fetch
  return { calendars, requests, fetch: fakeFetch, setRefreshFails: (v: boolean) => { refreshFails = v } }
}

const google = fakeGoogle()
let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' }, { googleFetch: google.fetch }) })

// Runs the consent round trip the way a browser would.
async function connect(c: ReturnType<typeof client>, code = 'good-code') {
  const start = await c.post('/api/integrations/google/connect')
  expect(start.status).toBe(200)
  const url = new URL(start.data.url)
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  expect(url.searchParams.get('scope')).toContain('calendar.app.created')
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/integrations/google/callback')
  const state = url.searchParams.get('state')!
  const stateCookie = start.res.headers.get('set-cookie')!.match(/tq_google_state=([^;]+)/)![1]
  const res = await ctx.app.request(`/api/integrations/google/callback?state=${state}&code=${code}`, { headers: { cookie: `${c.cookie}; tq_google_state=${stateCookie}` } })
  // Wait for the first sync the callback starts in the background.
  const userId = (await c.get('/api/auth/me')).data.user.id
  for (let i = 0; i < 200; i++) {
    const row = await ctx.db.one('SELECT sync_started_at, last_synced_at, last_error FROM calendar_connections WHERE user_id = $1', [userId])
    if (!row || (!row.sync_started_at && (row.last_synced_at || row.last_error))) break
    await new Promise((r) => setTimeout(r, 20))
  }
  return res
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString()

describe('secret box', () => {
  it('round-trips and rejects the wrong key or tampering', () => {
    const sealed = seal('refresh-token', 'k1')
    expect(sealed).not.toContain('refresh-token')
    expect(open(sealed, 'k1')).toBe('refresh-token')
    expect(open(sealed, 'k2')).toBeNull()
    expect(open(sealed.slice(0, -2) + 'AA', 'k1')).toBeNull()
  })
})

describe('Google credentials from the environment', () => {
  const id = '514012320000-abcdef0123456789.apps.googleusercontent.com'
  it('cleans up common pasting mistakes and reports what still looks wrong', () => {
    expect(googleCredentials(` "${id}" `, "'GOCSPX-secret'")).toEqual({ clientId: id, clientSecret: 'GOCSPX-secret', problems: [] })
    expect(googleCredentials('GOCSPX-secret', id)).toMatchObject({ clientId: id, clientSecret: 'GOCSPX-secret' })
    const json = JSON.stringify({ web: { client_id: id, client_secret: 'GOCSPX-x', redirect_uris: [] } })
    expect(googleCredentials(json, '')).toMatchObject({ clientId: id, clientSecret: 'GOCSPX-x', problems: [] })
    expect(googleCredentials('trustiqlegal-474512', 'GOCSPX-x')!.problems[0]).toContain('does not look like an OAuth client ID')
    expect(googleCredentials(id, '')).toBeUndefined()
    expect(googleCredentials(undefined, undefined)).toBeUndefined()
  })

  it('shows the client ID and redirect URI to admins only', async () => {
    const { c } = await registered(ctx.app)
    const r = (await c.get('/api/integrations/google')).data
    expect(r.setup).toEqual({ client_id: 'test-client', redirect_uri: 'http://localhost:8080/api/integrations/google/callback', problems: [expect.stringContaining('does not look like')] })
  })
})

describe('Google Calendar sync', () => {
  it('connects, creates its own calendar and mirrors events and tasks', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.get('/api/integrations/google')).data).toMatchObject({ configured: true, connected: false })
    const kase = await c.post('/api/cases', { title: 'Al Amal v. Gulf Trading', jurisdiction: 'oman', status: 'active', priority: 'high', currency: 'OMR' })
    const hearing = await c.post('/api/events', { title: 'First hearing', kind: 'hearing', starts_at: day(3), case_id: kase.data.case.id, location: 'Muscat Primary Court' })
    expect(hearing.status).toBe(201)
    const me = (await c.get('/api/auth/me')).data
    await c.post('/api/tasks', { title: 'File defence memo', due_date: day(2).slice(0, 10), assigned_to: me.user.id })

    const res = await connect(c)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/app#/settings?tab=profile&google=connected')
    await runCalendarSync({ db: ctx.db, config: ctx.config, log: ctx.log, fetch: google.fetch })

    const status = (await c.get('/api/integrations/google')).data
    expect(status.connection).toMatchObject({ account_email: 'lawyer@gmail.test', last_error: null, items: 2 })
    const cal = google.calendars.get(status.connection.calendar_id)!
    const titles = [...cal.values()].map((e) => e.summary).sort()
    expect(titles).toEqual([`⚖ First hearing (${kase.data.case.reference})`, '☑ File defence memo'].sort())
    const ev = [...cal.values()].find((e) => e.summary.startsWith('⚖'))
    expect(ev).toMatchObject({ location: 'Muscat Primary Court', colorId: '11' })
    expect(ev.description).toContain('Al Amal v. Gulf Trading')

    // Tokens are stored encrypted.
    const row = await ctx.db.one('SELECT refresh_token FROM calendar_connections WHERE account_email = $1 AND calendar_id = $2', ['lawyer@gmail.test', status.connection.calendar_id])
    expect(row!.refresh_token).not.toContain('rt-1')

    // Edits and deletions flow through; unchanged items are not re-sent.
    await c.patch(`/api/events/${hearing.data.event.id}`, { title: 'First hearing – adjourned' })
    const before = google.requests.length
    const sync = await c.post('/api/integrations/google/sync')
    expect(sync.data).toMatchObject({ created: 0, updated: 1, deleted: 0 })
    expect(google.requests.slice(before).filter((r) => r.method === 'PUT')).toHaveLength(1)
    expect([...cal.values()].map((e) => e.summary)).toContain(`⚖ First hearing – adjourned (${kase.data.case.reference})`)
    await c.del(`/api/events/${hearing.data.event.id}`)
    expect((await c.post('/api/integrations/google/sync')).data).toMatchObject({ deleted: 1 })
    expect(cal.size).toBe(1)

    // If the user deletes the calendar in Google, the next sync recreates it.
    google.calendars.delete(status.connection.calendar_id)
    expect((await c.post('/api/integrations/google/sync')).data).toMatchObject({ created: 1 })
    const again = (await c.get('/api/integrations/google')).data.connection
    expect(again.calendar_id).not.toBe(status.connection.calendar_id)

    // Disconnecting removes the calendar and the stored tokens.
    expect((await c.del('/api/integrations/google')).status).toBe(200)
    expect(google.calendars.has(again.calendar_id)).toBe(false)
    expect((await c.get('/api/integrations/google')).data.connected).toBe(false)
  })

  it('queues a sync when the firm calendar changes', async () => {
    const { c } = await registered(ctx.app)
    await connect(c)
    const userId = (await c.get('/api/auth/me')).data.user.id
    await ctx.db.query('UPDATE calendar_connections SET needs_sync = false, last_synced_at = now() WHERE user_id = $1', [userId])
    await c.post('/api/events', { title: 'Client meeting', starts_at: day(1) })
    expect((await ctx.db.one('SELECT needs_sync FROM calendar_connections WHERE user_id = $1', [userId]))!.needs_sync).toBe(true)
  })

  it('rejects a forged or missing state and a consent without calendar access', async () => {
    const { c } = await registered(ctx.app)
    await c.post('/api/integrations/google/connect')
    const forged = await ctx.app.request('/api/integrations/google/callback?state=forged&code=good-code', { headers: { cookie: `${c.cookie}; tq_google_state=other` } })
    expect(forged.headers.get('location')).toContain('google=expired')
    const noCookie = await ctx.app.request('/api/integrations/google/callback?state=x&code=good-code', { headers: { cookie: c.cookie } })
    expect(noCookie.headers.get('location')).toContain('google=expired')
    const scope = await connect(c, 'no-scope')
    expect(scope.headers.get('location')).toContain('google=scope')
    expect((await c.get('/api/integrations/google')).data.connected).toBe(false)
    // Not signed in.
    expect((await client(ctx.app).post('/api/integrations/google/connect')).status).toBe(401)
  })

  it('reports revoked access instead of retrying forever', async () => {
    const { c } = await registered(ctx.app)
    await connect(c)
    const userId = (await c.get('/api/auth/me')).data.user.id
    await ctx.db.query('UPDATE calendar_connections SET access_expires_at = now() - interval \'1 minute\' WHERE user_id = $1', [userId])
    google.setRefreshFails(true)
    try {
      const r = await c.post('/api/integrations/google/sync')
      expect(r.status).toBe(502)
      expect(r.data.error.message).toContain('Connect Google Calendar again')
      expect((await c.get('/api/integrations/google')).data.connection.last_error).toContain('revoked')
    } finally {
      google.setRefreshFails(false)
    }
  })

  it('says when Google is not configured', async () => {
    const plain = await setup()
    const { c } = await registered(plain.app)
    expect((await c.get('/api/integrations/google')).data).toMatchObject({ configured: false, connected: false })
    expect((await c.post('/api/integrations/google/connect')).status).toBe(503)
  })
})
