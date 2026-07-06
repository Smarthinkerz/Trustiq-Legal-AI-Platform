import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
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

const page = `<!DOCTYPE html>
<html lang="en" dir="ltr" id="html-root">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal - The World's Most Advanced Legal Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="/static/style.css?v=20251022-2000" rel="stylesheet" />
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="min-h-screen">
    <nav class="bg-legal-primary text-white shadow-lg sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-16 gap-4">
          <div class="flex items-center gap-4 min-w-0">
            <h1 class="text-xl font-bold whitespace-nowrap"><i class="fas fa-balance-scale mr-2"></i>TrustiqLegal</h1>
            <div class="hidden xl:flex gap-2 text-sm">
              <a href="#dashboard" class="nav-link px-3 py-2 rounded-md font-medium bg-legal-secondary" onclick="showSection('dashboard'); return false;">Dashboard</a>
              <a href="#cases" class="nav-link px-3 py-2 rounded-md font-medium hover:bg-legal-secondary" onclick="showSection('cases'); return false;">Cases</a>
              <a href="#documents" class="nav-link px-3 py-2 rounded-md font-medium hover:bg-legal-secondary" onclick="showSection('documents'); return false;">Documents</a>
              <a href="#ai-assistant" class="nav-link px-3 py-2 rounded-md font-medium hover:bg-legal-secondary" onclick="showSection('ai-assistant'); return false;">AI Assistant</a>
              <a href="#schedule" class="nav-link px-3 py-2 rounded-md font-medium hover:bg-legal-secondary" onclick="showSection('schedule'); return false;">Schedule</a>
              <a href="#clients" class="nav-link px-3 py-2 rounded-md font-medium hover:bg-legal-secondary" onclick="showSection('clients'); return false;">Clients</a>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button class="language-toggle bg-legal-accent px-3 py-1 rounded text-sm" onclick="toggleLanguage()">EN / AR</button>
            <button class="btn-gold text-legal-primary px-4 py-2 rounded font-medium" onclick="showProfile()"><i class="fas fa-user-circle mr-2"></i>Profile</button>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <section id="dashboard" class="section active">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div class="card bg-gradient-to-br from-slate-900 to-slate-700 text-white lg:col-span-2">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p class="uppercase tracking-widest text-slate-300 text-xs">AI Legal Operating System</p>
                <h2 class="text-3xl font-bold mt-2">All legal work in one bilingual workspace</h2>
                <p class="mt-3 text-slate-200 max-w-2xl">Track matters, draft documents, analyze contracts, manage clients, and coordinate deadlines across GCC jurisdictions.</p>
              </div>
              <div class="flex gap-3 flex-wrap">
                <button class="btn-primary" onclick="showSection('cases')">Open Cases</button>
                <button class="btn-secondary" onclick="showSection('documents')">Draft Document</button>
                <button class="btn-outline" onclick="showSection('ai-assistant')">Ask AI</button>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-gray-700">Health</h3>
              <span class="status-pill success">Online</span>
            </div>
            <div class="space-y-3 text-sm">
              <div class="flex justify-between"><span>Cases</span><strong>2 active</strong></div>
              <div class="flex justify-between"><span>Documents</span><strong>14 generated</strong></div>
              <div class="flex justify-between"><span>AI prompts</span><strong>48 today</strong></div>
              <div class="flex justify-between"><span>Jurisdictions</span><strong>GCC + Intl</strong></div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div class="card metric-card"><div class="metric-label">Active Cases</div><div class="metric-value">18</div><div class="metric-foot">2 urgent this week</div></div>
          <div class="card metric-card"><div class="metric-label">Drafted Docs</div><div class="metric-value">127</div><div class="metric-foot">7 templates ready</div></div>
          <div class="card metric-card"><div class="metric-label">Clients</div><div class="metric-value">39</div><div class="metric-foot">6 VIP matters</div></div>
          <div class="card metric-card"><div class="metric-label">AI Analyses</div><div class="metric-value">84</div><div class="metric-foot">Avg risk score 41%</div></div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="card xl:col-span-2">
            <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-semibold">Recent Activities</h3><button class="text-sm text-legal-accent" onclick="showSection('cases')">View all</button></div>
            <div class="space-y-4">
              <div class="activity-item"><span class="activity-dot bg-green-500"></span><div><p class="font-medium">Case #2024-001 status updated to <span class="text-green-700">Under Review</span></p><p class="text-sm text-gray-500">Commercial dispute • 2 hours ago</p></div></div>
              <div class="activity-item"><span class="activity-dot bg-blue-500"></span><div><p class="font-medium">AI generated contract draft for ABC Corp</p><p class="text-sm text-gray-500">Commercial contract • 4 hours ago</p></div></div>
              <div class="activity-item"><span class="activity-dot bg-amber-500"></span><div><p class="font-medium">Brand variables saved for legal letterhead</p><p class="text-sm text-gray-500">Branding module • Yesterday</p></div></div>
            </div>
          </div>
          <div class="card">
            <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-semibold">Quick Actions</h3><span class="text-xs text-gray-400">Bilingual</span></div>
            <div class="grid grid-cols-1 gap-3">
              <button class="quick-action-btn" onclick="showSection('cases')"><i class="fas fa-folder-plus text-legal-accent mr-3"></i>New Case</button>
              <button class="quick-action-btn" onclick="showSection('documents')"><i class="fas fa-file-contract text-green-500 mr-3"></i>Generate Document</button>
              <button class="quick-action-btn" onclick="showSection('ai-assistant')"><i class="fas fa-brain text-purple-500 mr-3"></i>AI Analysis</button>
              <button class="quick-action-btn" onclick="showSection('schedule')"><i class="fas fa-calendar-alt text-blue-500 mr-3"></i>Calendar</button>
            </div>
          </div>
        </div>
      </section>

      <section id="cases" class="section">
        <div class="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h2 class="text-2xl font-bold">Cases</h2>
            <p class="text-gray-500">Manage legal matters, jurisdictions, and timelines.</p>
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn-secondary text-sm" onclick="showNewCaseForm()">New Case</button>
            <button class="btn-outline text-sm" onclick="filterCases('all')">All</button>
            <button class="btn-outline text-sm" onclick="filterCases('active')">Active</button>
            <button class="btn-outline text-sm" onclick="filterCases('under_review')">Under Review</button>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div class="card">
            <h3 class="font-semibold mb-3">Case #2024-001</h3>
            <p class="text-sm text-gray-500">ABC Corp vs XYZ Ltd</p>
            <div class="mt-4 space-y-2 text-sm">
              <div><strong>Type:</strong> Commercial dispute</div>
              <div><strong>Jurisdiction:</strong> UAE</div>
              <div><strong>Priority:</strong> High</div>
            </div>
            <div class="mt-4 flex gap-2">
              <button class="btn-primary text-sm" onclick="viewClientDetails('abc-corp')">Open</button>
              <button class="btn-secondary text-sm" onclick="showSection('documents')">Docs</button>
            </div>
          </div>
          <div class="card">
            <h3 class="font-semibold mb-3">Case #2024-002</h3>
            <p class="text-sm text-gray-500">Personal Injury Claim</p>
            <div class="mt-4 space-y-2 text-sm">
              <div><strong>Type:</strong> Personal injury</div>
              <div><strong>Jurisdiction:</strong> UAE</div>
              <div><strong>Priority:</strong> Medium</div>
            </div>
            <div class="mt-4 flex gap-2">
              <button class="btn-primary text-sm" onclick="viewClientDetails('mohamed-ahmed')">Open</button>
              <button class="btn-secondary text-sm" onclick="showSection('schedule')">Timeline</button>
            </div>
          </div>
          <div class="card border-dashed border-2 border-slate-300 flex items-center justify-center min-h-[220px] text-center">
            <div>
              <i class="fas fa-plus-circle text-4xl text-slate-300 mb-3"></i>
              <p class="font-medium">Create a new legal case</p>
              <button class="btn-primary mt-4" onclick="showNewCaseForm()">New Case</button>
            </div>
          </div>
        </div>

        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th class="px-4 py-3 text-left">Case</th>
                  <th class="px-4 py-3 text-left">Client</th>
                  <th class="px-4 py-3 text-left">Jurisdiction</th>
                  <th class="px-4 py-3 text-left">Status</th>
                  <th class="px-4 py-3 text-left">Priority</th>
                </tr>
              </thead>
              <tbody id="case-table-body">
                <tr><td class="px-4 py-3">ABC Corp vs XYZ Ltd</td><td class="px-4 py-3">ABC Corporation</td><td class="px-4 py-3">UAE</td><td class="px-4 py-3">Active</td><td class="px-4 py-3">High</td></tr>
                <tr class="border-t"><td class="px-4 py-3">Personal Injury Claim</td><td class="px-4 py-3">محمد أحمد علي</td><td class="px-4 py-3">UAE</td><td class="px-4 py-3">Under Review</td><td class="px-4 py-3">Medium</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="documents" class="section">
        <div class="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h2 class="text-2xl font-bold">Documents</h2>
            <p class="text-gray-500">Draft, review, edit, download, and save legal documents.</p>
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn-secondary text-sm" onclick="generateDocument()">Generate</button>
            <button class="btn-outline text-sm" onclick="reviewDocument()">Review</button>
            <button class="btn-outline text-sm" onclick="editDocument()">Edit</button>
            <button class="btn-outline text-sm" onclick="downloadDocument()">Download</button>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="card xl:col-span-2">
            <div class="flex items-center justify-between mb-4"><h3 class="font-semibold">Document Library</h3><button class="text-sm text-legal-accent" onclick="createNewTemplate()">New Template</button></div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="doc-card"><div class="doc-title">Commercial Contract</div><div class="doc-meta">UAE • Draft</div><div class="mt-3 flex gap-2"><button class="btn-primary text-sm" onclick="reviewDocument()">Review</button><button class="btn-secondary text-sm" onclick="downloadDocument()">Download</button></div></div>
              <div class="doc-card"><div class="doc-title">Power of Attorney</div><div class="doc-meta">GCC • Template</div><div class="mt-3 flex gap-2"><button class="btn-primary text-sm" onclick="saveToCase()">Save</button><button class="btn-secondary text-sm" onclick="editDocument()">Edit</button></div></div>
            </div>
          </div>
          <div class="card">
            <h3 class="font-semibold mb-4">Branding</h3>
            <div class="space-y-3 text-sm">
              <button class="btn-secondary w-full" onclick="showBrandSettings()">Brand Settings</button>
              <button class="btn-primary w-full" onclick="createLetterhead()">Create Letterhead</button>
              <button class="btn-outline w-full" onclick="testBrandingSystem()">Test Branding</button>
            </div>
            <div class="mt-4 text-sm text-gray-500">
              Upload logos, watermarks, and stamp assets for professional output.
            </div>
          </div>
        </div>
      </section>

      <section id="ai-assistant" class="section">
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="card xl:col-span-2">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-2xl font-bold">AI Assistant</h2>
              <span class="status-pill success">GPT Ready</span>
            </div>
            <div id="ai-chat" class="chat-panel mb-4">
              <div class="chat-bubble bot">Ask a legal question, upload documents, or request research.</div>
            </div>
            <div class="flex gap-2">
              <input id="ai-message" class="input flex-1" placeholder="Type your legal question..." />
              <button class="btn-primary" onclick="sendAIMessage()">Send</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <button class="quick-chat-btn" onclick="quickAIQueryBilingual('How do I file a commercial dispute in UAE?', 'كيف يمكنني رفع نزاع تجاري في دولة الإمارات العربية المتحدة؟')">Commercial dispute</button>
              <button class="quick-chat-btn" onclick="quickAIQueryBilingual('Review this contract for compliance issues', 'راجع هذا العقد للتأكد من مسائل الامتثال')">Contract review</button>
              <button class="quick-chat-btn" onclick="quickAIQueryBilingual('Help me with GCC legal research', 'ساعدني في البحث القانوني الخليجي')">GCC research</button>
              <button class="quick-chat-btn" onclick="quickAIQueryBilingual('What are the labor law requirements in Qatar?', 'ما هي متطلبات قانون العمل في دولة قطر؟')">Labor law</button>
            </div>
          </div>
          <div class="card">
            <h3 class="font-semibold mb-4">Document Analysis</h3>
            <div class="space-y-3 text-sm">
              <div class="analysis-item"><strong>Risk score:</strong> 41%</div>
              <div class="analysis-item"><strong>Compliance:</strong> Review recommended</div>
              <div class="analysis-item"><strong>Missing clauses:</strong> Governing law, signatures</div>
            </div>
            <button class="btn-secondary w-full mt-4" onclick="analyzeAllDocuments()">Analyze Documents</button>
            <button class="btn-outline w-full mt-3" onclick="clearAllDocuments()">Clear Documents</button>
          </div>
        </div>
      </section>

      <section id="schedule" class="section">
        <div class="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h2 class="text-2xl font-bold">Schedule</h2>
            <p class="text-gray-500">Calendar, reminders, hearings, and deadlines.</p>
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn-secondary text-sm" onclick="previousMonth()">Prev</button>
            <button class="btn-outline text-sm" onclick="todayView()">Today</button>
            <button class="btn-secondary text-sm" onclick="nextMonth()">Next</button>
            <button class="btn-primary text-sm" onclick="showNewEventModal()">New Event</button>
          </div>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div class="card xl:col-span-2">
            <div class="calendar-grid">
              <div class="calendar-header">Sun</div><div class="calendar-header">Mon</div><div class="calendar-header">Tue</div><div class="calendar-header">Wed</div><div class="calendar-header">Thu</div><div class="calendar-header">Fri</div><div class="calendar-header">Sat</div>
              <div class="calendar-day muted">28</div><div class="calendar-day muted">29</div><div class="calendar-day muted">30</div><div class="calendar-day">1</div><div class="calendar-day">2</div><div class="calendar-day today">3</div><div class="calendar-day">4</div>
              <div class="calendar-day">5</div><div class="calendar-day">6</div><div class="calendar-day event">7</div><div class="calendar-day">8</div><div class="calendar-day">9</div><div class="calendar-day">10</div><div class="calendar-day">11</div>
              <div class="calendar-day">12</div><div class="calendar-day event">13</div><div class="calendar-day">14</div><div class="calendar-day">15</div><div class="calendar-day">16</div><div class="calendar-day">17</div><div class="calendar-day">18</div>
              <div class="calendar-day">19</div><div class="calendar-day">20</div><div class="calendar-day">21</div><div class="calendar-day">22</div><div class="calendar-day event">23</div><div class="calendar-day">24</div><div class="calendar-day">25</div>
              <div class="calendar-day">26</div><div class="calendar-day">27</div><div class="calendar-day">28</div><div class="calendar-day">29</div><div class="calendar-day">30</div><div class="calendar-day">31</div><div class="calendar-day muted">1</div>
            </div>
          </div>
          <div class="card">
            <h3 class="font-semibold mb-4">Upcoming</h3>
            <div class="space-y-3 text-sm">
              <div class="timeline-item"><strong>7 Jul</strong><div>Hearing with opposing counsel</div></div>
              <div class="timeline-item"><strong>13 Jul</strong><div>Client review meeting</div></div>
              <div class="timeline-item"><strong>23 Jul</strong><div>Document filing deadline</div></div>
            </div>
            <button class="btn-outline w-full mt-4" onclick="showNewEventModal()">Add event</button>
          </div>
        </div>
      </section>

      <section id="clients" class="section">
        <div class="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h2 class="text-2xl font-bold">Clients</h2>
            <p class="text-gray-500">Client profiles, contacts, and matter assignment.</p>
          </div>
          <button class="btn-secondary text-sm" onclick="showAddClientForm()">Add Client</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div class="client-card cursor-pointer" onclick="viewClientDetails('abc-corp')"><div class="client-name">ABC Corporation</div><div class="client-meta">Commercial dispute • UAE</div><div class="mt-3 text-sm text-gray-500">Primary contact: procurement@abccorp.com</div></div>
          <div class="client-card cursor-pointer" onclick="viewClientDetails('mohamed-ahmed')"><div class="client-name">محمد أحمد علي</div><div class="client-meta">Personal injury • UAE</div><div class="mt-3 text-sm text-gray-500">Mobile: +968 9xxxxxxx</div></div>
          <div class="client-card cursor-pointer" onclick="viewClientDetails('emirates-trading')"><div class="client-name">Emirates Trading LLC</div><div class="client-meta">Corporate • GCC</div><div class="mt-3 text-sm text-gray-500">Portfolio: 4 matters</div></div>
        </div>
      </section>
    </main>
  </div>

  <div id="profile-modal" class="modal hidden"><div class="modal-backdrop" onclick="closeProfile()"></div><div class="modal-panel"><h3 class="text-xl font-bold mb-3">Profile</h3><p>Fathi Al Riyami — Founder</p><button class="btn-primary mt-4" onclick="closeProfile()">Close</button></div></div>
  <div id="new-case-modal" class="modal hidden"><div class="modal-backdrop" onclick="closeNewCaseForm()"></div><div class="modal-panel"><h3 class="text-xl font-bold mb-3">New Case</h3><p>Create a new legal matter.</p><button class="btn-primary mt-4" onclick="closeNewCaseForm()">Close</button></div></div>
  <div id="new-event-modal" class="modal hidden"><div class="modal-backdrop" onclick="closeEventModal()"></div><div class="modal-panel"><h3 class="text-xl font-bold mb-3">New Event</h3><p>Schedule a hearing, deadline, or reminder.</p><button class="btn-primary mt-4" onclick="closeEventModal()">Close</button></div></div>
  <div id="review-modal" class="modal hidden"><div class="modal-backdrop" onclick="closeReviewModal()"></div><div class="modal-panel"><h3 class="text-xl font-bold mb-3">Review Document</h3><p>Review your generated document before download.</p><button class="btn-primary mt-4" onclick="closeReviewModal()">Close</button></div></div>
  <div id="brand-modal" class="modal hidden"><div class="modal-backdrop" onclick="closeBrandSettings()"></div><div class="modal-panel"><h3 class="text-xl font-bold mb-3">Brand Settings</h3><p>Logo, watermark, colors, and letterhead.</p><button class="btn-primary mt-4" onclick="closeBrandSettings()">Close</button></div></div>

  <script src="/static/test-navigation.js?v=20251022-2100" cache="no-cache"></script>
  <script src="/static/app.js?v=20251022-2000" cache="no-cache"></script>
</body>
</html>`

app.get('/', (c) => c.html(page))
app.get('/health', (c) => c.json({ status: 'healthy', service: 'TrustiqLegal Platform', timestamp: new Date().toISOString() }))

// Start the Node.js server
const port = Number(process.env.PORT) || 8080
serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
})

console.log(`🚀 TrustiqLegal Platform running on port ${port}`)

