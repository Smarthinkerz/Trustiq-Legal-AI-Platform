import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors'
import { jsonBody, likePattern, optText, pageSchema, paged, queryParams, updateBody, uuidParam } from '../lib/http'
import { JURISDICTION_CODES } from '../services/reference'
import { ACCEPTED_TYPES, cleanText, detectKind, extractWithOcr } from '../services/extract'
import { citationLabel, indexSource, searchLibrary } from '../services/library'
import { RELATIONS, applyArticleFlags, applySourceRelation, linkedInstruments } from '../services/legal-corpus'
import { contentDisposition } from '../services/export'
import { recordAiUsage } from '../services/usage'
import { allowedUrl, discoverLinks, ImportError, importDomains } from '../services/library-import'

export const LIBRARY_KINDS = ['law', 'royal_decree', 'regulation', 'ministerial_decision', 'judgment', 'circular', 'treaty', 'other'] as const
const STATUSES = ['in_force', 'amended', 'repealed'] as const
const MAX_TEXT = 3_000_000

const metaSchema = z.object({
  title: z.string().trim().min(2).max(400),
  jurisdiction: z.enum(JURISDICTION_CODES),
  kind: z.enum(LIBRARY_KINDS).default('law'),
  number: optText(60),
  year: z.coerce.number().int().min(1800).max(2100).nullish().or(z.literal('')).transform((v) => (v === '' || v == null ? null : v)),
  status: z.enum(STATUSES).default('in_force'),
  language: z.enum(['en', 'ar']).default('ar'),
  source_url: z.string().trim().url().max(500).nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(2000),
  // Point-in-time validity of this version: in force from, and no longer in force from.
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  version_label: optText(120),
  scope: z.enum(['org', 'platform']).default('org')
})
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const isPlatformAdmin = (c: Ctx) => c.get('deps').config.platformAdminEmails.includes(auth(c).user.email.toLowerCase())

// Firms curate a private library; platform admins curate the shared library visible to every firm.
function assertCanEdit(c: Ctx, source: { org_id: string | null }) {
  const { user } = auth(c)
  if (source.org_id === null) {
    if (!isPlatformAdmin(c)) throw forbidden('Only platform administrators can change the shared library.')
    return
  }
  if (source.org_id !== user.org_id) throw notFound('Source')
  requireRole(c, 'owner', 'admin', 'lawyer')
}

const libraryRoutes = new Hono<AppEnv>()

libraryRoutes.get('/sources', queryParams(z.object({
  ...pageSchema,
  jurisdiction: z.enum(JURISDICTION_CODES).optional(),
  kind: z.enum(LIBRARY_KINDS).optional(),
  scope: z.enum(['all', 'org', 'platform']).default('all')
})), async (c) => {
  const { org } = auth(c)
  const { page, pageSize, q, jurisdiction, kind, scope } = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = [scope === 'org' ? 's.org_id = $1' : scope === 'platform' ? '(s.org_id IS NULL AND $1::uuid IS NOT NULL)' : '(s.org_id = $1 OR s.org_id IS NULL)']
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)) }
  if (jurisdiction) add('s.jurisdiction = ?', jurisdiction)
  if (kind) add('s.kind = ?', kind)
  if (q) add('(s.title ILIKE ? OR s.number ILIKE ? OR s.notes ILIKE ?)'.replace(/\?/g, `$${params.length + 1}`), likePattern(q))
  const where = conds.join(' AND ')
  const { db } = c.get('deps')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM library_sources s WHERE ${where}`, params)
  const items = await db.query(
    `SELECT s.id, s.org_id, (s.org_id IS NULL) AS shared, s.jurisdiction, s.kind, s.title, s.number, s.year, s.status, s.language,
            s.source_url, s.articles, s.file_name, s.created_at, s.updated_at, s.version_label,
            to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to
       FROM library_sources s WHERE ${where}
      ORDER BY s.jurisdiction, s.year DESC NULLS LAST, s.title LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

