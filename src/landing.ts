import { PLANS } from './lib/plans'
import { esc, head } from './pages/layout'

type Lang = 'en' | 'ar'

const fmt = (n: number | null, lang: Lang, unlimited: string) =>
  n === null ? unlimited : n.toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-US')

const copy = {
  en: {
    title: 'TrustiqLegal – AI-powered legal practice platform for GCC law firms',
    description: 'Matter management, document drafting and AI contract review for law firms in Oman and the GCC, in English and Arabic.',
    nav: { features: 'Features', pricing: 'Pricing', security: 'Security', signin: 'Sign in', start: 'Start free trial', other: 'العربية', otherHref: '/ar' },
    hero: {
      eyebrow: 'Built for GCC legal practice',
      h1: 'Run your law firm in one bilingual, AI-assisted workspace',
      p: 'Manage matters and clients, keep every document versioned, draft agreements in English or Arabic, and get structured AI contract reviews grounded in the jurisdiction you practise in.',
      cta: 'Start your 14-day free trial', cta2: 'See pricing', note: 'No credit card required.'
    },
    heroCard: ['Case reference, status, priority and owner on every matter', 'Documents with version history and branded Word export', 'AI review with risk score, issues and missing clauses', 'Hearings, filings and deadlines with overdue alerts'],
    featuresTitle: 'Everything a modern GCC practice needs', featuresSub: 'Designed for the way firms in Oman, the UAE, Saudi Arabia, Qatar, Kuwait and Bahrain actually work.',
    features: [
      ['fa-folder-open', 'Matter management', 'Automatic case references, status and priority tracking, assignment to team members, and a timeline of notes and changes for every matter.'],
      ['fa-address-book', 'Client records', 'Individuals and companies with bilingual names, contact details and ID/CR numbers, linked to their matters and documents.'],
      ['fa-file-lines', 'Document management', 'Upload PDF and Word files with automatic text extraction, edit drafts with full version history, and export on your firm\'s letterhead.'],
      ['fa-pen-nib', 'AI drafting', 'Generate first drafts of 12 common instruments – from NDAs and employment contracts to statements of claim – in English or Arabic.'],
      ['fa-magnifying-glass-chart', 'AI contract review', 'Summaries, risk scoring, compliance checks and clause-by-clause reviews, with every issue rated by severity and a recommended fix.'],
      ['fa-comments', 'Legal research assistant', 'Jurisdiction-aware answers that can draw on a matter\'s facts, with saved conversations and a verification checklist on every answer.'],
      ['fa-calendar-days', 'Calendar & deadlines', 'Hearings, filings, meetings and deadlines linked to matters, with upcoming and overdue items on your dashboard.'],
      ['fa-language', 'Truly bilingual', 'The entire interface works in English and Arabic with right-to-left layout, and documents can be drafted and exported in either language.']
    ],
    securityTitle: 'Security and control by design',
    security: [
      ['fa-user-shield', 'Role-based access', 'Owner, admin, lawyer and staff roles. Only authorised people can delete records or manage your team.'],
      ['fa-clipboard-list', 'Complete audit trail', 'Sign-ins, edits, downloads, exports and AI usage are logged with user, time and IP address.'],
      ['fa-lock', 'Protected accounts', 'Salted password hashing, secure session cookies, brute-force lockout and encrypted connections.'],
      ['fa-file-export', 'Your data stays yours', 'Export your workspace at any time. Your documents are never used to train AI models.']
    ],
    disclaimer: 'TrustiqLegal is a tool for legal professionals and does not provide legal advice. AI output must be reviewed by a qualified lawyer.',
    pricingTitle: 'Simple, transparent pricing', pricingSub: 'Every plan includes the bilingual workspace, all GCC jurisdictions, version history and the audit log. Prices exclude VAT.',
    perMonth: '/month', custom: 'Custom', unlimited: 'Unlimited', popular: 'Most popular',
    plans: {
      starter: { name: 'Starter', desc: 'For solo practitioners and boutique firms', price: 'OMR 199' },
      professional: { name: 'Professional', desc: 'For growing law firms', price: 'OMR 499' },
      enterprise: { name: 'Enterprise', desc: 'For large firms and in-house legal teams' }
    },
    lines: {
      cases: (n: string) => `${n} open cases`, docs: (n: string) => `${n} new documents / month`, ai: (n: string) => `${n} AI requests / month`,
      drafting: 'AI drafting, research and summaries', advanced: 'AI risk, compliance and full reviews', support: 'Email support', priority: 'Priority support',
      onboarding: 'Dedicated onboarding and data migration', sla: 'Custom limits and service levels'
    },
    choose: 'Start free trial', contact: 'Contact sales',
    ctaTitle: 'Try TrustiqLegal with your own matters', ctaP: 'Set up your firm in two minutes. Invite your team, upload a contract and see the AI review for yourself.',
    footer: { product: 'Product', legal: 'Legal', contact: 'Contact', terms: 'Terms of Service', privacy: 'Privacy Policy', rights: 'All rights reserved.' }
  },
  ar: {
    title: 'TrustiqLegal – منصة ذكية لإدارة الممارسة القانونية لمكاتب المحاماة في الخليج',
    description: 'إدارة القضايا وصياغة المستندات ومراجعة العقود بالذكاء الاصطناعي لمكاتب المحاماة في عُمان ودول الخليج، بالعربية والإنجليزية.',
    nav: { features: 'المزايا', pricing: 'الأسعار', security: 'الأمان', signin: 'تسجيل الدخول', start: 'ابدأ التجربة المجانية', other: 'English', otherHref: '/' },
    hero: {
      eyebrow: 'مصممة للممارسة القانونية في الخليج',
      h1: 'أدِر مكتب المحاماة من مساحة عمل واحدة ثنائية اللغة ومدعومة بالذكاء الاصطناعي',
      p: 'نظّم القضايا والموكلين، واحتفظ بسجل إصدارات لكل مستند، وصُغ الاتفاقيات بالعربية أو الإنجليزية، واحصل على مراجعات منظمة للعقود وفق الولاية القضائية التي تعمل بها.',
      cta: 'ابدأ تجربتك المجانية لمدة ١٤ يوماً', cta2: 'اطّلع على الأسعار', note: 'لا حاجة لبطاقة ائتمان.'
    },
    heroCard: ['رقم مرجعي وحالة وأولوية ومسؤول لكل قضية', 'مستندات بسجل إصدارات وتصدير Word بترويسة المكتب', 'مراجعة ذكية بدرجة مخاطر وملاحظات وبنود ناقصة', 'جلسات ومواعيد إيداع ومهل مع تنبيهات بالتأخير'],
    featuresTitle: 'كل ما يحتاجه مكتب محاماة حديث في الخليج', featuresSub: 'مصممة وفق طريقة عمل المكاتب في عُمان والإمارات والسعودية وقطر والكويت والبحرين.',
    features: [
      ['fa-folder-open', 'إدارة القضايا', 'أرقام مرجعية تلقائية، ومتابعة الحالة والأولوية، وإسناد القضايا لأعضاء الفريق، وسجل زمني للملاحظات والتغييرات.'],
      ['fa-address-book', 'سجلات الموكلين', 'أفراد وشركات بأسماء ثنائية اللغة وبيانات الاتصال وأرقام الهوية أو السجل التجاري، مرتبطة بقضاياهم ومستنداتهم.'],
      ['fa-file-lines', 'إدارة المستندات', 'ارفع ملفات PDF وWord مع استخراج النص تلقائياً، وعدّل المسودات مع سجل إصدارات كامل، وصدّرها بترويسة مكتبك.'],
      ['fa-pen-nib', 'الصياغة الذكية', 'أنشئ مسودات أولية لـ ١٢ نوعاً من المستندات الشائعة – من اتفاقيات عدم الإفصاح وعقود العمل إلى صحف الدعوى – بالعربية أو الإنجليزية.'],
      ['fa-magnifying-glass-chart', 'مراجعة العقود بالذكاء الاصطناعي', 'ملخصات، وتقييم مخاطر، وفحص امتثال، ومراجعة بنداً ببند، مع تصنيف كل ملاحظة حسب خطورتها وتوصية بالمعالجة.'],
      ['fa-comments', 'مساعد البحث القانوني', 'إجابات مرتبطة بالولاية القضائية يمكنها الاستناد إلى وقائع القضية، مع حفظ المحادثات وقائمة تحقق في نهاية كل إجابة.'],
      ['fa-calendar-days', 'التقويم والمواعيد', 'جلسات وإيداعات واجتماعات ومهل مرتبطة بالقضايا، مع عرض المواعيد القادمة والمتأخرة في لوحة التحكم.'],
      ['fa-language', 'ثنائية اللغة بالكامل', 'الواجهة كاملة بالعربية والإنجليزية مع دعم الاتجاه من اليمين إلى اليسار، وصياغة المستندات وتصديرها بأي من اللغتين.']
    ],
    securityTitle: 'الأمان والتحكم في صميم التصميم',
    security: [
      ['fa-user-shield', 'صلاحيات حسب الدور', 'أدوار المالك والمسؤول والمحامي والموظف. لا يستطيع حذف السجلات أو إدارة الفريق إلا المخوّلون.'],
      ['fa-clipboard-list', 'سجل تدقيق كامل', 'تسجيل عمليات الدخول والتعديل والتنزيل والتصدير واستخدام الذكاء الاصطناعي مع المستخدم والوقت وعنوان IP.'],
      ['fa-lock', 'حسابات محمية', 'تشفير كلمات المرور، وجلسات آمنة، وقفل الحساب عند محاولات الاختراق، واتصالات مشفرة.'],
      ['fa-file-export', 'بياناتك ملكك', 'صدّر بيانات مساحة العمل في أي وقت. لا تُستخدم مستنداتك أبداً لتدريب نماذج الذكاء الاصطناعي.']
    ],
    disclaimer: 'TrustiqLegal أداة للمهنيين القانونيين ولا تقدم استشارات قانونية. يجب أن يراجع محامٍ مؤهل مخرجات الذكاء الاصطناعي.',
    pricingTitle: 'أسعار واضحة وبسيطة', pricingSub: 'تشمل جميع الباقات مساحة العمل ثنائية اللغة وجميع الولايات القضائية الخليجية وسجل الإصدارات وسجل التدقيق. الأسعار لا تشمل ضريبة القيمة المضافة.',
    perMonth: '/شهرياً', custom: 'حسب الطلب', unlimited: 'غير محدود', popular: 'الأكثر طلباً',
    plans: {
      starter: { name: 'الأساسية', desc: 'للمحامين المستقلين والمكاتب الصغيرة', price: '١٩٩ ر.ع.' },
      professional: { name: 'الاحترافية', desc: 'لمكاتب المحاماة المتنامية', price: '٤٩٩ ر.ع.' },
      enterprise: { name: 'المؤسسات', desc: 'للمكاتب الكبيرة والإدارات القانونية' }
    },
    lines: {
      cases: (n: string) => `${n} قضايا مفتوحة`, docs: (n: string) => `${n} مستند جديد شهرياً`, ai: (n: string) => `${n} طلب ذكاء اصطناعي شهرياً`,
      drafting: 'صياغة وبحث وملخصات بالذكاء الاصطناعي', advanced: 'مراجعات المخاطر والامتثال والمراجعة الشاملة', support: 'دعم عبر البريد الإلكتروني', priority: 'دعم ذو أولوية',
      onboarding: 'إعداد مخصص ونقل البيانات', sla: 'حدود ومستويات خدمة مخصصة'
    },
    choose: 'ابدأ التجربة المجانية', contact: 'تواصل مع المبيعات',
    ctaTitle: 'جرّب TrustiqLegal على قضاياك الفعلية', ctaP: 'جهّز مكتبك خلال دقيقتين. ادعُ فريقك، وارفع عقداً، وشاهد المراجعة الذكية بنفسك.',
    footer: { product: 'المنتج', legal: 'قانوني', contact: 'تواصل', terms: 'شروط الخدمة', privacy: 'سياسة الخصوصية', rights: 'جميع الحقوق محفوظة.' }
  }
}

