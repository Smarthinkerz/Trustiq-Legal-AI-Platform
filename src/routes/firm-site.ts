import { publicReplyProblem } from '../services/ai-guard'
import { Hono } from 'hono'
import { runLeadIntake } from '../services/lead-intake'
import { mediaResolver, serveMedia } from '../services/blog-media'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { clientIp, runLater, type AppEnv, type Ctx, type Deps } from '../context'
import { tooMany } from '../lib/errors'
import { RateLimiter } from '../lib/rate-limit'
import { subscriptionExpired, trialExpired } from '../lib/plans'
import { firmBlogPage, firmHomePage, firmNotFoundPage, firmPostPage, type Lang, type PublicSite } from '../pages/firm-site'
import { PRACTICE_AREA_IDS } from '../services/reference'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { chatFallback, plainText, siteChatMessages, SLUG_RE } from '../services/website'

// ---------------------------------------------------------------------------
// Public firm websites at /f/:slug — pages, the consultation form and the chatbot.
// No session is involved; abuse is contained by per-IP and per-firm rate limits.
// ---------------------------------------------------------------------------

type SiteRow = PublicSite & { org_id: string; chat_knowledge: string | null; default_jurisdiction: string; plan: string; trial_ends_at: Date | null; plan_expires_at: Date | null; org_name: string }

