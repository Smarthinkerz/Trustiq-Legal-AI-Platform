import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { decimalsFor } from './billing'

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


function letterheadParagraphs(lh: Letterhead | null | undefined, rtl: boolean, font: string, color: string): Paragraph[] {
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

  return headerChildren
}

export async function renderDocx(opts: { title: string; content: string; language: 'en' | 'ar'; letterhead?: Letterhead | null }): Promise<Buffer> {
  const rtl = opts.language === 'ar'
  const font = rtl ? 'Arial' : 'Calibri'
  const color = (opts.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const lh = opts.letterhead

  const headerChildren = letterheadParagraphs(lh, rtl, font, color)

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

// ---------------------------------------------------------------------------
// Tax invoice (bilingual labels, as expected by GCC VAT rules).
// ---------------------------------------------------------------------------

type InvoiceData = {
  invoice: Record<string, any>
  lines: Record<string, any>[]
  letterhead: Letterhead | null
  billing: { vat_number?: string | null; bank_details?: string | null; invoice_footer?: string | null }
  language: 'en' | 'ar'
}

const L = {
  tax_invoice: ['Tax Invoice', 'فاتورة ضريبية'], draft: ['Draft invoice', 'مسودة فاتورة'], number: ['Invoice no.', 'رقم الفاتورة'],
  issued: ['Issue date', 'تاريخ الإصدار'], due: ['Due date', 'تاريخ الاستحقاق'], bill_to: ['Bill to', 'إلى'],
  matter: ['Matter', 'القضية'], vat_no: ['VAT registration no.', 'الرقم الضريبي'], description: ['Description', 'البيان'],
  qty: ['Qty / hours', 'الكمية / الساعات'], price: ['Rate', 'السعر'], amount: ['Amount', 'المبلغ'],
  subtotal: ['Subtotal', 'المجموع الفرعي'], vat: ['VAT', 'ضريبة القيمة المضافة'], total: ['Total', 'الإجمالي'],
  paid: ['Paid', 'المدفوع'], balance: ['Balance due', 'الرصيد المستحق'], bank: ['Payment details', 'بيانات الدفع'], notes: ['Notes', 'ملاحظات'],
  status_void: ['VOID', 'ملغاة']
} as const

export async function renderInvoiceDocx(d: InvoiceData): Promise<Buffer> {
  const rtl = d.language === 'ar'
  const font = rtl ? 'Arial' : 'Calibri'
  const color = (d.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const inv = d.invoice
  const cur = inv.currency as string
  const dp = decimalsFor(cur)
  const money = (n: unknown) => `${Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })} ${cur}`
  const lbl = (k: keyof typeof L) => `${L[k][0]} / ${L[k][1]}`
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT
  const p = (text: string, o: { bold?: boolean; size?: number; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; color?: string } = {}) =>
    new Paragraph({ bidirectional: rtl, alignment: o.alignment ?? align, spacing: { after: 60 },
      children: [new TextRun({ text, bold: o.bold, size: o.size ?? 20, font, color: o.color, rightToLeft: rtl || /[\u0600-\u06FF]/.test(text) })] })
  const cell = (text: string, o: { bold?: boolean; right?: boolean; shade?: boolean; width?: number } = {}) => new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.shade ? { fill: 'EEF2F7' } : undefined,
    children: [p(text, { bold: o.bold, alignment: o.right ? AlignmentType.RIGHT : align })]
  })

  const title = inv.status === 'draft' ? lbl('draft') : lbl('tax_invoice')
  const meta: Paragraph[] = [
    p(title + (inv.status === 'void' ? `  –  ${lbl('status_void')}` : ''), { bold: true, size: 32, color }),
    p(`${lbl('number')}: ${inv.number ?? '—'}`),
    p(`${lbl('issued')}: ${inv.issue_date ? new Date(inv.issue_date).toISOString().slice(0, 10) : '—'}`),
    p(`${lbl('due')}: ${inv.due_date ? new Date(inv.due_date).toISOString().slice(0, 10) : '—'}`),
    ...(d.billing.vat_number ? [p(`${lbl('vat_no')}: ${d.billing.vat_number}`)] : []),
    p(''),
    p(lbl('bill_to'), { bold: true }),
    p([inv.client_name, inv.client_name_ar].filter(Boolean).join(' – ')),
    ...(inv.client_address ? [p(inv.client_address)] : []),
    ...(inv.client_id_number ? [p(inv.client_id_number)] : []),
    ...(inv.case_reference ? [p(`${lbl('matter')}: ${inv.case_reference} – ${inv.case_title ?? ''}`)] : []),
    p('')
  ]

  const header = new TableRow({ tableHeader: true, children: [
    cell(lbl('description'), { bold: true, shade: true, width: 52 }), cell(lbl('qty'), { bold: true, shade: true, right: true, width: 14 }),
    cell(lbl('price'), { bold: true, shade: true, right: true, width: 16 }), cell(lbl('amount'), { bold: true, shade: true, right: true, width: 18 })
  ] })
  const rows = d.lines.map((l) => new TableRow({ children: [
    cell(l.description), cell(Number(l.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 }), { right: true }),
    cell(money(l.unit_price), { right: true }), cell(money(l.amount), { right: true })
  ] }))
  const totalRow = (label: string, value: string, bold = false) => new TableRow({ children: [
    cell(''), cell(''), cell(label, { bold, right: true, shade: bold }), cell(value, { bold, right: true, shade: bold })
  ] })
  const balance = Number(inv.total) - Number(inv.amount_paid)
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: rtl,
    rows: [
      header, ...rows,
      totalRow(lbl('subtotal'), money(inv.subtotal)),
      totalRow(`${lbl('vat')} (${Number(inv.vat_rate)}%)`, money(inv.vat_amount)),
      totalRow(lbl('total'), money(inv.total), true),
      ...(Number(inv.amount_paid) > 0 ? [totalRow(lbl('paid'), money(inv.amount_paid)), totalRow(lbl('balance'), money(balance), true)] : [])
    ]
  })

  const after: Paragraph[] = [p('')]
  if (inv.notes) after.push(p(lbl('notes'), { bold: true }), ...String(inv.notes).split('\n').map((x) => p(x)))
  if (d.billing.bank_details) after.push(p(''), p(lbl('bank'), { bold: true }), ...String(d.billing.bank_details).split('\n').map((x) => p(x)))
  if (d.billing.invoice_footer) after.push(p(''), p(d.billing.invoice_footer, { size: 16, color: '666666' }))

  const headerChildren = letterheadParagraphs(d.letterhead, rtl, font, color)
  const doc = new Document({
    creator: d.letterhead?.firm_name ?? 'TrustiqLegal',
    title: inv.number ?? 'Invoice',
    sections: [{
      properties: { page: { margin: { top: 1300, bottom: 1100, left: 1100, right: 1100 } } },
      headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 14, color: '777777', font })] })] }) },
      children: [...meta, table, ...after]
    }]
  })
  return Packer.toBuffer(doc)
}

