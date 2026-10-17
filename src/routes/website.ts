import { fileStore, storeFile } from '../services/storage'
import { markUnverifiedLaw, publicReplyProblem, VERIFY_MARKER } from '../services/ai-guard'
import { logAiUse } from '../services/ai-log'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, runLater, type AppEnv, type Ctx } from '../context'
import { badRequest, conflict, HttpError, notFound, tooMany, unavailable } from '../lib/errors'
import { conflictOverride, gateConflicts } from '../lib/conflict-gate'
import { clientConflicts, logConflictCheck, opposingConflicts, type Blocking } from '../services/conflicts'
import { normalizeReply, replyMessages, runLeadIntake, type LeadRow } from '../services/lead-intake'
import { coverPrompt, mediaIdsIn, mediaResolver, serveMedia, sniffMedia } from '../services/blog-media'
import { renderArticle } from '../services/website'
import { buildUpdate, jsonBody, optText, optUuid, queryParams, uuidParam } from '../lib/http'
import { parseJsonObject } from '../services/legal-prompts'
import { JURISDICTION_CODES, PRACTICE_AREA_IDS } from '../services/reference'
import { assertCanOpenCase, assertCanUseAi, recordAiUsage } from '../services/usage'
import { normalizeWriterResult, RESERVED_SLUGS, SLUG_RE, slugify, WRITER_ACTIONS, writerMessages } from '../services/website'
import { caseActivity } from './cases'

const LEAD_STATUSES = ['new', 'contacted', 'converted', 'declined'] as const
const email = z.string().trim().email().max(254).nullish().or(z.literal('')).transform((v) => v || null)
const slug = z.string().trim().toLowerCase().regex(SLUG_RE, 'Use lowercase letters, numbers and hyphens.')

const websiteRoutes = new Hono<AppEnv>()

const publicUrl = (c: Ctx, s: string) => `${c.get('deps').config.appUrl}/f/${s}`

function throttleAi(c: Ctx) {
  const r = c.get('deps').limiters.ai.take(auth(c).user.id)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  }
}

// ---------------- Site settings ----------------

const SITE_FIELDS = ['slug', 'published', 'tagline', 'tagline_ar', 'about', 'about_ar', 'practice_areas', 'contact_email', 'phone', 'whatsapp',
  'address', 'address_ar', 'office_hours', 'office_hours_ar', 'chatbot_enabled', 'chatbot_greeting', 'chatbot_greeting_ar', 'chat_knowledge'] as const

websiteRoutes.get('/site', async (c) => {
  const { org } = auth(c)
  const { db } = c.get('deps')
  const site = await db.one(`SELECT ${SITE_FIELDS.join(', ')}, updated_at FROM firm_sites WHERE org_id = $1`, [org.id])
  if (site) return c.json({ site, url: publicUrl(c, site.slug), exists: true })
  let suggested = slugify(org.name) || 'firm'
  if (suggested.length < 3 || RESERVED_SLUGS.has(suggested) || await db.one('SELECT 1 FROM firm_sites WHERE slug = $1', [suggested])) {
    suggested = `${suggested}-${org.id.slice(0, 6)}`
  }
  return c.json({
    exists: false,
    url: null,
    site: { slug: suggested, published: false, practice_areas: [], chatbot_enabled: false }
  })
})

