import { beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { createLogger } from '../src/lib/logger'
import { createAiService } from '../src/services/ai'
import { normalizeAnalysis } from '../src/services/legal-prompts'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('AI assistant', () => {
  it('persists conversations and includes case context and history', async () => {
    const { c } = await registered(ctx.app)
    const k = await c.post('/api/cases', { title: 'Wrongful termination – Hamdan', jurisdiction: 'oman', description: 'Employee dismissed without notice.' })
    ctx.ai.nextReply = 'Under the Omani Labour Law... Verify: notice period.'
    const first = await c.post('/api/ai/chat', { message: 'What remedies are available?', case_id: k.data.case.id })
    expect(first.status).toBe(200)
    expect(first.data.reply).toContain('Omani Labour Law')
    const system = ctx.ai.calls.at(-1)![0].content
    expect(system).toContain('Sultanate of Oman')
    expect(system).toContain('Wrongful termination')
    expect(system).toMatch(/Never invent statutes/)

    await c.post('/api/ai/chat', { message: 'And the limitation period?', conversation_id: first.data.conversation_id })
    const lastCall = ctx.ai.calls.at(-1)!
    expect(lastCall.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])

    const conv = await c.get(`/api/ai/conversations/${first.data.conversation_id}`)
    expect(conv.data.messages).toHaveLength(4)
    expect((await c.get('/api/org')).data.usage.ai_requests_this_month).toBe(2)
  })

  it('answers in Arabic when requested', async () => {
    const { c } = await registered(ctx.app)
    await c.post('/api/ai/chat', { message: 'ما هي شروط عقد العمل؟', language: 'ar' })
    expect(ctx.ai.calls.at(-1)![0].content).toContain('Modern Standard Arabic')
  })

  it('drafts a document into the library', async () => {
    const { c } = await registered(ctx.app)
    ctx.ai.nextReply = '**NON-DISCLOSURE AGREEMENT**\n\n## 1. Parties\n[PARTY A NAME]'
    // Blank optional form fields arrive as null from the web app.
    const r = await c.post('/api/ai/draft', { template: 'nda', jurisdiction: 'uae', instructions: 'Mutual NDA for a software partnership, 3 years.', title: null, parties: null, case_id: null })
    expect(r.status).toBe(201)
    expect(r.data.document.source).toBe('ai')
    expect(r.data.document.content).toBe('NON-DISCLOSURE AGREEMENT\n\n1. Parties\n[PARTY A NAME]')
    expect(r.data.document.title).toBe('Non-Disclosure Agreement')
  })

  it('analyses a document and stores a normalised result', async () => {
    const { c } = await registered(ctx.app)
    const d = await c.post('/api/documents', { title: 'Service agreement', content: 'SERVICE AGREEMENT. '.repeat(20) })
    const r = await c.post(`/api/ai/documents/${d.data.document.id}/analyze`, { type: 'risk' })
    expect(r.status).toBe(201)
    expect(r.data.analysis.result.risk_score).toBe(62)
    expect(r.data.analysis.result.issues[0].severity).toBe('high')
    const doc = await c.get(`/api/documents/${d.data.document.id}`)
    expect(doc.data.analyses).toHaveLength(1)
    // The document text is fenced as data, not instructions.
    expect(ctx.ai.calls.at(-1)![1].content).toMatch(/<document>[\s\S]*<\/document>/)
  })

  it('rejects analysis of near-empty documents', async () => {
    const { c } = await registered(ctx.app)
    const d = await c.post('/api/documents', { title: 'Scan', content: '' })
    expect((await c.post(`/api/ai/documents/${d.data.document.id}/analyze`, { type: 'summary' })).status).toBe(400)
  })

  it('reports unconfigured AI honestly instead of returning fake answers', async () => {
    const noAi = await setup()
    noAi.ai.configured = false
    noAi.ai.complete = createAiService(loadConfig({ NODE_ENV: 'test' }), createLogger('error', true)).complete
    const { c } = await registered(noAi.app)
    const r = await c.post('/api/ai/chat', { message: 'hello' })
    expect(r.status).toBe(503)
    expect(r.data.error.code).toBe('ai_not_configured')
  })
})