// ---------------------------------------------------------------------------
// Signed copy: the signed text followed by a signature page and an audit trail.
// ---------------------------------------------------------------------------

export type SignedCopy = {
  title: string
  content: string
  language: 'en' | 'ar'
  letterhead?: Letterhead | null
  contentHash: string
  fileName?: string | null
  fileHash?: string | null
  completedAt?: Date | string | null
  signers: { name: string; email: string | null; status: string; signed_name: string | null; signed_at: Date | string | null; ip: string | null; signature_image: Uint8Array | null }[]
  events: { event: string; signer_name: string | null; detail: string | null; ip: string | null; created_at: Date | string }[]
}

const SL = {
  signatures: ['Signature page', 'صفحة التوقيعات'], signer: ['Signer', 'الموقّع'], signed_as: ['Signed as', 'وقّع باسم'],
  signed_at: ['Signed at (UTC)', 'وقت التوقيع (UTC)'], ip: ['IP address', 'عنوان IP'], status: ['Status', 'الحالة'],
  fingerprint: ['Document fingerprint (SHA-256)', 'البصمة الرقمية للمستند (SHA-256)'], file: ['Original file', 'الملف الأصلي'],
  audit: ['Audit trail', 'سجل التدقيق'], completed: ['Completed (UTC)', 'اكتمل (UTC)'],
  note: [
    'Signed electronically through TrustiqLegal. Each signer opened a personal link, reviewed the document and confirmed their signature; the fingerprint above identifies the exact text that was signed.',
    'تم التوقيع إلكترونيًا عبر TrustiqLegal. فتح كل موقّع رابطًا شخصيًا وراجع المستند وأكّد توقيعه، وتحدد البصمة أعلاه النص الذي تم توقيعه بالضبط.'
  ]
} as const

const utc = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—')