websiteRoutes.put('/site', jsonBody(z.object({
  slug: slug.refine((s) => !RESERVED_SLUGS.has(s), 'That address is reserved. Choose another.'),
  published: z.boolean().default(false),
  tagline: optText(200),
  tagline_ar: optText(200),
  about: optText(10_000),
  about_ar: optText(10_000),
  practice_areas: z.array(z.enum(PRACTICE_AREA_IDS)).max(20).default([]).transform((a) => [...new Set(a)]),
  contact_email: email,
  phone: optText(60),
  whatsapp: z.string().trim().max(30).regex(/^\+?[0-9 ]*$/, 'Use digits only, with the country code.').nullish().or(z.literal('')).transform((v) => v || null),
  address: optText(500),
  address_ar: optText(500),
  office_hours: optText(200),
  office_hours_ar: optText(200),
  chatbot_enabled: z.boolean().default(false),
  chatbot_greeting: optText(300),
  chatbot_greeting_ar: optText(300),
  chat_knowledge: optText(20_000)
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const taken = await db.one('SELECT 1 FROM firm_sites WHERE slug = $1 AND org_id <> $2', [b.slug, org.id])
  if (taken) throw conflict('That web address is already used by another firm. Choose another.')
  const cols = SITE_FIELDS
  const values = cols.map((k) => b[k])
  const site = await db.one(
    `INSERT INTO firm_sites (org_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (org_id) DO UPDATE SET ${cols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, updated_at = now()
     RETURNING ${cols.join(', ')}, updated_at`,
    [org.id, ...values])
  await audit(c, 'website.updated', 'organization', org.id, { slug: b.slug, published: b.published, chatbot: b.chatbot_enabled })
  return c.json({ site, url: publicUrl(c, site!.slug), exists: true })
})

// ---------------- Blog posts ----------------

const postFields = {
  slug: slug.optional(),
  title: optText(200),
  title_ar: optText(200),
  excerpt: optText(500),
  excerpt_ar: optText(500),
  body: optText(60_000),
  body_ar: optText(60_000),
  cover_media_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  cover_alt: optText(300),
  // Set by the editor when the AI writer was used; shown on the public article.
  ai_assisted: z.boolean().optional(),
  status: z.enum(['draft', 'published'])
}
const POST_UPDATABLE = ['slug', 'title', 'title_ar', 'excerpt', 'excerpt_ar', 'body', 'body_ar', 'cover_media_id', 'cover_alt', 'ai_assisted'] as const

// Public articles cannot go live while "[verify]" markers (from the AI writer or the firm) remain.
function assertPublishable(p: Record<string, unknown>) {
  const fields = ['title', 'title_ar', 'excerpt', 'excerpt_ar', 'body', 'body_ar']
  if (fields.some((f) => typeof p[f] === 'string' && VERIFY_MARKER.test(p[f] as string))) {
    throw badRequest('Resolve every [verify] marker before publishing: check the point against the official source, then edit or remove it.')
  }
}

// Files uploaded before the post was first saved are filed under it once it uses them.
async function linkMedia(c: Ctx, orgId: string, post: Record<string, any>) {
  const ids = [...mediaIdsIn(post.body, post.body_ar), ...(post.cover_media_id ? [post.cover_media_id] : [])]
  if (ids.length) await c.get('deps').db.query('UPDATE blog_media SET post_id = $2 WHERE org_id = $1 AND post_id IS NULL AND id = ANY($3::uuid[])', [orgId, post.id, ids])
}

async function assertCover(c: Ctx, orgId: string, id: string | null | undefined) {
  if (!id) return
  const m = await c.get('deps').db.one('SELECT kind FROM blog_media WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!m || m.kind !== 'image') throw badRequest('Choose an image from this firm\'s media for the cover.')
}

const hasTitle = (p: { title?: string | null; title_ar?: string | null }) => !!(p.title || p.title_ar)

async function uniquePostSlug(c: Ctx, orgId: string, base: string, exceptId?: string) {
  const { db } = c.get('deps')
  let candidate = base || `post-${Date.now().toString(36)}`
  for (let i = 2; await db.one('SELECT 1 FROM blog_posts WHERE org_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3)', [orgId, candidate, exceptId ?? null]); i++) {
    candidate = `${base}-${i}`
  }
  return candidate
}

websiteRoutes.get('/posts', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT p.id, p.slug, p.title, p.title_ar, p.excerpt, p.excerpt_ar, p.status, p.published_at, p.updated_at, p.cover_media_id, u.name AS author_name
       FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.org_id = $1 ORDER BY coalesce(p.published_at, p.updated_at) DESC`, [org.id])
  return c.json({ items })
})

websiteRoutes.get('/posts/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Post')
  const post = await c.get('deps').db.one('SELECT * FROM blog_posts WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!post) throw notFound('Post')
  return c.json({ post })
})

websiteRoutes.post('/posts', jsonBody(z.object({ ...postFields, status: postFields.status.default('draft') })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (!hasTitle(b)) throw badRequest('Give the post a title in English or Arabic.')
  if (b.status === 'published') assertPublishable(b)
  await assertCover(c, org.id, b.cover_media_id)
  const postSlug = await uniquePostSlug(c, org.id, b.slug ?? slugify(b.title ?? ''))
  const post = await c.get('deps').db.one(
    `INSERT INTO blog_posts (org_id, slug, title, title_ar, excerpt, excerpt_ar, body, body_ar, status, published_at, author_id, cover_media_id, cover_alt, ai_assisted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${b.status === 'published' ? 'now()' : 'NULL'}, $10, $11, $12, $13) RETURNING *`,
    [org.id, postSlug, b.title, b.title_ar, b.excerpt, b.excerpt_ar, b.body, b.body_ar, b.status, user.id, b.cover_media_id, b.cover_alt, b.ai_assisted ?? false])
  await linkMedia(c, org.id, post!)
  await audit(c, b.status === 'published' ? 'blog.published' : 'blog.created', 'blog_post', post!.id, { title: b.title ?? b.title_ar })
  return c.json({ post }, 201)
})

websiteRoutes.patch('/posts/:id', jsonBody(z.object(postFields).partial()), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Post')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const current = await db.one('SELECT * FROM blog_posts WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!current) throw notFound('Post')
  if (!hasTitle({ title: b.title !== undefined ? b.title : current.title, title_ar: b.title_ar !== undefined ? b.title_ar : current.title_ar })) {
    throw badRequest('Give the post a title in English or Arabic.')
  }
  if (b.slug && b.slug !== current.slug && await db.one('SELECT 1 FROM blog_posts WHERE org_id = $1 AND slug = $2 AND id <> $3', [org.id, b.slug, id])) {
    throw conflict('Another post already uses that address.')
  }
  if ((b.status ?? current.status) === 'published') assertPublishable({ ...current, ...b })
  // Once an article has used the AI writer it stays labelled.
  if (b.ai_assisted === false && current.ai_assisted) delete b.ai_assisted
  await assertCover(c, org.id, b.cover_media_id)
  const { sets, values } = buildUpdate(b, POST_UPDATABLE, 3)
  if (b.status) {
    sets.push(`status = '${b.status}'`)
    // Keep the original publication date when re-publishing an edited post.
    sets.push(b.status === 'published' ? 'published_at = coalesce(published_at, now())' : 'published_at = NULL')
  }
  const post = await db.one(`UPDATE blog_posts SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  await linkMedia(c, org.id, post!)
  const action = b.status && b.status !== current.status ? (b.status === 'published' ? 'blog.published' : 'blog.unpublished') : 'blog.updated'
  await audit(c, action, 'blog_post', id, { fields: Object.keys(b) })
  return c.json({ post })
})

// ---------------- Blog images and videos ----------------

const MEDIA_COLUMNS = 'id, post_id, kind, mime, size, file_name, alt, source, created_at'

websiteRoutes.get('/media', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(`SELECT ${MEDIA_COLUMNS} FROM blog_media WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200`, [org.id])
  return c.json({ items })
})