libraryRoutes.get('/sources/:id', queryParams(z.object({ q: z.string().trim().max(200).optional() })), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const { db } = c.get('deps')
  const source = await db.one(
    `SELECT s.id, s.org_id, (s.org_id IS NULL) AS shared, s.jurisdiction, s.kind, s.title, s.number, s.year, s.status, s.language,
            s.source_url, s.notes, s.articles, s.file_name, s.created_at, s.updated_at, s.work_id, s.version_label,
            to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to
       FROM library_sources s WHERE s.id = $1 AND (s.org_id = $2 OR s.org_id IS NULL)`, [id, org.id])
  if (!source) throw notFound('Source')
  const q = c.req.valid('query').q
  const chunks = q
    ? (await searchLibrary(db, org.id, q, { sourceId: id, limit: 50 })).map((p) => ({ id: p.id, label: p.label, text: p.text, article_no: p.article_no, status: p.article_status, changed_on: p.changed_on }))
    : await db.query(`SELECT id, ordinal, label, text, article_no, status, to_char(changed_on, 'YYYY-MM-DD') AS changed_on FROM library_chunks WHERE source_id = $1 ORDER BY ordinal LIMIT 2000`, [id])
  const relations = (await linkedInstruments(db, org.id, [id])).get(id) ?? []
  // Other versions of the same instrument (point-in-time history).
  const versions = source.work_id ? await db.query(
    `SELECT id, title, version_label, status, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
       FROM library_sources WHERE work_id = $1 AND (org_id = $2 OR org_id IS NULL) ORDER BY effective_from NULLS FIRST, created_at`, [source.work_id, org.id]) : []
  return c.json({ source, chunks, relations, versions })
})

libraryRoutes.get('/sources/:id/file', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const row = await c.get('deps').db.one(
    'SELECT file_name, mime_type, file_data FROM library_sources WHERE id = $1 AND (org_id = $2 OR org_id IS NULL) AND file_data IS NOT NULL', [id, org.id])
  if (!row) throw notFound('Original file')
  return new Response(Buffer.from(row.file_data), {
    headers: { 'content-type': row.mime_type, 'content-disposition': contentDisposition(row.file_name), 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }
  })
})

libraryRoutes.get('/chunks/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Passage')
  const row = await c.get('deps').db.one(
    `SELECT c.id, c.label, c.text, c.source_id, s.title, s.number, s.year, s.status, s.jurisdiction, s.kind, s.source_url
       FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
      WHERE c.id = $1 AND (s.org_id = $2 OR s.org_id IS NULL)`, [id, org.id])
  if (!row) throw notFound('Passage')
  return c.json({ passage: { ...row, citation: citationLabel(row as any) } })
})

libraryRoutes.get('/search', queryParams(z.object({
  q: z.string().trim().min(2).max(500),
  jurisdiction: z.enum(JURISDICTION_CODES).optional(),
  // Only versions in force on this date (point-in-time law).
  as_of: dateParam.optional()
})), async (c) => {
  const { org } = auth(c)
  const { q, jurisdiction, as_of } = c.req.valid('query')
  const passages = await searchLibrary(c.get('deps').db, org.id, q, { jurisdictions: jurisdiction ? [jurisdiction] : undefined, asOf: as_of, limit: 30 })
  return c.json({ items: passages.map((p) => ({ ...p, citation: citationLabel(p) })) })
})

