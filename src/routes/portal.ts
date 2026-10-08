import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv, type Ctx } from '../context'
import type { Queryable } from '../db'
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors'
import { jsonBody, optUuid, uuidParam } from '../lib/http'
import { ACCEPTED_TYPES, cleanText, detectKind, extractText } from '../services/extract'
import { contentDisposition, renderDocx, safeFileName } from '../services/export'
import { insertDocument } from './documents'
import { invoiceDocxResponse } from './billing'
import { issueSigningToken, signingUrl } from '../services/signatures'

// Everything here is scoped to the signed-in portal user's own client record.
function portalUser(c: Ctx) {
  const { user, org } = auth(c)
  if (user.role !== 'client' || !user.client_id) throw forbidden()
  return { user, org, clientId: user.client_id }
}

async function assertClientCase(db: Queryable, orgId: string, clientId: string, caseId: string) {
  const rows = await db.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [caseId, orgId, clientId])
  if (!rows.length) throw notFound('Case')
}

// Notifies the firm (responsible lawyers, or owners/admins) when a client acts in the portal.
export async function notifyFirm(c: Ctx, orgId: string, clientId: string, caseId: string | null, subject: string, text: string) {
  const { db, mailer, config, log } = c.get('deps')
  if (!mailer.configured) return
  const recipients = await db.query(
    `SELECT DISTINCT u.email FROM users u
      WHERE u.org_id = $1 AND u.deactivated_at IS NULL AND u.role <> 'client' AND u.notify_email AND (
        u.id IN (SELECT assigned_to FROM cases WHERE org_id = $1 AND client_id = $2 AND ($3::uuid IS NULL OR id = $3) AND assigned_to IS NOT NULL)
        OR u.role IN ('owner', 'admin'))`, [orgId, clientId, caseId])
  for (const r of recipients.slice(0, 10)) {
    await mailer.send({ to: r.email, subject, text: `${text}\n\n${config.appUrl}/app#/clients/${clientId}` }).catch((err) => log.warn('portal notification failed', { err }))
  }
}

const portalRoutes = new Hono<AppEnv>()

portalRoutes.get('/overview', async (c) => {
  const { org, clientId } = portalUser(c)
  const { db } = c.get('deps')
  const [client, cases, documents, invoices, unread] = await Promise.all([
    db.one('SELECT id, name, name_ar, email, phone FROM clients WHERE id = $1 AND org_id = $2', [clientId, org.id]),
    db.query(
      `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.jurisdiction, k.court, k.updated_at, u.name AS lawyer_name, u.email AS lawyer_email,
              (SELECT min(e.starts_at) FROM events e WHERE e.case_id = k.id AND e.kind = 'hearing' AND e.starts_at >= now()) AS next_hearing
         FROM cases k LEFT JOIN users u ON u.id = k.assigned_to
        WHERE k.org_id = $1 AND k.client_id = $2 ORDER BY (k.status = 'closed'), k.updated_at DESC`, [org.id, clientId]),
    db.query(
      `SELECT d.id, d.title, d.case_id, d.file_name, d.uploaded_by_client, d.updated_at FROM documents d
        WHERE d.org_id = $1 AND d.client_id = $2 AND (d.shared_with_client OR d.uploaded_by_client) ORDER BY d.updated_at DESC LIMIT 200`, [org.id, clientId]),
    db.query(
      `SELECT id, number, status, issue_date, due_date, currency, total, amount_paid, (status = 'issued' AND due_date < CURRENT_DATE) AS overdue
         FROM invoices WHERE org_id = $1 AND client_id = $2 AND status IN ('issued', 'paid') ORDER BY issue_date DESC`, [org.id, clientId]),
    db.query('SELECT count(*)::int AS n FROM client_messages WHERE org_id = $1 AND client_id = $2 AND NOT from_client AND read_at IS NULL', [org.id, clientId])
  ])
  if (!client) throw notFound('Client')
  const firm = await db.one('SELECT firm_name, firm_name_ar, phone, email, (logo IS NOT NULL) AS has_logo FROM branding WHERE org_id = $1', [org.id])
  return c.json({ client, cases, documents, invoices, unread_messages: unread[0].n, firm })
})

