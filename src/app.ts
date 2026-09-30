import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { randomUUID } from 'node:crypto'
import type { AppEnv, Deps } from './context'
import { clientIp } from './context'
import { forbidden, HttpError, tooMany, unauthorized } from './lib/errors'
import { loadSession, requireActiveSubscription } from './middleware/session'
import authRoutes from './routes/auth'
import orgRoutes from './routes/org'
import clientsRoutes from './routes/clients'
import casesRoutes from './routes/cases'
import documentsRoutes from './routes/documents'
import eventsRoutes from './routes/events'
import aiRoutes from './routes/ai'
import dashboardRoutes from './routes/dashboard'
import referenceRoutes from './routes/api'
import adminRoutes from './routes/admin'
import { landingPage } from './landing'
import { appShell } from './pages/app-shell'
import { legalPage } from './pages/legal'

// Endpoints reachable without a session.
const PUBLIC_API = new Set([
  'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password', 'POST /api/auth/accept-invite', 'GET /api/reference'
])
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
    const isUpload = c.req.path === '/api/documents/upload' || c.req.path === '/api/org/branding/logo'
    return (isUpload ? uploadLimit : jsonLimit)(c, next)
  })

  app.use('/api/*', loadSession)
  app.use('/api/*', async (c, next) => {
    if (!c.get('user') && !isPublicApi(c.req.method, c.req.path)) throw unauthorized()
    await next()
  })

  app.route('/api/auth', authRoutes)
  app.route('/api/reference', referenceRoutes)
  app.route('/api/org', orgRoutes)
  app.route('/api/admin', adminRoutes)
  for (const [path, routes] of [
    ['/api/dashboard', dashboardRoutes], ['/api/clients', clientsRoutes], ['/api/cases', casesRoutes],
    ['/api/documents', documentsRoutes], ['/api/events', eventsRoutes], ['/api/ai', aiRoutes]
  ] as const) {
    app.use(`${path}/*`, requireActiveSubscription)
    app.use(path, requireActiveSubscription)
    app.route(path, routes)
  }
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'API endpoint not found' } }, 404))

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
  app.get('/terms', html(legalPage('terms', { assetVersion, supportEmail: config.supportEmail })))
  app.get('/privacy', html(legalPage('privacy', { assetVersion, supportEmail: config.supportEmail })))

  app.notFound((c) => c.html(legalPage('404', { assetVersion, supportEmail: config.supportEmail }), 404))

  return app
}
