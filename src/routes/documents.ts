import { ocrReviewItems } from '../services/ai-guard'
import { fileStore, readFile, storeFile } from '../services/storage'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, runLater, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { DOC_TYPE_IDS, JURISDICTION_CODES } from '../services/reference'
import { assertCanCreateDocument, assertCanUseAi, recordAiUsage } from '../services/usage'
import {
  detectLanguage, isStalled, MAX_RUNNING_PER_ORG, MAX_TRANSLATION_CHARS, runningTranslations, runTranslation, translationTitle, type Lang
} from '../services/translation'
import { ACCEPTED_TYPES, detectKind, extractWithOcr } from '../services/extract'
import { bilingualPairs, renderBilingualDocx } from '../services/bilingual'
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
  client_id: optUuid,
  shared_with_client: z.boolean()
}
const createSchema = z.object({
  ...docFields,
  doc_type: docFields.doc_type.default('other'),
  language: docFields.language.default('en'),
  status: docFields.status.default('draft'),
  content: docFields.content.default(''),
  shared_with_client: docFields.shared_with_client.default(false)
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
  ocr?: boolean; uploadedByClient?: boolean; sharedWithClient?: boolean
}) {
  const stored = await storeFile(fileStore(), 'documents', v.orgId, v.file?.bytes ?? null, v.file?.mime ?? 'application/octet-stream')
  const doc = await db.query(
    `INSERT INTO documents (org_id, case_id, client_id, title, doc_type, language, jurisdiction, status, source, content, file_name, mime_type, file_size, file_data, created_by,
                            ocr, uploaded_by_client, shared_with_client, file_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING id, org_id, case_id, client_id, title, doc_type, language, jurisdiction, status, source, content, version, file_name, mime_type, file_size,
               ocr, uploaded_by_client, shared_with_client, created_at, updated_at`,
    [v.orgId, v.caseId, v.clientId, v.title, v.docType, v.language, v.jurisdiction, v.status ?? 'draft', v.source, v.content,
     v.file?.name ?? null, v.file?.mime ?? null, v.file?.bytes.length ?? null, stored.data, v.userId,
     v.ocr ?? false, v.uploadedByClient ?? false, v.sharedWithClient ?? false, stored.key])
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
            d.shared_with_client, d.uploaded_by_client, d.translated_from, d.translation_status,
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
            d.shared_with_client, d.uploaded_by_client, d.ocr,
            d.translated_from, src.title AS translated_from_title, src.language AS translated_from_language,
            d.translation_status, d.translation_done, d.translation_total, d.translation_error, d.translation_heartbeat, d.translation_checks,
            d.case_id, k.reference AS case_reference, k.title AS case_title, d.client_id, cl.name AS client_name,
            d.created_at, d.updated_at, u.name AS created_by_name
       FROM documents d LEFT JOIN cases k ON k.id = d.case_id LEFT JOIN clients cl ON cl.id = d.client_id LEFT JOIN users u ON u.id = d.created_by
            LEFT JOIN documents src ON src.id = d.translated_from AND src.org_id = d.org_id
      WHERE d.id = $1 AND d.org_id = $2`, [id, org.id])
  if (!document) throw notFound('Document')
  document.translation_stalled = isStalled(document as any)
  // Text read from a scan: passages the OCR was unsure of, unreadable pages and misread numbers.
  if (document.ocr) document.ocr_review = ocrReviewItems(String(document.content ?? ''), 50)
  const [versions, analyses, translations] = await Promise.all([
    db.query(`SELECT v.version, v.title, v.created_at, u.name AS created_by_name FROM document_versions v LEFT JOIN users u ON u.id = v.created_by
               WHERE v.document_id = $1 AND v.org_id = $2 ORDER BY v.version DESC`, [id, org.id]),
    db.query(`SELECT a.id, a.analysis_type, a.language, a.jurisdiction, a.result, a.model, a.created_at, u.name AS created_by_name
                FROM document_analyses a LEFT JOIN users u ON u.id = a.created_by
               WHERE a.document_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC LIMIT 20`, [id, org.id]),
    db.query(`SELECT id, title, language, translation_status, created_at FROM documents WHERE translated_from = $1 AND org_id = $2 ORDER BY created_at DESC`, [id, org.id])
  ])
  return c.json({ document, versions, analyses, translations })
})

documentsRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertCanCreateDocument(db, org)
  await assertDocRefs(db, org.id, b)
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id, title: b.title, docType: b.doc_type, language: b.language, jurisdiction: b.jurisdiction,
    status: b.status, source: 'manual', content: b.content, caseId: b.case_id, clientId: b.client_id, sharedWithClient: b.shared_with_client
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
  const { ai, log } = c.get('deps')
  const extracted = await extractWithOcr({ ai, log, onAiUsage: (r) => recordAiUsage(db, org.id, user.id, 'ocr', r) }, bytes, kind, file.name)
  const text = extracted.text.slice(0, MAX_CONTENT)
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id,
    title: meta.data.title || file.name.replace(/\.[^.]+$/, '').slice(0, 300),
    docType: meta.data.doc_type, language: meta.data.language, jurisdiction: meta.data.jurisdiction ?? null,
    source: 'upload', content: text, caseId: meta.data.case_id, clientId: meta.data.client_id,
    file: { name: file.name.slice(0, 255), mime: ACCEPTED_TYPES[kind], bytes }, ocr: extracted.ocr
  })
  await audit(c, 'document.uploaded', 'document', document.id, { file_name: file.name, size: file.size })
  return c.json({ document, extracted_characters: text.length, ocr: extracted.ocr, warning: text.length < 20 ? 'little_text' : undefined }, 201)
})

documentsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertDocRefs(db, org.id, b)
  const document = await db.tx(async (q) => {
    const current = await q.one('SELECT id, title, content, version, translation_status FROM documents WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!current) return null
    if (b.content !== undefined && current.translation_status === 'running') {
      throw new HttpError(409, 'translation_running', 'This document is still being translated. Edit it when the translation has finished.')
    }
    const { sets, values } = buildUpdate(b, ['title', 'doc_type', 'language', 'jurisdiction', 'status', 'content', 'case_id', 'client_id', 'shared_with_client'], 3)
    // Every content change snapshots the previous text so edits are never lost.
    if (b.content !== undefined && b.content !== current.content) {
      await q.query('INSERT INTO document_versions (org_id, document_id, version, title, content, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [org.id, id, current.version, current.title, current.content, user.id])
      sets.push('version = version + 1')
    }
    return q.one(
      `UPDATE documents SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2
       RETURNING id, title, doc_type, language, jurisdiction, status, source, content, version, case_id, client_id, shared_with_client, updated_at`,
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
  const row = await c.get('deps').db.one('SELECT file_name, mime_type, file_data, file_key FROM documents WHERE id = $1 AND org_id = $2 AND (file_data IS NOT NULL OR file_key IS NOT NULL)', [id, org.id])
  const bytes = row && await readFile(fileStore(), { data: row.file_data, key: row.file_key })
  if (!row || !bytes) throw notFound('Original file')
  await audit(c, 'document.downloaded', 'document', id)
  return new Response(Buffer.from(bytes), {
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

// The original and its translation side by side (English | العربية), as GCC contracts are signed.
// format=json returns the aligned rows so the app can show a preview and flag rows to check.
documentsRoutes.get('/:id/bilingual', queryParams(z.object({
  partner: z.string().uuid().optional(),
  prevailing: z.enum(['ar', 'en', 'none']).default('ar'),
  letterhead: z.enum(['true', 'false']).default('true'),
  format: z.enum(['docx', 'json']).default('docx')
})), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const doc = await db.one('SELECT id, title, content, language, translated_from, translation_status FROM documents WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!doc) throw notFound('Document')
  // The other language: the given partner, the document this was translated from, or its latest finished translation.
  const partner = q.partner
    ? await db.one(`SELECT id, title, content, language, translation_status FROM documents WHERE id = $1 AND org_id = $2 AND (translated_from = $3 OR id = $4)`, [q.partner, org.id, id, doc.translated_from])
    : doc.translated_from
      ? await db.one('SELECT id, title, content, language, translation_status FROM documents WHERE id = $1 AND org_id = $2', [doc.translated_from, org.id])
      : await db.one(`SELECT id, title, content, language, translation_status FROM documents WHERE translated_from = $1 AND org_id = $2 AND translation_status = 'done' ORDER BY created_at DESC LIMIT 1`, [id, org.id])
  if (!partner) throw badRequest('Translate this document first; the bilingual version pairs it with its translation.')
  if ([doc, partner].some((d) => d.translation_status === 'running' || d.translation_status === 'failed')) throw badRequest('Wait until the translation has finished.')
  const en = doc.language === 'en' ? doc : partner.language === 'en' ? partner : null
  const ar = doc.language === 'ar' ? doc : partner.language === 'ar' ? partner : null
  if (!en || !ar) throw badRequest('A bilingual version needs one English and one Arabic document.')
  const pairs = bilingualPairs(en.content, ar.content)
  if (q.format === 'json') return c.json({ english: { id: en.id, title: en.title }, arabic: { id: ar.id, title: ar.title }, pairs, flagged: pairs.filter((p) => p.flagged).length })
  const lh = q.letterhead === 'true' ? await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id]) : null
  const buf = await renderBilingualDocx({ titleEn: en.title, titleAr: ar.title, pairs, prevailing: q.prevailing === 'none' ? null : q.prevailing, letterhead: lh as any, firmName: lh?.firm_name || org.name })
  await audit(c, 'document.bilingual_exported', 'document', id, { partner: partner.id, rows: pairs.length })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(`${en.title} - bilingual`, 'docx')), 'cache-control': 'private, no-store' }
  })
})

// AI translation into a new, linked document (Arabic <-> English).
documentsRoutes.post('/:id/translate', jsonBody(z.object({ target: z.enum(['en', 'ar']).optional() })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const { target } = c.req.valid('json')
  const deps = c.get('deps')
  const { db } = deps
  const src = await db.one(
    'SELECT id, title, doc_type, language, jurisdiction, content, case_id, client_id, translation_status FROM documents WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!src) throw notFound('Document')
  if (src.translation_status === 'running') throw new HttpError(409, 'translation_running', 'Wait for this document to finish translating first.')
  if (!/[\p{L}]/u.test(src.content)) throw badRequest('This document has no text to translate.')
  if (src.content.length > MAX_TRANSLATION_CHARS) {
    throw new HttpError(422, 'document_too_long', `Documents up to ${MAX_TRANSLATION_CHARS.toLocaleString('en')} characters can be translated. Split this document first.`)
  }
  const from = detectLanguage(src.content, src.language)
  const to: Lang = target ?? (from === 'ar' ? 'en' : 'ar')
  if (to === from) throw badRequest(to === 'ar' ? 'This document is already in Arabic.' : 'This document is already in English.')
  await assertCanUseAi(db, org)
  await assertCanCreateDocument(db, org)
  if ((await runningTranslations(db, org.id)) >= MAX_RUNNING_PER_ORG) {
    throw new HttpError(429, 'translations_busy', `Up to ${MAX_RUNNING_PER_ORG} translations can run at once. Try again when one has finished.`)
  }
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id, title: translationTitle(src.title, to), docType: src.doc_type, language: to, jurisdiction: src.jurisdiction,
    source: 'ai', content: '', caseId: src.case_id, clientId: src.client_id
  })
  await db.query(`UPDATE documents SET translated_from = $2, translation_status = 'running', translation_heartbeat = now() WHERE id = $1`, [document.id, id])
  await audit(c, 'document.translated', 'document', document.id, { from: id, language: to })
  runLater(deps, 'document translation', () => runTranslation(deps, document.id))
  return c.json({ document: { ...document, translated_from: id, translation_status: 'running' } }, 202)
})

documentsRoutes.post('/:id/translation/retry', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const deps = c.get('deps')
  await assertCanUseAi(deps.db, org)
  const rows = await deps.db.query(
    `UPDATE documents SET translation_status = 'running', translation_error = NULL, translation_heartbeat = now()
      WHERE id = $1 AND org_id = $2 AND translated_from IS NOT NULL
        AND (translation_status = 'failed' OR (translation_status = 'running' AND (translation_heartbeat IS NULL OR translation_heartbeat < now() - interval '10 minutes')))
      RETURNING id`, [id, org.id])
  if (!rows.length) throw new HttpError(409, 'translation_not_retryable', 'This translation is not waiting for a retry.')
  await audit(c, 'document.translation_retried', 'document', id)
  runLater(deps, 'document translation', () => runTranslation(deps, id))
  return c.json({ ok: true }, 202)
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
