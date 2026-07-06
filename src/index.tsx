import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiQ Legal Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .section { display: none; }
    .section.active { display: block; }
    .nav-link.active { background-color: #1a365d; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="min-h-screen">
    <nav class="bg-slate-900 text-white shadow-lg">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-4">
            <h1 class="text-xl font-bold"><i class="fas fa-balance-scale mr-2"></i>TrustiQ Legal Platform</h1>
            <div class="hidden md:flex gap-2">
              <a href="#dashboard" class="nav-link px-3 py-2 rounded" onclick="showSection('dashboard'); return false;">Dashboard</a>
              <a href="#cases" class="nav-link px-3 py-2 rounded" onclick="showSection('cases'); return false;">Cases</a>
              <a href="#documents" class="nav-link px-3 py-2 rounded" onclick="showSection('documents'); return false;">Documents</a>
              <a href="#clients" class="nav-link px-3 py-2 rounded" onclick="showSection('clients'); return false;">Clients</a>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <section id="dashboard" class="section active">
        <h2 class="text-3xl font-bold mb-4">Dashboard</h2>
        <p class="text-lg">Welcome to TrustiQ Legal Platform.</p>
        <p class="mt-2 text-gray-600">This Railway build serves the platform shell and health check.</p>
      </section>

      <section id="cases" class="section">
        <h2 class="text-3xl font-bold mb-4">Cases</h2>
        <p>Manage your legal cases here.</p>
      </section>

      <section id="documents" class="section">
        <h2 class="text-3xl font-bold mb-4">Document Management</h2>
        <p>Generate and manage legal documents.</p>
      </section>

      <section id="clients" class="section">
        <h2 class="text-3xl font-bold mb-4">Clients</h2>
        <p>Manage your clients here.</p>
      </section>
    </main>
  </div>

  <script>
    function showSection(sectionId) {
      document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
      const el = document.getElementById(sectionId);
      if (el) el.classList.add('active');
      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + sectionId) link.classList.add('active');
      });
    }
  </script>
</body>
</html>`

app.get('/health', (c) => c.json({ status: 'healthy', service: 'Trustiq Legal Platform', timestamp: new Date().toISOString() }))
app.get('/', (c) => c.html(html))

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
