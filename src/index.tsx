import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { renderer } from './renderer'
import { landingPage } from './landing'
import { cmsInterface } from './cms-interface'

import authRoutes from './routes/auth'
import apiRoutes from './routes/api'
import casesRoutes from './routes/cases'
import documentsRoutes from './routes/documents'
import aiRoutes from './routes/ai'
import brandingRoutes from './routes/branding'
import cmsApi from './routes/cms-api'

type Bindings = {
  OPENAI_API_KEY?: string
  JWT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use(renderer)
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))
app.use('/static/*', serveStatic({ root: './public' }))

app.route('/auth', authRoutes)
app.route('/api', apiRoutes)
app.route('/api/cases', casesRoutes)
app.route('/api/documents', documentsRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/branding', brandingRoutes)
app.route('/api/cms', cmsApi)

const appPage = `<!DOCTYPE html>
<html lang="en" dir="ltr" id="html-root">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal - The World's Most Advanced Legal Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="min-h-screen">
    <nav class="bg-blue-900 text-white shadow-lg sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <h1 class="text-xl font-bold"><i class="fas fa-balance-scale mr-2"></i>TrustiqLegal</h1>
          <div class="flex gap-3">
            <button class="bg-blue-600 px-3 py-1 rounded text-sm">EN / AR</button>
            <button class="bg-yellow-500 text-blue-900 px-4 py-2 rounded font-medium"><i class="fas fa-user-circle mr-2"></i>Profile</button>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <div class="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-lg p-8 mb-8">
        <h2 class="text-3xl font-bold mb-2">All legal work in one bilingual workspace</h2>
        <p class="text-slate-200">Track matters, draft documents, analyze contracts, manage clients, and coordinate deadlines across GCC jurisdictions.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-white p-6 rounded-lg shadow"><div class="text-sm text-gray-600">Active Cases</div><div class="text-3xl font-bold">18</div></div>
        <div class="bg-white p-6 rounded-lg shadow"><div class="text-sm text-gray-600">Drafted Docs</div><div class="text-3xl font-bold">127</div></div>
        <div class="bg-white p-6 rounded-lg shadow"><div class="text-sm text-gray-600">Clients</div><div class="text-3xl font-bold">39</div></div>
        <div class="bg-white p-6 rounded-lg shadow"><div class="text-sm text-gray-600">AI Analyses</div><div class="text-3xl font-bold">84</div></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white p-6 rounded-lg shadow md:col-span-2">
          <h3 class="text-lg font-semibold mb-4">Quick Actions</h3>
          <div class="grid grid-cols-2 gap-3">
            <button class="bg-blue-600 text-white p-3 rounded hover:bg-blue-700"><i class="fas fa-folder-plus mr-2"></i>New Case</button>
            <button class="bg-green-600 text-white p-3 rounded hover:bg-green-700"><i class="fas fa-file-contract mr-2"></i>Generate Doc</button>
            <button class="bg-purple-600 text-white p-3 rounded hover:bg-purple-700"><i class="fas fa-brain mr-2"></i>AI Analysis</button>
            <button class="bg-blue-500 text-white p-3 rounded hover:bg-blue-600"><i class="fas fa-calendar-alt mr-2"></i>Calendar</button>
          </div>
        </div>
        <div class="bg-white p-6 rounded-lg shadow">
          <h3 class="text-lg font-semibold mb-4">Status</h3>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span>System</span><span class="text-green-600">Online</span></div>
            <div class="flex justify-between"><span>Cases</span><span>2 urgent</span></div>
            <div class="flex justify-between"><span>Docs</span><span>14 ready</span></div>
          </div>
        </div>
      </div>
    </main>
  </div>
</body>
</html>`

app.get('/cms', (c) => c.html(cmsInterface))
app.get('/', (c) => c.html(landingPage))
app.get('/app', (c) => c.html(appPage))
app.get('/health', (c) => c.json({ status: 'healthy', service: 'TrustiqLegal Platform', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT) || 8080
serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
})

console.log(`🚀 TrustiqLegal Platform running on port ${port}`)
