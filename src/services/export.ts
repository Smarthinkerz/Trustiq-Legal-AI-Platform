import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, TextRun } from 'docx'

export type Letterhead = {
  firm_name?: string | null
  firm_name_ar?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  footer_text?: string | null
  primary_color?: string | null
  logo?: Uint8Array | null
  logo_mime?: string | null
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s)

// A line is treated as a heading if it is short and numbered ("1. DEFINITIONS") or fully upper-case.
const isHeading = (line: string) =>
  line.length < 90 && (/^(\d+(\.\d+)*[.)]?|article|clause|المادة|البند)\s/i.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line)))

export async function renderDocx(opts: { title: string; content: string; language: 'en' | 'ar'; letterhead?: Letterhead | null }): Promise<Buffer> {
  const rtl = opts.language === 'ar'
  const font = rtl ? 'Arial' : 'Calibri'
  const color = (opts.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const lh = opts.letterhead

  const headerChildren: Paragraph[] = []
  if (lh) {
    const logoType = lh.logo_mime === 'image/png' ? 'png' : lh.logo_mime === 'image/jpeg' ? 'jpg' : null
    if (lh.logo && logoType) {
      headerChildren.push(new Paragraph({
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new ImageRun({ type: logoType, data: Buffer.from(lh.logo), transformation: { width: 140, height: 50 } })]
      }))
    }
    const name = rtl ? (lh.firm_name_ar || lh.firm_name) : (lh.firm_name || lh.firm_name_ar)
    if (name) {
      headerChildren.push(new Paragraph({
        bidirectional: rtl,
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: name, bold: true, size: 26, color, font, rightToLeft: rtl })]
      }))
    }
    const contact = [lh.address, lh.phone, lh.email, lh.website].filter(Boolean).join('  |  ')
    if (contact) {
      headerChildren.push(new Paragraph({
        bidirectional: rtl,
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 4 } },
        children: [new TextRun({ text: contact, size: 16, color: '555555', font, rightToLeft: rtl })]
      }))
    }
  }

  const footerText = lh?.footer_text ?? ''
  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        ...(footerText ? [new TextRun({ text: `${footerText}   `, size: 14, color: '777777', font })] : []),
        new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 14, color: '777777', font })
      ]
    })]
  })

  const body: Paragraph[] = [
    new Paragraph({
      bidirectional: rtl,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: opts.title, bold: true, size: 32, font, rightToLeft: rtl || hasArabic(opts.title) })]
    })
  ]
  for (const raw of opts.content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const lineRtl = rtl || hasArabic(line)
    body.push(new Paragraph({
      bidirectional: lineRtl,
      alignment: lineRtl ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
      spacing: { after: line ? 120 : 60, line: 300 },
      children: [new TextRun({ text: line, bold: !!line && isHeading(line.trim()), size: 22, font, rightToLeft: lineRtl })]
    }))
  }

  const doc = new Document({
    creator: lh?.firm_name ?? 'TrustiqLegal',
    title: opts.title,
    sections: [{
      properties: { page: { margin: { top: 1300, bottom: 1100, left: 1200, right: 1200 } } },
      headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
      footers: { default: footer },
      children: body
    }]
  })
  return Packer.toBuffer(doc)
}

export function safeFileName(name: string, ext: string) {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document'
  return `${base}.${ext}`
}

// RFC 5987 Content-Disposition value that supports Arabic file names.
export function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
