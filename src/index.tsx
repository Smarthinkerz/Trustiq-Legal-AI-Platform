import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { renderer } from './renderer'
import { landingPage } from './landing'

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

// ============ CMS ADMIN PAGE ============
const cmsAdminPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal CMS Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root { --primary: #1a365d; --secondary: #2d3748; --accent: #3182ce; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .sidebar { background: var(--primary); }
    .sidebar-link { transition: all 0.3s ease; }
    .sidebar-link:hover { background: rgba(255,255,255,0.1); }
    .sidebar-link.active { background: var(--accent); }
    .input-field { border: 1px solid #d1d5db; border-radius: 0.375rem; padding: 0.5rem 0.75rem; }
    .input-field:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1); }
    .btn-primary { background: var(--accent); color: white; padding: 0.5rem 1rem; border-radius: 0.375rem; border: none; cursor: pointer; font-weight: 600; }
    .btn-primary:hover { background: #2563eb; }
    .btn-danger { background: #ef4444; color: white; padding: 0.5rem 1rem; border-radius: 0.375rem; border: none; cursor: pointer; }
    .btn-danger:hover { background: #dc2626; }
    .editor-panel { background: #f9fafb; }
    .preview-frame { border: 2px solid #e5e7eb; border-radius: 0.5rem; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body class="bg-gray-100">
  <!-- Login Screen -->
  <div id="loginScreen" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
      <div class="text-center mb-8">
        <i class="fas fa-lock text-4xl text-blue-600 mb-4"></i>
        <h1 class="text-2xl font-bold">CMS Admin Login</h1>
        <p class="text-gray-600 mt-2">TrustiqLegal Content Management</p>
      </div>
      <form onsubmit="handleLogin(event)">
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Email</label>
          <input type="email" id="email" class="input-field w-full" placeholder="admin@trustiqlegal.com" required />
        </div>
        <div class="mb-6">
          <label class="block text-sm font-medium mb-2">Password</label>
          <input type="password" id="password" class="input-field w-full" placeholder="••••••••" required />
        </div>
        <button type="submit" class="btn-primary w-full">Login</button>
      </form>
      <p class="text-center text-sm text-gray-600 mt-4">Demo: admin@trustiqlegal.com / admin123</p>
    </div>
  </div>

  <!-- CMS Dashboard -->
  <div id="cmsDashboard" class="hidden flex h-screen bg-gray-100">
    <!-- Sidebar -->
    <div class="sidebar text-white w-64 shadow-lg overflow-y-auto">
      <div class="p-6 border-b border-blue-700">
        <h2 class="text-xl font-bold"><i class="fas fa-cog mr-2"></i>CMS Admin</h2>
        <p class="text-sm text-blue-200 mt-1">TrustiqLegal</p>
      </div>
      <nav class="p-4 space-y-2">
        <button onclick="switchTab('landing')" class="sidebar-link active w-full text-left px-4 py-3 rounded"><i class="fas fa-globe mr-2"></i>Landing Page</button>
        <button onclick="switchTab('app')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-chart-line mr-2"></i>App Dashboard</button>
        <button onclick="switchTab('pricing')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-tag mr-2"></i>Pricing</button>
        <button onclick="switchTab('theme')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-palette mr-2"></i>Theme</button>
      </nav>
      <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-blue-700">
        <button onclick="logout()" class="btn-danger w-full"><i class="fas fa-sign-out-alt mr-2"></i>Logout</button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-white shadow-sm border-b p-4 flex items-center justify-between">
        <h1 id="pageTitle" class="text-2xl font-bold">Landing Page Editor</h1>
        <div class="text-sm text-gray-600"><i class="fas fa-user-circle mr-2"></i><span id="userEmail">admin@trustiqlegal.com</span></div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-hidden flex gap-4 p-4">
        <!-- Editor Panel -->
        <div class="editor-panel rounded-lg shadow w-1/2 overflow-y-auto p-6">
          <!-- Landing Page Tab -->
          <div id="landingTab" class="tab-content active">
            <h2 class="text-xl font-bold mb-6">Landing Page Content</h2>
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Hero Title</label>
                <input type="text" id="heroTitle" class="input-field w-full" value="The World's Most Advanced Legal Platform" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-2">Hero Subtitle</label>
                <textarea id="heroSubtitle" class="input-field w-full h-20">AI-powered legal workspace for GCC firms. Manage cases, draft documents, analyze contracts, and coordinate with clients—all in one bilingual platform.</textarea>
              </div>
              <div>
                <label class="block text-sm font-medium mb-2">CTA Button Text</label>
                <input type="text" id="ctaText" class="input-field w-full" value="Start Free Trial" />
              </div>
              <button onclick="saveContent('landing')" class="btn-primary w-full">Save Changes</button>
            </div>
          </div>

          <!-- App Dashboard Tab -->
          <div id="appTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">App Dashboard Content</h2>
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Dashboard Title</label>
                <input type="text" id="appTitle" class="input-field w-full" value="All legal work in one bilingual workspace" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-2">Dashboard Description</label>
                <textarea id="appDesc" class="input-field w-full h-20">Track matters, draft documents, analyze contracts, manage clients, and coordinate deadlines across GCC jurisdictions.</textarea>
              </div>
              <button onclick="saveContent('app')" class="btn-primary w-full">Save Changes</button>
            </div>
          </div>

          <!-- Pricing Tab -->
          <div id="pricingTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Pricing Configuration</h2>
            <div class="space-y-6">
              <div class="border-b pb-4">
                <h3 class="font-semibold mb-3">Starter Plan</h3>
                <div class="mb-3">
                  <label class="block text-sm font-medium mb-2">Price (OMR)</label>
                  <input type="number" id="starterPrice" class="input-field w-full" value="199" />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-2">Description</label>
                  <input type="text" id="starterDesc" class="input-field w-full" value="For solo practitioners and small firms" />
                </div>
              </div>
              <div class="border-b pb-4">
                <h3 class="font-semibold mb-3">Professional Plan</h3>
                <div class="mb-3">
                  <label class="block text-sm font-medium mb-2">Price (OMR)</label>
                  <input type="number" id="proPrice" class="input-field w-full" value="499" />
                </div>
                <div>
                  <label class="block text-sm font-medium mb-2">Description</label>
                  <input type="text" id="proDesc" class="input-field w-full" value="For growing law firms" />
                </div>
              </div>
              <div>
                <h3 class="font-semibold mb-3">Enterprise Plan</h3>
                <div>
                  <label class="block text-sm font-medium mb-2">Description</label>
                  <input type="text" id="entDesc" class="input-field w-full" value="For large firms and organizations" />
                </div>
              </div>
              <button onclick="saveContent('pricing')" class="btn-primary w-full">Save Changes</button>
            </div>
          </div>

          <!-- Theme Tab -->
          <div id="themeTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Theme Customization</h2>
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Primary Color</label>
                <div class="flex gap-2">
                  <input type="color" id="colorPrimary" class="w-12 h-10 rounded cursor-pointer" value="#1a365d" />
                  <input type="text" id="colorPrimaryText" class="input-field flex-1" value="#1a365d" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium mb-2">Accent Color</label>
                <div class="flex gap-2">
                  <input type="color" id="colorAccent" class="w-12 h-10 rounded cursor-pointer" value="#3182ce" />
                  <input type="text" id="colorAccentText" class="input-field flex-1" value="#3182ce" />
                </div>
              </div>
              <button onclick="saveTheme()" class="btn-primary w-full">Save Theme</button>
            </div>
          </div>
        </div>

        <!-- Live Preview Panel -->
        <div class="bg-white rounded-lg shadow w-1/2 overflow-hidden flex flex-col">
          <div class="bg-gray-200 p-3 border-b flex items-center justify-between">
            <h3 class="font-semibold"><i class="fas fa-eye mr-2"></i>Live Preview</h3>
            <button onclick="refreshPreview()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              <i class="fas fa-sync mr-1"></i>Refresh
            </button>
          </div>
          <iframe id="previewFrame" class="preview-frame flex-1 border-0" src="/"></iframe>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentTab = 'landing';
    let isLoggedIn = false;

    function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      if (email === 'admin@trustiqlegal.com' && password === 'admin123') {
        isLoggedIn = true;
        localStorage.setItem('cmsToken', 'token-' + Date.now());
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('cmsDashboard').classList.remove('hidden');
        document.getElementById('userEmail').textContent = email;
        loadSavedData();
      } else {
        alert('Invalid credentials. Use admin@trustiqlegal.com / admin123');
      }
    }

    function logout() {
      if (confirm('Are you sure you want to logout?')) {
        isLoggedIn = false;
        localStorage.removeItem('cmsToken');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('cmsDashboard').classList.add('hidden');
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.getElementById(tab + 'Tab').classList.add('active');
      
      document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
      event.target.closest('.sidebar-link').classList.add('active');

      const titles = {
        'landing': 'Landing Page Editor',
        'app': 'App Dashboard Editor',
        'pricing': 'Pricing Configuration',
        'theme': 'Theme Customization'
      };
      document.getElementById('pageTitle').textContent = titles[tab];
    }

    function saveContent(type) {
      const data = {};
      
      if (type === 'landing') {
        data = {
          heroTitle: document.getElementById('heroTitle').value,
          heroSubtitle: document.getElementById('heroSubtitle').value,
          ctaText: document.getElementById('ctaText').value
        };
      } else if (type === 'app') {
        data = {
          appTitle: document.getElementById('appTitle').value,
          appDesc: document.getElementById('appDesc').value
        };
      } else if (type === 'pricing') {
        data = {
          starterPrice: document.getElementById('starterPrice').value,
          starterDesc: document.getElementById('starterDesc').value,
          proPrice: document.getElementById('proPrice').value,
          proDesc: document.getElementById('proDesc').value,
          entDesc: document.getElementById('entDesc').value
        };
      }

      localStorage.setItem('cms_' + type, JSON.stringify(data));
      alert('✅ Content saved successfully!');
      refreshPreview();
    }

    function saveTheme() {
      const theme = {
        primary: document.getElementById('colorPrimary').value,
        accent: document.getElementById('colorAccent').value
      };

      localStorage.setItem('cms_theme', JSON.stringify(theme));
      alert('✅ Theme saved successfully!');
      refreshPreview();
    }

    function loadSavedData() {
      const landing = JSON.parse(localStorage.getItem('cms_landing') || '{}');
      const app = JSON.parse(localStorage.getItem('cms_app') || '{}');
      const pricing = JSON.parse(localStorage.getItem('cms_pricing') || '{}');
      const theme = JSON.parse(localStorage.getItem('cms_theme') || '{}');

      if (landing.heroTitle) document.getElementById('heroTitle').value = landing.heroTitle;
      if (landing.heroSubtitle) document.getElementById('heroSubtitle').value = landing.heroSubtitle;
      if (landing.ctaText) document.getElementById('ctaText').value = landing.ctaText;

      if (app.appTitle) document.getElementById('appTitle').value = app.appTitle;
      if (app.appDesc) document.getElementById('appDesc').value = app.appDesc;

      if (pricing.starterPrice) document.getElementById('starterPrice').value = pricing.starterPrice;
      if (pricing.starterDesc) document.getElementById('starterDesc').value = pricing.starterDesc;
      if (pricing.proPrice) document.getElementById('proPrice').value = pricing.proPrice;
      if (pricing.proDesc) document.getElementById('proDesc').value = pricing.proDesc;
      if (pricing.entDesc) document.getElementById('entDesc').value = pricing.entDesc;

      if (theme.primary) document.getElementById('colorPrimary').value = theme.primary;
      if (theme.accent) document.getElementById('colorAccent').value = theme.accent;
    }

    function refreshPreview() {
      const frame = document.getElementById('previewFrame');
      frame.src = frame.src;
    }

    window.addEventListener('load', () => {
      if (localStorage.getItem('cmsToken')) {
        isLoggedIn = true;
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('cmsDashboard').classList.remove('hidden');
        loadSavedData();
      }
    });
  </script>
</body>
</html>`

// ============ APP DASHBOARD PAGE ============
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

// ============ ROUTES ============
app.get('/cms-admin', (c) => c.html(cmsAdminPage))
app.get('/', (c) => c.html(landingPage))
app.get('/app', (c) => c.html(appPage))
app.get('/health', (c) => c.json({ status: 'healthy', service: 'TrustiqLegal Platform', timestamp: new Date().toISOString() }))

// Start the Node.js server
const port = Number(process.env.PORT) || 8080
serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
})

console.log(`🚀 TrustiqLegal Platform running on port ${port}`)

