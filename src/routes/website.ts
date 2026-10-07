import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, conflict, notFound, tooMany } from '../lib/errors'
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
  status: z.enum(['draft', 'published'])
}
const POST_UPDATABLE = ['slug', 'title', 'title_ar', 'excerpt', 'excerpt_ar', 'body', 'body_ar'] as const

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
    `SELECT p.id, p.slug, p.title, p.title_ar, p.excerpt, p.excerpt_ar, p.status, p.published_at, p.updated_at, u.name AS author_name
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
  const postSlug = await uniquePostSlug(c, org.id, b.slug ?? slugify(b.title ?? ''))
  const post = await c.get('deps').db.one(
    `INSERT INTO blog_posts (org_id, slug, title, title_ar, excerpt, excerpt_ar, body, body_ar, status, published_at, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${b.status === 'published' ? 'now()' : 'NULL'}, $10) RETURNING *`,
    [org.id, postSlug, b.title, b.title_ar, b.excerpt, b.excerpt_ar, b.body, b.body_ar, b.status, user.id])
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
  const { sets, values } = buildUpdate(b, POST_UPDATABLE, 3)
  if (b.status) {
    sets.push(`status = '${b.status}'`)
    // Keep the original publication date when re-publishing an edited post.
    sets.push(b.status === 'published' ? 'published_at = coalesce(published_at, now())' : 'published_at = NULL')
  }
  const post = await db.one(`UPDATE blog_posts SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  const action = b.status && b.status !== current.status ? (b.status === 'published' ? 'blog.published' : 'blog.unpublished') : 'blog.updated'
  await audit(c, action, 'blog_post', id, { fields: Object.keys(b) })
  return c.json({ post })
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
  const r = c.get('deps').limiters.ai.take(user.id)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  }
  const { db, ai } = c.get('deps')
  await assertCanUseAi(db, org)
  const firm = await db.one('SELECT firm_name FROM branding WHERE org_id = $1', [org.id])
  const result = await ai.complete({
    messages: writerMessages({ ...b, firm_name: firm?.firm_name || org.name }),
    json: true, maxTokens: b.action === 'titles' || b.action === 'excerpt' ? 600 : 4000, temperature: 0.4
  })
  await recordAiUsage(db, org.id, user.id, 'blog_writer', result)
  let parsed: any
  try { parsed = parseJsonObject(result.text) } catch { throw badRequest('The AI reply could not be read. Please try again.') }
  return c.json({ result: normalizeWriterResult(b.action, parsed) })
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
      WHERE l.org_id = $1${filter} ORDER BY l.created_at DESC LIMIT 500`,
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
  return c.json({ lead }, 201)
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
    jurisdiction: z.enum(JURISDICTION_CODES)
  }).nullish()
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
        `INSERT INTO cases (org_id, reference, title, client_id, practice_area, jurisdiction, status, priority, description, currency, assigned_to, opened_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'medium', $7, $8, $9, CURRENT_DATE, $9) RETURNING id, reference`,
        [org.id, reference, b.case.title, clientId, b.case.practice_area, b.case.jurisdiction, lead.message, org.default_currency, user.id])) ?? null
      await caseActivity(q, org.id, caseRow!.id, user.id, 'created', 'Case opened from a website enquiry')
    }
    await q.query(`UPDATE leads SET status = 'converted', client_id = $3, case_id = $4, handled_by = coalesce(handled_by, $5), updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, clientId, caseRow?.id ?? null, user.id])
    return { client_id: clientId!, client_created: clientCreated, case: caseRow }
  })
  await audit(c, 'lead.converted', 'lead', id, { client_id: result.client_id, case_id: result.case?.id ?? null })
  return c.json(result)
})

export default websiteRoutes