// Accepts either a file (PDF/DOCX/TXT) or pasted text, plus metadata, as multipart form data.
libraryRoutes.post('/sources', async (c) => {
  const { user, org } = auth(c)
  const { db, config, ai, log } = c.get('deps')
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a multipart form upload.') })
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))
  const meta = metaSchema.safeParse(fields)
  if (!meta.success) throw badRequest('Please check the highlighted fields.', meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const m = meta.data
  if (m.scope === 'platform') {
    if (!isPlatformAdmin(c)) throw forbidden('Only platform administrators can add to the shared library.')
  } else requireRole(c, 'owner', 'admin', 'lawyer')

  const file = form.get('file')
  let text = typeof fields.text === 'string' ? cleanText(fields.text) : ''
  let fileInfo: { name: string; mime: string; bytes: Uint8Array } | null = null
  let ocr = false
  if (file instanceof File && file.size > 0) {
    if (file.size > config.maxUploadBytes) throw new HttpError(413, 'file_too_large', 'This file is too large.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = detectKind(bytes, file.name)
    if (!kind) throw new HttpError(415, 'unsupported_file', 'Upload a PDF, Word (.docx) or plain-text file.')
    const extracted = await extractWithOcr({ ai, log, onAiUsage: (r) => recordAiUsage(db, org.id, user.id, 'ocr', r) }, bytes, kind, file.name)
    text = extracted.text
    ocr = extracted.ocr
    fileInfo = { name: file.name.slice(0, 255), mime: ACCEPTED_TYPES[kind], bytes }
  }
  if (text.replace(/\s/g, '').length < 20) throw badRequest('No readable text was found. Upload a text-based PDF or Word file, or paste the text.')
  text = text.slice(0, MAX_TEXT)

  const ownerOrg = m.scope === 'platform' ? null : org.id
  const result = await db.tx(async (q) => {
    const src = await q.one(
      `INSERT INTO library_sources (org_id, jurisdiction, kind, title, number, year, status, language, source_url, notes, file_name, mime_type, file_data, created_by, effective_from, effective_to, version_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [ownerOrg, m.jurisdiction, m.kind, m.title, m.number, m.year, m.status, m.language, m.source_url, m.notes,
       fileInfo?.name ?? null, fileInfo?.mime ?? null, fileInfo ? Buffer.from(fileInfo.bytes) : null, user.id, m.effective_from, m.effective_to, m.version_label])
    const passages = await indexSource(q, src!.id, ownerOrg, text)
    return { id: src!.id as string, passages }
  })
  await audit(c, 'library.source_added', 'library_source', result.id, { scope: m.scope, title: m.title })
  return c.json({ source: { id: result.id }, passages: result.passages, ocr }, 201)
})

libraryRoutes.patch('/sources/:id', jsonBody(updateBody(metaSchema.omit({ scope: true }).shape)), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const { db } = c.get('deps')
  const src = await db.one<{ org_id: string | null }>('SELECT org_id FROM library_sources WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)', [id, org.id])
  if (!src) throw notFound('Source')
  assertCanEdit(c, src)
  const b = c.req.valid('json')
  const cols = ['title', 'jurisdiction', 'kind', 'number', 'year', 'status', 'language', 'source_url', 'notes', 'effective_from', 'effective_to', 'version_label'] as const
  const sets: string[] = []
  const values: unknown[] = []
  for (const k of cols) if (b[k] !== undefined) { values.push(b[k]); sets.push(`${k} = $${values.length + 1}`) }
  if (sets.length) await db.query(`UPDATE library_sources SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values])
  await audit(c, 'library.source_updated', 'library_source', id, { fields: Object.keys(b) })
  return c.json({ ok: true })
})

libraryRoutes.delete('/sources/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const { db } = c.get('deps')
  const src = await db.one<{ org_id: string | null; title: string }>('SELECT org_id, title FROM library_sources WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)', [id, org.id])
  if (!src) throw notFound('Source')
  assertCanEdit(c, src)
  await db.query('DELETE FROM library_sources WHERE id = $1', [id])
  await audit(c, 'library.source_deleted', 'library_source', id, { title: src.title })
  return c.json({ ok: true })
})

// ---------------- Links between instruments ----------------

