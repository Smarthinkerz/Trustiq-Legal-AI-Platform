import { siteFooter, siteNav, type Lang } from '../landing'
import type { MediaRef } from '../services/blog-media'
import { plainText, renderArticle } from '../services/website'
import { esc, head } from './layout'

// ---------------------------------------------------------------------------
// The TrustiqLegal blog at /blog and /ar/blog: a card grid (cover, date, title,
// excerpt, "Read more") and article pages with a title banner. Everything that
// came from the editor goes through esc() or renderArticle().
// ---------------------------------------------------------------------------

export type BlogPost = {
  slug: string; title: string | null; title_ar: string | null; excerpt: string | null; excerpt_ar: string | null
  body: string | null; body_ar: string | null; published_at: string | Date; cover_media_id: string | null; cover_alt: string | null
}

const copy = {
  en: {
    title: 'Blog', heroTitle: 'Insights & updates', heroSub: 'Practical articles on legal practice, technology and the law across the GCC and the Middle East.',
    readMore: 'Read more', back: 'Back to blog', empty: 'No articles have been published yet. Check back soon.', more: 'More articles',
    minRead: (n: number) => `${n} min read`, share: 'Share', ctaTitle: 'Run your firm on TrustiqLegal', ctaText: 'Matters, documents, billing and AI in English and Arabic. Try it free for 14 days.', cta: 'Start free trial'
  },
  ar: {
    title: 'المدونة', heroTitle: 'مقالات ومستجدات', heroSub: 'مقالات عملية عن الممارسة القانونية والتقنية والقانون في دول الخليج والشرق الأوسط.',
    readMore: 'اقرأ المزيد', back: 'العودة إلى المدونة', empty: 'لم تُنشر أي مقالات بعد. تابعنا قريبًا.', more: 'مقالات أخرى',
    minRead: (n: number) => `${n} دقائق قراءة`, share: 'شارك', ctaTitle: 'أدِر مكتبك عبر TrustiqLegal', ctaText: 'القضايا والمستندات والفوترة والذكاء الاصطناعي بالعربية والإنجليزية. جرّبه مجانًا لمدة 14 يومًا.', cta: 'ابدأ التجربة المجانية'
  }
} as const

const pick = (lang: Lang, en: string | null | undefined, ar: string | null | undefined) => (lang === 'ar' ? ar || en : en || ar) || ''
// Body and excerpt follow the language of the title shown, so the card never mixes languages.
const contentLang = (lang: Lang, p: BlogPost): Lang => (lang === 'ar' ? (p.title_ar || !p.title ? 'ar' : 'en') : (p.title || !p.title_ar ? 'en' : 'ar'))
const field = (p: BlogPost, l: Lang, k: 'title' | 'excerpt' | 'body') => (l === 'ar' ? p[`${k}_ar`] : p[k]) ?? ''
const fmtDate = (d: string | Date, lang: Lang, day = true) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { year: 'numeric', month: 'long', ...(day ? { day: 'numeric' } : {}) }).format(new Date(d))
const blogBase = (lang: Lang) => (lang === 'ar' ? '/ar/blog' : '/blog')
export const mediaPath = (id: string) => `/blog-media/${id}`

type Shell = { lang: Lang; assetVersion: string; appUrl: string; salesEmail: string; supportEmail: string }

function shell(o: Shell & { title: string; description: string; path: string; otherPath: string; image?: string | null; body: string }) {
  const canonical = `${o.appUrl}${o.path}`
  return `<!DOCTYPE html>
<html lang="${o.lang}" dir="${o.lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  ${head({ title: o.title, description: o.description, assetVersion: o.assetVersion, lang: o.lang })}
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="alternate" hreflang="${o.lang === 'ar' ? 'en' : 'ar'}" href="${esc(`${o.appUrl}${o.otherPath}`)}" />
  <meta property="og:title" content="${esc(o.title)}" />
  <meta property="og:description" content="${esc(o.description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:type" content="${o.image ? 'article' : 'website'}" />
  ${o.image ? `<meta property="og:image" content="${esc(o.image)}" /><meta name="twitter:card" content="summary_large_image" />` : ''}
</head>
<body class="bg-white text-slate-900 antialiased">
  ${siteNav(o.lang, { active: 'blog', otherHref: o.otherPath })}
  <main>${o.body}</main>
  ${siteFooter(o.lang, { salesEmail: o.salesEmail, supportEmail: o.supportEmail })}
</body>
</html>`
}

function card(p: BlogPost, lang: Lang) {
  const t = copy[lang]
  const l = contentLang(lang, p)
  const title = field(p, l, 'title')
  const excerpt = field(p, l, 'excerpt') || plainText(field(p, l, 'body'), 180)
  const href = `${blogBase(lang)}/${esc(p.slug)}`
  const image = p.cover_media_id
    ? `<img src="${mediaPath(p.cover_media_id)}" alt="${esc(p.cover_alt || title)}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />`
    : `<div class="w-full h-full hero-gradient grid place-items-center text-white/90 text-5xl font-bold" aria-hidden="true">${esc(title.trim().charAt(0))}</div>`
  return `<article class="group bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-shadow flex flex-col">
    <a href="${href}" class="block aspect-[16/10] overflow-hidden bg-slate-100" tabindex="-1">${image}</a>
    <div class="p-6 flex flex-col flex-1" dir="${l === 'ar' ? 'rtl' : 'ltr'}" lang="${l}">
      <time class="text-xs font-semibold uppercase tracking-wide text-gold-600" datetime="${new Date(p.published_at).toISOString()}">${fmtDate(p.published_at, lang, false)}</time>
      <h2 class="mt-2 text-lg font-bold leading-snug text-slate-900"><a href="${href}" class="hover:text-brand-700">${esc(title)}</a></h2>
      <p class="mt-3 text-sm text-slate-600 leading-relaxed line-clamp-3 flex-1">${esc(excerpt)}</p>
      <a href="${href}" class="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-900">${t.readMore} <i class="fas fa-arrow-right rtl:rotate-180 text-xs"></i></a>
    </div>
  </article>`
}