export function firmSiteRoutes(deps: Deps, assetVersion: string) {
  const { db, config, log } = deps
  const app = new Hono<AppEnv>()
  const limits = {
    contactIp: new RateLimiter(5, 10 * 60_000, 'site:contact_ip'),
    contactSite: new RateLimiter(200, 24 * 3600_000, 'site:contact_site'),
    chatIp: new RateLimiter(30, 10 * 60_000, 'site:chat_ip'),
    chatSite: new RateLimiter(500, 24 * 3600_000, 'site:chat_site'),
    pages: new RateLimiter(300, 60_000, 'site:pages')
  }

  const loadSite = async (slug: string): Promise<SiteRow | undefined> => {
    if (!SLUG_RE.test(slug)) return undefined
    return db.one<SiteRow>(
      `SELECT s.*, coalesce(nullif(b.firm_name, ''), o.name) AS firm_name, b.firm_name_ar,
              coalesce(b.primary_color, '#1a365d') AS primary_color, coalesce(b.accent_color, '#d69e2e') AS accent_color,
              (b.logo IS NOT NULL) AS has_logo, o.name AS org_name, o.default_jurisdiction, o.plan, o.trial_ends_at, o.plan_expires_at
         FROM firm_sites s JOIN organizations o ON o.id = s.org_id LEFT JOIN branding b ON b.org_id = s.org_id
        WHERE s.slug = $1 AND s.published`, [slug])
  }

  const langOf = (c: Ctx, site?: SiteRow): Lang => {
    const q = c.req.query('lang')
    if (q === 'ar' || q === 'en') return q
    // Arabic-only sites default to Arabic.
    return site && !site.about && !site.tagline && (site.about_ar || site.tagline_ar) ? 'ar' : 'en'
  }

  const publishedPosts = (orgId: string, limit: number) => db.query(
    `SELECT slug, title, title_ar, excerpt, excerpt_ar, left(body, 600) AS body, left(body_ar, 600) AS body_ar, published_at, cover_media_id, cover_alt
       FROM blog_posts WHERE org_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT $2`, [orgId, limit]) as Promise<any[]>

  const notFoundHtml = (c: Ctx) => c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title>
    <link rel="stylesheet" href="/static/app.css?v=${assetVersion}"></head><body class="min-h-screen grid place-items-center bg-slate-50 text-slate-700 p-6">
    <div class="text-center"><h1 class="text-2xl font-bold">Website not found</h1><p class="mt-2" lang="ar" dir="rtl">الموقع غير موجود</p></div></body></html>`, 404)

  app.use('*', async (c, next) => {
    const r = limits.pages.take(`p:${clientIp(c)}`)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      throw tooMany()
    }
    await next()
  })

  app.get('/:slug', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site) return notFoundHtml(c)
    const lang = langOf(c, site)
    const status = c.req.query('sent') ? 'sent' : c.req.query('error') === 'limited' ? 'limited' : c.req.query('error') ? 'error' : undefined
    c.header('cache-control', 'no-cache')
    return c.html(firmHomePage({ site, lang, assetVersion, appUrl: config.appUrl, posts: await publishedPosts(site.org_id, 3), status }))
  })

  app.get('/:slug/blog', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site) return notFoundHtml(c)
    c.header('cache-control', 'no-cache')
    return c.html(firmBlogPage({ site, lang: langOf(c, site), assetVersion, appUrl: config.appUrl, posts: await publishedPosts(site.org_id, 100) }))
  })

  app.get('/:slug/blog/:post', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site) return notFoundHtml(c)
    const lang = langOf(c, site)
    const post = await db.one<any>(
      `SELECT slug, title, title_ar, excerpt, excerpt_ar, body, body_ar, published_at, cover_media_id, cover_alt, ai_assisted FROM blog_posts WHERE org_id = $1 AND slug = $2 AND status = 'published'`,
      [site.org_id, c.req.param('post')])
    if (!post) return c.html(firmNotFoundPage({ site, lang, assetVersion, appUrl: config.appUrl }), 404)
    c.header('cache-control', 'no-cache')
    const media = await mediaResolver(db, site.org_id, [post.body, post.body_ar], (id) => `/f/${site.slug}/media/${id}`)
    return c.html(firmPostPage({ site, lang, assetVersion, appUrl: config.appUrl, post, media }))
  })

  // Images and videos are public only while a published article uses them.
  app.get('/:slug/media/:id', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    const id = c.req.param('id').toLowerCase()
    if (!site || !/^[0-9a-f-]{36}$/.test(id)) return c.body(null, 404)
    const used = await db.one(
      `SELECT 1 FROM blog_posts WHERE org_id = $1 AND status = 'published'
          AND (cover_media_id = $2::uuid OR strpos(coalesce(body, ''), $3) > 0 OR strpos(coalesce(body_ar, ''), $3) > 0) LIMIT 1`,
      [site.org_id, id, `](media:${id})`])
    if (!used) return c.body(null, 404)
    return serveMedia(c, db, { id, orgId: site.org_id }, 'public, max-age=86400')
  })

  app.get('/:slug/logo', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site?.has_logo) return c.body(null, 404)
    const row = await db.one('SELECT logo, logo_mime FROM branding WHERE org_id = $1', [site.org_id])
    if (!row?.logo || !/^image\/(png|jpeg|webp)$/.test(row.logo_mime)) return c.body(null, 404)
    c.header('content-type', row.logo_mime)
    c.header('cache-control', 'public, max-age=3600')
    return c.body(new Uint8Array(row.logo))
  })

  app.get('/:slug/sitemap.xml', async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site) return c.body(null, 404)
    const posts = await db.query(`SELECT slug, updated_at FROM blog_posts WHERE org_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT 1000`, [site.org_id])
    const base = `${config.appUrl}/f/${site.slug}`
    const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const urls = [base, `${base}/blog`, ...posts.map((p) => `${base}/blog/${p.slug}`)]
    c.header('content-type', 'application/xml; charset=utf-8')
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xmlEsc(u)}</loc></url>`).join('\n')}\n</urlset>\n`)
  })

  // ---------- Consultation requests ----------

  const contactSchema = z.object({
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(254).optional().or(z.literal('')).transform((v) => v || null),
    phone: z.string().trim().max(60).optional().transform((v) => v || null),
    message: z.string().trim().max(5000).optional().transform((v) => v || null),
    practice_area: z.enum(PRACTICE_AREA_IDS).optional().or(z.literal('')).transform((v) => v || null),
    transcript: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(30).optional(),
    chat_id: z.string().uuid().optional(),
    website: z.string().optional()
  }).refine((v) => v.email || v.phone, { message: 'Enter an email address or phone number.' })

  const sameSite = (c: Ctx) => {
    const origin = c.req.header('origin')
    if (!origin) return c.req.header('sec-fetch-site') !== 'cross-site'
    return origin === new URL(config.appUrl).origin || origin === new URL(c.req.url).origin
  }

  app.post('/:slug/contact', bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const isJson = (c.req.header('content-type') ?? '').includes('application/json')
    const slug = c.req.param('slug')
    let raw: Record<string, unknown>
    try { raw = isJson ? await c.req.json() : await c.req.parseBody() as Record<string, unknown> } catch { raw = {} }
    const lang: Lang = raw.lang === 'ar' ? 'ar' : 'en'
    const back = (q: string) => c.redirect(`/f/${slug}?${lang === 'ar' ? 'lang=ar&' : ''}${q}#contact`, 303)
    const fail = (code: 'error' | 'limited', status: 400 | 403 | 404 | 429) => (isJson ? c.json({ ok: false, error: code }, status) : back(`error=${code}`))

    const site = await loadSite(slug)
    if (!site) return isJson ? c.json({ ok: false }, 404) : notFoundHtml(c)
    if (!sameSite(c)) return fail('error', 403)
    const ip = clientIp(c)
    if (!limits.contactIp.take(`c:${ip}`).ok || !limits.contactSite.take(`c:${site.org_id}`).ok) return fail('limited', 429)
    const parsed = contactSchema.safeParse(raw)
    if (!parsed.success) return fail('error', 400)
    const b = parsed.data
    // Bots fill the hidden field; pretend success so they move on.
    if (b.website) return isJson ? c.json({ ok: true }) : back('sent=1')

    // The chat transcript comes from the server's copy; a transcript sent by the browser keeps only the visitor's own words.
    const chat = b.chat_id ? await db.one<{ messages: { role: string; content: string }[] }>('SELECT messages FROM site_chats WHERE id = $1 AND org_id = $2', [b.chat_id, site.org_id]) : null
    const turns = chat?.messages ?? (b.transcript ?? []).filter((m) => m.role === 'user')
    const transcript = turns.length
      ? `\n\n— Website chat —\n${turns.map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n')}`
      : ''
    const lead = await db.one<{ id: string }>(
      `INSERT INTO leads (org_id, name, email, phone, message, practice_area, source, language) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [site.org_id, b.name, b.email, b.phone, ((b.message ?? '') + transcript).trim() || null, b.practice_area, turns.length ? 'chat' : 'form', lang])
    await db.query(`INSERT INTO audit_log (org_id, action, entity_type, entity_id, meta, ip) VALUES ($1, 'lead.received', 'lead', $2, $3, $4)`,
      [site.org_id, lead!.id, JSON.stringify({ source: turns.length ? 'chat' : 'form' }), ip]).catch((err) => log.warn('lead audit failed', { err }))
    // Sorted and conflict-checked in the background so the visitor is not kept waiting.
    runLater(deps, 'lead intake', () => runLeadIntake(deps, site.org_id, lead!.id, null))

    if (deps.mailer.configured) {
      const staff = await db.query(`SELECT email FROM users WHERE org_id = $1 AND role IN ('owner', 'admin') AND deactivated_at IS NULL AND notify_email`, [site.org_id])
      const text = [
        `A new consultation request arrived from your website.`, '',
        `Name: ${b.name}`, b.email && `Email: ${b.email}`, b.phone && `Phone: ${b.phone}`,
        b.practice_area && `Area: ${b.practice_area}`, '', plainText(b.message, 1500), '',
        `Open the leads inbox: ${config.appUrl}/app#/website`, '',
        'وصل طلب استشارة جديد من موقعك الإلكتروني. افتح صندوق الطلبات من الرابط أعلاه.'
      ].filter((l) => l !== null && l !== undefined).join('\n')
      for (const s of staff) {
        await deps.mailer.send({ to: s.email, subject: `New website enquiry: ${b.name.slice(0, 80)}`, text }).catch((err) => log.warn('lead email failed', { err }))
      }
    }
    return isJson ? c.json({ ok: true }) : back('sent=1')
  })

  // ---------- Website chatbot ----------

  // The conversation is kept on the server: the visitor sends only their new message (and the chat id).
  // Older widgets send the whole history; then only the last visitor message is used, never their "assistant" turns.
  const chatSchema = z.object({
    lang: z.enum(['en', 'ar']).default('en'),
    chat_id: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(1500).optional(),
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) })).min(1).max(12).optional()
  }).transform((v) => ({ lang: v.lang, chat_id: v.chat_id, message: v.message ?? [...(v.messages ?? [])].reverse().find((m) => m.role === 'user')?.content }))
    .refine((v) => !!v.message, { message: 'Write a message.' })

  app.post('/:slug/chat', bodyLimit({ maxSize: 32 * 1024 }), async (c) => {
    const site = await loadSite(c.req.param('slug'))
    if (!site || !site.chatbot_enabled) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404)
    if (!sameSite(c)) return c.json({ error: { code: 'forbidden', message: 'Cross-origin request blocked.' } }, 403)
    const ipLimit = limits.chatIp.take(`ch:${clientIp(c)}`)
    if (!ipLimit.ok) {
      c.header('Retry-After', String(ipLimit.retryAfterSec))
      return c.json({ error: { code: 'rate_limited', message: 'Too many messages. Please wait a little.' } }, 429)
    }
    const parsed = chatSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: { code: 'bad_request', message: 'Invalid message.' } }, 400)
    const { lang, message } = parsed.data
    const fallback = () => c.json({ reply: chatFallback(site, lang), fallback: true })
    const stored = parsed.data.chat_id
      ? await db.one<{ id: string; messages: { role: 'user' | 'assistant'; content: string }[] }>('SELECT id, messages FROM site_chats WHERE id = $1 AND org_id = $2', [parsed.data.chat_id, site.org_id])
      : null
    const history = (stored?.messages ?? []).slice(-11)
    const messages = [...history, { role: 'user' as const, content: message! }]

    const org = { id: site.org_id, name: site.org_name, plan: site.plan, trial_ends_at: site.trial_ends_at, plan_expires_at: site.plan_expires_at, default_jurisdiction: site.default_jurisdiction, default_currency: '' }
    if (!deps.ai.configured || trialExpired(org) || subscriptionExpired(org) || !limits.chatSite.take(`ch:${site.org_id}`).ok) return fallback()
    try {
      await assertCanUseAi(db, org)
    } catch {
      return fallback()
    }
    const posts = (await publishedPosts(site.org_id, 20)).map((p) => ({
      title: p.title || p.title_ar, excerpt: plainText(p.excerpt || p.excerpt_ar || p.body || p.body_ar, 200)
    }))
    try {
      const result = await deps.ai.complete({
        messages: siteChatMessages({ ...site, jurisdiction: site.default_jurisdiction }, posts, messages, lang),
        maxTokens: 400, temperature: 0.2
      })
      await recordAiUsage(db, site.org_id, null, 'site_chat', result)
      let reply = result.text.trim().slice(0, 2000)
      // Code filter: a public visitor never gets law references, article numbers or advice from the bot.
      const problem = publicReplyProblem(reply)
      if (problem) {
        reply = lang === 'ar'
          ? `لا يمكنني تقديم استشارة قانونية أو الإشارة إلى نصوص قانونية هنا. يسعد أحد محامي ${site.firm_name} بمساعدتك: اترك بياناتك في نموذج «طلب استشارة» وسنتواصل معك.`
          : `I can't give legal advice or point to specific laws here. A lawyer at ${site.firm_name} would be glad to help: leave your details in the "Request a consultation" form and we will get back to you.`
      }
      // Every reply is stored with the conversation for review (pruned after 90 days).
      const saved = [...messages, { role: 'assistant' as const, content: reply }].slice(-24)
      const chatId = stored
        ? (await db.query('UPDATE site_chats SET messages = $2, filtered = filtered + $3, updated_at = now() WHERE id = $1 RETURNING id', [stored.id, JSON.stringify(saved), problem ? 1 : 0]))[0]!.id
        : (await db.one<{ id: string }>('INSERT INTO site_chats (org_id, lang, messages, filtered) VALUES ($1, $2, $3, $4) RETURNING id', [site.org_id, lang, JSON.stringify(saved), problem ? 1 : 0]))!.id
      return c.json({ reply, chat_id: chatId })
    } catch (err) {
      log.warn('site chat failed', { err, org: site.org_id })
      return fallback()
    }
  })

  return app
}
