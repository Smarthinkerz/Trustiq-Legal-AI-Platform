import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Originals register (سجل الأصول): original documents clients hand to the firm
// (cheques, title deeds, contracts, powers of attorney…), where each one is,
// every movement, and bilingual receipts for taking them in and handing back.
// ---------------------------------------------------------------------------

export const KINDS = ['cheque', 'contract', 'title_deed', 'poa', 'id_document', 'certificate', 'court_document', 'other'] as const
export const MOVES = ['moved', 'lodged', 'retrieved', 'returned'] as const
export type Move = (typeof MOVES)[number]

const KIND_LABEL: Record<(typeof KINDS)[number], [string, string]> = {
  cheque: ['Cheque', 'شيك'], contract: ['Contract', 'عقد'], title_deed: ['Title deed', 'سند ملكية'], poa: ['Power of attorney', 'وكالة'],
  id_document: ['Identity document', 'وثيقة هوية'], certificate: ['Certificate', 'شهادة'], court_document: ['Court document', 'مستند قضائي'], other: ['Document', 'مستند']
}

// What each movement does to the item, and which state it must be in first.
export function applyMove(cur: { status: string }, move: Move): { status: 'held' | 'lodged' | 'returned' } {
  if (cur.status === 'returned') throw new Error('This original has already been returned.')
  if (move === 'retrieved' && cur.status !== 'lodged') throw new Error('Only an original lodged elsewhere can be retrieved.')
  if (move === 'lodged' && cur.status === 'lodged') throw new Error('This original is already lodged.')
  if (move === 'moved' && cur.status !== 'held') throw new Error('Retrieve the original before moving it within the firm.')
  return { status: move === 'lodged' ? 'lodged' : move === 'returned' ? 'returned' : 'held' }
}

export const receiptNo = (n: number) => `OR-${String(n).padStart(5, '0')}`

type Item = { receipt_no: number; kind: (typeof KINDS)[number]; description: string; reference_no: string | null; amount: number | null; currency: string | null; copies: number }

export async function renderReceiptDocx(o: {
  type: 'receipt' | 'return'; firmName: string; firmNameAr: string | null; letterhead: Letterhead | null
  clientName: string; clientNameAr: string | null; party: string | null; date: string; reference: string | null; caseTitle: string | null; items: Item[]
}) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  const p = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) => new Paragraph({
    bidirectional: rtl, alignment: opts.align ?? (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT), spacing: { after: 80 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
  })
  const pair = (en: string, ar: string, opts: { bold?: boolean; size?: number } = {}) => new TableRow({ children: [
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children: [p(en, false, opts)] }),
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children: [p(ar, true, opts)] })
  ] })
  const returning = o.type === 'return'
  const clientAr = o.clientNameAr || o.clientName
  const firmAr = o.firmNameAr || o.firmName
  const who = o.party || o.clientName
  const header = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    pair(returning ? 'Return of original documents' : 'Receipt of original documents', returning ? 'إيصال تسليم أصول' : 'إيصال استلام أصول', { bold: true, size: 28 }),
    pair(`Receipt no. ${o.items.map((i) => receiptNo(i.receipt_no)).join(', ')}`, `رقم الإيصال ${o.items.map((i) => receiptNo(i.receipt_no)).join('، ')}`),
    pair(`Date: ${o.date}`, `التاريخ: ${o.date}`),
    pair(`Client: ${o.clientName}`, `الموكل: ${clientAr}`),
    ...(o.reference ? [pair(`Matter: ${o.reference}${o.caseTitle ? ` – ${o.caseTitle}` : ''}`, `القضية: ${o.reference}${o.caseTitle ? ` – ${o.caseTitle}` : ''}`)] : []),
    pair(
      returning
        ? `${o.firmName} has today returned the original documents listed below to ${who}, who acknowledges receiving them complete and in good order.`
        : `${o.firmName} acknowledges receiving today from ${who} the original documents listed below, to be held in safe custody for the client.`,
      returning
        ? `سلّم ${firmAr} اليوم الأصول المبينة أدناه إلى ${o.party || clientAr}، ويقر المستلم باستلامها كاملة وبحالة سليمة.`
        : `يقر ${firmAr} باستلامه اليوم من ${o.party || clientAr} الأصول المبينة أدناه، لحفظها بأمانة لصالح الموكل.`
    )
  ] })
  const head = (en: string, ar: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, shading: { fill: 'E2E8F0' }, children: [p(en, false, { bold: true, size: 18 }), p(ar, true, { bold: true, size: 18 })] })
  const cell = (text: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, children: [p(text, /[؀-ۿ]/.test(text))] })
  const items = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ tableHeader: true, children: [head('No.', 'الرقم'), head('Type', 'النوع'), head('Description', 'الوصف'), head('Reference', 'المرجع'), head('Amount', 'المبلغ'), head('Copies', 'العدد')] }),
    ...o.items.map((i) => new TableRow({ children: [
      cell(receiptNo(i.receipt_no)), cell(`${KIND_LABEL[i.kind][0]} / ${KIND_LABEL[i.kind][1]}`), cell(i.description), cell(i.reference_no ?? ''),
      cell(i.amount != null ? `${i.amount.toFixed(3)} ${i.currency ?? ''}` : ''), cell(String(i.copies))
    ] }))
  ] })
  const sign = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
    new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, children: [
      p(returning ? 'Handed over by (for the firm)' : 'Received by (for the firm)', false, { bold: true }), p(returning ? 'سلّمها (عن المكتب)' : 'استلمها (عن المكتب)', true, { bold: true }),
      p('Name / الاسم: ____________________', false), p('Signature / التوقيع: ____________________', false)] }),
    new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, children: [
      p(returning ? 'Received by' : 'Handed over by', false, { bold: true }), p(returning ? 'المستلم' : 'المسلِّم', true, { bold: true }),
      p('Name / الاسم: ____________________', false), p('Signature / التوقيع: ____________________', false)] })
  ] })] })
  const doc = new Document({
    creator: o.firmName,
    title: returning ? 'Return of original documents' : 'Receipt of original documents',
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [...letterheadParagraphs(o.letterhead, false, 'Calibri', color), header, new Paragraph({ text: '' }), items, new Paragraph({ text: '' }), new Paragraph({ text: '' }), sign]
    }]
  })
  return Packer.toBuffer(doc)
}
