export const landingPage = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal - The World's Most Advanced Legal Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root {
      --legal-primary: #1a365d;
      --legal-secondary: #2d3748;
      --legal-accent: #3182ce;
      --legal-gold: #d69e2e;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .hero-gradient { background: linear-gradient(135deg, #1a365d 0%, #2d3748 50%, #1a365d 100%); }
    .feature-card { transition: all 0.3s ease; }
    .feature-card:hover { transform: translateY(-8px); box-shadow: 0 20px 40px rgba(26, 54, 93, 0.15); }
    .pricing-card { transition: all 0.3s ease; border: 2px solid #e2e8f0; }
    .pricing-card:hover { border-color: #3182ce; box-shadow: 0 20px 40px rgba(49, 130, 206, 0.15); }
    .pricing-card.featured { border-color: #3182ce; box-shadow: 0 20px 40px rgba(49, 130, 206, 0.2); transform: scale(1.05); }
    .btn-primary { background: #3182ce; color: white; padding: 0.875rem 2rem; border-radius: 0.75rem; font-weight: 600; transition: all 0.3s ease; cursor: pointer; border: none; }
    .btn-primary:hover { background: #2c5aa0; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(49, 130, 206, 0.3); }
    .btn-secondary { background: transparent; color: #3182ce; border: 2px solid #3182ce; padding: 0.75rem 1.75rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
    .btn-secondary:hover { background: #3182ce; color: white; }
    .check-icon { color: #10b981; }
    .x-icon { color: #ef4444; }
  </style>
</head>
<body class="bg-white text-gray-900">
  <!-- Navigation -->
  <nav class="sticky top-0 z-50 bg-white shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center gap-3">
          <i class="fas fa-balance-scale text-2xl" style="color: var(--legal-primary);"></i>
          <span class="text-xl font-bold" style="color: var(--legal-primary);">TrustiqLegal</span>
        </div>
        <div class="hidden md:flex items-center gap-8">
          <a href="#features" class="text-gray-600 hover:text-gray-900 font-medium">Features</a>
          <a href="#pricing" class="text-gray-600 hover:text-gray-900 font-medium">Pricing</a>
          <button class="btn-primary" onclick="goToDashboard()">Launch App</button>
        </div>
        <div class="md:hidden">
          <button class="btn-primary" onclick="goToDashboard()">Launch App</button>
        </div>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero-gradient text-white py-20 md:py-32">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div>
          <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
            The World's Most Advanced Legal Platform
          </h1>
          <p class="text-lg md:text-xl text-gray-100 mb-8 leading-relaxed">
            AI-powered legal workspace for GCC firms. Manage cases, draft documents, analyze contracts, and coordinate with clients—all in one bilingual platform.
          </p>
          <div class="flex flex-col sm:flex-row gap-4">
            <button class="btn-primary text-lg px-8 py-3" onclick="goToDashboard()">
              <i class="fas fa-rocket mr-2"></i>Start Free Trial
            </button>
            <button class="btn-secondary text-lg px-8 py-3" style="color: white; border-color: white;">
              <i class="fas fa-play-circle mr-2"></i>Watch Demo
            </button>
          </div>
        </div>
        <div class="hidden md:block">
          <div class="bg-white bg-opacity-10 backdrop-blur-sm rounded-2xl p-8 border border-white border-opacity-20">
            <div class="space-y-4">
              <div class="flex items-center gap-3 text-white">
                <i class="fas fa-check-circle text-2xl text-green-400"></i>
                <span>18 Active Cases</span>
              </div>
              <div class="flex items-center gap-3 text-white">
                <i class="fas fa-check-circle text-2xl text-green-400"></i>
                <span>127 Generated Documents</span>
              </div>
              <div class="flex items-center gap-3 text-white">
                <i class="fas fa-check-circle text-2xl text-green-400"></i>
                <span>39 Clients Managed</span>
              </div>
              <div class="flex items-center gap-3 text-white">
                <i class="fas fa-check-circle text-2xl text-green-400"></i>
                <span>84 AI Analyses</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features Section -->
  <section id="features" class="py-20 md:py-32 bg-gray-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">Powerful Features for Modern Legal Practice</h2>
        <p class="text-lg text-gray-600 max-w-2xl mx-auto">Everything you need to manage your legal practice efficiently and securely.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-folder-open text-2xl text-blue-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">Case Management</h3>
          <p class="text-gray-600">Track matters, jurisdictions, and timelines across GCC and international cases with full audit trails.</p>
        </div>
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-file-contract text-2xl text-green-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">Document Generation</h3>
          <p class="text-gray-600">AI-powered drafting with 50+ legal templates. Generate, review, edit, and download in seconds.</p>
        </div>
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-brain text-2xl text-purple-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">AI Assistant</h3>
          <p class="text-gray-600">Legal research, contract analysis, compliance checks, and risk scoring powered by GPT.</p>
        </div>
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-calendar-alt text-2xl text-orange-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">Calendar & Deadlines</h3>
          <p class="text-gray-600">Never miss a hearing or deadline. Integrated calendar with smart reminders and notifications.</p>
        </div>
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-users text-2xl text-red-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">Client Portal</h3>
          <p class="text-gray-600">Secure client access to case updates, documents, and communications in one place.</p>
        </div>
        <div class="feature-card bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <div class="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
            <i class="fas fa-globe text-2xl text-indigo-600"></i>
          </div>
          <h3 class="text-xl font-bold mb-3">Bilingual Support</h3>
          <p class="text-gray-600">Full English/Arabic interface with GCC jurisdiction-specific legal frameworks built-in.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pricing Section -->
  <section id="pricing" class="py-20 md:py-32">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
        <p class="text-lg text-gray-600 max-w-2xl mx-auto">Choose the plan that fits your practice. All plans include bilingual support and GCC jurisdiction coverage.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        <!-- Starter -->
        <div class="pricing-card bg-white rounded-2xl overflow-hidden flex flex-col">
          <div class="p-8 flex-1">
            <h3 class="text-2xl font-bold mb-2">Starter</h3>
            <p class="text-gray-600 mb-6">For solo practitioners and small firms</p>
            <div class="mb-8">
              <span class="text-4xl font-extrabold">OMR 199</span>
              <span class="text-gray-600">/month</span>
            </div>
            <ul class="space-y-4 mb-8">
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Up to 5 active cases</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>50 documents/month</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Basic legal templates</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Email support</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-times x-icon"></i><span class="text-gray-400">Advanced AI analysis</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-times x-icon"></i><span class="text-gray-400">Client portal</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-times x-icon"></i><span class="text-gray-400">API access</span></li>
            </ul>
          </div>
          <div class="px-8 pb-8">
            <button class="btn-secondary w-full" onclick="goToDashboard()">Get Started</button>
          </div>
        </div>

        <!-- Professional (Featured) -->
        <div class="pricing-card featured bg-white rounded-2xl overflow-hidden flex flex-col">
          <div class="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-3 text-center font-bold">
            MOST POPULAR
          </div>
          <div class="p-8 flex-1">
            <h3 class="text-2xl font-bold mb-2">Professional</h3>
            <p class="text-gray-600 mb-6">For growing law firms</p>
            <div class="mb-8">
              <span class="text-4xl font-extrabold">OMR 499</span>
              <span class="text-gray-600">/month</span>
            </div>
            <ul class="space-y-4 mb-8">
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Unlimited cases</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>500 documents/month</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>All legal templates</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Advanced AI analysis</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Client portal</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Priority support</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-times x-icon"></i><span class="text-gray-400">API access</span></li>
            </ul>
          </div>
          <div class="px-8 pb-8">
            <button class="btn-primary w-full" onclick="goToDashboard()">Start Free Trial</button>
          </div>
        </div>

        <!-- Enterprise -->
        <div class="pricing-card bg-white rounded-2xl overflow-hidden flex flex-col">
          <div class="p-8 flex-1">
            <h3 class="text-2xl font-bold mb-2">Enterprise</h3>
            <p class="text-gray-600 mb-6">For large firms and organizations</p>
            <div class="mb-8">
              <span class="text-4xl font-extrabold">Custom</span>
              <span class="text-gray-600">/month</span>
            </div>
            <ul class="space-y-4 mb-8">
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Unlimited everything</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Custom integrations</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>Dedicated account manager</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>API access</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>White-label options</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>24/7 phone support</span></li>
              <li class="flex items-center gap-3"><i class="fas fa-check check-icon"></i><span>SLA guarantee</span></li>
            </ul>
          </div>
          <div class="px-8 pb-8">
            <button class="btn-secondary w-full" onclick="contactSales()">Contact Sales</button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- CTA Section -->
  <section class="hero-gradient text-white py-16 md:py-24">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
      <h2 class="text-3xl md:text-4xl font-bold mb-6">Ready to Transform Your Legal Practice?</h2>
      <p class="text-lg text-gray-100 mb-8">Join hundreds of legal professionals using TrustiqLegal to work smarter, faster, and more securely.</p>
      <button class="btn-primary text-lg px-8 py-3" onclick="goToDashboard()">
        <i class="fas fa-rocket mr-2"></i>Launch App Now
      </button>
    </div>
  </section>

  <!-- Footer -->
  <footer class="bg-gray-900 text-gray-400 py-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
        <div>
          <div class="flex items-center gap-2 mb-4">
            <i class="fas fa-balance-scale text-2xl text-blue-400"></i>
            <span class="text-white font-bold">TrustiqLegal</span>
          </div>
          <p class="text-sm">The world's most advanced legal platform for GCC firms.</p>
        </div>
        <div>
          <h4 class="text-white font-bold mb-4">Product</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="#features" class="hover:text-white">Features</a></li>
            <li><a href="#pricing" class="hover:text-white">Pricing</a></li>
            <li><a href="#" class="hover:text-white">Security</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-4">Company</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="#" class="hover:text-white">About</a></li>
            <li><a href="#" class="hover:text-white">Blog</a></li>
            <li><a href="#" class="hover:text-white">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold mb-4">Legal</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="#" class="hover:text-white">Privacy</a></li>
            <li><a href="#" class="hover:text-white">Terms</a></li>
            <li><a href="#" class="hover:text-white">Compliance</a></li>
          </ul>
        </div>
      </div>
      <div class="border-t border-gray-800 pt-8 text-center text-sm">
        <p>&copy; 2024 TrustiqLegal. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script>
    function goToDashboard() {
      window.location.href = '/app'
    }
    function contactSales() {
      alert('Contact sales: sales@trustiqlegal.com')
    }
  </script>
</body>
</html>`