websiteRoutes.get('/media/:id', async (c) => {
  const { org } = auth(c)
  return serveMedia(c, c.get('deps').db, { id: uuidParam(c.req.param('id'), 'Media'), orgId: org.id }, 'private, max-age=300')
})

websiteRoutes.post('/media', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const { db, config } = c.get('deps')
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || !file.size) throw badRequest('Choose an image or video to upload.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniffMedia(bytes)
  if (!kind) throw new HttpError(415, 'unsupported_media', 'Upload a JPG, PNG, WebP or GIF image, or an MP4, MOV or WebM video.')
  const max = kind.kind === 'video' ? config.maxVideoBytes : config.maxUploadBytes
  if (bytes.length > max) throw new HttpError(413, 'payload_too_large', `${kind.kind === 'video' ? 'Videos' : 'Images'} can be up to ${Math.round(max / 1048576)} MB.`)
  const postId = typeof form!.get('post_id') === 'string' && /^[0-9a-f-]{36}$/.test(String(form!.get('post_id'))) ? String(form!.get('post_id')) : null
  if (postId && !(await db.one('SELECT 1 FROM blog_posts WHERE id = $1 AND org_id = $2', [postId, org.id]))) throw badRequest('Post not found.')
  const alt = typeof form!.get('alt') === 'string' ? String(form!.get('alt')).trim().slice(0, 300) || null : null
  const stored = await storeFile(fileStore(), 'blog_media', org.id, bytes, kind.mime)
  const media = await db.one(
    `INSERT INTO blog_media (org_id, post_id, kind, mime, size, file_name, alt, data, created_by, file_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${MEDIA_COLUMNS}`,
    [org.id, postId, kind.kind, kind.mime, bytes.length, file.name.slice(0, 200), alt, stored.data, user.id, stored.key])
  await audit(c, 'blog.media_uploaded', 'blog_media', media!.id, { kind: kind.kind, size: bytes.length })
  return c.json({ media }, 201)
})

