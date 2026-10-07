import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  // Public base URL of the app, used for links in emails and origin checks.
  APP_URL: z.string().url().optional(),
  // Postgres connection string. When absent, an embedded Postgres (PGlite) is used,
  // which is only allowed outside production.
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
  PGLITE_DATA_DIR: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  MAIL_FROM: z.string().default('TrustiqLegal <no-reply@trustiqlegal.com>'),

  SALES_EMAIL: z.string().email().default('sales@trustiqlegal.com'),
  SUPPORT_EMAIL: z.string().email().default('support@trustiqlegal.com'),
  // Comma-separated emails allowed to manage organizations and plans.
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
  // Set when running behind a proxy (Railway, Render, Nginx) so client IPs come from X-Forwarded-For.
  TRUST_PROXY: z.enum(['true', 'false']).optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  // Tap Payments (https://api.tap.company). Enables self-serve plan checkout when TAP_SECRET_KEY is set.
  TAP_SECRET_KEY: z.string().optional(),
  TAP_WEBHOOK_SECRET: z.string().optional(),
  TAP_API_URL: z.string().url().default('https://api.tap.company/v2'),
  TAP_WEBHOOK_TOLERANCE_MS: z.coerce.number().int().positive().default(300_000),
  WEBHOOK_AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  // VAT added to self-serve subscription charges (set to 5 once your company is VAT-registered in Oman).
  PLATFORM_VAT_PERCENT: z.coerce.number().min(0).max(100).default(0),
  // Extra domains (comma-separated) the law-library importer may fetch from, beyond the built-in GCC government sites.
  LIBRARY_IMPORT_DOMAINS: z.string().default(''),
  // Extra CA certificates (PEM) trusted only for library imports, e.g. a government PKI root.
  LIBRARY_IMPORT_EXTRA_CA: z.string().default(''),
  // Google Calendar sync (OAuth client from Google Cloud Console). Redirect URI: <APP_URL>/api/integrations/google/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Key for encrypting stored OAuth tokens. Defaults to a key derived from GOOGLE_CLIENT_SECRET.
  ENCRYPTION_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
})

export type Config = {
  env: 'development' | 'test' | 'production'
  isProduction: boolean
  port: number
  appUrl: string
  databaseUrl?: string
  databaseSsl: boolean
  pgliteDataDir?: string
  ai: { apiKey?: string; baseUrl: string; model: string; timeoutMs: number }
  smtp?: { host: string; port: number; user?: string; pass?: string; secure: boolean }
  mailFrom: string
  salesEmail: string
  supportEmail: string
  platformAdminEmails: string[]
  trustProxy: boolean
  maxUploadBytes: number
  tap: { secretKey?: string; webhookSecret?: string; apiUrl: string; toleranceMs: number; auditRetentionDays: number }
  platformVatPercent: number
  libraryImportDomains: string[]
  libraryImportExtraCa: string
  google?: { clientId: string; clientSecret: string; problems: string[] }
  encryptionKey?: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  const e = parsed.data
  const isProduction = e.NODE_ENV === 'production'

  if (isProduction && !e.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production. Attach a PostgreSQL database.')
  }
  if (isProduction && !e.APP_URL) {
    throw new Error('APP_URL is required in production (e.g. https://app.trustiqlegal.com).')
  }

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    appUrl: (e.APP_URL ?? `http://localhost:${e.PORT}`).replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL || undefined,
    databaseSsl: e.DATABASE_SSL === 'true',
    pgliteDataDir: e.PGLITE_DATA_DIR,
    ai: { apiKey: e.OPENAI_API_KEY || undefined, baseUrl: e.OPENAI_BASE_URL.replace(/\/$/, ''), model: e.OPENAI_MODEL, timeoutMs: e.AI_TIMEOUT_MS },
    smtp: e.SMTP_HOST
      ? { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, secure: e.SMTP_SECURE === 'true' || e.SMTP_PORT === 465 }
      : undefined,
    mailFrom: e.MAIL_FROM,
    salesEmail: e.SALES_EMAIL,
    supportEmail: e.SUPPORT_EMAIL,
    platformAdminEmails: e.PLATFORM_ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY === 'true' : isProduction,
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    tap: {
      secretKey: e.TAP_SECRET_KEY || undefined,
      webhookSecret: e.TAP_WEBHOOK_SECRET || undefined,
      apiUrl: e.TAP_API_URL.replace(/\/$/, ''),
      toleranceMs: e.TAP_WEBHOOK_TOLERANCE_MS,
      auditRetentionDays: e.WEBHOOK_AUDIT_RETENTION_DAYS
    },
    platformVatPercent: e.PLATFORM_VAT_PERCENT,
    libraryImportExtraCa: e.LIBRARY_IMPORT_EXTRA_CA,
    libraryImportDomains: e.LIBRARY_IMPORT_DOMAINS.split(',').map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')).filter(Boolean),
    google: googleCredentials(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET),
    encryptionKey: e.ENCRYPTION_KEY || undefined,
    logLevel: e.LOG_LEVEL
  }
}

const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/
const unquote = (v: string) => v.trim().replace(/^(['"`])([\s\S]*)\1$/, '$2').trim()

// Accepts the values as pasted from Google Cloud Console, including surrounding quotes, swapped
// variables or the whole downloaded client_secret.json, and lists anything that still looks wrong.
export function googleCredentials(rawId?: string, rawSecret?: string): Config['google'] {
  if (!rawId?.trim() && !rawSecret?.trim()) return undefined
  let id = unquote(rawId ?? '')
  let secret = unquote(rawSecret ?? '')
  for (const v of [id, secret]) {
    if (!v.startsWith('{')) continue
    try {
      const j = JSON.parse(v)
      const c = j.web ?? j.installed ?? j
      if (c.client_id) id = String(c.client_id).trim()
      if (c.client_secret) secret = String(c.client_secret).trim()
    } catch { /* reported below */ }
  }
  if (CLIENT_ID_RE.test(secret) && !CLIENT_ID_RE.test(id)) [id, secret] = [secret, id]
  const problems: string[] = []
  if (!id) problems.push('GOOGLE_CLIENT_ID is empty.')
  else if (!CLIENT_ID_RE.test(id)) problems.push('GOOGLE_CLIENT_ID does not look like an OAuth client ID (it should end in .apps.googleusercontent.com).')
  if (!secret) problems.push('GOOGLE_CLIENT_SECRET is empty.')
  if (!id || !secret) return undefined
  return { clientId: id, clientSecret: secret, problems }
}
