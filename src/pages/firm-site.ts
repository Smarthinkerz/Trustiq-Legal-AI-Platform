import { PRACTICE_AREAS } from '../services/reference'
import { plainText, practiceAreaName, renderArticle } from '../services/website'
import { esc } from './layout'

// ---------------------------------------------------------------------------
// Public website of a law firm, served at /f/:slug. Server-rendered; every value
// that came from the firm or a visitor goes through esc() or renderArticle().
// ---------------------------------------------------------------------------

export type Lang = 'en' | 'ar'

export type PublicSite = {
  slug: string
  firm_name: string
  firm_name_ar: string | null
  primary_color: string
  accent_color: string
  has_logo: boolean
  tagline: string | null
  tagline_ar: string | null
  about: string | null
  about_ar: string | null
  practice_areas: string[]
  contact_email: string | null
  phone: string | null
  whatsapp: string | null
  address: string | null
  address_ar: string | null
  office_hours: string | null
  office_hours_ar: string | null
  chatbot_enabled: boolean
  chatbot_greeting: string | null
  chatbot_greeting_ar: string | null
}

export type PublicPost = {
  slug: string
  title: string | null
  title_ar: string | null
  excerpt: string | null
  excerpt_ar: string | null
  body?: string | null
  body_ar?: string | null
  published_at: string | Date
}

const copy = {
  en: {
    home: 'Home', services: 'Practice areas', about: 'About us', blog: 'Insights', contact: 'Contact', other: 'العربية',
    consult: 'Request a consultation', call: 'Call us', whatsapp: 'WhatsApp',
    servicesTitle: 'How we can help', aboutTitle: 'About the firm', latest: 'Latest insights', allPosts: 'All articles', readMore: 'Read more',
    contactTitle: 'Request a consultation', contactIntro: 'Tell us briefly what you need and a lawyer will contact you. Please do not send confidential documents through this form.',
    name: 'Full name', email: 'Email', phone: 'Phone', area: 'Area of law', areaAny: 'Not sure / other', message: 'How can we help?',
    send: 'Send request', sent: 'Thank you. Your request has been received and a lawyer will contact you soon.',
    error: 'Please enter your name and an email address or phone number.', limited: 'Too many requests. Please try again later or call us.',
    privacy: 'We use your details only to respond to your request.',
    hours: 'Office hours', address: 'Office', blogTitle: 'Insights', blogIntro: 'Articles and legal updates from our team.', noPosts: 'No articles have been published yet.',
    back: 'All articles', published: 'Published', disclaimer: 'The information on this website is general and is not legal advice. Contact the firm for advice on your situation.',
    poweredBy: 'Website by TrustiqLegal', notFound: 'Page not found', notFoundText: 'The page you are looking for does not exist or is no longer available.',
    chat: { title: 'Ask us', open: 'Chat with us', placeholder: 'Type your question…', send: 'Send', close: 'Close chat', greeting: 'Hello! How can we help you today?',
      note: 'Automated assistant. General information only, not legal advice.', error: 'Sorry, something went wrong. Please try again or use the consultation form.', typing: 'Typing…', book: 'Request a consultation' }
  },
  ar: {
    home: 'الرئيسية', services: 'مجالات الممارسة', about: 'من نحن', blog: 'مقالات', contact: 'تواصل معنا', other: 'English',
    consult: 'طلب استشارة', call: 'اتصل بنا', whatsapp: 'واتساب',
    servicesTitle: 'كيف يمكننا مساعدتك', aboutTitle: 'عن المكتب', latest: 'أحدث المقالات', allPosts: 'جميع المقالات', readMore: 'اقرأ المزيد',
    contactTitle: 'طلب استشارة', contactIntro: 'أخبرنا باختصار بما تحتاجه وسيتواصل معك أحد المحامين. يُرجى عدم إرسال مستندات سرية عبر هذا النموذج.',
    name: 'الاسم الكامل', email: 'البريد الإلكتروني', phone: 'الهاتف', area: 'مجال القانون', areaAny: 'غير متأكد / أخرى', message: 'كيف يمكننا مساعدتك؟',
    send: 'إرسال الطلب', sent: 'شكرًا لك. تم استلام طلبك وسيتواصل معك أحد المحامين قريبًا.',
    error: 'يُرجى إدخال اسمك وبريدك الإلكتروني أو رقم هاتفك.', limited: 'طلبات كثيرة. يُرجى المحاولة لاحقًا أو الاتصال بنا.',
    privacy: 'نستخدم بياناتك فقط للرد على طلبك.',
    hours: 'ساعات العمل', address: 'المكتب', blogTitle: 'مقالات', blogIntro: 'مقالات ومستجدات قانونية من فريقنا.', noPosts: 'لم تُنشر أي مقالات بعد.',
    back: 'جميع المقالات', published: 'نُشر في', disclaimer: 'المعلومات الواردة في هذا الموقع عامة ولا تُعد استشارة قانونية. تواصل مع المكتب للحصول على المشورة بشأن حالتك.',
    poweredBy: 'الموقع من TrustiqLegal', notFound: 'الصفحة غير موجودة', notFoundText: 'الصفحة التي تبحث عنها غير موجودة أو لم تعد متاحة.',
    chat: { title: 'اسألنا', open: 'تحدث معنا', placeholder: 'اكتب سؤالك…', send: 'إرسال', close: 'إغلاق المحادثة', greeting: 'مرحبًا! كيف يمكننا مساعدتك اليوم؟',
      note: 'مساعد آلي. معلومات عامة فقط وليست استشارة قانونية.', error: 'عذرًا، حدث خطأ. يُرجى المحاولة مرة أخرى أو استخدام نموذج طلب الاستشارة.', typing: 'يكتب…', book: 'طلب استشارة' }
  }
} as const

