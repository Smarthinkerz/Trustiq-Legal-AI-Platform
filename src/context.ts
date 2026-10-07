import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Config } from './config'
import type { Db } from './db'
import type { Logger } from './lib/logger'
import type { Mailer } from './lib/mailer'
import type { AiService } from './services/ai'
import type { TapClient } from './services/tap'
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
}

export type Deps = {
  config: Config
  db: Db
  log: Logger
  mailer: Mailer
  ai: AiService
  tap: TapClient
  // Overridable in tests; defaults to a fetcher that refuses private network addresses.
  webFetch?: WebFetcher
  // Overridable in tests; used for Google OAuth and Calendar API calls.
  googleFetch?: typeof fetch
  limiters: { auth: RateLimiter; api: RateLimiter; ai: RateLimiter; webhook: RateLimiter; apiKey: RateLimiter }
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
