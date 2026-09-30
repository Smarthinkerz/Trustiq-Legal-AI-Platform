import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { DOC_TYPE_IDS, JURISDICTION_CODES } from '../services/reference'
import { assertCanCreateDocument } from '../services/usage'
import { ACCEPTED_TYPES, cleanText, detectKind, extractText } from '../services/extract'
import { contentDisposition, renderDocx, safeFileName } from '../services/export'
import { caseActivity } from './cases'

const MAX_CONTENT = 2_000_000
const STATUSES = ['draft', 'review', 'final'] as const

const docFields = {
  title: z.string().trim().min(1).max(300),
  doc_type: z.enum(DOC_TYPE_IDS),
  language: z.enum(['en', 'ar']),
  jurisdiction: z.enum(JURISDICTION_CODES).nullish().or(z.literal('')).transform((v) => v || null),
  status: z.enum(STATUSES),
  content: z.string().max(MAX_CONTENT),
  case_id: optUuid,
  client_id: optUuid
}
const createSchema = z.object({
  ...docFields,
  doc_type: docFields.doc_type.default('other'),
  language: docFields.language.default('en'),
  status: docFields.status.default('draft'),
  content: docFields.content.default('')
})
const updateSchema = z.object(docFields).partial()

export async function assertDocRefs(db: Queryable, orgId: string, refs: { case_id?: string | null; client_id?: string | null }) {
  if (refs.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [refs.case_id, orgId])).length) throw badRequest('Selected case does not exist.')
  if (refs.client_id && !(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [refs.client_id, orgId])).length) throw badRequest('Selected client does not exist.')
}

// Shared by manual creation, uploads and AI drafting.
export async function insertDocument(db: Queryable, v: {
  orgId: string; userId: string; title: string; docType: string; language: string; jurisdiction: string | null; status?: string
  source: 'upload' | 'ai' | 'manual'; content: string; caseId: string | null; clientId: string | null
  file?: { name: string; mime: string; bytes: Uint8Array }
}) {
  const doc = await db.query(
    `INSERT INTO documents (org_id, case_id, client_id, title, doc_type, language, jurisdiction, status, source, content, file_name, mime_type, file_size, file_data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, org_id, case_id, client_id, title, doc_type, language, jurisdiction, status, source, content, version, file_name, mime_type, file_size, created_at, updated_at`,
    [v.orgId, v.caseId, v.clientId, v.title, v.docType, v.language, v.jurisdiction, v.status ?? 'draft', v.source, v.content,
     v.file?.name ?? null, v.file?.mime ?? null, v.file?.bytes.length ?? null, v.file ? Buffer.from(v.file.bytes) : null, v.userId])
  if (v.caseId) await caseActivity(db, v.orgId, v.caseId, v.userId, 'document', `Document added: ${v.title}`)
  return doc[0]
}

const documentsRoutes = new Hono<AppEnv>()

documentsRoutes.get('/', queryParams(z.object({
  ...pageSchema,
  case_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional()
})), async (c) => {
  const { org } = auth(c)
  const { page, pageSize, q, case_id, client_id, status } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = [org.id]
  const conds = ['d.org_id = $1']
  const add = (col: string, v: unknown) => { params.push(v); conds.push(`${col} = $${params.length}`) }
  if (case_id) add('d.case_id', case_id)
  if (client_id) add('d.client_id', client_id)
  if (status) add('d.status', status)
  if (q) { params.push(likePattern(q)); conds.push(`(d.title ILIKE $${params.length} OR d.file_name ILIKE $${params.length})`) }
  const where = conds.join(' AND ')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM documents d WHERE ${where}`, params)
  const items = await db.query(
    `SELECT d.id, d.title, d.doc_type, d.language, d.jurisdiction, d.status, d.source, d.version, d.file_name, d.file_size, d.updated_at, d.created_at,
            d.case_id, k.reference AS case_reference, k.title AS case_title, d.client_id, cl.name AS client_name, u.name AS created_by_name,
            (SELECT a.result->>'risk_score' FROM document_analyses a WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1)::int AS last_risk_score
       FROM documents d LEFT JOIN cases k ON k.id = d.case_id LEFT JOIN clients cl ON cl.id = d.client_id LEFT JOIN users u ON u.id = d.created_by
      WHERE ${where} ORDER BY d.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

documentsRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const { db } = c.get('deps')
  const document = await db.one(
    `SELECT d.id, d.title, d.doc_type, d.language, d.jurisdiction, d.status, d.source, d.content, d.version, d.file_name, d.mime_type, d.file_size,
            d.case_id, k.reference AS case_reference, k.title AS case_title, d.client_id, cl.name AS client_name,
            d.created_at, d.updated_at, u.name AS created_by_name
       FROM documents d LEFT JOIN cases k ON k.id = d.case_id LEFT JOIN clients cl ON cl.id = d.client_id LEFT JOIN users u ON u.id = d.created_by
      WHERE d.id = $1 AND d.org_id = $2`, [id, org.id])
  if (!document) throw notFound('Document')
  const [versions, analyses] = await Promise.all([
    db.query(`SELECT v.version, v.title, v.created_at, u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id = v.created_by
               WHERE v.document_id = $1 AND v.org_id = $2 ORDER BY v.version DESC`, [id, org.id]),
    db.query(`SELECT a.id, a.analysis_type, a.language, a.jurisdiction, a.result, a.model, a.created_at, u.name AS created_by_name
                FROM document_analyses a LEFT JOIN users u ON u.id = a.created_by
               WHERE a.document_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC LIMIT 20`, [id, org.id])
  ])
  return c.json({ document, versions, analyses })
})

documentsRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertCanCreateDocument(db, org)
  await assertDocRefs(db, org.id, b)
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id, title: b.title, docType: b.doc_type, language: b.language, jurisdiction: b.jurisdiction,
    status: b.status, source: 'manual', content: b.content, caseId: b.case_id, clientId: b.client_id
  })
  await audit(c, 'document.created', 'document', document.id)
  return c.json({ document }, 201)
})

documentsRoutes.post('/upload', async (c) => {
  const { user, org } = auth(c)
  const { db, config } = c.get('deps')
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a multipart form upload.') })
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw badRequest('Choose a file to upload.')
  if (file.size > config.maxUploadBytes) throw new HttpError(413, 'file_too_large', `Files must be smaller than ${Math.round(config.maxUploadBytes / 1048576)} MB.`)
  const meta = z.object({
    title: z.string().trim().max(300).optional(),
    doc_type: docFields.doc_type.default('other'),
    language: docFields.language.default('en'),
    jurisdiction: docFields.jurisdiction,
    case_id: optUuid,
    client_id: optUuid
  }).safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')))
  if (!meta.success) throw badRequest('Please check the upload details.', meta.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))

  await assertCanCreateDocument(db, org)
  await assertDocRefs(db, org.id, meta.data)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = detectKind(bytes, file.name)
  if (!kind) throw new HttpError(415, 'unsupported_file', 'Upload a PDF, Word (.docx) or plain-text file.')
  const text = cleanText(await extractText(bytes, kind)).slice(0, MAX_CONTENT)
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id,
    title: meta.data.title || file.name.replace(/\.[^.]+$/, '').slice(0, 300),
    docType: meta.data.doc_type, language: meta.data.language, jurisdiction: meta.data.jurisdiction ?? null,
    source: 'upload', content: text, caseId: meta.data.case_id, clientId: meta.data.client_id,
    file: { name: file.name.slice(0, 255), mime: ACCEPTED_TYPES[kind], bytes }
  })
  await audit(c, 'document.uploaded', 'document', document.id, { file_name: file.name, size: file.size })
  return c.json({ document, extracted_characters: text.length, warning: text.length < 20 ? 'little_text' : undefined }, 201)
})

documentsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertDocRefs(db, org.id, b)
  const document = await db.tx(async (q) => {
    const current = await q.one('SELECT id, title, content, version FROM documents WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!current) return null
    const { sets, values } = buildUpdate(b, ['title', 'doc_type', 'language', 'jurisdiction', 'status', 'content', 'case_id', 'client_id'], 3)
    // Every content change snapshots the previous text so edits are never lost.
    if (b.content !== undefined && b.content !== current.content) {
      await q.query('INSERT INTO document_versions (org_id, document_id, version, title, content, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [org.id, id, current.version, current.title, current.content, user.id])
      sets.push('version = version + 1')
    }
    return q.one(
      `UPDATE documents SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2
       RETURNING id, title, doc_type, language, jurisdiction, status, source, content, version, case_id, client_id, updated_at`,
      [id, org.id, ...values])
  })
  if (!document) throw notFound('Document')
  await audit(c, 'document.updated', 'document', id, { fields: Object.keys(b) })
  return c.json({ document })
})

documentsRoutes.get('/:id/versions/:version', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) throw badRequest('Invalid version')
  const row = await c.get('deps').db.one(
    'SELECT version, title, content, created_at FROM document_versions WHERE document_id = $1 AND org_id = $2 AND version = $3', [id, org.id, version])
  if (!row) throw notFound('Version')
  return c.json({ version: row })
})

documentsRoutes.get('/:id/file', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const row = await c.get('deps').db.one('SELECT file_name, mime_type, file_data FROM documents WHERE id = $1 AND org_id = $2 AND file_data IS NOT NULL', [id, org.id])
  if (!row) throw notFound('Original file')
  await audit(c, 'document.downloaded', 'document', id)
  return new Response(Buffer.from(row.file_data), {
    headers: { 'content-type': row.mime_type, 'content-disposition': contentDisposition(row.file_name), 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }
  })
})

documentsRoutes.get('/:id/export', queryParams(z.object({ format: z.enum(['docx', 'txt']).default('docx'), letterhead: z.enum(['true', 'false']).default('true') })), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const { format, letterhead } = c.req.valid('query')
  const { db } = c.get('deps')
  const doc = await db.one('SELECT title, content, language FROM documents WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!doc) throw notFound('Document')
  await audit(c, 'document.exported', 'document', id, { format })
  if (format === 'txt') {
    return new Response(doc.content, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': contentDisposition(safeFileName(doc.title, 'txt')), 'cache-control': 'private, no-store' } })
  }
  const lh = letterhead === 'true' ? await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id]) : null
  const buf = await renderDocx({ title: doc.title, content: doc.content, language: doc.language, letterhead: lh })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(doc.title, 'docx')), 'cache-control': 'private, no-store' }
  })
})

documentsRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const rows = await c.get('deps').db.query('DELETE FROM documents WHERE id = $1 AND org_id = $2 RETURNING title', [id, org.id])
  if (!rows.length) throw notFound('Document')
  await audit(c, 'document.deleted', 'document', id, { title: rows[0].title })
  return c.json({ ok: true })
})

export default documentsRoutes
