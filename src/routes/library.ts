import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors'
import { jsonBody, likePattern, optText, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { JURISDICTION_CODES } from '../services/reference'
import { ACCEPTED_TYPES, cleanText, detectKind, extractWithOcr } from '../services/extract'
import { citationLabel, indexSource, searchLibrary } from '../services/library'
import { contentDisposition } from '../services/export'
import { recordAiUsage } from '../services/usage'

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
  scope: z.enum(['org', 'platform']).default('org')
})

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
            s.source_url, s.articles, s.file_name, s.created_at, s.updated_at
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
            s.source_url, s.notes, s.articles, s.file_name, s.created_at, s.updated_at
       FROM library_sources s WHERE s.id = $1 AND (s.org_id = $2 OR s.org_id IS NULL)`, [id, org.id])
  if (!source) throw notFound('Source')
  const q = c.req.valid('query').q
  const chunks = q
    ? (await searchLibrary(db, org.id, q, { sourceId: id, limit: 50 })).map((p) => ({ id: p.id, label: p.label, text: p.text }))
    : await db.query('SELECT id, ordinal, label, text FROM library_chunks WHERE source_id = $1 ORDER BY ordinal LIMIT 2000', [id])
  return c.json({ source, chunks })
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
  jurisdiction: z.enum(JURISDICTION_CODES).optional()
})), async (c) => {
  const { org } = auth(c)
  const { q, jurisdiction } = c.req.valid('query')
  const passages = await searchLibrary(c.get('deps').db, org.id, q, { jurisdictions: jurisdiction ? [jurisdiction] : undefined, limit: 30 })
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
      `INSERT INTO library_sources (org_id, jurisdiction, kind, title, number, year, status, language, source_url, notes, file_name, mime_type, file_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [ownerOrg, m.jurisdiction, m.kind, m.title, m.number, m.year, m.status, m.language, m.source_url, m.notes,
       fileInfo?.name ?? null, fileInfo?.mime ?? null, fileInfo ? Buffer.from(fileInfo.bytes) : null, user.id])
    const passages = await indexSource(q, src!.id, ownerOrg, text)
    return { id: src!.id as string, passages }
  })
  await audit(c, 'library.source_added', 'library_source', result.id, { scope: m.scope, title: m.title })
  return c.json({ source: { id: result.id }, passages: result.passages, ocr }, 201)
})

libraryRoutes.patch('/sources/:id', jsonBody(metaSchema.omit({ scope: true }).partial()), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Source')
  const { db } = c.get('deps')
  const src = await db.one<{ org_id: string | null }>('SELECT org_id FROM library_sources WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)', [id, org.id])
  if (!src) throw notFound('Source')
  assertCanEdit(c, src)
  const b = c.req.valid('json')
  const cols = ['title', 'jurisdiction', 'kind', 'number', 'year', 'status', 'language', 'source_url', 'notes'] as const
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

export default libraryRoutes