const HEX = /^#[0-9a-f]{6}$/i
const color = (v: string, fallback: string) => (HEX.test(v) ? v : fallback)
// Picks the text for the page language, falling back to the other language.
const pick = (lang: Lang, en: string | null | undefined, ar: string | null | undefined) => (lang === 'ar' ? ar || en : en || ar) || ''
const fmtDate = (d: string | Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d))
const firmName = (s: PublicSite, lang: Lang) => pick(lang, s.firm_name, s.firm_name_ar)
const withLang = (path: string, lang: Lang) => (lang === 'ar' ? `${path}${path.includes('?') ? '&' : '?'}lang=ar` : path)

type PageOpts = { site: PublicSite; lang: Lang; assetVersion: string; appUrl: string; title: string; description: string; path: string; body: string; otherPath: string }

function page(o: PageOpts) {
  const { site, lang } = o
  const t = copy[lang]
  const primary = color(site.primary_color, '#1a365d')
  const accent = color(site.accent_color, '#d69e2e')
  const base = `/f/${site.slug}`
  const name = firmName(site, lang)
  const canonical = `${o.appUrl}${withLang(o.path, lang)}`
  const chat = site.chatbot_enabled
    ? `<div id="tq-chat" data-slug="${esc(site.slug)}" data-lang="${lang}" data-color="${primary}"
        data-greeting="${esc(pick(lang, site.chatbot_greeting, site.chatbot_greeting_ar) || t.chat.greeting)}"
        data-t="${esc(JSON.stringify({ ...t.chat, title: `${t.chat.title} · ${name}` }))}"
        data-consult="${esc(withLang(`${base}#contact`, lang))}"></div>
      <script src="/static/site/chat.js?v=${o.assetVersion}" defer></script>`
    : ''
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(o.title)}</title>
  <meta name="description" content="${esc(o.description)}" />
  <meta name="theme-color" content="${primary}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="alternate" hreflang="en" href="${esc(`${o.appUrl}${o.path}`)}" />
  <link rel="alternate" hreflang="ar" href="${esc(`${o.appUrl}${withLang(o.path, 'ar')}`)}" />
  <meta property="og:title" content="${esc(o.title)}" />
  <meta property="og:description" content="${esc(o.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  ${site.has_logo ? `<link rel="icon" href="${base}/logo" />` : '<link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />'}
  <link rel="stylesheet" href="/static/app.css?v=${o.assetVersion}" />
  <link rel="stylesheet" href="/vendor/fa/css/all.min.css?v=${o.assetVersion}" />
  <style>
    :root { --firm: ${primary}; --firm-accent: ${accent}; }
    .firm-bg { background: var(--firm); } .firm-text { color: var(--firm); } .firm-accent-bg { background: var(--firm-accent); }
    .firm-btn { background: var(--firm-accent); color: #111827; } .firm-btn:hover { filter: brightness(0.95); }
    .article h2 { font-size: 1.35rem; font-weight: 700; margin: 1.6rem 0 .6rem; color: var(--firm); }
    .article h3 { font-size: 1.1rem; font-weight: 700; margin: 1.3rem 0 .5rem; }
    .article p { margin: .8rem 0; line-height: 1.85; } .article ul, .article ol { margin: .8rem 0; padding-inline-start: 1.4rem; line-height: 1.8; }
    .article ul { list-style: disc; } .article ol { list-style: decimal; }
  </style>
</head>
<body class="bg-white text-slate-800 antialiased">
  <header class="firm-bg text-white">
    <div class="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <a href="${withLang(base, lang)}" class="flex items-center gap-3 font-bold text-lg min-w-0">
        ${site.has_logo ? `<img src="${base}/logo" alt="" class="h-10 w-auto rounded bg-white p-1" />` : '<i class="fas fa-scale-balanced text-2xl"></i>'}
        <span class="truncate">${esc(name)}</span>
      </a>
      <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm ms-auto" aria-label="${esc(name)}">
        <a class="hover:underline" href="${withLang(base, lang)}#services">${t.services}</a>
        <a class="hover:underline" href="${withLang(`${base}/blog`, lang)}">${t.blog}</a>
        <a class="hover:underline" href="${withLang(base, lang)}#contact">${t.contact}</a>
        <a class="hover:underline" href="${esc(o.otherPath)}" lang="${lang === 'ar' ? 'en' : 'ar'}">${t.other}</a>
      </nav>
    </div>
  </header>
  <main>${o.body}</main>
  <footer class="bg-slate-900 text-slate-300 text-sm">
    <div class="max-w-6xl mx-auto px-4 py-8 space-y-3">
      <p>${t.disclaimer}</p>
      <p class="flex flex-wrap gap-x-4 gap-y-1"><span>© ${new Date().getFullYear()} ${esc(name)}</span><a class="hover:underline text-slate-400" href="/">${t.poweredBy}</a></p>
    </div>
  </footer>
  ${chat}
</body>
</html>`
}