export function landingPage(opts: { assetVersion: string; salesEmail: string; supportEmail: string; lang?: Lang }) {
  const lang = opts.lang ?? 'en'
  const t = copy[lang]
  const L = t.lines
  const check = (text: string, on = true) =>
    `<li class="flex items-start gap-3"><i class="fas ${on ? 'fa-check text-emerald-600' : 'fa-xmark text-slate-300'} mt-1"></i><span class="${on ? '' : 'text-slate-400'}">${esc(text)}</span></li>`
  const S = PLANS.starter, P = PLANS.professional
  const register = `/app#/register${lang === 'ar' ? '?lang=ar' : ''}`
  const login = `/app#/login${lang === 'ar' ? '?lang=ar' : ''}`
  const sales = `mailto:${esc(opts.salesEmail)}?subject=${encodeURIComponent('TrustiqLegal Enterprise')}`

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  ${head({ title: t.title, description: t.description, assetVersion: opts.assetVersion, lang })}
  <link rel="alternate" hreflang="en" href="/" /><link rel="alternate" hreflang="ar" href="/ar" />
</head>
<body class="bg-white text-slate-900 antialiased">
  <nav class="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
      <a href="${lang === 'ar' ? '/ar' : '/'}" class="flex items-center gap-2 text-brand-900 font-bold text-xl"><i class="fas fa-scale-balanced"></i>TrustiqLegal</a>
      <div class="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
        <a href="#features" class="hover:text-slate-900">${t.nav.features}</a>
        <a href="#security" class="hover:text-slate-900">${t.nav.security}</a>
        <a href="#pricing" class="hover:text-slate-900">${t.nav.pricing}</a>
        <a href="${t.nav.otherHref}" class="hover:text-slate-900" lang="${lang === 'ar' ? 'en' : 'ar'}">${t.nav.other}</a>
      </div>
      <div class="flex items-center gap-2">
        <a href="${login}" class="btn btn-ghost hidden sm:inline-flex">${t.nav.signin}</a>
        <a href="${register}" class="btn btn-primary">${t.nav.start}</a>
      </div>
    </div>
  </nav>

  <header class="hero-gradient text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
      <div>
        <p class="uppercase tracking-widest text-xs font-semibold text-gold-300 mb-4">${t.hero.eyebrow}</p>
        <h1 class="text-4xl md:text-5xl font-bold leading-tight mb-6">${t.hero.h1}</h1>
        <p class="text-lg text-slate-200 leading-relaxed mb-8">${t.hero.p}</p>
        <div class="flex flex-col sm:flex-row gap-3">
          <a href="${register}" class="btn btn-gold text-base px-6 py-3"><i class="fas fa-rocket"></i>${t.hero.cta}</a>
          <a href="#pricing" class="btn btn-outline-light text-base px-6 py-3">${t.hero.cta2}</a>
        </div>
        <p class="text-sm text-slate-300 mt-4">${t.hero.note}</p>
      </div>
      <div class="hidden md:block">
        <div class="rounded-2xl bg-white/10 border border-white/20 p-8 space-y-5">
          ${t.heroCard.map((x) => `<div class="flex items-start gap-3"><i class="fas fa-circle-check text-emerald-300 text-xl mt-0.5"></i><span>${esc(x)}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </header>

  <section id="features" class="py-20 md:py-28 bg-slate-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-14 max-w-2xl mx-auto">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.featuresTitle}</h2>
        <p class="text-lg text-slate-600">${t.featuresSub}</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        ${t.features.map(([icon, title, body]) => `
        <div class="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition">
          <div class="w-11 h-11 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center mb-4"><i class="fas ${icon} text-lg"></i></div>
          <h3 class="font-bold text-lg mb-2">${esc(title)}</h3>
          <p class="text-slate-600 text-sm leading-relaxed">${esc(body)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section id="security" class="py-20 md:py-24">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <h2 class="text-3xl md:text-4xl font-bold mb-12 text-center">${t.securityTitle}</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        ${t.security.map(([icon, title, body]) => `
        <div>
          <i class="fas ${icon} text-2xl text-brand-700 mb-3"></i>
          <h3 class="font-bold mb-2">${esc(title)}</h3>
          <p class="text-slate-600 text-sm leading-relaxed">${esc(body)}</p>
        </div>`).join('')}
      </div>
      <p class="mt-12 text-center text-sm text-slate-500 max-w-3xl mx-auto"><i class="fas fa-circle-info"></i> ${t.disclaimer}</p>
    </div>
  </section>

  <section id="pricing" class="py-20 md:py-28 bg-slate-50">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-14 max-w-2xl mx-auto">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.pricingTitle}</h2>
        <p class="text-lg text-slate-600">${t.pricingSub}</p>
      </div>
      <div class="grid md:grid-cols-3 gap-8 items-stretch">
        <div class="pricing-card">
          <h3 class="text-2xl font-bold mb-1">${t.plans.starter.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.starter.desc}</p>
          <p class="mb-8"><span class="text-4xl font-extrabold">${t.plans.starter.price}</span><span class="text-slate-500">${t.perMonth}</span></p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.cases(fmt(S.maxActiveCases, lang, t.unlimited)))}${check(L.docs(fmt(S.documentsPerMonth, lang, t.unlimited)))}${check(L.ai(fmt(S.aiRequestsPerMonth, lang, t.unlimited)))}
            ${check(L.drafting)}${check(L.support)}${check(L.advanced, false)}
          </ul>
          <a href="${register}" class="btn btn-secondary w-full">${t.choose}</a>
        </div>
        <div class="pricing-card featured">
          <div class="absolute -top-3 inset-x-0 flex justify-center"><span class="bg-brand-700 text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">${t.popular}</span></div>
          <h3 class="text-2xl font-bold mb-1">${t.plans.professional.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.professional.desc}</p>
          <p class="mb-8"><span class="text-4xl font-extrabold">${t.plans.professional.price}</span><span class="text-slate-500">${t.perMonth}</span></p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.cases(fmt(P.maxActiveCases, lang, t.unlimited)))}${check(L.docs(fmt(P.documentsPerMonth, lang, t.unlimited)))}${check(L.ai(fmt(P.aiRequestsPerMonth, lang, t.unlimited)))}
            ${check(L.drafting)}${check(L.advanced)}${check(L.priority)}
          </ul>
          <a href="${register}" class="btn btn-primary w-full">${t.choose}</a>
        </div>
        <div class="pricing-card">
          <h3 class="text-2xl font-bold mb-1">${t.plans.enterprise.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.enterprise.desc}</p>
          <p class="mb-8"><span class="text-4xl font-extrabold">${t.custom}</span></p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.cases(t.unlimited))}${check(L.docs(t.unlimited))}${check(L.ai(t.unlimited))}
            ${check(L.advanced)}${check(L.sla)}${check(L.onboarding)}
          </ul>
          <a href="${sales}" class="btn btn-secondary w-full">${t.contact}</a>
        </div>
      </div>
    </div>
  </section>

  <section class="hero-gradient text-white py-16 md:py-20">
    <div class="max-w-3xl mx-auto px-4 text-center">
      <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.ctaTitle}</h2>
      <p class="text-lg text-slate-200 mb-8">${t.ctaP}</p>
      <a href="${register}" class="btn btn-gold text-base px-6 py-3">${t.hero.cta}</a>
    </div>
  </section>

  <footer class="bg-slate-900 text-slate-400 py-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-4 gap-8 text-sm">
      <div>
        <div class="flex items-center gap-2 text-white font-bold mb-3"><i class="fas fa-scale-balanced text-gold-300"></i>TrustiqLegal</div>
        <p>${t.description}</p>
      </div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.product}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="#features">${t.nav.features}</a></li><li><a class="hover:text-white" href="#pricing">${t.nav.pricing}</a></li><li><a class="hover:text-white" href="#security">${t.nav.security}</a></li></ul></div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.legal}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="/terms">${t.footer.terms}</a></li><li><a class="hover:text-white" href="/privacy">${t.footer.privacy}</a></li></ul></div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.contact}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="mailto:${esc(opts.salesEmail)}">${esc(opts.salesEmail)}</a></li><li><a class="hover:text-white" href="mailto:${esc(opts.supportEmail)}">${esc(opts.supportEmail)}</a></li></ul></div>
    </div>
    <p class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-6 border-t border-slate-800 text-center text-xs">&copy; ${new Date().getFullYear()} TrustiqLegal. ${t.footer.rights}</p>
  </footer>
</body>
</html>`
}
