import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, optUuid, queryParams, uuidParam } from '../lib/http'
import { contentDisposition, renderSignedDocx, safeFileName } from '../services/export'
import {
  DEFAULT_EXPIRY_DAYS, issueSigningToken, logSignatureEvent, sendSigningInvitation, sha256, signingUrl
} from '../services/signatures'

const signaturesRoutes = new Hono<AppEnv>()

const email = z.string().trim().toLowerCase().email().max(254).nullish().or(z.literal('')).transform((v) => v || null)

async function firmName(c: Ctx, orgId: string, fallback: string) {
  const b = await c.get('deps').db.one('SELECT firm_name FROM branding WHERE org_id = $1', [orgId])
  return b?.firm_name || fallback
}

signaturesRoutes.get('/', queryParams(z.object({ document_id: z.string().uuid().optional(), status: z.enum(['pending', 'completed', 'declined', 'cancelled', 'all']).default('all') })), async (c) => {
  const { org } = auth(c)
  const { document_id, status } = c.req.valid('query')
  const params: unknown[] = [org.id]
  let where = 'r.org_id = $1'
  if (document_id) { params.push(document_id); where += ` AND r.document_id = $${params.length}` }
  if (status !== 'all') { params.push(status); where += ` AND r.status = $${params.length}` }
  const items = await c.get('deps').db.query(
    `SELECT r.id, r.title, r.status, r.document_id, r.case_id, r.client_id, r.expires_at, r.created_at, r.completed_at,
            (r.status = 'pending' AND r.expires_at < now()) AS expired, u.name AS created_by_name,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'email', s.email, 'status', s.status, 'signed_at', s.signed_at) ORDER BY s.position)
                        FROM signature_signers s WHERE s.request_id = r.id), '[]') AS signers
       FROM signature_requests r LEFT JOIN users u ON u.id = r.created_by
      WHERE ${where} ORDER BY r.created_at DESC LIMIT 300`, params)
  return c.json({ items })
})

signaturesRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Signature request')
  const { db } = c.get('deps')
  const request = await db.one(
    `SELECT id, title, message, language, status, document_id, case_id, client_id, content_hash, file_name, file_hash, expires_at, created_at, completed_at,
            (status = 'pending' AND expires_at < now()) AS expired
       FROM signature_requests WHERE id = $1 AND org_id = $2`, [id, org.id])
  if (!request) throw notFound('Signature request')
  const [signers, events] = await Promise.all([
    db.query('SELECT id, name, email, client_id, status, viewed_at, signed_at, declined_at, decline_reason, signed_name, ip FROM signature_signers WHERE request_id = $1 ORDER BY position', [id]),
    db.query(`SELECT e.event, e.detail, e.ip, e.created_at, s.name AS signer_name FROM signature_events e LEFT JOIN signature_signers s ON s.id = e.signer_id WHERE e.request_id = $1 ORDER BY e.id`, [id])
  ])
  return c.json({ request, signers, events })
})

