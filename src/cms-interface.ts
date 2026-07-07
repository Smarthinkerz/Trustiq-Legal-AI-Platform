export const cmsInterface = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal CMS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .sidebar { background: #1a365d; }
    .sidebar-item { padding: 12px 16px; cursor: pointer; transition: all 0.2s; border-left: 3px solid transparent; }
    .sidebar-item:hover { background: rgba(255,255,255,0.1); }
    .sidebar-item.active { background: #3182ce; border-left-color: #fbbf24; }
    .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s; }
    .btn-primary { background: #3182ce; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .input { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; font-size: 14px; }
    .input:focus { outline: none; border-color: #3182ce; box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1); }
    .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; align-items: center; justify-content: center; }
    .modal.active { display: flex; }
    .modal-content { background: white; border-radius: 8px; padding: 24px; max-width: 600px; width: 90%; }
    .table { width: 100%; border-collapse: collapse; }
    .table th { background: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    .table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-draft { background: #fef3c7; color: #92400e; }
    .badge-published { background: #dcfce7; color: #166534; }
  </style>
</head>
<body class="bg-gray-50">
  <!-- Login Modal -->
  <div id="loginModal" class="modal active">
    <div class="modal-content">
      <h1 class="text-2xl font-bold mb-6">TrustiqLegal CMS</h1>
      <form onsubmit="handleLogin(event)">
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Email</label>
          <input type="email" id="loginEmail" class="input w-full" placeholder="admin@trustiqlegal.com" required />
        </div>
        <div class="mb-6">
          <label class="block text-sm font-medium mb-2">Password</label>
          <input type="password" id="loginPassword" class="input w-full" placeholder="••••••••" required />
        </div>
        <button type="submit" class="btn btn-primary w-full">Login</button>
      </form>
      <p class="text-sm text-gray-600 mt-4 text-center">Demo: admin@trustiqlegal.com / admin123</p>
    </div>
  </div>

  <!-- Main CMS Interface -->
  <div id="cmsApp" class="hidden flex h-screen">
    <!-- Sidebar -->
    <div class="sidebar text-white w-64 overflow-y-auto">
      <div class="p-6 border-b border-blue-700">
        <h2 class="text-xl font-bold"><i class="fas fa-cog mr-2"></i>CMS</h2>
        <p class="text-sm text-blue-200">TrustiqLegal</p>
      </div>
      <nav class="p-4 space-y-1">
        <div class="sidebar-item active" onclick="switchSection('dashboard')"><i class="fas fa-chart-line mr-2"></i>Dashboard</div>
        <div class="sidebar-item" onclick="switchSection('pages')"><i class="fas fa-file-alt mr-2"></i>Pages</div>
        <div class="sidebar-item" onclick="switchSection('posts')"><i class="fas fa-newspaper mr-2"></i>Posts</div>
        <div class="sidebar-item" onclick="switchSection('media')"><i class="fas fa-images mr-2"></i>Media</div>
        <div class="sidebar-item" onclick="switchSection('forms')"><i class="fas fa-wpforms mr-2"></i>Forms</div>
        <div class="sidebar-item" onclick="switchSection('settings')"><i class="fas fa-sliders-h mr-2"></i>Settings</div>
      </nav>
      <div class="p-4 border-t border-blue-700 mt-auto">
        <button onclick="logout()" class="btn btn-danger w-full"><i class="fas fa-sign-out-alt mr-2"></i>Logout</button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-white border-b p-4 flex items-center justify-between">
        <h1 id="sectionTitle" class="text-2xl font-bold">Dashboard</h1>
        <div class="text-sm text-gray-600"><i class="fas fa-user-circle mr-2"></i><span id="userEmail">admin</span></div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- Dashboard Section -->
        <div id="dashboardSection" class="section">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div class="card p-6">
              <div class="text-sm text-gray-600">Total Pages</div>
              <div class="text-3xl font-bold" id="totalPages">0</div>
            </div>
            <div class="card p-6">
              <div class="text-sm text-gray-600">Total Posts</div>
              <div class="text-3xl font-bold" id="totalPosts">0</div>
            </div>
            <div class="card p-6">
              <div class="text-sm text-gray-600">Media Files</div>
              <div class="text-3xl font-bold" id="totalMedia">0</div>
            </div>
            <div class="card p-6">
              <div class="text-sm text-gray-600">Form Submissions</div>
              <div class="text-3xl font-bold" id="totalSubmissions">0</div>
            </div>
          </div>
        </div>

        <!-- Pages Section -->
        <div id="pagesSection" class="section hidden">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">Pages</h2>
            <button class="btn btn-primary" onclick="showPageForm()"><i class="fas fa-plus mr-2"></i>New Page</button>
          </div>
          <div class="card overflow-hidden">
            <table class="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="pagesTable">
                <tr><td colspan="4" class="text-center text-gray-500 py-8">No pages yet</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Posts Section -->
        <div id="postsSection" class="section hidden">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">Posts</h2>
            <button class="btn btn-primary" onclick="showPostForm()"><i class="fas fa-plus mr-2"></i>New Post</button>
          </div>
          <div class="card overflow-hidden">
            <table class="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="postsTable">
                <tr><td colspan="4" class="text-center text-gray-500 py-8">No posts yet</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Media Section -->
        <div id="mediaSection" class="section hidden">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">Media Library</h2>
            <button class="btn btn-primary" onclick="showMediaUpload()"><i class="fas fa-upload mr-2"></i>Upload</button>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4" id="mediaGrid">
            <div class="text-center text-gray-500 py-8">No media files</div>
          </div>
        </div>

        <!-- Forms Section -->
        <div id="formsSection" class="section hidden">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">Forms</h2>
            <button class="btn btn-primary" onclick="showFormBuilder()"><i class="fas fa-plus mr-2"></i>New Form</button>
          </div>
          <div class="card overflow-hidden">
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Fields</th>
                  <th>Submissions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="formsTable">
                <tr><td colspan="4" class="text-center text-gray-500 py-8">No forms yet</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Settings Section -->
        <div id="settingsSection" class="section hidden">
          <h2 class="text-xl font-bold mb-6">Settings</h2>
          <div class="card p-6 max-w-2xl">
            <div class="space-y-6">
              <div>
                <label class="block text-sm font-medium mb-2">Site Title</label>
                <input type="text" id="siteTitle" class="input w-full" placeholder="TrustiqLegal" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-2">Site Description</label>
                <textarea id="siteDesc" class="input w-full h-24" placeholder="Site description"></textarea>
              </div>
              <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Page/Post Form Modal -->
  <div id="formModal" class="modal">
    <div class="modal-content">
      <h2 id="formTitle" class="text-xl font-bold mb-6">New Page</h2>
      <form onsubmit="handleFormSubmit(event)">
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Title</label>
          <input type="text" id="formTitle" class="input w-full" required />
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Slug</label>
          <input type="text" id="formSlug" class="input w-full" required />
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Content</label>
          <textarea id="formContent" class="input w-full h-32" required></textarea>
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">Status</label>
          <select id="formStatus" class="input w-full">
            <option>draft</option>
            <option>published</option>
          </select>
        </div>
        <div class="flex gap-3">
          <button type="submit" class="btn btn-primary flex-1">Save</button>
          <button type="button" class="btn" onclick="closeFormModal()">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const API = '/api/cms';
    let currentUser = null;
    let currentSection = 'dashboard';

    async function handleLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch(\`\${API}/auth/login\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        
        if (data.token) {
          currentUser = data.user;
          localStorage.setItem('cmsToken', data.token);
          localStorage.setItem('cmsUser', JSON.stringify(data.user));
          document.getElementById('loginModal').classList.remove('active');
          document.getElementById('cmsApp').classList.remove('hidden');
          document.getElementById('userEmail').textContent = data.user.email;
          loadDashboard();
        } else {
          alert('Login failed');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    function logout() {
      if (confirm('Logout?')) {
        localStorage.removeItem('cmsToken');
        localStorage.removeItem('cmsUser');
        location.reload();
      }
    }

    function switchSection(section) {
      currentSection = section;
      document.querySelectorAll('.section').forEach(el => el.classList.add('hidden'));
      document.getElementById(section + 'Section').classList.remove('hidden');
      
      document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
      event.target.closest('.sidebar-item').classList.add('active');

      const titles = {
        'dashboard': 'Dashboard',
        'pages': 'Pages',
        'posts': 'Posts',
        'media': 'Media Library',
        'forms': 'Forms',
        'settings': 'Settings'
      };
      document.getElementById('sectionTitle').textContent = titles[section];

      if (section === 'pages') loadPages();
      if (section === 'posts') loadPosts();
      if (section === 'media') loadMedia();
      if (section === 'forms') loadForms();
    }

    async function loadDashboard() {
      try {
        const pages = await fetch(\`\${API}/pages\`).then(r => r.json());
        const posts = await fetch(\`\${API}/posts\`).then(r => r.json());
        const media = await fetch(\`\${API}/media\`).then(r => r.json());
        
        document.getElementById('totalPages').textContent = pages.length;
        document.getElementById('totalPosts').textContent = posts.length;
        document.getElementById('totalMedia').textContent = media.length;
      } catch (err) {
        console.error('Error loading dashboard:', err);
      }
    }

    async function loadPages() {
      try {
        const pages = await fetch(\`\${API}/pages\`).then(r => r.json());
        const tbody = document.getElementById('pagesTable');
        tbody.innerHTML = pages.map(p => \`
          <tr>
            <td>\${p.title}</td>
            <td>\${p.slug}</td>
            <td><span class="badge badge-\${p.status}">\${p.status}</span></td>
            <td><button class="btn" onclick="editPage('\${p.id}')">Edit</button></td>
          </tr>
        \`).join('') || '<tr><td colspan="4" class="text-center text-gray-500 py-8">No pages</td></tr>';
      } catch (err) {
        console.error('Error loading pages:', err);
      }
    }

    async function loadPosts() {
      try {
        const posts = await fetch(\`\${API}/posts\`).then(r => r.json());
        const tbody = document.getElementById('postsTable');
        tbody.innerHTML = posts.map(p => \`
          <tr>
            <td>\${p.title}</td>
            <td>\${p.category || '-'}</td>
            <td><span class="badge badge-\${p.status}">\${p.status}</span></td>
            <td><button class="btn" onclick="editPost('\${p.id}')">Edit</button></td>
          </tr>
        \`).join('') || '<tr><td colspan="4" class="text-center text-gray-500 py-8">No posts</td></tr>';
      } catch (err) {
        console.error('Error loading posts:', err);
      }
    }

    async function loadMedia() {
      try {
        const media = await fetch(\`\${API}/media\`).then(r => r.json());
        const grid = document.getElementById('mediaGrid');
        grid.innerHTML = media.map(m => \`
          <div class="card p-4">
            <img src="\${m.url}" alt="\${m.filename}" class="w-full h-32 object-cover rounded mb-2" />
            <p class="text-sm font-medium truncate">\${m.filename}</p>
            <button class="btn btn-danger w-full mt-2 text-sm" onclick="deleteMedia('\${m.id}')">Delete</button>
          </div>
        \`).join('') || '<div class="text-center text-gray-500 py-8">No media</div>';
      } catch (err) {
        console.error('Error loading media:', err);
      }
    }

    async function loadForms() {
      try {
        const forms = await fetch(\`\${API}/forms\`).then(r => r.json());
        const tbody = document.getElementById('formsTable');
        tbody.innerHTML = forms.map(f => \`
          <tr>
            <td>\${f.name}</td>
            <td>\${f.fields.length}</td>
            <td>0</td>
            <td><button class="btn" onclick="editForm('\${f.id}')">Edit</button></td>
          </tr>
        \`).join('') || '<tr><td colspan="4" class="text-center text-gray-500 py-8">No forms</td></tr>';
      } catch (err) {
        console.error('Error loading forms:', err);
      }
    }

    function showPageForm() {
      document.getElementById('formTitle').textContent = 'New Page';
      document.getElementById('formModal').classList.add('active');
    }

    function showPostForm() {
      document.getElementById('formTitle').textContent = 'New Post';
      document.getElementById('formModal').classList.add('active');
    }

    function closeFormModal() {
      document.getElementById('formModal').classList.remove('active');
    }

    async function handleFormSubmit(e) {
      e.preventDefault();
      const title = document.getElementById('formTitle').value;
      const slug = document.getElementById('formSlug').value;
      const content = document.getElementById('formContent').value;
      const status = document.getElementById('formStatus').value;

      const endpoint = currentSection === 'pages' ? 'pages' : 'posts';
      try {
        await fetch(\`\${API}/\${endpoint}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, slug, content, status })
        });
        closeFormModal();
        if (currentSection === 'pages') loadPages();
        if (currentSection === 'posts') loadPosts();
        alert('Saved successfully!');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    function showMediaUpload() {
      alert('Media upload coming soon!');
    }

    function showFormBuilder() {
      alert('Form builder coming soon!');
    }

    async function deleteMedia(id) {
      if (confirm('Delete this media?')) {
        try {
          await fetch(\`\${API}/media/\${id}\`, { method: 'DELETE' });
          loadMedia();
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }
    }

    async function saveSettings() {
      const settings = {
        siteTitle: document.getElementById('siteTitle').value,
        siteDesc: document.getElementById('siteDesc').value
      };
      try {
        await fetch(\`\${API}/settings\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });
        alert('Settings saved!');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // Check if already logged in
    window.addEventListener('load', () => {
      const token = localStorage.getItem('cmsToken');
      const user = localStorage.getItem('cmsUser');
      if (token && user) {
        currentUser = JSON.parse(user);
        document.getElementById('loginModal').classList.remove('active');
        document.getElementById('cmsApp').classList.remove('hidden');
        document.getElementById('userEmail').textContent = currentUser.email;
        loadDashboard();
      }
    });
  </script>
</body>
</html>`