export function blogIndexPage(o: Shell & { posts: BlogPost[] }) {
  const t = copy[o.lang]
  const body = `
  <section class="hero-gradient text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center">
      <p class="uppercase tracking-widest text-xs font-semibold text-gold-300 mb-3">${t.title}</p>
      <h1 class="text-3xl md:text-5xl font-bold">${t.heroTitle}</h1>
      <p class="mt-4 text-lg text-slate-200 max-w-2xl mx-auto">${t.heroSub}</p>
    </div>
  </section>
  <section class="bg-slate-50 py-14 md:py-20">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      ${o.posts.length ? `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">${o.posts.map((p) => card(p, o.lang)).join('')}</div>`
        : `<p class="text-center text-slate-500 py-16">${t.empty}</p>`}
    </div>
  </section>`
  return shell({ ...o, title: `${t.title} – TrustiqLegal`, description: t.heroSub, path: blogBase(o.lang), otherPath: blogBase(o.lang === 'ar' ? 'en' : 'ar'), body })
}

export function blogPostPage(o: Shell & { post: BlogPost; media: (id: string) => MediaRef | undefined; more: BlogPost[] }) {
  const t = copy[o.lang]
  const p = o.post
  const l = contentLang(o.lang, p)
  const title = field(p, l, 'title')
  const content = field(p, l, 'body')
  const excerpt = field(p, l, 'excerpt') || plainText(content, 160)
  const minutes = Math.max(1, Math.round(plainText(content, 100_000).split(/\s+/).length / 200))
  const path = `${blogBase(o.lang)}/${p.slug}`
  const url = encodeURIComponent(`${o.appUrl}${path}`)
  const shareText = encodeURIComponent(title)
  const share = [
    ['fa-whatsapp', 'WhatsApp', `https://wa.me/?text=${shareText}%20${url}`],
    ['fa-linkedin-in', 'LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${url}`],
    ['fa-x-twitter', 'X', `https://twitter.com/intent/tweet?url=${url}&text=${shareText}`]
  ].map(([icon, name, href]) => `<a href="${href}" target="_blank" rel="noopener" aria-label="${t.share}: ${name}" class="w-9 h-9 grid place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100"><i class="fab ${icon}"></i></a>`).join('')
  const body = `
  <section class="hero-gradient text-white">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 text-center" dir="${l === 'ar' ? 'rtl' : 'ltr'}" lang="${l}">
      <a href="${blogBase(o.lang)}" class="inline-flex items-center gap-2 text-sm text-gold-300 hover:text-white"><i class="fas fa-arrow-left rtl:rotate-180 text-xs"></i>${t.back}</a>
      <h1 class="mt-5 text-3xl md:text-5xl font-bold leading-tight">${esc(title)}</h1>
      <p class="mt-5 text-slate-300 text-sm"><time datetime="${new Date(p.published_at).toISOString()}">${fmtDate(p.published_at, o.lang)}</time> · ${t.minRead(minutes)}</p>
    </div>
  </section>
  <article class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16" dir="${l === 'ar' ? 'rtl' : 'ltr'}" lang="${l}">
    ${p.cover_media_id ? `<img src="${mediaPath(p.cover_media_id)}" alt="${esc(p.cover_alt || title)}" class="w-full aspect-[16/9] object-cover rounded-2xl shadow-sm mb-10" />` : ''}
    <div class="article-preview">${renderArticle(content, o.media)}</div>
    <div class="mt-12 pt-6 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
      <a href="${blogBase(o.lang)}" class="inline-flex items-center gap-2 font-semibold text-brand-700 hover:text-brand-900"><i class="fas fa-arrow-left rtl:rotate-180 text-xs"></i>${t.back}</a>
      <div class="flex items-center gap-2"><span class="text-sm text-slate-500 me-1">${t.share}</span>${share}</div>
    </div>
    <div class="mt-10 rounded-2xl hero-gradient text-white p-8 text-center">
      <h2 class="text-xl font-bold">${t.ctaTitle}</h2>
      <p class="mt-2 text-slate-200">${t.ctaText}</p>
      <a href="/app#/register${o.lang === 'ar' ? '?lang=ar' : ''}" class="btn btn-gold mt-5 inline-flex">${t.cta}</a>
    </div>
  </article>
  ${o.more.length ? `<section class="bg-slate-50 py-14"><div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <h2 class="text-2xl font-bold mb-8">${t.more}</h2>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">${o.more.map((m) => card(m, o.lang)).join('')}</div>
  </div></section>` : ''}`
  return shell({
    ...o, title: `${title} – TrustiqLegal`, description: plainText(excerpt, 160), path,
    otherPath: `${blogBase(o.lang === 'ar' ? 'en' : 'ar')}/${p.slug}`,
    image: p.cover_media_id ? `${o.appUrl}${mediaPath(p.cover_media_id)}` : null, body
  })
}