function postCard(p: PublicPost, base: string, lang: Lang) {
  const t = copy[lang]
  const title = pick(lang, p.title, p.title_ar)
  // Prefer a summary in the same language as the title shown.
  const own = lang === 'ar' ? (p.title_ar ? [p.excerpt_ar, p.body_ar] : null) : (p.title ? [p.excerpt, p.body] : null)
  const excerpt = own ? own[0] || plainText(own[1], 220) : pick(lang, p.excerpt, p.excerpt_ar) || plainText(pick(lang, p.body, p.body_ar), 220)
  return `<article class="border border-slate-200 rounded-xl p-5 flex flex-col">
    <time class="text-xs text-slate-500" datetime="${new Date(p.published_at).toISOString()}">${fmtDate(p.published_at, lang)}</time>
    <h3 class="font-semibold text-lg mt-1" dir="auto"><a class="hover:underline" href="${withLang(`${base}/blog/${p.slug}`, lang)}">${esc(title)}</a></h3>
    <p class="text-slate-600 mt-2 flex-1" dir="auto">${esc(excerpt)}</p>
    <a class="firm-text text-sm font-semibold mt-3" href="${withLang(`${base}/blog/${p.slug}`, lang)}">${t.readMore} <i class="fas fa-arrow-right rtl:rotate-180 text-xs"></i></a>
  </article>`
}

type Common = { site: PublicSite; lang: Lang; assetVersion: string; appUrl: string }