// A link from this source to another: it amends, repeals, implements or replaces it (optionally one article).
libraryRoutes.post('/sources/:id/relations', jsonBody(z.object({
  relation: z.enum(RELATIONS),
  to_source_id: z.string().uuid(),
  from_article: optText(20),
  to_article: optText(20),
  effective_on: dateParam.nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(1000)
})), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [from, to] = await Promise.all([id, b.to_source_id].map((sid) =>
    db.one<{ id: string; org_id: string | null }>('SELECT id, org_id FROM library_sources WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)', [sid, org.id])))
  if (!from || !to) throw notFound('Source')
  if (from.id === to.id) throw badRequest('A source cannot be linked to itself.')
  // A link between two shared sources belongs to the shared library; any other link belongs to the firm.
  const shared = from.org_id === null && to.org_id === null
  if (shared) { if (!isPlatformAdmin(c)) throw forbidden('Only platform administrators can link sources in the shared library.') } else requireRole(c, 'owner', 'admin', 'lawyer')
  // A firm may not change the validity of a shared law for everyone.
  if (to.org_id === null && !shared && ['repeals', 'replaces', 'amends'].includes(b.relation) && !isPlatformAdmin(c)) {
    throw forbidden('Only platform administrators can mark a shared law as amended, repealed or replaced.')
  }
  const rel = await db.tx(async (q) => {
    const row = await q.one<{ id: string }>(
      `INSERT INTO library_relations (org_id, from_source_id, from_article, relation, to_source_id, to_article, effective_on, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [shared ? null : org.id, id, b.from_article, b.relation, b.to_source_id, b.to_article, b.effective_on, b.notes, user.id])
    await applySourceRelation(q, { from_source_id: id, to_source_id: b.to_source_id, relation: b.relation, to_article: b.to_article, effective_on: b.effective_on })
    return row!
  })
  await audit(c, 'library.relation_added', 'library_source', id, { relation: b.relation, to: b.to_source_id, to_article: b.to_article })
  return c.json({ relation: { id: rel.id } }, 201)
})

libraryRoutes.delete('/relations/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Link')
  const { db } = c.get('deps')
  const rel = await db.one<{ org_id: string | null; to_source_id: string }>(
    'SELECT org_id, to_source_id FROM library_relations WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)', [id, org.id])
  if (!rel) throw notFound('Link')
  if (rel.org_id === null) { if (!isPlatformAdmin(c)) throw forbidden('Only platform administrators can change the shared library.') } else requireRole(c, 'owner', 'admin', 'lawyer')
  await db.tx(async (q) => {
    await q.query('DELETE FROM library_relations WHERE id = $1', [id])
    await applyArticleFlags(q, rel.to_source_id)
  })
  await audit(c, 'library.relation_deleted', 'library_source', rel.to_source_id, { relation_id: id })
  return c.json({ ok: true })
})

// ---------------- Import from official websites ----------------

const MAX_QUEUED_PER_ORG = 2000

function assertCanImport(c: Ctx, scope: 'org' | 'platform') {
  if (scope === 'platform') {
    if (!isPlatformAdmin(c)) throw forbidden('Only platform administrators can add to the shared library.')
  } else requireRole(c, 'owner', 'admin', 'lawyer')
}

libraryRoutes.post('/imports/discover', jsonBody(z.object({
  url: z.string().trim().min(8).max(2000),
  pages: z.number().int().min(1).max(50).default(1)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { url, pages } = c.req.valid('json')
  const deps = c.get('deps')
  if (!allowedUrl(url, importDomains(deps.config))) throw badRequest('Only links to official government legislation websites can be used.')
  try {
    const result = await discoverLinks(deps, url, pages)
    return c.json(result)
  } catch (err) {
    if (err instanceof ImportError) throw badRequest(err.message)
    throw err
  }
})

libraryRoutes.post('/imports', jsonBody(z.object({
  items: z.array(z.object({ url: z.string().trim().min(8).max(2000), title: z.string().trim().max(400).nullish() })).min(1).max(500),
  jurisdiction: z.enum(JURISDICTION_CODES),
  kind: z.enum(LIBRARY_KINDS).nullish(),
  language: z.enum(['en', 'ar']).nullish(),
  status: z.enum(STATUSES).nullish(),
  scope: z.enum(['org', 'platform']).default('org')
})), async (c) => {
  const b = c.req.valid('json')
  assertCanImport(c, b.scope)
  const { user, org } = auth(c)
  const { db, config } = c.get('deps')
  const domains = importDomains(config)
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM library_imports WHERE org_id = $1 AND status IN ('queued', 'running')`, [org.id])
  if (n + b.items.length > MAX_QUEUED_PER_ORG) throw badRequest(`At most ${MAX_QUEUED_PER_ORG} imports can be waiting at once. Wait for the current ones to finish.`)
  const skipped: { url: string; reason: string }[] = []
  const seen = new Set<string>()
  let queued = 0
  for (const item of b.items) {
    const url = allowedUrl(item.url, domains)
    if (!url) { skipped.push({ url: item.url, reason: 'not_allowed' }); continue }
    const key = url.toString()
    if (seen.has(key)) continue
    seen.add(key)
    const pending = await db.one(`SELECT 1 FROM library_imports WHERE org_id = $1 AND url = $2 AND scope = $3 AND status IN ('queued', 'running')`, [org.id, key, b.scope])
    if (pending) { skipped.push({ url: key, reason: 'already_queued' }); continue }
    await db.query(
      `INSERT INTO library_imports (org_id, scope, created_by, url, title, jurisdiction, kind, language, status_hint) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [org.id, b.scope, user.id, key, item.title || null, b.jurisdiction, b.kind ?? null, b.language ?? null, b.status ?? null])
    queued++
  }
  await audit(c, 'library.import_queued', 'library_import', undefined, { queued, skipped: skipped.length, scope: b.scope, jurisdiction: b.jurisdiction })
  return c.json({ queued, skipped }, 201)
})

libraryRoutes.get('/imports', async (c) => {
  const { org } = auth(c)
  const { db } = c.get('deps')
  const [items, [summary]] = await Promise.all([
    db.query(
      `SELECT i.id, i.url, i.title, i.scope, i.jurisdiction, i.status, i.detail, i.source_id, i.created_at, i.finished_at, s.title AS source_title, s.articles
         FROM library_imports i LEFT JOIN library_sources s ON s.id = i.source_id
        WHERE i.org_id = $1 ORDER BY (i.status IN ('queued', 'running')) DESC, i.created_at DESC LIMIT 300`, [org.id]),
    db.query(
      `SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'running')::int AS running,
              count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM library_imports WHERE org_id = $1`, [org.id])
  ])
  return c.json({ items, summary })
})

libraryRoutes.post('/imports/:id/retry', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const rows = await c.get('deps').db.query(
    `UPDATE library_imports SET status = 'queued', detail = NULL, attempts = 0, started_at = NULL, finished_at = NULL
      WHERE id = $1 AND org_id = $2 AND status = 'failed' RETURNING id`, [uuidParam(c.req.param('id'), 'Import'), org.id])
  if (!rows.length) throw notFound('Import')
  return c.json({ ok: true })
})

libraryRoutes.post('/imports/retry-failed', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const rows = await c.get('deps').db.query(
    `UPDATE library_imports SET status = 'queued', detail = NULL, attempts = 0, started_at = NULL, finished_at = NULL
      WHERE org_id = $1 AND status = 'failed' RETURNING id`, [org.id])
  return c.json({ requeued: rows.length })
})

libraryRoutes.delete('/imports', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const which = c.req.query('which') === 'queued' ? `status = 'queued'` : `status IN ('done', 'skipped', 'failed')`
  const rows = await c.get('deps').db.query(`DELETE FROM library_imports WHERE org_id = $1 AND ${which} RETURNING id`, [org.id])
  return c.json({ removed: rows.length })
})

export default libraryRoutes
