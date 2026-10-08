import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { SignedCopy } from './export'

// ---------------------------------------------------------------------------
// Signed PDF for documents whose original is a PDF: the original pages, a small
// "signed electronically" footer on each, then a signature page with every
// signer's signature stamp and the audit trail. The stamps are images made in
// the signer's browser, so Arabic names show correctly; the remaining text uses
// Latin characters only because the built-in PDF fonts cannot shape Arabic.
// ---------------------------------------------------------------------------

const latin = (s: string | null | undefined) => String(s ?? '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()
const utc = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-')

export async function renderSignedPdf(original: Uint8Array, d: SignedCopy & { reference: string }): Promise<Uint8Array | null> {
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(original, { updateMetadata: false })
  } catch {
    return null // encrypted or damaged: the caller falls back to the Word copy
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const grey = rgb(0.35, 0.4, 0.47)
  const footer = `Signed electronically via TrustiqLegal - Ref ${d.reference} - SHA-256 ${d.fileHash?.slice(0, 16) ?? d.contentHash.slice(0, 16)}`

  const total = pdf.getPageCount()
  pdf.getPages().forEach((page, i) => {
    const { width } = page.getSize()
    page.drawText(`${footer} - page ${i + 1}/${total + 1}`, { x: 24, y: 12, size: 7, font, color: grey, maxWidth: width - 48 })
  })

  // Signature page (A4).
  const W = 595.28, H = 841.89, M = 48
  let page = pdf.addPage([W, H])
  let y = H - M
  const newPageIfNeeded = (space: number) => {
    if (y - space > M + 20) return
    page = pdf.addPage([W, H])
    y = H - M
  }
  const text = (s: string, o: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 10
    newPageIfNeeded(size + 6)
    page.drawText(latin(s), { x: M, y, size, font: o.f ?? font, color: o.color ?? rgb(0.1, 0.12, 0.16), maxWidth: W - 2 * M })
    y -= size + (o.gap ?? 6)
  }

  text('Signature page', { size: 18, f: bold, gap: 4 })
  text(latin(d.title) || 'Document', { size: 11, color: grey, gap: 18 })

  for (const s of d.signers) {
    newPageIfNeeded(150)
    if (s.signature_image) {
      try {
        const img = await pdf.embedPng(s.signature_image)
        const scale = Math.min(240 / img.width, 90 / img.height)
        page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale })
        y -= img.height * scale + 8
      } catch { /* not a usable PNG: details below still identify the signer */ }
    }
    const name = latin(s.signed_name) || latin(s.name)
    if (name) text(name, { f: bold })
    if (s.email) text(latin(s.email))
    text(`Signed: ${utc(s.signed_at)}   IP: ${latin(s.ip) || '-'}   Status: ${s.status}`, { size: 9, color: grey, gap: 16 })
  }

  newPageIfNeeded(80)
  text('Document fingerprint (SHA-256)', { f: bold, size: 9, gap: 3 })
  text(d.fileHash ?? d.contentHash, { size: 8, color: grey })
  text(`Completed: ${utc(d.completedAt)}   Reference: ${d.reference}`, { size: 9, color: grey, gap: 10 })
  text('Each signer opened a personal link, reviewed this document and confirmed their signature. The fingerprint identifies the exact file that was signed.', { size: 8, color: grey, gap: 16 })

  text('Audit trail', { f: bold, size: 12, gap: 8 })
  for (const e of d.events) {
    text(`${utc(e.created_at)}  ${e.event}${e.signer_name && latin(e.signer_name) ? ` - ${latin(e.signer_name)}` : ''}${e.ip ? `  (${latin(e.ip)})` : ''}`, { size: 8, color: grey, gap: 4 })
  }

  pdf.setTitle(`${latin(d.title) || 'Document'} (signed)`)
  pdf.setProducer('TrustiqLegal')
  return pdf.save()
}
