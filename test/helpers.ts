import { createApp } from '../src/app'
import { loadConfig } from '../src/config'
import { createDb, type Db } from '../src/db'
import { createLogger } from '../src/lib/logger'
import type { Mail, Mailer } from '../src/lib/mailer'
import { RateLimiter } from '../src/lib/rate-limit'
import type { AiService, ChatMessage } from '../src/services/ai'
import type { TapCharge, TapClient } from '../src/services/tap'
import { runLibraryImports, type WebFetcher } from '../src/services/library-import'

// A fake web for the law-library importer: register URL -> response, everything else 404s.
export function fakeWeb() {
  const pages = new Map<string, { status?: number; type?: string; body?: string | Uint8Array; location?: string; throw?: string }>()
  const requested: string[] = []
  const fetch: WebFetcher = async (url) => {
    requested.push(url)
    const p = pages.get(url)
    if (!p) return new Response('not found', { status: 404 })
    if (p.throw) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code: p.throw }) })
    const headers: Record<string, string> = { 'content-type': p.type ?? 'text/html; charset=utf-8' }
    if (p.location) headers.location = p.location
    return new Response(p.body as any ?? '', { status: p.status ?? 200, headers })
  }
  return { pages, requested, fetch }
}

export type FakeAi = AiService & { calls: ChatMessage[][]; nextReply: string | null }

export function fakeAi(): FakeAi {
  const ai: FakeAi = {
    configured: true,
    model: 'test-model',
    calls: [],
    nextReply: null,
    async complete({ messages, json }) {
      ai.calls.push(messages)
      const text = ai.nextReply ?? (json
        ? JSON.stringify({ summary: 'A service agreement.', risk_score: 62, risk_level: 'high', parties: ['A', 'B'], key_terms: [{ label: 'Term', value: '12 months' }], issues: [{ severity: 'high', clause: '5', issue: 'Uncapped liability', recommendation: 'Add a cap' }], missing_clauses: ['Force majeure'], next_steps: ['Negotiate cap'] })
        : 'DRAFT AGREEMENT\n\n1. PARTIES\n[PARTY A NAME]')
      ai.nextReply = null
      return { text, model: 'test-model', promptTokens: 10, completionTokens: 20 }
    }
  }
  return ai
}

export type FakeTap = TapClient & { charges: Map<string, TapCharge>; created: Record<string, any>[] }

export function fakeTap(): FakeTap {
  let n = 0
  const tap: FakeTap = {
    configured: true,
    charges: new Map(),
    created: [],
    async createCharge(body: any) {
      tap.created.push(body)
      const charge: TapCharge = {
        id: `chg_TS${++n}${Date.now()}`, status: 'INITIATED', amount: body.amount, currency: body.currency,
        metadata: body.metadata, reference: body.reference, transaction: { url: `https://checkout.tap.test/${n}`, created: Date.now() }
      }
      tap.charges.set(charge.id, charge)
      return charge
    },
    async retrieveCharge(id) {
      const c = tap.charges.get(id)
      if (!c) throw new Error('unknown charge')
      return c
    }
  }
  return tap
}

export async function setup(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', APP_URL: 'http://localhost:8080', PLATFORM_ADMIN_EMAILS: 'ops@trustiq.test',
    ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
    ...env
  })
  const db: Db = await createDb(config)
  const mails: Mail[] = []
  const mailer: Mailer = { configured: true, async send(m) { mails.push(m) } }
  const ai = fakeAi()
  const tap = fakeTap()
  const web = fakeWeb()
  const log = createLogger('error', true)
  const app = createApp({
    config, db, ai, mailer, tap, webFetch: web.fetch,
    log,
    limiters: { auth: new RateLimiter(1000, 60_000), api: new RateLimiter(10_000, 60_000), ai: new RateLimiter(1000, 60_000), webhook: new RateLimiter(1000, 60_000), apiKey: new RateLimiter(1000, 60_000) }
  })
  return { app, db, ai, mails, config, tap, web, runImports: () => runLibraryImports({ db, config, ai, log, webFetch: web.fetch }) }
}

type App = Awaited<ReturnType<typeof setup>>['app']

// Minimal cookie-jar HTTP client over app.request().
export function client(app: App) {
  let cookie = ''
  const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...headers, ...(cookie ? { cookie } : {}) } }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      init.body = JSON.stringify(body)
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
    }
    const res = await app.request(path, init)
    const set = res.headers.get('set-cookie')
    if (set) {
      const m = set.match(/tq_session=([^;]*)/)
      if (m) cookie = m[1] ? `tq_session=${m[1]}` : ''
    }
    const type = res.headers.get('content-type') ?? ''
    const data: any = type.includes('json') ? await res.json() : await res.text()
    return { status: res.status, data, res }
  }
  return {
    get: (p: string) => request('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => request('POST', p, b ?? {}, h),
    patch: (p: string, b: unknown) => request('PATCH', p, b),
    put: (p: string, b: unknown) => request('PUT', p, b),
    del: (p: string) => request('DELETE', p),
    raw: request,
    get cookie() { return cookie }
  }
}

let n = 0
export async function registered(app: App, overrides: Record<string, unknown> = {}) {
  const c = client(app)
  n++
  const email = (overrides.email as string) ?? `owner${n}-${crypto.randomUUID().slice(0, 8)}@firm.test`
  const r = await c.post('/api/auth/register', {
    name: 'Owner Person', email, password: 'Str0ngPassw0rd', firm_name: `Firm ${n}`, accept_terms: true, ...overrides
  })
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`)
  return { c, email, me: r.data }
}
