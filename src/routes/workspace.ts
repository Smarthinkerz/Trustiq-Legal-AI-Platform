import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, likePattern, optUuid, queryParams, uuidParam } from '../lib/http'
import { DOC_TYPE_IDS } from '../services/reference'
import { assertCanCreateDocument } from '../services/usage'
import { assertDocRefs, insertDocument } from './documents'

const workspaceRoutes = new Hono<AppEnv>()

// ---------------- Conflict-of-interest check ----------------
// Searches every party the firm has dealt with: clients (names, IDs), opposing parties and case titles.
workspaceRoutes.get('/conflicts', queryParams(z.object({
  name: z.string().trim().min(2).max(200),
  exclude_client_id: z.string().uuid().optional()
})), async (c) => {
  const { org } = auth(c)
  const { name, exclude_client_id } = c.req.valid('query')
  const { db } = c.get('deps')
  const pattern = likePattern(name)
  const [clients, opposing] = await Promise.all([
    db.query(
      `SELECT id, name, name_ar, id_number, archived_at FROM clients
        WHERE org_id = $1 AND (name ILIKE $2 OR name_ar ILIKE $2 OR id_number ILIKE $2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 20`,
      [org.id, pattern, exclude_client_id ?? null]),
    db.query(
      `SELECT k.id, k.reference, k.title, k.opposing_party, k.status, cl.name AS client_name FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id
        WHERE k.org_id = $1 AND (k.opposing_party ILIKE $2 OR k.title ILIKE $2 OR k.title_ar ILIKE $2) LIMIT 20`,
      [org.id, pattern])
  ])
  await audit(c, 'conflict.checked', 'conflict', undefined, { name, matches: clients.length + opposing.length })
  return c.json({ clients, cases: opposing, conflict: opposing.some((k) => k.opposing_party && k.opposing_party.toLowerCase().includes(name.toLowerCase())) })
})

// ---------------- Global search ----------------
workspaceRoutes.get('/search', queryParams(z.object({ q: z.string().trim().min(2).max(200) })), async (c) => {
  const { org } = auth(c)
  const { q } = c.req.valid('query')
  const { db } = c.get('deps')
  const p = likePattern(q)
  const [clients, cases, documents, tasks, library] = await Promise.all([
    db.query(`SELECT id, name, name_ar FROM clients WHERE org_id = $1 AND (name ILIKE $2 OR name_ar ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2 OR id_number ILIKE $2) ORDER BY name LIMIT 6`, [org.id, p]),
    db.query(`SELECT id, reference, title, status FROM cases WHERE org_id = $1 AND (title ILIKE $2 OR title_ar ILIKE $2 OR reference ILIKE $2 OR opposing_party ILIKE $2 OR court ILIKE $2) ORDER BY updated_at DESC LIMIT 6`, [org.id, p]),
    db.query(`SELECT id, title, doc_type FROM documents WHERE org_id = $1 AND (title ILIKE $2 OR file_name ILIKE $2 OR content ILIKE $2) ORDER BY updated_at DESC LIMIT 6`, [org.id, p]),
    db.query(`SELECT id, title, case_id, status FROM tasks WHERE org_id = $1 AND title ILIKE $2 ORDER BY (status = 'done'), due_date NULLS LAST LIMIT 6`, [org.id, p]),
    db.query(`SELECT id, title, jurisdiction, number, year FROM library_sources WHERE (org_id = $1 OR org_id IS NULL) AND (title ILIKE $2 OR number ILIKE $2) ORDER BY year DESC NULLS LAST LIMIT 6`, [org.id, p])
  ])
  return c.json({ clients, cases, documents, tasks, library })
})

// ---------------- Document templates with merge fields ----------------
export const MERGE_FIELDS = [
  'firm.name', 'firm.name_ar', 'firm.address', 'firm.phone', 'firm.email',
  'client.name', 'client.name_ar', 'client.id_number', 'client.email', 'client.phone', 'client.address',
  'case.reference', 'case.title', 'case.title_ar', 'case.court', 'case.opposing_party',
  'user.name', 'today'
] as const

export function mergeTemplate(content: string, values: Record<string, string | null | undefined>) {
  return content.replace(/\{\{\s*([a-z_]+\.[a-z_]+|today)\s*\}\}/g, (m, key: string) => {
    const v = values[key]
    return v === undefined ? m : v ?? ''
  })
}

