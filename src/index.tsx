import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig } from './config'
import { createDb } from './db'
import { createLogger } from './lib/logger'
import { createMailer } from './lib/mailer'
import { RateLimiter } from './lib/rate-limit'
import { createAiService } from './services/ai'
import { runDailyDigest, runRenewalReminders } from './services/jobs'
import { createTapClient } from './services/tap'
import { runLibraryImports } from './services/library-import'
import { runCalendarSync } from './services/google-calendar'

async function main() {
  const config = loadConfig()
  const log = createLogger(config.logLevel)
  const db = await createDb(config)
  if (db.kind === 'pglite') log.warn('using embedded PGlite database; set DATABASE_URL to use PostgreSQL', { dataDir: config.pgliteDataDir ?? '(in-memory)' })
  if (!config.ai.apiKey) log.warn('OPENAI_API_KEY is not set; AI features are disabled')
  if (!config.smtp) log.warn('SMTP is not configured; invitation and password-reset emails will not be delivered')

  const mailer = createMailer(config, log)
  const ai = createAiService(config, log)
  const app = createApp({
    config,
    db,
    log,
    mailer,
    ai,
    tap: createTapClient(config, log),
    limiters: {
      auth: new RateLimiter(20, 15 * 60_000),
      api: new RateLimiter(600, 60_000),
      ai: new RateLimiter(20, 60_000),
      webhook: new RateLimiter(30, 60_000),
      apiKey: new RateLimiter(120, 60_000)
    }
  })

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    log.info('TrustiqLegal listening', { port: info.port, env: config.env, db: db.kind, node: process.version })
  })

  // Periodic cleanup of expired sessions and tokens.
  const sweeper = setInterval(() => {
    db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => log.error('session sweep failed', { err }))
    db.query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '30 days'`).catch((err) => log.error('token sweep failed', { err }))
    const days = config.tap.auditRetentionDays
    db.query(`DELETE FROM webhook_events WHERE created_at < now() - make_interval(days => $1)`, [days]).catch((err) => log.error('webhook audit sweep failed', { err }))
    db.query(`DELETE FROM processed_webhook_events WHERE created_at < now() - make_interval(days => $1)`, [days]).catch((err) => log.error('webhook key sweep failed', { err }))
  }, 60 * 60_000)
  sweeper.unref()

  // Daily digest and renewal reminders (safe with several instances: users are claimed atomically).
  const jobs = setInterval(() => {
    runDailyDigest(db, mailer, config, log).catch((err) => log.error('daily digest failed', { err }))
    runRenewalReminders(db, mailer, config, log).catch((err) => log.error('renewal reminders failed', { err }))
  }, 15 * 60_000)
  jobs.unref()

  // Law-library imports run in the background, one document at a time.
  let importing = false
  const importer = setInterval(() => {
    if (importing) return
    importing = true
    runLibraryImports({ db, config, ai, log }, { max: 20 })
      .catch((err) => log.error('library import worker failed', { err }))
      .finally(() => { importing = false })
  }, 5_000)
  importer.unref()

  // Google Calendar sync: pushes firm calendar changes to connected users' Google calendars.
  let syncing = false
  const calendarSync = setInterval(() => {
    if (syncing || !config.google) return
    syncing = true
    runCalendarSync({ db, config, log })
      .catch((err) => log.error('calendar sync worker failed', { err }))
      .finally(() => { syncing = false })
  }, 60_000)
  calendarSync.unref()
  if (config.google) {
    // The client ID is public (it appears in every Google sign-in URL); logging it helps match it with Google Cloud Console.
    log.info('Google Calendar sync enabled', { clientId: config.google.clientId, redirectUri: `${config.appUrl}/api/integrations/google/callback` })
    for (const problem of config.google.problems) log.warn(`Google Calendar setup: ${problem}`)
  } else if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) {
    log.warn('Google Calendar sync is off: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')
  }

  const shutdown = (signal: string) => {
    log.info('shutting down', { signal })
    clearInterval(sweeper)
    clearInterval(jobs)
    clearInterval(importer)
    clearInterval(calendarSync)
    server.close(async () => {
      await db.close().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'failed to start', err: { message: err?.message, stack: err?.stack } }))
  process.exit(1)
})