// Generates an image with AI (a cover, or a picture for inside the article) from the title and summary or a description.
websiteRoutes.post('/media/generate', jsonBody(z.object({
  post_id: optUuid,
  title: optText(300),
  excerpt: optText(1000),
  prompt: optText(1000),
  style: z.enum(['illustration', 'photo']).default('illustration')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (!b.title && !b.prompt) throw badRequest('Write a title (or describe the image) first.')
  throttleAi(c)
  const { db, ai } = c.get('deps')
  if (!ai.configured) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
  await assertCanUseAi(db, org)
  if (b.post_id && !(await db.one('SELECT 1 FROM blog_posts WHERE id = $1 AND org_id = $2', [b.post_id, org.id]))) throw badRequest('Post not found.')
  const prompt = b.prompt
    ? `${b.prompt.slice(0, 1000)} Professional image for a law firm's blog. No text, letters, logos or watermarks. No identifiable real people.`
    : coverPrompt({ title: b.title, excerpt: b.excerpt, style: b.style, jurisdiction: org.default_jurisdiction })
  const img = await ai.generateImage({ prompt })
  if (!sniffMedia(img.bytes)) throw new HttpError(502, 'ai_bad_output', 'The image service returned an unreadable image. Please try again.')
  await recordAiUsage(db, org.id, user.id, 'cover_image', { model: img.model, promptTokens: 0, completionTokens: 0 })
  const stored = await storeFile(fileStore(), 'blog_media', org.id, img.bytes, img.mime)
  const media = await db.one(
    `INSERT INTO blog_media (org_id, post_id, kind, mime, size, file_name, alt, source, data, created_by, file_key) VALUES ($1, $2, 'image', $3, $4, $5, $6, 'ai', $7, $8, $9) RETURNING ${MEDIA_COLUMNS}`,
    [org.id, b.post_id, img.mime, img.bytes.length, 'ai-image.png', (b.title ?? b.prompt ?? '').slice(0, 300) || null, stored.data, user.id, stored.key])
  await audit(c, 'ai.blog_image', 'blog_media', media!.id, { model: img.model })
  return c.json({ media }, 201)
})

websiteRoutes.patch('/media/:id', jsonBody(z.object({ alt: optText(300) })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const media = await c.get('deps').db.one(`UPDATE blog_media SET alt = $3 WHERE id = $1 AND org_id = $2 RETURNING ${MEDIA_COLUMNS}`,
    [uuidParam(c.req.param('id'), 'Media'), org.id, c.req.valid('json').alt])
  if (!media) throw notFound('Media')
  return c.json({ media })
})

websiteRoutes.delete('/media/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Media')
  const rows = await c.get('deps').db.query('DELETE FROM blog_media WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Media')
  await audit(c, 'blog.media_deleted', 'blog_media', id)
  return c.json({ ok: true })
})

