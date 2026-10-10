import type { Config } from '../config'
import type { Queryable } from '../db'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// Document requests: the firm asks a client for a checklist of documents, the
// client uploads each one in the portal and the firm accepts or returns it.
// ---------------------------------------------------------------------------

export async function loadDocumentRequest(q: Queryable, orgId: string, id: string, clientId?: string) {
  const [request] = await q.query(
    `SELECT r.*, cl.name AS client_name, k.reference AS case_reference, k.title AS case_title, u.name AS created_by_name
       FROM document_requests r JOIN clients cl ON cl.id = r.client_id LEFT JOIN cases k ON k.id = r.case_id LEFT JOIN users u ON u.id = r.created_by
      WHERE r.id = $1 AND r.org_id = $2 AND ($3::uuid IS NULL OR r.client_id = $3)`, [id, orgId, clientId ?? null])
  if (!request) return null
  const items = await q.query(
    `SELECT i.id, i.label, i.note, i.status, i.document_id, i.uploaded_at, i.reviewed_at, i.reject_reason, d.title AS document_title, d.file_name
       FROM document_request_items i LEFT JOIN documents d ON d.id = i.document_id
      WHERE i.request_id = $1 ORDER BY i.position`, [id])
  return { request, items }
}

// Marks the request completed once every item is accepted.
export async function refreshRequestStatus(q: Queryable, requestId: string) {
  await q.query(
    `UPDATE document_requests r SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE r.id = $1 AND r.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM document_request_items i WHERE i.request_id = r.id AND i.status <> 'accepted')`, [requestId])
}

// Emails the client's active portal users. Returns how many were emailed.
export async function emailClientPortalUsers(
  deps: { db: Queryable; mailer: Mailer; config: Config; log: Logger },
  orgId: string, clientId: string, subject: string, lines: string[]
) {
  const users = await deps.db.query(
    `SELECT email, name FROM users WHERE org_id = $1 AND client_id = $2 AND role = 'client' AND deactivated_at IS NULL AND notify_email`, [orgId, clientId])
  if (!deps.mailer.configured) return 0
  let sent = 0
  for (const u of users.slice(0, 10)) {
    const text = [`Dear ${u.name},`, '', ...lines, '', `${deps.config.appUrl}/app#/portal`].join('\n')
    await deps.mailer.send({ to: u.email, subject, text }).then(() => sent++).catch((err) => deps.log.warn('document request email failed', { err }))
  }
  return sent
}

export const requestEmailLines = (firm: string, title: string, labels: string[], o: { message?: string | null; due?: string | null; reminder?: boolean }) => [
  `${firm} ${o.reminder ? 'reminds you that it is still waiting for' : 'has asked you for'} the following documents ("${title}"):`,
  ...labels.map((l) => `  • ${l}`),
  ...(o.due ? ['', `Please upload them by ${o.due}.`] : []),
  ...(o.message ? ['', `Message from ${firm}:`, o.message] : []),
  '', 'Sign in to your client portal to upload them securely.',
  '', '—', '',
  `${firm} ${o.reminder ? 'يذكّرك بأنه لا يزال بانتظار' : 'يطلب منك'} المستندات التالية («${title}»):`,
  ...labels.map((l) => `  • ${l}`),
  ...(o.due ? [`يُرجى رفعها قبل ${o.due}.`] : []),
  'سجّل الدخول إلى بوابة العملاء لرفعها بأمان.'
]

// Uploads for a requested document may also be photos (ID cards, passports).
export function detectImage(bytes: Uint8Array): { ext: 'png' | 'jpg'; mime: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', mime: 'image/png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  return null
}