describe('OpenAI client', () => {
  const config = loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test' })
  const log = createLogger('error', true)

  it('sends the model, messages and JSON mode, and reads usage', async () => {
    let sent: any
    const ai = createAiService(config, log, (async (url: string, init: any) => {
      sent = { url, body: JSON.parse(init.body), auth: init.headers.authorization }
      return new Response(JSON.stringify({ model: 'gpt-test', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), { status: 200 })
    }) as any)
    const r = await ai.complete({ messages: [{ role: 'user', content: 'hi' }], json: true })
    expect(sent.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(sent.auth).toBe('Bearer sk-test')
    expect(sent.body.model).toBe('gpt-test')
    expect(sent.body.response_format).toEqual({ type: 'json_object' })
    expect(r).toEqual({ text: '{"a":1}', model: 'gpt-test', promptTokens: 5, completionTokens: 7 })
  })

  it('maps provider failures to user-safe errors', async () => {
    const ai = createAiService(config, log, (async () => new Response('rate limited', { status: 429 })) as any)
    await expect(ai.complete({ messages: [] })).rejects.toMatchObject({ status: 503, code: 'ai_busy' })
    const down = createAiService(config, log, (async () => { throw new TypeError('fetch failed') }) as any)
    await expect(down.complete({ messages: [] })).rejects.toMatchObject({ status: 503, code: 'ai_unavailable' })
  })

  it('normalises malformed analysis output', () => {
    const r = normalizeAnalysis({ risk_score: '250', issues: [{ severity: 'extreme', issue: 'x' }, { nothing: true }], parties: 'not-an-array' })
    expect(r.risk_score).toBe(100)
    expect(r.risk_level).toBe('critical')
    expect(r.issues).toEqual([{ severity: 'medium', clause: '', issue: 'x', recommendation: '' }])
    expect(r.parties).toEqual([])
  })
})

describe('plans and limits', () => {
  it('starter plan enforces open-case limit and blocks advanced analysis', async () => {
    const { c, me } = await registered(ctx.app)
    await ctx.db.query(`UPDATE organizations SET plan = 'starter' WHERE id = $1`, [me.org.id])
    for (let i = 0; i < 5; i++) expect((await c.post('/api/cases', { title: `Matter ${i}`, jurisdiction: 'oman' })).status).toBe(201)
    const sixth = await c.post('/api/cases', { title: 'Matter 6', jurisdiction: 'oman' })
    expect(sixth.status).toBe(402)
    expect(sixth.data.error.code).toBe('plan_limit_cases')
    // Closed cases do not count.
    expect((await c.post('/api/cases', { title: 'Old closed matter', jurisdiction: 'oman', status: 'closed' })).status).toBe(201)

    const d = await c.post('/api/documents', { title: 'Doc', content: 'x'.repeat(100) })
    expect((await c.post(`/api/ai/documents/${d.data.document.id}/analyze`, { type: 'risk' })).status).toBe(402)
    expect((await c.post(`/api/ai/documents/${d.data.document.id}/analyze`, { type: 'summary' })).status).toBe(201)
  })

  it('expired trials are read-only', async () => {
    const { c, me } = await registered(ctx.app)
    await c.post('/api/clients', { name: 'Before expiry' })
    await ctx.db.query(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, [me.org.id])
    expect((await c.get('/api/clients')).data.total).toBe(1)
    const r = await c.post('/api/clients', { name: 'After expiry' })
    expect(r.status).toBe(402)
    expect(r.data.error.code).toBe('trial_expired')
    expect((await c.get('/api/org/export')).status).toBe(200)
  })

  it('platform admins can change plans; others cannot', async () => {
    const { c, me } = await registered(ctx.app)
    expect((await c.get('/api/admin/organizations')).status).toBe(403)
    const ops = await registered(ctx.app, { email: 'ops@trustiq.test' })
    expect(ops.me.is_platform_admin).toBe(true)
    const r = await ops.c.patch(`/api/admin/organizations/${me.org.id}`, { plan: 'professional' })
    expect(r.data.organization.plan).toBe('professional')
    expect((await c.get('/api/auth/me')).data.plan.id).toBe('professional')
  })
})

describe('HTTP hardening', () => {
  it('blocks cross-origin state-changing requests', async () => {
    const r = await ctx.app.request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'a@b.test', password: 'x' })
    })
    expect(r.status).toBe(403)
  })

  it('sets security headers and serves pages', async () => {
    const home = await ctx.app.request('/')
    expect(home.status).toBe(200)
    expect(home.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(home.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    const html = await home.text()
    expect(html).not.toContain('cdn.tailwindcss.com')
    expect(html).not.toMatch(/onclick=/)
    expect((await ctx.app.request('/ar')).status).toBe(200)
    expect((await ctx.app.request('/app')).status).toBe(200)
    expect((await ctx.app.request('/terms')).status).toBe(200)
    expect((await ctx.app.request('/nope')).status).toBe(404)
    expect((await ctx.app.request('/api/nope')).status).toBe(401)
  })

  it('derives the client IP from the proxy-appended X-Forwarded-For entry, which clients cannot spoof', async () => {
    const { clientIp } = await import('../src/context')
    const ctx = (trustProxy: boolean): any => ({
      get: () => ({ config: { trustProxy } }),
      req: { header: (h: string) => (h === 'x-forwarded-for' ? '1.1.1.1, 203.0.113.9' : undefined) },
      env: {}
    })
    expect(clientIp(ctx(true))).toBe('203.0.113.9')
    expect(clientIp(ctx(false))).not.toBe('1.1.1.1')
  })

  it('reports readiness', async () => {
    const r = await ctx.app.request('/ready')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ status: 'ready', db: true })
  })

  it('returns structured errors for malformed JSON', async () => {
    const c = client(ctx.app)
    const r = await ctx.app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })
    expect(r.status).toBe(400)
    expect((await r.json()).error.code).toBeTruthy()
    void c
  })
})