export function firmHomePage(o: Common & { posts: PublicPost[]; status?: 'sent' | 'error' | 'limited' }) {
  const { site, lang } = o
  const t = copy[lang]
  const base = `/f/${site.slug}`
  const name = firmName(site, lang)
  const tagline = pick(lang, site.tagline, site.tagline_ar)
  const about = pick(lang, site.about, site.about_ar)
  const address = pick(lang, site.address, site.address_ar)
  const hours = pick(lang, site.office_hours, site.office_hours_ar)
  const wa = site.whatsapp ? `https://wa.me/${site.whatsapp.replace(/\D/g, '')}` : null
  const areas = site.practice_areas.filter((a) => PRACTICE_AREAS.some((p) => p.id === a))
  const notice = o.status === 'sent'
    ? `<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 p-4" role="status">${t.sent}</div>`
    : o.status ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-700 p-4" role="alert">${o.status === 'limited' ? t.limited : t.error}</div>` : ''
  const body = `
  <section class="firm-bg text-white">
    <div class="max-w-6xl mx-auto px-4 pt-10 pb-16">
      <h1 class="text-3xl sm:text-5xl font-bold leading-tight max-w-3xl" dir="auto">${esc(name)}</h1>
      ${tagline ? `<p class="mt-4 text-lg sm:text-xl text-white/85 max-w-2xl" dir="auto">${esc(tagline)}</p>` : ''}
      <div class="mt-8 flex flex-wrap gap-3">
        <a href="#contact" class="firm-btn rounded-lg px-5 py-3 font-semibold"><i class="fas fa-calendar-check me-2"></i>${t.consult}</a>
        ${site.phone ? `<a href="tel:${esc(site.phone.replace(/[^0-9+]/g, ''))}" class="rounded-lg px-5 py-3 font-semibold border border-white/40 hover:bg-white/10"><i class="fas fa-phone me-2"></i>${t.call}</a>` : ''}
        ${wa ? `<a href="${esc(wa)}" rel="noopener" target="_blank" class="rounded-lg px-5 py-3 font-semibold border border-white/40 hover:bg-white/10"><i class="fab fa-whatsapp me-2"></i>${t.whatsapp}</a>` : ''}
      </div>
    </div>
  </section>
  ${areas.length ? `<section id="services" class="max-w-6xl mx-auto px-4 py-14">
    <h2 class="text-2xl font-bold firm-text">${t.servicesTitle}</h2>
    <ul class="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${areas.map((a) => `<li class="rounded-xl border border-slate-200 p-5 flex items-center gap-3"><i class="fas fa-scale-balanced firm-text"></i><span class="font-medium">${esc(practiceAreaName(a, lang))}</span></li>`).join('')}
    </ul>
  </section>` : '<div id="services"></div>'}
  ${about ? `<section id="about" class="bg-slate-50"><div class="max-w-3xl mx-auto px-4 py-14">
    <h2 class="text-2xl font-bold firm-text">${t.aboutTitle}</h2>
    <div class="article mt-4 text-slate-700" dir="auto">${renderArticle(about)}</div>
  </div></section>` : ''}
  ${o.posts.length ? `<section class="max-w-6xl mx-auto px-4 py-14">
    <div class="flex flex-wrap items-end justify-between gap-3"><h2 class="text-2xl font-bold firm-text">${t.latest}</h2>
      <a class="firm-text font-semibold text-sm" href="${withLang(`${base}/blog`, lang)}">${t.allPosts}</a></div>
    <div class="mt-6 grid md:grid-cols-3 gap-5">${o.posts.slice(0, 3).map((p) => postCard(p, base, lang)).join('')}</div>
  </section>` : ''}
  <section id="contact" class="bg-slate-50 border-t border-slate-100">
    <div class="max-w-6xl mx-auto px-4 py-14 grid lg:grid-cols-5 gap-10">
      <div class="lg:col-span-3 space-y-4">
        <h2 class="text-2xl font-bold firm-text">${t.contactTitle}</h2>
        <p class="text-slate-600">${t.contactIntro}</p>
        ${notice}
        <form method="post" action="${base}/contact" class="grid sm:grid-cols-2 gap-4">
          <input type="hidden" name="lang" value="${lang}" />
          <div class="hidden" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
          <label class="block sm:col-span-2"><span class="text-sm font-medium">${t.name}</span>
            <input name="name" required minlength="2" maxlength="200" autocomplete="name" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label class="block"><span class="text-sm font-medium">${t.email}</span>
            <input name="email" type="email" maxlength="254" autocomplete="email" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" dir="ltr" /></label>
          <label class="block"><span class="text-sm font-medium">${t.phone}</span>
            <input name="phone" type="tel" maxlength="60" autocomplete="tel" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" dir="ltr" /></label>
          ${areas.length ? `<label class="block sm:col-span-2"><span class="text-sm font-medium">${t.area}</span>
            <select name="practice_area" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"><option value="">${t.areaAny}</option>
            ${areas.map((a) => `<option value="${esc(a)}">${esc(practiceAreaName(a, lang))}</option>`).join('')}</select></label>` : ''}
          <label class="block sm:col-span-2"><span class="text-sm font-medium">${t.message}</span>
            <textarea name="message" rows="5" maxlength="5000" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" dir="auto"></textarea></label>
          <div class="sm:col-span-2 flex flex-wrap items-center gap-4">
            <button type="submit" class="firm-btn rounded-lg px-5 py-3 font-semibold">${t.send}</button>
            <span class="text-xs text-slate-500">${t.privacy}</span>
          </div>
        </form>
      </div>
      <aside class="lg:col-span-2 space-y-5 text-sm">
        ${address ? `<div><h3 class="font-semibold mb-1"><i class="fas fa-location-dot firm-text me-2"></i>${t.address}</h3><p class="text-slate-600 whitespace-pre-line" dir="auto">${esc(address)}</p></div>` : ''}
        ${hours ? `<div><h3 class="font-semibold mb-1"><i class="fas fa-clock firm-text me-2"></i>${t.hours}</h3><p class="text-slate-600" dir="auto">${esc(hours)}</p></div>` : ''}
        ${site.phone ? `<p><i class="fas fa-phone firm-text me-2"></i><a class="hover:underline" dir="ltr" href="tel:${esc(site.phone.replace(/[^0-9+]/g, ''))}">${esc(site.phone)}</a></p>` : ''}
        ${wa ? `<p><i class="fab fa-whatsapp firm-text me-2"></i><a class="hover:underline" dir="ltr" rel="noopener" target="_blank" href="${esc(wa)}">${esc(site.whatsapp)}</a></p>` : ''}
        ${site.contact_email ? `<p><i class="fas fa-envelope firm-text me-2"></i><a class="hover:underline" href="mailto:${esc(site.contact_email)}">${esc(site.contact_email)}</a></p>` : ''}
      </aside>
    </div>
  </section>`
  return page({
    ...o, body, path: base, otherPath: withLang(base, lang === 'ar' ? 'en' : 'ar'),
    title: tagline ? `${name} – ${tagline}` : name,
    description: plainText(tagline || about || name, 160)
  })
}

