import type { FileStore } from './services/storage'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Config } from './config'
import type { Db } from './db'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import type { AiService } from './services/ai'
import type { EmbeddingService, RerankService } from './services/retrieval'
import type { TapClient } from './services/tap'
import type { ThawaniClient, ThawaniKeys } from './services/thawani'
import type { WebFetcher } from './services/library-import'
import type { RateLimiter } from './lib/rate-limit'
import { forbidden, unauthorized } from './lib/errors'

export type Role = 'owner' | 'admin' | 'lawyer' | 'staff' | 'client'
export const STAFF_ROLES: Role[] = ['owner', 'admin', 'lawyer', 'staff']

export type AuthUser = {
  id: string
  org_id: string
  email: string
  name: string
  role: Role
  locale: 'en' | 'ar'
  // Show Hijri dates next to Gregorian ones; 'auto' means on for Saudi firms.
  hijri_dates: 'auto' | 'on' | 'off'
  // Set only for client-portal users.
  client_id: string | null
  two_factor: boolean
}

export type Org = {
  id: string
  name: string
  plan: string
  trial_ends_at: Date | null
  plan_expires_at: Date | null
  default_jurisdiction: string
  default_currency: string
  // Set for firm subscriptions: the firm's own limits and seats.
  limits_custom?: boolean
  cases_limit?: number | null
  documents_limit?: number | null
  ai_requests_limit?: number | null
  lawyer_seats?: number | null
  support_seats?: number | null
  // Role of the signed-in member making this request (unset for public or background work).
  acting_role?: Role
}

export type Deps = {
  config: Config
  db: Db
  log: Logger
  mailer: Mailer
  ai: AiService
  // Optional hybrid-retrieval services for the law library (see services/retrieval.ts).
  embeddings?: EmbeddingService
  reranker?: RerankService
  tap: TapClient
  // Builds a client for a firm's own Tap account (invoice payments). Overridable in tests.
  firmTap?: (secretKey: string) => TapClient
  // Builds a client for a firm's own Thawani account (Oman invoice payments). Overridable in tests.
  firmThawani?: (keys: ThawaniKeys) => ThawaniClient
  // Runs work after the response (e.g. AI intake of a new enquiry). Tests replace it to run tasks on demand.
  defer?: (task: () => Promise<unknown>) => void
  // Overridable in tests; used for the WhatsApp Cloud API (graph.facebook.com).
  waFetch?: typeof fetch
  // Calls to the SmarThinkerz Hub Team Checkout (replaced in tests).
  hubFetch?: typeof fetch
  // Overridable in tests; defaults to a fetcher that refuses private network addresses.
  webFetch?: WebFetcher
  // Overridable in tests; used for Google OAuth and Calendar API calls.
  googleFetch?: typeof fetch
  limiters: { auth: RateLimiter; api: RateLimiter; ai: RateLimiter; webhook: RateLimiter; apiKey: RateLimiter }
  // Object store for uploaded files when STORAGE_DRIVER=s3; null keeps files in the database.
  files?: FileStore | null
}

export type AppEnv = {
  Variables: {
    deps: Deps
    requestId: string
    user?: AuthUser
    org?: Org
    sessionId?: string
    // Set when the request is authenticated with a public API key instead of a session.
    apiKey?: { id: string; name: string; access: 'read' | 'read_write' }
  }
}

export type Ctx = Context<AppEnv>

export function auth(c: Ctx): { user: AuthUser; org: Org } {
  const user = c.get('user')
  const org = c.get('org')
  if (!user || !org) throw unauthorized()
  return { user, org }
}

export function requireRole(c: Ctx, ...roles: Role[]) {
  const { user } = auth(c)
  if (!roles.includes(user.role)) throw forbidden()
}

export function clientIp(c: Ctx): string {
  if (c.get('deps').config.trustProxy) {
    // Use the entry appended by our own proxy (the last one); earlier entries are client-controlled.
    const xff = c.req.header('x-forwarded-for')
    if (xff) return xff.split(',').pop()!.trim()
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function audit(c: Ctx, action: string, entityType?: string, entityId?: string, meta?: Record<string, unknown>) {
  const { db, log } = c.get('deps')
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  const fullMeta = apiKey ? { ...meta, via_api_key: { id: apiKey.id, name: apiKey.name } } : meta
  try {
    await db.query(
      'INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, meta, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [user?.org_id ?? null, user?.id ?? null, action, entityType ?? null, entityId ?? null, fullMeta ? JSON.stringify(fullMeta) : null, clientIp(c)]
    )
  } catch (err) {
    // Auditing must never break the user's request, but failures must be visible.
    log.error('audit write failed', { action, err })
  }
}

// Fire-and-forget with logging; the default when deps.defer is not set.
export function runLater(deps: Pick<Deps, 'defer' | 'log'>, label: string, task: () => Promise<unknown>) {
  if (deps.defer) return deps.defer(task)
  void task().catch((err) => deps.log.warn(`${label} failed`, { err }))
}
