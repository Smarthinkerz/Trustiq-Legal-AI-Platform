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
    logLevel: e.LOG_LEVEL
  }
}