export function firmBlogPage(o: Common & { posts: PublicPost[] }) {
  const { site, lang } = o
  const t = copy[lang]
  const base = `/f/${site.slug}`
  const body = `<section class="max-w-6xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold firm-text">${t.blogTitle}</h1>
    <p class="text-slate-600 mt-2">${t.blogIntro}</p>
    ${o.posts.length ? `<div class="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-5">${o.posts.map((p) => postCard(p, base, lang)).join('')}</div>`
      : `<p class="mt-8 text-slate-500">${t.noPosts}</p>`}
  </section>`
  return page({ ...o, body, path: `${base}/blog`, otherPath: withLang(`${base}/blog`, lang === 'ar' ? 'en' : 'ar'), title: `${t.blogTitle} – ${firmName(site, lang)}`, description: t.blogIntro })
}

export function firmPostPage(o: Common & { post: PublicPost }) {
  const { site, lang, post } = o
  const t = copy[lang]
  const base = `/f/${site.slug}`
  const title = pick(lang, post.title, post.title_ar)
  const content = pick(lang, post.body, post.body_ar)
  const excerpt = pick(lang, post.excerpt, post.excerpt_ar) || plainText(content, 160)
  const body = `<article class="max-w-3xl mx-auto px-4 py-12">
    <a class="firm-text text-sm font-semibold" href="${withLang(`${base}/blog`, lang)}"><i class="fas fa-arrow-left rtl:rotate-180 me-1"></i>${t.back}</a>
    <h1 class="text-3xl sm:text-4xl font-bold mt-4 leading-tight" dir="auto">${esc(title)}</h1>
    <p class="text-sm text-slate-500 mt-3">${t.published} <time datetime="${new Date(post.published_at).toISOString()}">${fmtDate(post.published_at, lang)}</time></p>
    <div class="article mt-6 text-slate-800 text-[1.05rem]" dir="auto">${renderArticle(content)}</div>
    <div class="mt-10 rounded-xl border border-slate-200 bg-slate-50 p-6 flex flex-wrap items-center justify-between gap-4">
      <p class="text-slate-700">${t.contactIntro.split('.')[0]}.</p>
      <a href="${withLang(base, lang)}#contact" class="firm-btn rounded-lg px-5 py-3 font-semibold">${t.consult}</a>
    </div>
  </article>`
  const path = `${base}/blog/${post.slug}`
  return page({ ...o, body, path, otherPath: withLang(path, lang === 'ar' ? 'en' : 'ar'), title: `${title} – ${firmName(site, lang)}`, description: plainText(excerpt, 160) })
}

export function firmNotFoundPage(o: Common) {
  const t = copy[o.lang]
  const base = `/f/${o.site.slug}`
  const body = `<section class="max-w-3xl mx-auto px-4 py-20 text-center">
    <h1 class="text-3xl font-bold firm-text">${t.notFound}</h1><p class="mt-3 text-slate-600">${t.notFoundText}</p>
    <a class="inline-block mt-6 firm-btn rounded-lg px-5 py-3 font-semibold" href="${withLang(base, o.lang)}">${t.home}</a></section>`
  return page({ ...o, body, path: base, otherPath: withLang(base, o.lang === 'ar' ? 'en' : 'ar'), title: t.notFound, description: t.notFoundText })
}