export async function renderSignedDocx(d: SignedCopy): Promise<Buffer> {
  const rtl = d.language === 'ar'
  const font = rtl ? 'Arial' : 'Calibri'
  const color = (d.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT
  const lbl = (k: Exclude<keyof typeof SL, 'note'>) => `${SL[k][0]} / ${SL[k][1]}`
  const p = (text: string, o: { bold?: boolean; size?: number; color?: string; center?: boolean; after?: number } = {}) => new Paragraph({
    bidirectional: rtl || hasArabic(text), alignment: o.center ? AlignmentType.CENTER : (rtl || hasArabic(text) ? AlignmentType.RIGHT : align), spacing: { after: o.after ?? 80 },
    children: [new TextRun({ text, bold: o.bold, size: o.size ?? 20, font, color: o.color, rightToLeft: rtl || hasArabic(text) })]
  })
  const cell = (children: Paragraph[], o: { shade?: boolean; width?: number } = {}) => new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined, shading: o.shade ? { fill: 'EEF2F7' } : undefined, children
  })

  const body: (Paragraph | Table)[] = [p(d.title, { bold: true, size: 32, center: true, after: 300 })]
  for (const raw of d.content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const lineRtl = rtl || hasArabic(line)
    body.push(new Paragraph({
      bidirectional: lineRtl, alignment: lineRtl ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED, spacing: { after: line ? 120 : 60, line: 300 },
      children: [new TextRun({ text: line, bold: !!line && isHeading(line.trim()), size: 22, font, rightToLeft: lineRtl })]
    }))
  }

  const page: (Paragraph | Table)[] = [p(lbl('signatures'), { bold: true, size: 30, color, after: 200 })]
  for (const s of d.signers) {
    const image = s.signature_image ? [new Paragraph({ alignment: align, children: [new ImageRun({ type: 'png', data: Buffer.from(s.signature_image), transformation: { width: 220, height: 80 } })] })] : []
    page.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: rtl,
      rows: [
        new TableRow({ children: [cell([p(lbl('signer'), { bold: true })], { shade: true, width: 35 }), cell([p([s.name, s.email].filter(Boolean).join(' – '))], { width: 65 })] }),
        new TableRow({ children: [cell([p(lbl('signed_as'), { bold: true })], { shade: true }), cell([...image, p(s.signed_name ?? '—', { bold: true, size: 26 })])] }),
        new TableRow({ children: [cell([p(lbl('signed_at'), { bold: true })], { shade: true }), cell([p(utc(s.signed_at))])] }),
        new TableRow({ children: [cell([p(lbl('ip'), { bold: true })], { shade: true }), cell([p(s.ip ?? '—')])] }),
        new TableRow({ children: [cell([p(lbl('status'), { bold: true })], { shade: true }), cell([p(s.status)])] })
      ]
    }), p(''))
  }
  page.push(
    p(`${lbl('fingerprint')}:`, { bold: true }), p(d.contentHash, { size: 16 }),
    ...(d.fileHash ? [p(`${lbl('file')}: ${d.fileName ?? ''}`, { bold: true }), p(d.fileHash, { size: 16 })] : []),
    p(`${lbl('completed')}: ${utc(d.completedAt)}`),
    p(SL.note[0], { size: 16, color: '555555' }), p(SL.note[1], { size: 16, color: '555555' }),
    p(''), p(lbl('audit'), { bold: true, size: 26, color, after: 120 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: rtl,
      rows: d.events.map((e) => new TableRow({ children: [
        cell([p(utc(e.created_at), { size: 16 })], { width: 26 }),
        cell([p([e.event, e.signer_name, e.detail].filter(Boolean).join(' · '), { size: 16 })], { width: 52 }),
        cell([p(e.ip ?? '', { size: 16 })], { width: 22 })
      ] }))
    })
  )

  const headerChildren = letterheadParagraphs(d.letterhead, rtl, font, color)
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: `SHA-256 ${d.contentHash.slice(0, 16)}…   `, size: 14, color: '777777', font }),
    new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 14, color: '777777', font })
  ] })] })
  const section = (children: (Paragraph | Table)[]) => ({
    properties: { page: { margin: { top: 1300, bottom: 1100, left: 1200, right: 1200 } } },
    headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
    footers: { default: footer },
    children
  })
  const doc = new Document({ creator: d.letterhead?.firm_name ?? 'TrustiqLegal', title: d.title, sections: [section(body), section(page)] })
  return Packer.toBuffer(doc)
}