const templateFields = {
  name: z.string().trim().min(2).max(200),
  doc_type: z.enum(DOC_TYPE_IDS),
  language: z.enum(['en', 'ar']),
  content: z.string().min(1).max(500_000)
}

workspaceRoutes.get('/templates', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT t.id, t.name, t.doc_type, t.language, t.updated_at, u.name AS created_by_name, length(t.content) AS size
       FROM document_templates t LEFT JOIN users u ON u.id = t.created_by WHERE t.org_id = $1 ORDER BY t.name`, [org.id])
  return c.json({ items, merge_fields: MERGE_FIELDS })
})

workspaceRoutes.get('/templates/:id', async (c) => {
  const { org } = auth(c)
  const t = await c.get('deps').db.one('SELECT * FROM document_templates WHERE id = $1 AND org_id = $2', [uuidParam(c.req.param('id'), 'Template'), org.id])
  if (!t) throw notFound('Template')
  return c.json({ template: t, merge_fields: MERGE_FIELDS })
})

workspaceRoutes.post('/templates', jsonBody(z.object({ ...templateFields, doc_type: templateFields.doc_type.default('other'), language: templateFields.language.default('en') })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const t = await c.get('deps').db.one(
    'INSERT INTO document_templates (org_id, name, doc_type, language, content, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [org.id, b.name, b.doc_type, b.language, b.content, user.id])
  await audit(c, 'template.created', 'template', t!.id)
  return c.json({ template: t }, 201)
})

workspaceRoutes.patch('/templates/:id', jsonBody(z.object(templateFields).partial()), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Template')
  const b = c.req.valid('json')
  const t = await c.get('deps').db.one(
    `UPDATE document_templates SET name = COALESCE($3, name), doc_type = COALESCE($4, doc_type), language = COALESCE($5, language),
            content = COALESCE($6, content), updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, org.id, b.name ?? null, b.doc_type ?? null, b.language ?? null, b.content ?? null])
  if (!t) throw notFound('Template')
  return c.json({ template: t })
})

workspaceRoutes.delete('/templates/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Template')
  const rows = await c.get('deps').db.query('DELETE FROM document_templates WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Template')
  await audit(c, 'template.deleted', 'template', id)
  return c.json({ ok: true })
})

workspaceRoutes.post('/templates/:id/generate', jsonBody(z.object({
  title: z.string().trim().max(300).nullish().transform((v) => v || undefined),
  case_id: optUuid,
  client_id: optUuid
})), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Template')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const t = await db.one('SELECT * FROM document_templates WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!t) throw notFound('Template')
  await assertCanCreateDocument(db, org)
  await assertDocRefs(db, org.id, b)
  const kase = b.case_id ? await db.one('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [b.case_id, org.id]) : null
  const clientId = b.client_id ?? kase?.client_id ?? null
  const client = clientId ? await db.one('SELECT * FROM clients WHERE id = $1 AND org_id = $2', [clientId, org.id]) : null
  if (b.client_id && !client) throw badRequest('Selected client does not exist.')
  const firm = await db.one('SELECT firm_name, firm_name_ar, address, phone, email FROM branding WHERE org_id = $1', [org.id])
  const today = new Intl.DateTimeFormat(t.language === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const content = mergeTemplate(t.content, {
    'firm.name': firm?.firm_name ?? org.name, 'firm.name_ar': firm?.firm_name_ar, 'firm.address': firm?.address, 'firm.phone': firm?.phone, 'firm.email': firm?.email,
    'client.name': client?.name, 'client.name_ar': client?.name_ar, 'client.id_number': client?.id_number, 'client.email': client?.email,
    'client.phone': client?.phone, 'client.address': client?.address,
    'case.reference': kase?.reference, 'case.title': kase?.title, 'case.title_ar': kase?.title_ar, 'case.court': kase?.court, 'case.opposing_party': kase?.opposing_party,
    'user.name': user.name, today
  })
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id, title: b.title || t.name, docType: t.doc_type, language: t.language, jurisdiction: kase?.jurisdiction ?? null,
    source: 'manual', content, caseId: b.case_id, clientId
  })
  await audit(c, 'template.generated', 'document', document.id, { template: id })
  return c.json({ document }, 201)
})

export default workspaceRoutes
