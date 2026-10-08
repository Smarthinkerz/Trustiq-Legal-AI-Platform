import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { clientIp, type AppEnv, type Ctx, type Deps } from '../context'
import { tooMany } from '../lib/errors'
import { RateLimiter } from '../lib/rate-limit'
import { signPage, type SignState } from '../pages/sign-page'
import { contentDisposition } from '../services/export'
import { completeIfAllSigned, isExpired, logSignatureEvent, parseSignatureImage, signerByToken, type SignerContext } from '../services/signatures'
import { signedCopy, storeSignedDocument } from './signatures'

// ---------------------------------------------------------------------------
// Public signing pages at /sign/:token. The token is the signer's credential.
// ---------------------------------------------------------------------------

export function signRoutes(deps: Deps, assetVersion: string) {
  const { db, config, mailer, log } = deps
  const app = new Hono<AppEnv>()
  const views = new RateLimiter(120, 10 * 60_000)
  const posts = new RateLimiter(20, 10 * 60_000)

  app.use('*', async (c, next) => {
    const r = (c.req.method === 'POST' ? posts : views).take(clientIp(c))
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      throw tooMany()
    }
    await next()
    c.header('cache-control', 'no-store')
    c.header('x-robots-tag', 'noindex, nofollow')
  })

  const langOf = (c: Ctx, s?: SignerContext): 'en' | 'ar' => {
    const q = c.req.query('lang')
    return q === 'ar' || q === 'en' ? q : s?.language ?? 'en'
  }

  const stateOf = (s: SignerContext): SignState => {
    if (s.request_status === 'completed') return 'completed'
    if (s.request_status === 'cancelled') return 'cancelled'
    if (s.signer_status === 'declined') return 'declined'
    if (s.signer_status === 'signed') return 'signed'
    if (s.request_status === 'declined') return 'cancelled'
    if (isExpired(s)) return 'expired'
    return 'sign'
  }

  const render = (c: Ctx, token: string, s: SignerContext | undefined, lang: 'en' | 'ar', extra: { error?: boolean } = {}) => {
    if (!s) return c.html(signPage({ state: 'invalid', lang, assetVersion }), 404)
    const name = (lang === 'ar' ? s.firm_name_ar || s.firm_name : s.firm_name)
    return c.html(signPage({
      state: stateOf(s), lang, assetVersion, token, firmName: name, color: s.primary_color, title: s.title, signerName: s.name,
      message: s.message, content: s.content, contentLanguage: s.language, contentHash: s.content_hash, fileName: s.has_file ? s.file_name : null, ...extra
    }), extra.error ? 400 : 200)
  }

  const notifyFirm = async (s: SignerContext, subject: string, text: string) => {
    if (!mailer.configured) return
    const to = await db.query(
      `SELECT DISTINCT u.email FROM users u WHERE u.org_id = $1 AND u.deactivated_at IS NULL AND u.notify_email
          AND (u.id = (SELECT created_by FROM signature_requests WHERE id = $2) OR u.role = 'owner')`, [s.org_id, s.request_id])
    for (const r of to.slice(0, 5)) {
      await mailer.send({ to: r.email, subject, text: `${text}\n\n${config.appUrl}/app#/signatures` }).catch((err) => log.warn('signature notification failed', { err }))
    }
  }

  app.get('/:token', async (c) => {
    const token = c.req.param('token')
    const s = await signerByToken(db, token)
    if (s && stateOf(s) === 'sign' && s.signer_status === 'pending') {
      await db.query(`UPDATE signature_signers SET status = 'viewed', viewed_at = now() WHERE id = $1 AND status = 'pending'`, [s.signer_id])
      await logSignatureEvent(db, s.request_id, s.signer_id, 'viewed', { ip: clientIp(c), userAgent: c.req.header('user-agent') })
    }
    return render(c, token, s, langOf(c, s))
  })

  app.get('/:token/file', async (c) => {
    const s = await signerByToken(db, c.req.param('token'))
    if (!s?.has_file || s.request_status === 'cancelled') return c.body(null, 404)
    const row = await db.one('SELECT file_data, file_mime, file_name FROM signature_requests WHERE id = $1', [s.request_id])
    // Shown inline only for PDFs; everything else downloads.
    const pdf = row!.file_mime === 'application/pdf'
    c.header('content-type', pdf ? 'application/pdf' : 'application/octet-stream')
    c.header('content-disposition', pdf ? `inline; filename*=UTF-8''${encodeURIComponent(row!.file_name ?? 'document.pdf')}` : contentDisposition(row!.file_name ?? 'document'))
    c.header('x-content-type-options', 'nosniff')
    return c.body(new Uint8Array(row!.file_data))
  })

  app.get('/:token/signed-copy', async (c) => {
    const s = await signerByToken(db, c.req.param('token'))
    if (!s || s.request_status !== 'completed') return c.body(null, 404)
    const fmt = c.req.query('format')
    const { buf, name, mime } = await signedCopy(db, s.org_id, s.request_id, fmt === 'docx' || fmt === 'pdf' ? fmt : undefined)
    await logSignatureEvent(db, s.request_id, s.signer_id, 'downloaded', { ip: clientIp(c) })
    c.header('content-type', mime)
    c.header('content-disposition', contentDisposition(name))
    return c.body(new Uint8Array(buf))
  })

  app.post('/:token', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
    const token = c.req.param('token')
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(config.appUrl).origin && origin !== new URL(c.req.url).origin) return c.text('Cross-origin request blocked.', 403)
    const s = await signerByToken(db, token)
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    const lang: 'en' | 'ar' = form.lang === 'ar' ? 'ar' : form.lang === 'en' ? 'en' : s?.language ?? 'en'
    if (!s || stateOf(s) !== 'sign') return render(c, token, s, lang)
    const ip = clientIp(c)
    const userAgent = c.req.header('user-agent') ?? null
    const back = () => c.redirect(`/sign/${token}${lang !== s.language ? `?lang=${lang}` : ''}`, 303)

    if (form.action === 'decline') {
      const reason = typeof form.reason === 'string' ? form.reason.trim().slice(0, 1000) || null : null
      await db.tx(async (q) => {
        await q.query(`UPDATE signature_signers SET status = 'declined', declined_at = now(), decline_reason = $2, ip = $3, user_agent = $4 WHERE id = $1`, [s.signer_id, reason, ip, userAgent?.slice(0, 300)])
        await q.query(`UPDATE signature_requests SET status = 'declined' WHERE id = $1 AND status = 'pending'`, [s.request_id])
        await logSignatureEvent(q, s.request_id, s.signer_id, 'declined', { detail: reason, ip, userAgent })
      })
      await notifyFirm(s, `Signature declined: ${s.title.slice(0, 80)}`, `${s.name} declined to sign "${s.title}".${reason ? `\nReason: ${reason}` : ''}`)
      return back()
    }

    const signedName = typeof form.signed_name === 'string' ? form.signed_name.trim().slice(0, 200) : ''
    if (signedName.length < 2 || form.consent !== 'on') return render(c, token, s, lang, { error: true })
    const image = parseSignatureImage(form.signature)
    let completed = false
    await db.tx(async (q) => {
      const rows = await q.query(
        `UPDATE signature_signers SET status = 'signed', signed_at = now(), signed_name = $2, signature_image = $3, ip = $4, user_agent = $5
          WHERE id = $1 AND status IN ('pending', 'viewed') RETURNING id`, [s.signer_id, signedName, image, ip, userAgent?.slice(0, 300)])
      if (!rows.length) return
      await logSignatureEvent(q, s.request_id, s.signer_id, 'signed', { detail: `as "${signedName}"${image ? ' with drawn signature' : ''}; consent given`, ip, userAgent })
      completed = await completeIfAllSigned(q, s.request_id)
    })
    if (completed) await storeSignedDocument(db, s.org_id, s.request_id, log)
    await notifyFirm(s, completed ? `Signed by everyone: ${s.title.slice(0, 80)}` : `Signed by ${s.name}: ${s.title.slice(0, 80)}`,
      completed ? `"${s.title}" has been signed by all signers. The signed copy is saved in Documents.` : `${s.name} signed "${s.title}".`)
    return back()
  })

  return app
}