portalRoutes.get('/cases/:id', async (c) => {
  const { org, clientId } = portalUser(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  const kase = await db.one(
    `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.jurisdiction, k.court, k.opposing_party, k.opened_on, k.closed_on, k.updated_at,
            u.name AS lawyer_name, u.email AS lawyer_email
       FROM cases k LEFT JOIN users u ON u.id = k.assigned_to WHERE k.id = $1 AND k.org_id = $2 AND k.client_id = $3`, [id, org.id, clientId])
  if (!kase) throw notFound('Case')
  const [events, documents] = await Promise.all([
    db.query(`SELECT id, title, kind, starts_at, all_day, location FROM events WHERE case_id = $1 AND kind IN ('hearing', 'meeting') AND starts_at >= now() - interval '30 days' ORDER BY starts_at`, [id]),
    db.query(`SELECT id, title, file_name, uploaded_by_client, updated_at FROM documents WHERE case_id = $1 AND org_id = $2 AND (shared_with_client OR uploaded_by_client) ORDER BY updated_at DESC`, [id, org.id])
  ])
  return c.json({ case: kase, events, documents })
})

async function portalDocument(c: Ctx, id: string) {
  const { org, clientId } = portalUser(c)
  const doc = await c.get('deps').db.one(
    `SELECT id, title, content, language, file_name, mime_type, file_data FROM documents
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND (shared_with_client OR uploaded_by_client)`, [id, org.id, clientId])
  if (!doc) throw notFound('Document')
  return doc
}

portalRoutes.get('/documents/:id/download', async (c) => {
  const doc = await portalDocument(c, uuidParam(c.req.param('id'), 'Document'))
  await audit(c, 'portal.document_downloaded', 'document', doc.id)
  if (doc.file_data) {
    return new Response(Buffer.from(doc.file_data), {
      headers: { 'content-type': doc.mime_type, 'content-disposition': contentDisposition(doc.file_name), 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }
    })
  }
  const [lh] = await c.get('deps').db.query('SELECT * FROM branding WHERE org_id = $1', [auth(c).org.id])
  const buf = await renderDocx({ title: doc.title, content: doc.content, language: doc.language, letterhead: lh ?? null })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(doc.title, 'docx')), 'cache-control': 'private, no-store' }
  })
})

portalRoutes.post('/documents', async (c) => {
  const { user, org, clientId } = portalUser(c)
  const { db, config } = c.get('deps')
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a multipart form upload.') })
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw badRequest('Choose a file to upload.')
  if (file.size > config.maxUploadBytes) throw new HttpError(413, 'file_too_large', 'This file is too large.')
  const caseId = typeof form.get('case_id') === 'string' && form.get('case_id') ? String(form.get('case_id')) : null
  if (caseId) await assertClientCase(db, org.id, clientId, uuidParam(caseId, 'Case'))
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = detectKind(bytes, file.name)
  if (!kind) throw new HttpError(415, 'unsupported_file', 'Upload a PDF, Word (.docx) or plain-text file.')
  const text = cleanText(await extractText(bytes, kind))
  const title = (typeof form.get('title') === 'string' && String(form.get('title')).trim()) || file.name.replace(/\.[^.]+$/, '')
  const document = await insertDocument(db, {
    orgId: org.id, userId: user.id, title: title.slice(0, 300), docType: 'correspondence', language: 'en', jurisdiction: null,
    source: 'upload', content: text.slice(0, 2_000_000), caseId, clientId, uploadedByClient: true,
    file: { name: file.name.slice(0, 255), mime: ACCEPTED_TYPES[kind], bytes }
  })
  await audit(c, 'portal.document_uploaded', 'document', document.id)
  await notifyFirm(c, org.id, clientId, caseId, `New document from client: ${title}`, `${user.name} uploaded "${title}" in the client portal.`)
  return c.json({ document: { id: document.id, title: document.title } }, 201)
})

