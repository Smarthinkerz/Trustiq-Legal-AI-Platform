import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEnv, Deps } from './context'
import { clientIp } from './context'
import { forbidden, HttpError, tooMany, unauthorized } from './lib/errors'
import { apiKeyAuth, loadSession, requireActiveSubscription } from './middleware/session'
import authRoutes from './routes/auth'
import orgRoutes from './routes/org'
import clientsRoutes from './routes/clients'
import casesRoutes from './routes/cases'
import documentsRoutes from './routes/documents'
import eventsRoutes from './routes/events'
import deadlinesRoutes from './routes/deadlines'
import importsRoutes from './routes/imports'
import websiteRoutes from './routes/website'
import integrationsRoutes from './routes/integrations'
import { markCalendarsDirty } from './services/google-calendar'
import { firmSiteRoutes } from './routes/firm-site'
import aiRoutes from './routes/ai'
import dashboardRoutes from './routes/dashboard'
import referenceRoutes from './routes/api'
import adminRoutes from './routes/admin'
import libraryRoutes from './routes/library'
import billingRoutes from './routes/billing'
import reportsRoutes from './routes/reports'
import tasksRoutes from './routes/tasks'
import workspaceRoutes from './routes/workspace'
import portalRoutes from './routes/portal'
import { subscriptionRoutes, tapPublicRoutes } from './routes/subscription'
import { buildIcs } from './services/jobs'
import { landingPage } from './landing'
import { appShell } from './pages/app-shell'
import { legalPage } from './pages/legal'
import { apiDocsPage } from './pages/api-docs'

// Endpoints reachable without a session.
const PUBLIC_API = new Set([
  'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password', 'POST /api/auth/accept-invite', 'POST /api/auth/login/mfa', 'GET /api/reference'
])
// Client-portal users may only reach these API prefixes.
const CLIENT_API = ['/api/portal', '/api/auth', '/api/reference']
const clientAllowed = (path: string) => CLIENT_API.some((p) => path === p || path.startsWith(`${p}/`))
const isPublicApi = (method: string, path: string) =>
  PUBLIC_API.has(`${method} ${path}`) || (method === 'GET' && path.startsWith('/api/auth/invite/'))