// Sends a snapshot of a document for signature.
signaturesRoutes.post('/', jsonBody(z.object({
  document_id: z.string().uuid(),
  signers: z.array(z.object({ name: z.string().trim().min(2).max(200), email, client_id: optUuid })).min(1).max(10),
  message: z.string().trim().max(2000).nullish().transform((v) => v || null),
  expires_in_days: z.number().int().min(1).max(90).default(DEFAULT_EXPIRY_DAYS),
  send_email: z.boolean().default(true)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  const doc = await db.one('SELECT id, title, content, language, case_id, client_id, file_name, mime_type, file_data FROM documents WHERE id = $1 AND org_id = $2', [b.document_id, org.id])
  if (!doc) throw notFound('Document')
  if (!doc.content?.trim() && !doc.file_data) throw badRequest('The document is empty.')
  for (const s of b.signers) {
    if (s.client_id && !(await db.one('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [s.client_id, org.id]))) throw badRequest('Selected client does not exist.')
  }
  const fileData: Uint8Array | null = doc.file_data ?? null
  const expiresAt = new Date(Date.now() + b.expires_in_days * 86_400_000)
  const created = await db.tx(async (q) => {
    const r = await q.one(
      `INSERT INTO signature_requests (org_id, document_id, case_id, client_id, title, message, language, content, content_hash, file_name, file_mime, file_data, file_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [org.id, doc.id, doc.case_id, doc.client_id, doc.title, b.message, doc.language, doc.content ?? '', sha256(doc.content ?? ''),
       fileData ? doc.file_name : null, fileData ? doc.mime_type : null, fileData, fileData ? sha256(fileData) : null, expiresAt, user.id])
    await logSignatureEvent(q, r!.id, null, 'created', { detail: `by ${user.name}`, ip: null })
    const signers = []
    for (const [i, s] of b.signers.entries()) {
      const row = await q.one('INSERT INTO signature_signers (request_id, org_id, client_id, name, email, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [r!.id, org.id, s.client_id, s.name, s.email, i + 1])
      signers.push({ id: row!.id, name: s.name, email: s.email, token: await issueSigningToken(q, row!.id) })
    }
    return { id: r!.id as string, signers }
  })
  const firm = await firmName(c, org.id, org.name)
  const links = []
  for (const s of created.signers) {
    const url = signingUrl(config, s.token)
    const emailed = b.send_email && s.email
      ? await sendSigningInvitation({ mailer, config, log }, { to: s.email, signerName: s.name, firmName: firm, title: doc.title, message: b.message, url, expiresAt })
      : false
    if (emailed) await logSignatureEvent(db, created.id, s.id, 'sent', { detail: s.email })
    links.push({ signer_id: s.id, name: s.name, email: s.email, url, emailed })
  }
  await audit(c, 'signature.requested', 'signature_request', created.id, { document_id: doc.id, signers: b.signers.length })
  return c.json({ id: created.id, links }, 201)
})

// New personal links for signers who have not signed yet (earlier links keep working).
signaturesRoutes.post('/:id/remind', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Signature request')
  const { db, mailer, config, log } = c.get('deps')
  const r = await db.one('SELECT id, title, message, status, expires_at FROM signature_requests WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!r) throw notFound('Signature request')
  if (r.status !== 'pending') throw conflict('This request is no longer waiting for signatures.')
  if (new Date(r.expires_at).getTime() < Date.now()) throw conflict('This request has expired. Send a new one.')
  const pending = await db.query(`SELECT id, name, email FROM signature_signers WHERE request_id = $1 AND status IN ('pending', 'viewed') ORDER BY position`, [id])
  const firm = await firmName(c, org.id, org.name)
  const links = []
  for (const s of pending) {
    const url = signingUrl(config, await issueSigningToken(db, s.id))
    const emailed = s.email ? await sendSigningInvitation({ mailer, config, log }, { to: s.email, signerName: s.name, firmName: firm, title: r.title, message: r.message, url, expiresAt: new Date(r.expires_at), reminder: true }) : false
    await logSignatureEvent(db, id, s.id, 'reminded', { detail: emailed ? s.email : 'link' })
    links.push({ signer_id: s.id, name: s.name, email: s.email, url, emailed })
  }
  await audit(c, 'signature.reminded', 'signature_request', id)
  return c.json({ links })
})

signaturesRoutes.post('/:id/cancel', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Signature request')
  const { db } = c.get('deps')
  const rows = await db.query(`UPDATE signature_requests SET status = 'cancelled' WHERE id = $1 AND org_id = $2 AND status = 'pending' RETURNING id`, [id, org.id])
  if (!rows.length) throw conflict('Only requests waiting for signatures can be cancelled.')
  await logSignatureEvent(db, id, null, 'cancelled', { detail: `by ${user.name}` })
  await audit(c, 'signature.cancelled', 'signature_request', id)
  return c.json({ ok: true })
})

export async function signedCopy(c: Ctx, orgId: string, requestId: string) {
  const { db } = c.get('deps')
  const r = await db.one('SELECT * FROM signature_requests WHERE id = $1 AND org_id = $2', [requestId, orgId])
  if (!r) throw notFound('Signature request')
  const [signers, events, letterhead] = await Promise.all([
    db.query('SELECT name, email, status, signed_name, signed_at, ip, signature_image FROM signature_signers WHERE request_id = $1 ORDER BY position', [requestId]),
    db.query(`SELECT e.event, e.detail, e.ip, e.created_at, s.name AS signer_name FROM signature_events e LEFT JOIN signature_signers s ON s.id = e.signer_id WHERE e.request_id = $1 ORDER BY e.id`, [requestId]),
    db.one('SELECT firm_name, firm_name_ar, address, phone, email, website, footer_text, primary_color, logo, logo_mime FROM branding WHERE org_id = $1', [orgId])
  ])
  const buf = await renderSignedDocx({
    title: r.title, content: r.content || (r.file_name ? `(${r.file_name})` : ''), language: r.language, letterhead: letterhead ?? null,
    contentHash: r.content_hash, fileName: r.file_name, fileHash: r.file_hash, completedAt: r.completed_at, signers: signers as any, events: events as any
  })
  return { buf, name: safeFileName(`${r.title} – ${r.status === 'completed' ? 'signed' : r.status}`, 'docx') }
}

signaturesRoutes.get('/:id/signed-copy', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Signature request')
  const { buf, name } = await signedCopy(c, org.id, id)
  await audit(c, 'signature.downloaded', 'signature_request', id)
  c.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  c.header('content-disposition', contentDisposition(name))
  return c.body(new Uint8Array(buf))
})

export default signaturesRoutes
