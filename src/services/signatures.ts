import { createHash } from 'node:crypto'
import type { Config } from '../config'
import type { Queryable } from '../db'
import { hashToken, newToken } from '../lib/crypto'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// Electronic signatures: a snapshot of a document is sent to one or more signers,
// who open a private link, review it and sign by typing their name (optionally
// drawing a signature). Every step is recorded with time, IP and browser, and the
// document's SHA-256 fingerprint ties the signatures to the exact text signed.
// ---------------------------------------------------------------------------

export const DEFAULT_EXPIRY_DAYS = 14
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

export const signingUrl = (config: Config, token: string) => `${config.appUrl}/sign/${token}`

// Creates a new link for a signer. Earlier links keep working until the request ends.
export async function issueSigningToken(q: Queryable, signerId: string) {
  const token = newToken()
  await q.query('INSERT INTO signature_tokens (token_hash, signer_id) VALUES ($1, $2)', [hashToken(token), signerId])
  return token
}

export type SignerContext = {
  signer_id: string
  request_id: string
  org_id: string
  name: string
  email: string | null
  signer_status: 'pending' | 'viewed' | 'signed' | 'declined'
  signed_at: Date | null
  request_status: 'pending' | 'completed' | 'declined' | 'cancelled'
  expires_at: Date
  title: string
  message: string | null
  language: 'en' | 'ar'
  content: string
  content_hash: string
  file_name: string | null
  file_mime: string | null
  has_file: boolean
  file_hash: string | null
  created_at: Date
  completed_at: Date | null
  firm_name: string
  firm_name_ar: string | null
  primary_color: string | null
}

export async function signerByToken(db: Queryable, token: string): Promise<SignerContext | undefined> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return undefined
  const [row] = await db.query<SignerContext>(
    `SELECT s.id AS signer_id, r.id AS request_id, r.org_id, s.name, s.email, s.status AS signer_status, s.signed_at,
            r.status AS request_status, r.expires_at, r.title, r.message, r.language, r.content, r.content_hash,
            r.file_name, r.file_mime, (r.file_data IS NOT NULL) AS has_file, r.file_hash, r.created_at, r.completed_at,
            coalesce(nullif(b.firm_name, ''), o.name) AS firm_name, b.firm_name_ar, b.primary_color
       FROM signature_tokens t JOIN signature_signers s ON s.id = t.signer_id JOIN signature_requests r ON r.id = s.request_id
       JOIN organizations o ON o.id = r.org_id LEFT JOIN branding b ON b.org_id = r.org_id
      WHERE t.token_hash = $1`, [hashToken(token)])
  return row
}

export const isExpired = (r: { expires_at: Date | string; request_status: string }) =>
  r.request_status === 'pending' && new Date(r.expires_at).getTime() < Date.now()

export async function logSignatureEvent(q: Queryable, requestId: string, signerId: string | null, event: string, meta: { detail?: string | null; ip?: string | null; userAgent?: string | null } = {}) {
  await q.query('INSERT INTO signature_events (request_id, signer_id, event, detail, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
    [requestId, signerId, event, meta.detail ?? null, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null])
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_SIGNATURE_BYTES = 200 * 1024

// Accepts a drawn signature as a PNG data URL; anything else is ignored.
export function parseSignatureImage(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 100 || bytes.length > MAX_SIGNATURE_BYTES) return null
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return null
  return bytes
}

// Marks the request completed once every signer has signed. Returns true when it just completed.
export async function completeIfAllSigned(q: Queryable, requestId: string): Promise<boolean> {
  const [{ remaining }] = await q.query(`SELECT count(*)::int AS remaining FROM signature_signers WHERE request_id = $1 AND status <> 'signed'`, [requestId])
  if (remaining > 0) return false
  const done = await q.query(`UPDATE signature_requests SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [requestId])
  if (done.length) await logSignatureEvent(q, requestId, null, 'completed')
  return done.length > 0
}

export async function sendSigningInvitation(deps: { mailer: Mailer; config: Config; log: Logger }, opts: {
  to: string; signerName: string; firmName: string; title: string; message: string | null; url: string; expiresAt: Date; reminder?: boolean
}) {
  if (!deps.mailer.configured) return false
  const date = opts.expiresAt.toISOString().slice(0, 10)
  const text = [
    `Dear ${opts.signerName},`, '',
    `${opts.firmName} ${opts.reminder ? 'reminds you that a document is waiting for your signature' : 'has sent you a document to sign electronically'}: "${opts.title}".`,
    opts.message ? `\nMessage from ${opts.firmName}:\n${opts.message}\n` : '',
    `Review and sign it here (the link is personal; do not forward it):`, opts.url, '',
    `The link is valid until ${date}.`, '',
    '—', '',
    `${opts.firmName} ${opts.reminder ? 'يذكّرك بأن مستندًا بانتظار توقيعك' : 'أرسل إليك مستندًا لتوقيعه إلكترونيًا'}: «${opts.title}».`,
    `للمراجعة والتوقيع افتح الرابط أعلاه (الرابط شخصي، يُرجى عدم مشاركته). صالح حتى ${date}.`
  ].filter((l) => l !== '').join('\n')
  try {
    await deps.mailer.send({ to: opts.to, subject: `${opts.reminder ? 'Reminder: ' : ''}Please sign "${opts.title.slice(0, 80)}" – ${opts.firmName}`, text })
    return true
  } catch (err) {
    deps.log.warn('signature invitation email failed', { err })
    return false
  }
}
