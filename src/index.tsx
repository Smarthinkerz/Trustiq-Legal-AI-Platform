import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig } from './config'
import { createDb } from './db'
import { createLogger } from './lib/logger'
import { createMailer } from './lib/mailer'
import { RateLimiter, shareRateLimits } from './lib/rate-limit'
import { createAiService } from './services/ai'
import { runFairUseAlerts } from './services/fair-use'
import { runPriceNotices } from './services/price-lock'
import { runDailyDigest, runRenewalReminders } from './services/jobs'
import { createTapClient } from './services/tap'
import { runWhatsAppReminders } from './services/whatsapp'
import { sweepThawaniPayments } from './services/invoice-payments'
import { sweepDemoFirms } from './services/demo'
import { runLibraryImports } from './services/library-import'
import { runCalendarSync } from './services/google-calendar'
import { createEmbeddingService, createRerankService, runEmbeddingBackfill } from './services/retrieval'
import { createS3Store, sweepDeletedFiles } from './services/storage'

async function main() {
  const config = loadConfig()
  const log = createLogger(config.logLevel)
  const db = await createDb(config)
  if (db.kind === 'pglite') log.warn('using embedded PGlite database; set DATABASE_URL to use PostgreSQL', { dataDir: config.pgliteDataDir ?? '(in-memory)' })
  if (!config.ai.apiKey) log.warn('OPENAI_API_KEY is not set; AI features are disabled')
  if (!config.smtp) log.warn('SMTP is not configured; invitation and password-reset emails will not be delivered')

  const mailer = createMailer(config, log)
  const ai = createAiService(config, log)
  const embeddings = createEmbeddingService(config, log)
  const reranker = createRerankService(config, log)
  log.info('law library retrieval', { mode: embeddings.configured ? 'hybrid' : 'bm25', embeddings: embeddings.configured ? embeddings.model : null, reranker: reranker.configured ? reranker.model : null })
  const files = config.storage.s3 ? createS3Store(config.storage.s3) : null
  log.info('file storage', { driver: config.storage.driver, bucket: config.storage.s3?.bucket ?? null })
  const app = createApp({
    files,
    config,
    db,
    log,
    mailer,
    ai,
    embeddings,
    reranker,
    tap: createTapClient(config, log),
    limiters: {
      auth: new RateLimiter(20, 15 * 60_000, 'auth'),
      api: new RateLimiter(600, 60_000, 'api'),
      ai: new RateLimiter(20, 60_000, 'ai'),
      webhook: new RateLimiter(30, 60_000, 'webhook'),
      apiKey: new RateLimiter(120, 60_000, 'apiKey')
    }
  })

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    log.info('TrustiqLegal listening', { port: info.port, env: config.env, db: db.kind, node: process.version })
  })

  // Periodic cleanup of expired sessions and tokens.
  // Several instances share rate-limit counts through the database.
  const stopSharing = config.rateLimitStore === 'db' ? shareRateLimits(db, (err) => log.warn('rate limit sync failed', { err })) : () => {}
  log.info('rate limits', { store: config.rateLimitStore })

  // Background jobs. Each claims its work in the database, so several instances may run them; set
  // RUN_WORKERS=false on instances that should only serve requests.
  const every = (ms: number, fn: () => void) => { const t = setInterval(() => { if (config.runWorkers) fn() }, ms); t.unref(); return t }
  log.info('background workers', { enabled: config.runWorkers })
  const sweeper = setInterval(() => {
    if (!config.runWorkers) return
    db.query('DELETE FROM sessions WHERE expires_at < now()').catch((err) => log.error('session sweep failed', { err }))
    db.query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '30 days'`).catch((err) => log.error('token sweep failed', { err }))
    const days = config.tap.auditRetentionDays
    db.query(`DELETE FROM webhook_events WHERE created_at < now() - make_interval(days => $1)`, [days]).catch((err) => log.error('webhook audit sweep failed', { err }))
    db.query(`DELETE FROM processed_webhook_events WHERE created_at < now() - make_interval(days => $1)`, [days]).catch((err) => log.error('webhook key sweep failed', { err }))
    db.query(`DELETE FROM site_chats WHERE updated_at < now() - interval '90 days'`).catch((err) => log.error('site chat sweep failed', { err }))
    sweepDeletedFiles(db, files).catch((err) => log.error('object store sweep failed', { err }))
  }, 60 * 60_000)
  sweeper.unref()

  // Daily digest and renewal reminders (safe with several instances: users are claimed atomically).
  const jobs = every(15 * 60_000, () => {
    runDailyDigest(db, mailer, config, log).catch((err) => log.error('daily digest failed', { err }))
    runRenewalReminders(db, mailer, config, log).catch((err) => log.error('renewal reminders failed', { err }))
    runWhatsAppReminders({ db, config, log }).catch((err) => log.error('whatsapp reminders failed', { err }))
    runFairUseAlerts(db, mailer, config, log).catch((err) => log.error('fair use alerts failed', { err }))
    runPriceNotices(db, mailer, config, log).catch((err) => log.error('price notices failed', { err }))
    sweepDemoFirms(db).catch((err) => log.error('demo firm cleanup failed', { err }))
  })

  // Settles Thawani invoice payments whose clients closed the page before returning.
  let thawaniSweeping = false
  const thawaniSweep = every(3 * 60_000, () => {
    if (thawaniSweeping) return
    thawaniSweeping = true
    sweepThawaniPayments({ db, config, log, mailer })
      .catch((err) => log.error('thawani payment sweep failed', { err }))
      .finally(() => { thawaniSweeping = false })
  })

  // Law-library imports run in the background, one document at a time.
  let importing = false
  const importer = every(5_000, () => {
    if (importing) return
    importing = true
    runLibraryImports({ db, config, ai, log }, { max: 20 })
      .catch((err) => log.error('library import worker failed', { err }))
      .finally(() => { importing = false })
  })

  // Embeds new law-library passages for hybrid retrieval.
  let embedding = false
  const embedder = every(30_000, () => {
    if (embedding || !embeddings.configured) return
    embedding = true
    runEmbeddingBackfill({ db, log, embeddings }, { max: 512 })
      .catch((err) => log.error('embedding backfill failed', { err }))
      .finally(() => { embedding = false })
  })

  // Google Calendar sync: pushes firm calendar changes to connected users' Google calendars.
  let syncing = false
  const calendarSync = every(60_000, () => {
    if (syncing || !config.google) return
    syncing = true
    runCalendarSync({ db, config, log })
      .catch((err) => log.error('calendar sync worker failed', { err }))
      .finally(() => { syncing = false })
  })
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
    stopSharing()
    clearInterval(jobs)
    clearInterval(importer)
    clearInterval(thawaniSweep)
    clearInterval(calendarSync)
    clearInterval(embedder)
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