portalRoutes.get('/invoices/:id/download', async (c) => {
  const { org, clientId, user } = portalUser(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const ok = await c.get('deps').db.query(`SELECT 1 FROM invoices WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status IN ('issued', 'paid')`, [id, org.id, clientId])
  if (!ok.length) throw notFound('Invoice')
  await audit(c, 'portal.invoice_downloaded', 'invoice', id)
  return invoiceDocxResponse(c.get('deps').db, org.id, id, user.locale)
})

portalRoutes.get('/messages', async (c) => {
  const { org, clientId } = portalUser(c)
  const { db } = c.get('deps')
  const items = await db.query(
    `SELECT m.id, m.body, m.from_client, m.case_id, k.reference AS case_reference, m.created_at, u.name AS sender_name
       FROM client_messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN cases k ON k.id = m.case_id
      WHERE m.org_id = $1 AND m.client_id = $2 ORDER BY m.created_at DESC LIMIT 200`, [org.id, clientId])
  await db.query('UPDATE client_messages SET read_at = now() WHERE org_id = $1 AND client_id = $2 AND NOT from_client AND read_at IS NULL', [org.id, clientId])
  return c.json({ items: items.reverse() })
})

portalRoutes.post('/messages', jsonBody(z.object({ body: z.string().trim().min(1).max(10_000), case_id: optUuid })), async (c) => {
  const { user, org, clientId } = portalUser(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  if (b.case_id) await assertClientCase(db, org.id, clientId, b.case_id)
  const msg = await db.one(
    'INSERT INTO client_messages (org_id, client_id, case_id, sender_id, from_client, body) VALUES ($1, $2, $3, $4, true, $5) RETURNING id, created_at',
    [org.id, clientId, b.case_id, user.id, b.body])
  await notifyFirm(c, org.id, clientId, b.case_id, `New message from ${user.name}`, `${user.name} wrote in the client portal:\n\n${b.body.slice(0, 2000)}`)
  return c.json({ message: msg }, 201)
})

// Documents the client has been asked to sign.
portalRoutes.get('/signatures', async (c) => {
  const { org, clientId, user } = portalUser(c)
  const items = await c.get('deps').db.query(
    `SELECT s.id, s.status AS signer_status, s.signed_at, r.id AS request_id, r.title, r.status, r.expires_at, r.created_at,
            (r.status = 'pending' AND r.expires_at < now()) AS expired
       FROM signature_signers s JOIN signature_requests r ON r.id = s.request_id
      WHERE s.org_id = $1 AND (s.client_id = $2 OR lower(s.email) = lower($3)) AND r.status <> 'cancelled'
      ORDER BY (s.status IN ('pending', 'viewed') AND r.status = 'pending') DESC, r.created_at DESC LIMIT 50`, [org.id, clientId, user.email])
  return c.json({ items })
})

// A fresh personal signing link for one of the client's own signature requests.
portalRoutes.post('/signatures/:id/open', async (c) => {
  const { org, clientId, user } = portalUser(c)
  const id = uuidParam(c.req.param('id'), 'Signature')
  const { db, config } = c.get('deps')
  const row = await db.one(
    `SELECT s.id FROM signature_signers s JOIN signature_requests r ON r.id = s.request_id
      WHERE s.id = $1 AND s.org_id = $2 AND (s.client_id = $3 OR lower(s.email) = lower($4)) AND r.status <> 'cancelled'`, [id, org.id, clientId, user.email])
  if (!row) throw notFound('Signature')
  return c.json({ url: signingUrl(config, await issueSigningToken(db, id)) })
})

export default portalRoutes