// Renders an article as visitors will see it, with its images and videos in place.
websiteRoutes.post('/preview', jsonBody(z.object({ body: z.string().max(60_000).default('') })), async (c) => {
  const { org } = auth(c)
  const { body } = c.req.valid('json')
  const resolve = await mediaResolver(c.get('deps').db, org.id, [body], (id) => `/api/website/media/${id}`)
  return c.json({ html: renderArticle(body, resolve) })
})

websiteRoutes.delete('/posts/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Post')
  const rows = await c.get('deps').db.query('DELETE FROM blog_posts WHERE id = $1 AND org_id = $2 RETURNING title, title_ar', [id, org.id])
  if (!rows.length) throw notFound('Post')
  await audit(c, 'blog.deleted', 'blog_post', id, { title: rows[0].title ?? rows[0].title_ar })
  return c.json({ ok: true })
})

// ---------------- AI blog writer ----------------

websiteRoutes.post('/writer', jsonBody(z.object({
  action: z.enum(WRITER_ACTIONS),
  language: z.enum(['en', 'ar']),
  topic: optText(1000),
  practice_area: z.enum(PRACTICE_AREA_IDS).nullish().or(z.literal('')).transform((v) => v || null),
  jurisdiction: z.enum(JURISDICTION_CODES).nullish().or(z.literal('')).transform((v) => v || null),
  audience: optText(200),
  title: optText(300),
  excerpt: optText(1000),
  body: optText(60_000)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (b.action === 'draft' && !b.topic && !b.title) throw badRequest('Describe the topic of the article.')
  if (['improve', 'translate', 'excerpt'].includes(b.action) && !b.body) throw badRequest('Write or generate the article first.')
  throttleAi(c)
  const { db, ai } = c.get('deps')
  await assertCanUseAi(db, org)
  const firm = await db.one('SELECT firm_name FROM branding WHERE org_id = $1', [org.id])
  const result = await ai.complete({
    messages: writerMessages({ ...b, firm_name: firm?.firm_name || org.name }),
    json: true, maxTokens: b.action === 'titles' || b.action === 'excerpt' ? 600 : 4000, temperature: 0.2
  })
  await recordAiUsage(db, org.id, user.id, 'blog_writer', result)
  let parsed: any
  try { parsed = parseJsonObject(result.text) } catch { throw badRequest('The AI reply could not be read. Please try again.') }
  const out: Record<string, any> = normalizeWriterResult(b.action, parsed)
  // Law references the library cannot confirm are marked [verify: ...]; the article cannot be published until they are resolved.
  let marked = 0
  for (const k of ['body', 'excerpt', 'title']) {
    if (typeof out[k] === 'string') { const r = await markUnverifiedLaw(db, org.id, out[k]); out[k] = r.text; marked += r.marked }
  }
  await logAiUse(db, { orgId: org.id, userId: user.id, feature: 'blog_writer', model: result.model, prompt: `${b.action}: ${b.topic ?? b.title ?? ''}`, output: JSON.stringify(out),
    verification: { status: marked ? 'passed_with_warnings' : 'unverified', errors: 0, warnings: marked, citations: 0, as_of: new Date().toISOString().slice(0, 10), checked_at: new Date().toISOString(),
      checks: marked ? [{ kind: 'law_reference', severity: 'warning', ok: false, code: 'law_marked_verify', detail: `${marked} law reference(s) not found in the library were marked [verify].` }] : [] } })
  return c.json({ result: out, ai_assisted: true, verify_marks: marked })
})

// ---------------- Leads ----------------

websiteRoutes.get('/leads', queryParams(z.object({ status: z.enum([...LEAD_STATUSES, 'open', 'all']).default('open') })), async (c) => {
  const { org } = auth(c)
  const { status } = c.req.valid('query')
  const { db } = c.get('deps')
  const filter = status === 'all' ? '' : status === 'open' ? ` AND l.status IN ('new', 'contacted')` : ' AND l.status = $2'
  const items = await db.query(
    `SELECT l.*, u.name AS handled_by_name, cl.name AS client_name, k.reference AS case_reference
       FROM leads l LEFT JOIN users u ON u.id = l.handled_by LEFT JOIN clients cl ON cl.id = l.client_id LEFT JOIN cases k ON k.id = l.case_id
      WHERE l.org_id = $1${filter}
      ORDER BY (l.status IN ('new', 'contacted') AND l.urgency = 'urgent') DESC, l.created_at DESC LIMIT 500`,
    filter.includes('$2') ? [org.id, status] : [org.id])
  const [counts] = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'new')::int AS new, count(*) FILTER (WHERE status = 'contacted')::int AS contacted,
            count(*) FILTER (WHERE status = 'converted')::int AS converted, count(*) FILTER (WHERE status = 'declined')::int AS declined
       FROM leads WHERE org_id = $1`, [org.id])
  return c.json({ items, counts })
})

websiteRoutes.post('/leads', jsonBody(z.object({
  name: z.string().trim().min(2).max(200),
  email, phone: optText(60), message: optText(5000),
  practice_area: z.enum(PRACTICE_AREA_IDS).nullish().or(z.literal('')).transform((v) => v || null)
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const lead = await c.get('deps').db.one(
    `INSERT INTO leads (org_id, name, email, phone, message, practice_area, source, handled_by) VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7) RETURNING *`,
    [org.id, b.name, b.email, b.phone, b.message, b.practice_area, user.id])
  await audit(c, 'lead.created', 'lead', lead!.id)
  runLater(c.get('deps'), 'lead intake', () => runLeadIntake(c.get('deps'), org.id, lead!.id, user.id))
  return c.json({ lead }, 201)
})

// Runs (or re-runs) the AI intake and conflict check on an enquiry.
websiteRoutes.post('/leads/:id/intake', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const deps = c.get('deps')
  if (!deps.ai.configured) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
  const lead = await deps.db.one('SELECT id, message FROM leads WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!lead) throw notFound('Lead')
  if (!lead.message?.trim()) throw badRequest('This enquiry has no message to analyse.')
  throttleAi(c)
  try {
    await runLeadIntake(deps, org.id, id, user.id, { enforceQuota: true })
  } catch (err) {
    if (err instanceof HttpError) throw err
    deps.log.warn('lead intake failed', { err })
    throw new HttpError(502, 'ai_bad_output', 'The AI could not read this enquiry. Please try again.')
  }
  await audit(c, 'ai.lead_intake', 'lead', id)
  return c.json({ lead: await deps.db.one('SELECT * FROM leads WHERE id = $1', [id]) })
})

// Drafts a first reply to the enquirer; nothing is sent until a lawyer reviews it.
websiteRoutes.post('/leads/:id/reply-draft', jsonBody(z.object({ language: z.enum(['en', 'ar']).optional() })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const { db, ai } = c.get('deps')
  const lead = await db.one('SELECT * FROM leads WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!lead) throw notFound('Lead')
  throttleAi(c)
  await assertCanUseAi(db, org)
  const firm = await db.one('SELECT firm_name, firm_name_ar FROM branding WHERE org_id = $1', [org.id])
  const language = c.req.valid('json').language ?? (lead.language === 'ar' ? 'ar' : 'en')
  const firmName = (language === 'ar' ? firm?.firm_name_ar || firm?.firm_name : firm?.firm_name) || org.name
  const result = await ai.complete({ messages: replyMessages(lead as LeadRow, { language, firmName, lawyerName: user.name }), json: true, maxTokens: 1200, temperature: 0.3 })
  await recordAiUsage(db, org.id, user.id, 'lead_reply', result)
  let draft
  try { draft = normalizeReply(parseJsonObject(result.text)) } catch { draft = { subject: '', body: '' } }
  if (!draft.body) throw new HttpError(502, 'ai_bad_output', 'The AI returned an empty reply. Please try again.')
  // Replies go to the public: flag law references or advice for the lawyer before it is sent.
  const problem = publicReplyProblem(draft.body)
  await logAiUse(db, { orgId: org.id, userId: user.id, feature: 'lead_reply', model: result.model, prompt: `Reply to lead ${id}`, output: draft.body,
    verification: { status: problem ? 'passed_with_warnings' : 'passed', errors: 0, warnings: problem ? 1 : 0,
      checks: problem ? [{ kind: 'law_reference', severity: 'warning', ok: false, code: `reply_${problem}`, detail: problem === 'advice' ? 'The reply may read as legal advice.' : 'The reply names a law or article.' }] : [] } })
  return c.json({ problem, draft: { ...draft, subject: draft.subject || (language === 'ar' ? `استفساركم لدى ${firmName}` : `Your enquiry to ${firmName}`), language } })
})

// Emails the enquirer (reply-to is the lawyer) and marks the enquiry as contacted.
websiteRoutes.post('/leads/:id/reply', jsonBody(z.object({
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(10_000)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const b = c.req.valid('json')
  const { db, mailer, log } = c.get('deps')
  const lead = await db.one('SELECT id, email, status, notes FROM leads WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!lead) throw notFound('Lead')
  if (!lead.email) throw badRequest('This enquiry has no email address. Call or message them instead.')
  if (!mailer.configured) throw unavailable('email_not_configured', 'Email is not set up on this server. Copy the reply and send it yourself.')
  try {
    await mailer.send({ to: lead.email, subject: b.subject, text: b.body, replyTo: user.email })
  } catch (err) {
    log.warn('lead reply failed', { err })
    throw unavailable('email_failed', 'The email could not be sent. Please try again.')
  }
  const note = `${new Date().toISOString().slice(0, 10)} – ${user.name} emailed: ${b.subject}`
  const updated = await db.one(
    `UPDATE leads SET replied_at = now(), status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, handled_by = coalesce(handled_by, $3),
            notes = CASE WHEN notes IS NULL OR notes = '' THEN $4 ELSE notes || E'\n' || $4 END, updated_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, user.id, note])
  await audit(c, 'lead.replied', 'lead', id)
  return c.json({ lead: updated })
})

