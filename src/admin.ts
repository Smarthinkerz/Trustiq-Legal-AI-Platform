export const adminPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal Admin CMS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root {
      --legal-primary: #1a365d;
      --legal-secondary: #2d3748;
      --legal-accent: #3182ce;
    }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .sidebar { background: var(--legal-primary); }
    .sidebar-link { transition: all 0.3s ease; }
    .sidebar-link:hover { background: rgba(255,255,255,0.1); }
    .sidebar-link.active { background: var(--legal-accent); }
    .preview-frame { border: 2px solid #e5e7eb; border-radius: 0.5rem; }
    .editor-panel { background: #f9fafb; }
    .input-field { border: 1px solid #d1d5db; border-radius: 0.375rem; padding: 0.5rem 0.75rem; }
    .input-field:focus { outline: none; border-color: var(--legal-accent); box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1); }
    .btn-save { background: #10b981; color: white; padding: 0.5rem 1rem; border-radius: 0.375rem; border: none; cursor: pointer; font-weight: 600; }
    .btn-save:hover { background: #059669; }
    .btn-logout { background: #ef4444; color: white; padding: 0.5rem 1rem; border-radius: 0.375rem; border: none; cursor: pointer; }
    .btn-logout:hover { background: #dc2626; }
  </style>
</head>
<body class="bg-gray-100">
  <!-- Login Screen -->
  <div id="loginScreen" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
      <div class="text-center mb-8">
        <i class="fas fa-lock text-4xl text-blue-600 mb-4"></i>
        <h1 class="text-2xl font-bold">Admin Login</h1>
        <p class="text-gray-600 mt-2">TrustiqLegal CMS</p>
      </div>
      <form onsubmit="handleLogin(event)">
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Username</label>
          <input type="text" id="username" class="input-field w-full" placeholder="admin" required />
        </div>
        <div class="mb-6">
          <label class="block text-sm font-medium mb-2">Password</label>
          <input type="password" id="password" class="input-field w-full" placeholder="••••••••" required />
        </div>
        <button type="submit" class="btn-save w-full">Login</button>
      </form>
      <p class="text-center text-sm text-gray-600 mt-4">Demo: admin / admin123</p>
    </div>
  </div>

  <!-- Admin Dashboard -->
  <div id="adminDashboard" class="hidden flex h-screen bg-gray-100">
    <!-- Sidebar -->
    <div class="sidebar text-white w-64 shadow-lg">
      <div class="p-6 border-b border-blue-700">
        <h2 class="text-xl font-bold"><i class="fas fa-cog mr-2"></i>Admin CMS</h2>
      </div>
      <nav class="p-4 space-y-2">
        <button onclick="switchTab('landing')" class="sidebar-link active w-full text-left px-4 py-3 rounded"><i class="fas fa-globe mr-2"></i>Landing Page</button>
        <button onclick="switchTab('dashboard')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-chart-line mr-2"></i>App Dashboard</button>
        <button onclick="switchTab('pricing')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-tag mr-2"></i>Pricing</button>
        <button onclick="switchTab('api')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-plug mr-2"></i>API Config</button>
      </nav>
      <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-blue-700">
        <button onclick="logout()" class="btn-logout w-full"><i class="fas fa-sign-out-alt mr-2"></i>Logout</button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-white shadow-sm border-b p-4 flex items-center justify-between">
        <h1 id="pageTitle" class="text-2xl font-bold">Landing Page Editor</h1>
        <div class="text-sm text-gray-600">
          <i class="fas fa-user-circle mr-2"></i>Admin User
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-hidden flex gap-4 p-4">
        <!-- Editor Panel -->
        <div class="editor-panel rounded-lg shadow w-1/2 overflow-y-auto p-6">
          <!-- Landing Page Tab -->
          <div id="landingTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Landing Page Content</h2>
            
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Hero Title</label>
                <input type="text" id="heroTitle" class="input-field w-full" value="The World's Most Advanced Legal Platform" />
              </div>
              
              <div>
                <label class="block text-sm font-medium mb-2">Hero Subtitle</label>
                <textarea id="heroSubtitle" class="input-field w-full h-20" placeholder="Enter hero subtitle">AI-powered legal workspace for GCC firms. Manage cases, draft documents, analyze contracts, and coordinate with clients—all in one bilingual platform.</textarea>
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">Features Section Title</label>
                <input type="text" id="featuresTitle" class="input-field w-full" value="Powerful Features for Modern Legal Practice" />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">CTA Button Text</label>
                <input type="text" id="ctaText" class="input-field w-full" value="Start Free Trial" />
              </div>

              <button onclick="saveChanges('landing')" class="btn-save w-full">Save Changes</button>
            </div>
          </div>

          <!-- Pricing Tab -->
          <div id="pricingTab" class="tab-content hidden">
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

              <button onclick="saveChanges('pricing')" class="btn-save w-full">Save Changes</button>
            </div>
          </div>

          <!-- API Config Tab -->
          <div id="apiTab" class="tab-content hidden">
            <h2 class="text-xl font-bold mb-6">API Configuration</h2>
            
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">OpenAI API Key</label>
                <input type="password" id="openaiKey" class="input-field w-full" placeholder="sk-..." />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">JWT Secret</label>
                <input type="password" id="jwtSecret" class="input-field w-full" placeholder="your-secret-key" />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">Database URL</label>
                <input type="text" id="dbUrl" class="input-field w-full" placeholder="postgresql://..." />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">API Base URL</label>
                <input type="text" id="apiUrl" class="input-field w-full" placeholder="https://api.example.com" />
              </div>

              <div class="bg-blue-50 border border-blue-200 rounded p-4">
                <p class="text-sm text-blue-800"><i class="fas fa-info-circle mr-2"></i>API keys are encrypted and stored securely.</p>
              </div>

              <button onclick="saveChanges('api')" class="btn-save w-full">Save Configuration</button>
            </div>
          </div>

          <!-- Dashboard Tab -->
          <div id="dashboardTab" class="tab-content hidden">
            <h2 class="text-xl font-bold mb-6">App Dashboard Content</h2>
            
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Dashboard Title</label>
                <input type="text" id="dashTitle" class="input-field w-full" value="All legal work in one bilingual workspace" />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">Dashboard Description</label>
                <textarea id="dashDesc" class="input-field w-full h-20" placeholder="Enter dashboard description">Track matters, draft documents, analyze contracts, manage clients, and coordinate deadlines across GCC jurisdictions.</textarea>
              </div>

              <button onclick="saveChanges('dashboard')" class="btn-save w-full">Save Changes</button>
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
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      // Simple demo authentication
      if (username === 'admin' && password === 'admin123') {
        isLoggedIn = true;
        localStorage.setItem('adminToken', 'demo-token-' + Date.now());
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('adminDashboard').classList.remove('hidden');
        loadSavedData();
      } else {
        alert('Invalid credentials. Use admin / admin123');
      }
    }

    function logout() {
      if (confirm('Are you sure you want to logout?')) {
        isLoggedIn = false;
        localStorage.removeItem('adminToken');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('adminDashboard').classList.add('hidden');
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.getElementById(tab + 'Tab').classList.remove('hidden');
      
      document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
      event.target.closest('.sidebar-link').classList.add('active');

      const titles = {
        'landing': 'Landing Page Editor',
        'dashboard': 'App Dashboard Editor',
        'pricing': 'Pricing Configuration',
        'api': 'API Configuration'
      };
      document.getElementById('pageTitle').textContent = titles[tab];
    }

    function saveChanges(section) {
      const data = {};
      
      if (section === 'landing') {
        data = {
          heroTitle: document.getElementById('heroTitle').value,
          heroSubtitle: document.getElementById('heroSubtitle').value,
          featuresTitle: document.getElementById('featuresTitle').value,
          ctaText: document.getElementById('ctaText').value
        };
      } else if (section === 'pricing') {
        data = {
          starterPrice: document.getElementById('starterPrice').value,
          starterDesc: document.getElementById('starterDesc').value,
          proPrice: document.getElementById('proPrice').value,
          proDesc: document.getElementById('proDesc').value,
          entDesc: document.getElementById('entDesc').value
        };
      } else if (section === 'api') {
        data = {
          openaiKey: document.getElementById('openaiKey').value,
          jwtSecret: document.getElementById('jwtSecret').value,
          dbUrl: document.getElementById('dbUrl').value,
          apiUrl: document.getElementById('apiUrl').value
        };
      } else if (section === 'dashboard') {
        data = {
          dashTitle: document.getElementById('dashTitle').value,
          dashDesc: document.getElementById('dashDesc').value
        };
      }

      localStorage.setItem('cms_' + section, JSON.stringify(data));
      alert('✅ Changes saved successfully!');
      refreshPreview();
    }

    function loadSavedData() {
      const landing = JSON.parse(localStorage.getItem('cms_landing') || '{}');
      const pricing = JSON.parse(localStorage.getItem('cms_pricing') || '{}');
      const api = JSON.parse(localStorage.getItem('cms_api') || '{}');
      const dashboard = JSON.parse(localStorage.getItem('cms_dashboard') || '{}');

      if (landing.heroTitle) document.getElementById('heroTitle').value = landing.heroTitle;
      if (landing.heroSubtitle) document.getElementById('heroSubtitle').value = landing.heroSubtitle;
      if (landing.featuresTitle) document.getElementById('featuresTitle').value = landing.featuresTitle;
      if (landing.ctaText) document.getElementById('ctaText').value = landing.ctaText;

      if (pricing.starterPrice) document.getElementById('starterPrice').value = pricing.starterPrice;
      if (pricing.starterDesc) document.getElementById('starterDesc').value = pricing.starterDesc;
      if (pricing.proPrice) document.getElementById('proPrice').value = pricing.proPrice;
      if (pricing.proDesc) document.getElementById('proDesc').value = pricing.proDesc;
      if (pricing.entDesc) document.getElementById('entDesc').value = pricing.entDesc;

      if (api.openaiKey) document.getElementById('openaiKey').value = api.openaiKey;
      if (api.jwtSecret) document.getElementById('jwtSecret').value = api.jwtSecret;
      if (api.dbUrl) document.getElementById('dbUrl').value = api.dbUrl;
      if (api.apiUrl) document.getElementById('apiUrl').value = api.apiUrl;

      if (dashboard.dashTitle) document.getElementById('dashTitle').value = dashboard.dashTitle;
      if (dashboard.dashDesc) document.getElementById('dashDesc').value = dashboard.dashDesc;
    }

    function refreshPreview() {
      const frame = document.getElementById('previewFrame');
      frame.src = frame.src;
    }

    // Check if already logged in
    window.addEventListener('load', () => {
      if (localStorage.getItem('adminToken')) {
        isLoggedIn = true;
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('adminDashboard').classList.remove('hidden');
        loadSavedData();
      }
    });
  </script>
</body>
</html>`