export function createApp(deps: Deps) {
  const { config, log } = deps
  const assetVersion = Date.now().toString(36)
  const app = new Hono<AppEnv>()

  app.use(async (c, next) => {
    c.set('deps', deps)
    const requestId = c.req.header('x-request-id')?.slice(0, 64) || randomUUID()
    c.set('requestId', requestId)
    c.header('x-request-id', requestId)
    const started = performance.now()
    await next()
    if (c.req.path !== '/health') {
      log.info('request', {
        requestId, method: c.req.method, path: c.req.path, status: c.res.status,
        ms: Math.round(performance.now() - started), user: c.get('user')?.id
      })
    }
  })

  app.use(secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    },
    strictTransportSecurity: config.isProduction ? 'max-age=31536000; includeSubDomains' : false,
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] }
  }))

  app.onError((err, c) => {
    const requestId = c.get('requestId')
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details }, requestId }, err.status)
    }
    if (err instanceof HTTPException) {
      const status = err.status
      const message = status === 413 ? 'The request is too large.' : status === 400 ? 'The request could not be understood.' : err.message
      return c.json({ error: { code: status === 413 ? 'payload_too_large' : 'bad_request', message }, requestId }, status)
    }
    log.error('unhandled error', { requestId, path: c.req.path, method: c.req.method, err })
    return c.json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again; if it persists, contact support with the request ID.' }, requestId }, 500)
  })

  // ---------- API ----------
  app.use('/api/*', async (c, next) => {
    c.header('cache-control', 'no-store')
    // Cookie-authenticated API: reject cross-site state-changing requests.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin')
      const allowed = new URL(config.appUrl).origin
      const self = new URL(c.req.url).origin
      if (origin && origin !== allowed && origin !== self) throw forbidden('Cross-origin request blocked.')
      if (!origin && c.req.header('sec-fetch-site') === 'cross-site') throw forbidden('Cross-origin request blocked.')
    }
    const r = deps.limiters.api.take(clientIp(c))
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      throw tooMany()
    }
    await next()
  })

  const uploadLimit = bodyLimit({ maxSize: config.maxUploadBytes + 1024 * 1024 })
  const jsonLimit = bodyLimit({ maxSize: 3 * 1024 * 1024 })
  app.use('/api/*', async (c, next) => {
    const p = c.req.path
    const isUpload = p === '/api/documents/upload' || p === '/api/v1/documents/upload' || p === '/api/org/branding/logo' || p === '/api/library/sources' || p === '/api/portal/documents' || p === '/api/import' || p === '/api/import/preview'
    return (isUpload ? uploadLimit : jsonLimit)(c, next)
  })

  app.use('/api/*', loadSession)
  app.use('/api/v1/*', apiKeyAuth)
  app.use('/api/v1', apiKeyAuth)
  app.use('/api/*', async (c, next) => {
    const user = c.get('user')
    if (!user && !isPublicApi(c.req.method, c.req.path)) throw unauthorized()
    if (user?.role === 'client' && !clientAllowed(c.req.path)) throw forbidden('This area is only available to the law firm.')
    await next()
  })

  // Changes to the firm calendar, tasks or cases queue a Google Calendar sync for the firm's connected users.
  const CALENDAR_SOURCES = /^\/api\/(v1\/)?(events|tasks|cases)(\/|$)/
  app.use('/api/*', async (c, next) => {
    await next()
    const org = c.get('org')
    if (org && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.res.status < 400 && CALENDAR_SOURCES.test(c.req.path)) {
      await markCalendarsDirty(deps.db, org.id).catch((err) => log.warn('calendar dirty flag failed', { err }))
    }
  })

  app.route('/api/auth', authRoutes)
  app.route('/api/integrations', integrationsRoutes)
  app.route('/api/reference', referenceRoutes)
  app.route('/api/org', orgRoutes)
  app.route('/api/admin', adminRoutes)
  app.route('/api/subscription', subscriptionRoutes)
  for (const [path, routes] of [
    ['/api/dashboard', dashboardRoutes], ['/api/clients', clientsRoutes], ['/api/cases', casesRoutes],
    ['/api/documents', documentsRoutes], ['/api/events', eventsRoutes], ['/api/ai', aiRoutes],
    ['/api/library', libraryRoutes], ['/api/billing', billingRoutes], ['/api/reports', reportsRoutes],
    ['/api/tasks', tasksRoutes], ['/api/workspace', workspaceRoutes], ['/api/portal', portalRoutes],
    ['/api/deadlines', deadlinesRoutes], ['/api/import', importsRoutes], ['/api/website', websiteRoutes]
  ] as const) {
    app.use(`${path}/*`, requireActiveSubscription)
    app.use(path, requireActiveSubscription)
    app.route(path, routes)
  }
  // ---------- Public API v1 (API keys; same handlers and rules as the app) ----------
  const whoAmI = (c: any) => {
    const { user, org } = c.var
    return c.json({ organization: { id: org.id, name: org.name, plan: org.plan }, acting_as: { id: user.id, name: user.name, role: user.role }, api_key: c.var.apiKey })
  }
  app.get('/api/v1', whoAmI)
  app.get('/api/v1/me', whoAmI)
  for (const [path, routes] of [
    ['/api/v1/clients', clientsRoutes], ['/api/v1/cases', casesRoutes], ['/api/v1/documents', documentsRoutes],
    ['/api/v1/billing', billingRoutes], ['/api/v1/tasks', tasksRoutes], ['/api/v1/events', eventsRoutes]
  ] as const) {
    app.use(`${path}/*`, requireActiveSubscription)
    app.use(path, requireActiveSubscription)
    app.route(path, routes)
  }
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'API endpoint not found' } }, 404))

  // ---------- Payments (public, verified by signature / re-fetch from Tap) ----------
  app.use('/webhooks/*', bodyLimit({ maxSize: 256 * 1024 }))
  app.route('/', tapPublicRoutes)

  // ---------- Calendar feed (token in URL, read-only) ----------
  app.get('/calendar/:file', async (c) => {
    const m = c.req.param('file').match(/^([A-Za-z0-9_-]{20,100})\.ics$/)
    const r = deps.limiters.api.take(`ics:${clientIp(c)}`)
    if (!m || !r.ok) return c.text('Not found', 404)
    const ics = await buildIcs(deps.db, m[1]!, config.appUrl)
    if (!ics) return c.text('Not found', 404)
    c.header('content-type', 'text/calendar; charset=utf-8')
    c.header('cache-control', 'private, max-age=300')
    return c.body(ics)
  })

  // ---------- Health ----------
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/ready', async (c) => {
    const dbOk = await deps.db.ping()
    return c.json({ status: dbOk ? 'ready' : 'degraded', db: dbOk, ai: deps.ai.configured, email: deps.mailer.configured }, dbOk ? 200 : 503)
  })

  // ---------- Static assets ----------
  const longCache = async (c: any, next: any) => {
    await next()
    if (c.res.status === 200) c.header('cache-control', c.req.query('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
  }
  app.use('/static/*', longCache, serveStatic({ root: './public' }))
  app.use('/vendor/fa/*', longCache, serveStatic({
    root: './node_modules/@fortawesome/fontawesome-free',
    rewriteRequestPath: (p) => p.replace(/^\/vendor\/fa/, '')
  }))
  app.get('/favicon.ico', (c) => c.redirect(`/static/favicon.svg?v=${assetVersion}`, 301))
  app.get('/manifest.webmanifest', (c) => {
    c.header('content-type', 'application/manifest+json')
    c.header('cache-control', 'public, max-age=3600')
    return c.body(JSON.stringify({
      name: 'TrustiqLegal', short_name: 'TrustiqLegal', description: 'Legal practice management and AI for GCC law firms',
      start_url: '/app', scope: '/', display: 'standalone', background_color: '#f8fafc', theme_color: '#1a365d', dir: 'auto',
      icons: [
        { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/static/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }))
  })
  const swSource = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
  app.get('/sw.js', (c) => {
    c.header('content-type', 'text/javascript; charset=utf-8')
    c.header('cache-control', 'no-cache')
    return c.body(swSource)
  })
  app.get('/robots.txt', (c) => c.text('User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\n'))

  // ---------- Pages ----------
  const html = (body: string) => (c: any) => {
    c.header('cache-control', 'no-cache')
    return c.html(body)
  }
  app.get('/', html(landingPage({ assetVersion, salesEmail: config.salesEmail, supportEmail: config.supportEmail })))
  app.get('/ar', html(landingPage({ assetVersion, salesEmail: config.salesEmail, supportEmail: config.supportEmail, lang: 'ar' })))
  app.get('/app', html(appShell({ assetVersion })))
  app.get('/app/', (c) => c.redirect('/app'))
  app.get('/developers', html(apiDocsPage({ assetVersion, appUrl: config.appUrl })))
  app.get('/terms', html(legalPage('terms', { assetVersion, supportEmail: config.supportEmail })))
  app.get('/privacy', html(legalPage('privacy', { assetVersion, supportEmail: config.supportEmail })))

  // Public firm websites (blog, consultation form, chatbot).
  app.route('/f', firmSiteRoutes(deps, assetVersion))

  app.notFound((c) => c.html(legalPage('404', { assetVersion, supportEmail: config.supportEmail }), 404))

  return app
}