websiteRoutes.patch('/leads/:id', jsonBody(z.object({
  status: z.enum(['new', 'contacted', 'declined']).optional(),
  notes: optText(10_000)
}).partial()), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const b = c.req.valid('json')
  const { sets, values } = buildUpdate(b, ['status', 'notes'], 4)
  const lead = await c.get('deps').db.one(
    `UPDATE leads SET ${[...sets, 'handled_by = coalesce(handled_by, $3)', 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, org.id, user.id, ...values])
  if (!lead) throw notFound('Lead')
  await audit(c, 'lead.updated', 'lead', id, { status: b.status })
  return c.json({ lead })
})

websiteRoutes.delete('/leads/:id', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const rows = await c.get('deps').db.query('DELETE FROM leads WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Lead')
  await audit(c, 'lead.deleted', 'lead', id)
  return c.json({ ok: true })
})

// Turns an enquiry into a client (new, or an existing one) and optionally opens a case.
websiteRoutes.post('/leads/:id/convert', jsonBody(z.object({
  client_id: optUuid,
  client: z.object({
    kind: z.enum(['individual', 'company']).default('individual'),
    name: z.string().trim().min(2).max(200),
    name_ar: optText(200),
    email, phone: optText(60)
  }).optional(),
  case: z.object({
    title: z.string().trim().min(3).max(300),
    practice_area: z.enum(PRACTICE_AREA_IDS).nullish().or(z.literal('')).transform((v) => v || null),
    jurisdiction: z.enum(JURISDICTION_CODES),
    opposing_party: optText(300)
  }).nullish(),
  conflict_override: conflictOverride
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lead')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const lead = await db.one('SELECT * FROM leads WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!lead) throw notFound('Lead')
  if (lead.status === 'converted') throw conflict('This enquiry has already been converted.')
  if (!b.client_id && !b.client) throw badRequest('Choose an existing client or enter the new client\'s details.')
  if (b.case) await assertCanOpenCase(db, org)
  // Same intake rules as creating a client and a case directly: a new client must not be an opposing party
  // elsewhere, and the new matter's opposing parties must not be the firm's clients.
  const blocking: Blocking[] = []
  if (!b.client_id && b.client) blocking.push(...await opposingConflicts(db, org.id, [b.client.name, b.client.name_ar]))
  if (b.client_id && b.case) {
    const [cl] = await db.query('SELECT name, name_ar FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])
    if (cl) blocking.push(...await opposingConflicts(db, org.id, [cl.name, cl.name_ar]))
  }
  if (b.case?.opposing_party) blocking.push(...await clientConflicts(db, org.id, b.case.opposing_party, b.client_id))
  const gate = gateConflicts(c, blocking, b.conflict_override)
  const result = await db.tx(async (q) => {
    let clientId = b.client_id
    let clientCreated = false
    if (clientId) {
      if (!(await q.one('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [clientId, org.id]))) throw badRequest('Selected client does not exist.')
    } else {
      const notes = [`From website enquiry (${new Date(lead.created_at).toISOString().slice(0, 10)}).`, lead.message].filter(Boolean).join('\n\n')
      const cl = await q.one(
        `INSERT INTO clients (org_id, kind, name, name_ar, email, phone, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [org.id, b.client!.kind, b.client!.name, b.client!.name_ar, b.client!.email, b.client!.phone, notes, user.id])
      clientId = cl!.id
      clientCreated = true
    }
    let caseRow: { id: string; reference: string } | null = null
    if (b.case) {
      const seq = await q.one('UPDATE organizations SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq', [org.id])
      const reference = `${new Date().getFullYear()}-${String(seq!.case_seq).padStart(4, '0')}`
      caseRow = (await q.one<{ id: string; reference: string }>(
        `INSERT INTO cases (org_id, reference, title, client_id, practice_area, jurisdiction, opposing_party, status, priority, description, currency, assigned_to, opened_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $10, 'pending', $11, $7, $8, $9, CURRENT_DATE, $9) RETURNING id, reference`,
        [org.id, reference, b.case.title, clientId, b.case.practice_area, b.case.jurisdiction, lead.message, org.default_currency, user.id,
         b.case.opposing_party, lead.urgency === 'urgent' ? 'high' : 'medium'])) ?? null
      await caseActivity(q, org.id, caseRow!.id, user.id, 'created', 'Case opened from a website enquiry')
      if (gate.decision === 'override') await caseActivity(q, org.id, caseRow!.id, user.id, 'conflict', `Conflict check overridden: ${gate.reason}`)
    }
    await logConflictCheck(q, {
      orgId: org.id, userId: user.id, subjectType: caseRow ? 'case' : 'client', subjectId: caseRow?.id ?? clientId!,
      subjectName: b.case?.title ?? b.client?.name ?? lead.name, matches: blocking, ...gate
    })
    await q.query(`UPDATE leads SET status = 'converted', client_id = $3, case_id = $4, handled_by = coalesce(handled_by, $5), updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, clientId, caseRow?.id ?? null, user.id])
    return { client_id: clientId!, client_created: clientCreated, case: caseRow }
  })
  await audit(c, 'lead.converted', 'lead', id, { client_id: result.client_id, case_id: result.case?.id ?? null })
  return c.json({ ...result, conflict_check: { decision: gate.decision, matches: blocking } })
})

export default websiteRoutes
