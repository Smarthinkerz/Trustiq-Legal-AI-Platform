export const cmsAdminPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal CMS Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root {
      --primary: #1a365d;
      --secondary: #2d3748;
      --accent: #3182ce;
    }
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
    .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; }
    .modal.active { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; border-radius: 0.5rem; padding: 2rem; max-width: 600px; width: 90%; }
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
        <button onclick="switchTab('media')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-images mr-2"></i>Media Library</button>
        <button onclick="switchTab('forms')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-wpforms mr-2"></i>Forms</button>
        <button onclick="switchTab('analytics')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-chart-bar mr-2"></i>Analytics</button>
        <button onclick="switchTab('seo')" class="sidebar-link w-full text-left px-4 py-3 rounded"><i class="fas fa-search mr-2"></i>SEO</button>
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
        <div class="text-sm text-gray-600">
          <i class="fas fa-user-circle mr-2"></i><span id="userEmail">admin@trustiqlegal.com</span>
        </div>
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

          <!-- Media Library Tab -->
          <div id="mediaTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Media Library</h2>
            
            <div class="space-y-6">
              <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <i class="fas fa-cloud-upload-alt text-4xl text-gray-400 mb-4"></i>
                <p class="text-gray-600 mb-4">Drag and drop files here or click to upload</p>
                <input type="file" id="mediaUpload" class="hidden" onchange="handleMediaUpload(event)" multiple />
                <button onclick="document.getElementById('mediaUpload').click()" class="btn-primary">Choose Files</button>
              </div>

              <div id="mediaList" class="grid grid-cols-2 gap-4">
                <!-- Media items will be added here -->
              </div>
            </div>
          </div>

          <!-- Forms Tab -->
          <div id="formsTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Forms Management</h2>
            
            <div class="space-y-6">
              <button onclick="showFormBuilder()" class="btn-primary w-full"><i class="fas fa-plus mr-2"></i>Create New Form</button>
              
              <div id="formsList" class="space-y-4">
                <!-- Forms will be listed here -->
              </div>
            </div>
          </div>

          <!-- Analytics Tab -->
          <div id="analyticsTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">Analytics Dashboard</h2>
            
            <div class="space-y-6">
              <div class="grid grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-lg border">
                  <p class="text-sm text-gray-600">Total Visitors</p>
                  <p class="text-3xl font-bold" id="totalVisitors">0</p>
                </div>
                <div class="bg-white p-4 rounded-lg border">
                  <p class="text-sm text-gray-600">Page Views</p>
                  <p class="text-3xl font-bold" id="totalPageViews">0</p>
                </div>
                <div class="bg-white p-4 rounded-lg border">
                  <p class="text-sm text-gray-600">Bounce Rate</p>
                  <p class="text-3xl font-bold" id="bounceRate">0%</p>
                </div>
                <div class="bg-white p-4 rounded-lg border">
                  <p class="text-sm text-gray-600">Avg Session</p>
                  <p class="text-3xl font-bold" id="avgSession">0s</p>
                </div>
              </div>

              <div id="analyticsChart" class="bg-white p-4 rounded-lg border">
                <p class="text-gray-600">Analytics data will appear here</p>
              </div>
            </div>
          </div>

          <!-- SEO Tab -->
          <div id="seoTab" class="tab-content">
            <h2 class="text-xl font-bold mb-6">SEO Settings</h2>
            
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Meta Title</label>
                <input type="text" id="metaTitle" class="input-field w-full" placeholder="Page title for search engines" />
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">Meta Description</label>
                <textarea id="metaDesc" class="input-field w-full h-20" placeholder="Page description for search engines"></textarea>
              </div>

              <div>
                <label class="block text-sm font-medium mb-2">Keywords</label>
                <input type="text" id="keywords" class="input-field w-full" placeholder="keyword1, keyword2, keyword3" />
              </div>

              <button onclick="saveSEO()" class="btn-primary w-full">Save SEO Settings</button>
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

              <div>
                <label class="block text-sm font-medium mb-2">Heading Font</label>
                <select id="fontHeading" class="input-field w-full">
                  <option>system-ui</option>
                  <option>Georgia</option>
                  <option>Times New Roman</option>
                  <option>Arial</option>
                </select>
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
    const API_BASE = '/api/cms';

    function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      fetch(\`\${API_BASE}/auth/login\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      .then(r => r.json())
      .then(data => {
        if (data.token) {
          isLoggedIn = true;
          localStorage.setItem('cmsToken', data.token);
          localStorage.setItem('cmsUser', JSON.stringify(data.user));
          document.getElementById('loginScreen').classList.add('hidden');
          document.getElementById('cmsDashboard').classList.remove('hidden');
          document.getElementById('userEmail').textContent = data.user.email;
          loadContent();
        } else {
          alert('Login failed: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(err => alert('Login error: ' + err.message));
    }

    function logout() {
      if (confirm('Are you sure you want to logout?')) {
        isLoggedIn = false;
        localStorage.removeItem('cmsToken');
        localStorage.removeItem('cmsUser');
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
        'media': 'Media Library',
        'forms': 'Forms Management',
        'analytics': 'Analytics Dashboard',
        'seo': 'SEO Settings',
        'theme': 'Theme Customization'
      };
      document.getElementById('pageTitle').textContent = titles[tab];
    }

    function saveContent(type) {
      const data = {};
      
      if (type === 'landing') {
        data = {
          type: 'landing',
          sections: {
            hero: {
              title: document.getElementById('heroTitle').value,
              subtitle: document.getElementById('heroSubtitle').value,
              ctaText: document.getElementById('ctaText').value
            }
          }
        };
      } else if (type === 'app') {
        data = {
          type: 'app',
          sections: {
            title: document.getElementById('appTitle').value,
            description: document.getElementById('appDesc').value
          }
        };
      } else if (type === 'pricing') {
        data = {
          type: 'landing',
          section: 'pricing',
          pricing: {
            starter: {
              price: document.getElementById('starterPrice').value,
              description: document.getElementById('starterDesc').value
            },
            professional: {
              price: document.getElementById('proPrice').value,
              description: document.getElementById('proDesc').value
            },
            enterprise: {
              description: document.getElementById('entDesc').value
            }
          }
        };
      }

      fetch(\`\${API_BASE}/content\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(r => r.json())
      .then(data => {
        alert('✅ Content saved successfully!');
        refreshPreview();
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function saveTheme() {
      const theme = {
        colors: {
          primary: document.getElementById('colorPrimary').value,
          accent: document.getElementById('colorAccent').value
        },
        fonts: {
          heading: document.getElementById('fontHeading').value
        }
      };

      fetch(\`\${API_BASE}/theme\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(theme)
      })
      .then(r => r.json())
      .then(data => {
        alert('✅ Theme saved successfully!');
        refreshPreview();
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function saveSEO() {
      const seo = {
        metaTitle: document.getElementById('metaTitle').value,
        metaDescription: document.getElementById('metaDesc').value,
        keywords: document.getElementById('keywords').value.split(',').map(k => k.trim())
      };

      fetch(\`\${API_BASE}/seo/landing\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seo)
      })
      .then(r => r.json())
      .then(data => {
        alert('✅ SEO settings saved!');
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function handleMediaUpload(e) {
      const files = e.target.files;
      for (let file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const mediaData = {
            filename: file.name,
            url: event.target.result,
            type: file.type.startsWith('image') ? 'image' : 'document',
            size: file.size
          };

          fetch(\`\${API_BASE}/media/upload\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mediaData)
          })
          .then(r => r.json())
          .then(data => {
            loadMedia();
          })
          .catch(err => console.error('Upload error:', err));
        };
        reader.readAsDataURL(file);
      }
    }

    function loadContent() {
      fetch(\`\${API_BASE}/content\`)
        .then(r => r.json())
        .then(data => {
          console.log('Content loaded:', data);
        })
        .catch(err => console.error('Load error:', err));
    }

    function loadMedia() {
      fetch(\`\${API_BASE}/media\`)
        .then(r => r.json())
        .then(data => {
          const mediaList = document.getElementById('mediaList');
          mediaList.innerHTML = data.map(m => \`
            <div class="bg-white p-4 rounded-lg border">
              <img src="\${m.url}" alt="\${m.filename}" class="w-full h-32 object-cover rounded mb-2" />
              <p class="text-sm font-medium truncate">\${m.filename}</p>
              <button onclick="deleteMedia('\${m.id}')" class="btn-danger text-sm w-full mt-2">Delete</button>
            </div>
          \`).join('');
        })
        .catch(err => console.error('Load error:', err));
    }

    function deleteMedia(id) {
      if (confirm('Delete this media?')) {
        fetch(\`\${API_BASE}/media/\${id}\`, { method: 'DELETE' })
          .then(r => r.json())
          .then(data => {
            loadMedia();
          })
          .catch(err => alert('Error: ' + err.message));
      }
    }

    function refreshPreview() {
      const frame = document.getElementById('previewFrame');
      frame.src = frame.src;
    }

    function showFormBuilder() {
      alert('Form builder coming soon!');
    }

    // Check if already logged in
    window.addEventListener('load', () => {
      if (localStorage.getItem('cmsToken')) {
        isLoggedIn = true;
        const user = JSON.parse(localStorage.getItem('cmsUser') || '{}');
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('cmsDashboard').classList.remove('hidden');
        document.getElementById('userEmail').textContent = user.email;
        loadContent();
        loadMedia();
      }
    });
  </script>
</body>
</html>`

