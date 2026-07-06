import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'

import authRoutes from './routes/auth'
import apiRoutes from './routes/api'
import casesRoutes from './routes/cases'
import documentsRoutes from './routes/documents'
import aiRoutes from './routes/ai'
import brandingRoutes from './routes/branding'

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

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en" dir="ltr" id="html-root">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal - The World's Most Advanced Legal Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="/static/style.css?v=20251022-2000" rel="stylesheet" />
</head>
<body class="bg-gray-50">
  <div class="min-h-screen">
    <nav class="bg-legal-primary text-white shadow-lg">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-4">
            <h1 class="text-xl font-bold"><i class="fas fa-balance-scale mr-2"></i>TrustiqLegal</h1>
            <div class="hidden md:flex gap-2">
              <a href="#dashboard" class="nav-link px-3 py-2 rounded-md text-sm font-medium bg-legal-secondary" onclick="showSection('dashboard'); return false;">Dashboard</a>
              <a href="#cases" class="nav-link px-3 py-2 rounded-md text-sm font-medium hover:bg-legal-secondary" onclick="showSection('cases'); return false;">Cases</a>
              <a href="#documents" class="nav-link px-3 py-2 rounded-md text-sm font-medium hover:bg-legal-secondary" onclick="showSection('documents'); return false;">Documents</a>
              <a href="#ai-assistant" class="nav-link px-3 py-2 rounded-md text-sm font-medium hover:bg-legal-secondary" onclick="showSection('ai-assistant'); return false;">AI Assistant</a>
              <a href="#schedule" class="nav-link px-3 py-2 rounded-md text-sm font-medium hover:bg-legal-secondary" onclick="showSection('schedule'); return false;">Schedule</a>
              <a href="#clients" class="nav-link px-3 py-2 rounded-md text-sm font-medium hover:bg-legal-secondary" onclick="showSection('clients'); return false;">Clients</a>
            </div>
          </div>
          <div class="flex items-center">
            <button class="language-toggle bg-legal-accent px-3 py-1 rounded text-sm" onclick="toggleLanguage()">EN / AR</button>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <section id="dashboard" class="section active">
        <h2 class="text-3xl font-bold mb-4">Dashboard</h2>
        <p class="text-gray-600">AI legal platform for GCC jurisdictions with cases, documents, branding, and bilingual support.</p>
      </section>

      <section id="cases" class="section">
        <h2 class="text-3xl font-bold mb-4">Cases</h2>
        <p>Manage legal matters, timelines, priorities, and jurisdictions.</p>
      </section>

      <section id="documents" class="section">
        <h2 class="text-3xl font-bold mb-4">Documents</h2>
        <p>Draft, review, and generate legal documents and templates.</p>
      </section>

      <section id="ai-assistant" class="section">
        <h2 class="text-3xl font-bold mb-4">AI Assistant</h2>
        <p>Ask legal questions, analyze documents, and generate research.</p>
      </section>

      <section id="schedule" class="section">
        <h2 class="text-3xl font-bold mb-4">Schedule</h2>
        <p>Track appointments, hearings, deadlines, and reminders.</p>
      </section>

      <section id="clients" class="section">
        <h2 class="text-3xl font-bold mb-4">Clients</h2>
        <p>Store client records, contact details, and matter assignments.</p>
      </section>
    </main>
  </div>

  <script src="/static/test-navigation.js?v=20251022-2100" cache="no-cache"></script>
  <script src="/static/app.js?v=20251022-2000" cache="no-cache"></script>
</body>
</html>`)
})

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'TrustiqLegal Platform',
    timestamp: new Date().toISOString()
  })
})

const port = Number(process.env.PORT) || 8080
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
console.log(`Server running on port ${port}`)
