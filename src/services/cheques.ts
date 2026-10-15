import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Returned cheques (الشيكات المرتجعة): each cheque on a collection matter, why
// the bank returned it, the complaint and what has been recovered; plus a
// bilingual demand letter to the drawer listing the unpaid cheques.
// ---------------------------------------------------------------------------

export const RETURN_REASONS = ['insufficient_funds', 'account_closed', 'signature', 'stopped', 'irregular', 'other'] as const
export const UNACTIONED_DAYS = 7

const REASON: Record<(typeof RETURN_REASONS)[number], [string, string]> = {
  insufficient_funds: ['Insufficient funds', 'عدم كفاية الرصيد'], account_closed: ['Account closed', 'الحساب مغلق'],
  signature: ['Signature irregular', 'عدم مطابقة التوقيع'], stopped: ['Payment stopped by drawer', 'إيقاف الصرف من الساحب'],
  irregular: ['Irregular cheque', 'شيك غير مستوفٍ للبيانات'], other: ['Other', 'أخرى']
}

export type Cheque = {
  amount: number; recovered: number; written_off: boolean; presented_on: string | null; returned_on: string | null; complaint_on: string | null
}

// Where the cheque stands, from the facts recorded.
export function status(c: Cheque) {
  if (c.recovered >= c.amount) return 'paid'
  if (c.written_off) return 'written_off'
  if (c.complaint_on) return 'complaint'
  if (c.returned_on) return c.recovered > 0 ? 'part_paid' : 'returned'
  if (c.presented_on) return 'presented'
  return 'held'
}

export const outstanding = (c: Pick<Cheque, 'amount' | 'recovered' | 'written_off'>) => (c.written_off ? 0 : Math.max(0, Math.round((c.amount - c.recovered) * 1000) / 1000))

const dmy = (iso: string) => iso.split('-').reverse().join('/')
const money = (n: number, cur: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${cur}`

// Bilingual demand to the drawer: the unpaid cheques, the total and the time to pay.
export async function renderDemandDocx(o: {
  firmName: string; firmNameAr: string | null; letterhead: Letterhead | null; date: string; days: number
  drawer: string; client: string; clientAr: string | null; reference: string
  cheques: { cheque_no: string; bank: string; cheque_date: string; returned_on: string | null; return_reason: string | null; amount: number; recovered: number; currency: string }[]
}) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  const p = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({
    bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 100 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
  })
  const half = (children: Paragraph[]) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children })
  const pair = (en: string, ar: string, opts: { bold?: boolean; size?: number } = {}) => new TableRow({ children: [half([p(en, false, opts)]), half([p(ar, true, opts)])] })
  // Totals per currency (a drawer may owe in more than one).
  const totals = new Map<string, number>()
  for (const c of o.cheques) totals.set(c.currency, (totals.get(c.currency) ?? 0) + Math.max(0, c.amount - c.recovered))
  const total = [...totals].map(([cur, n]) => money(n, cur)).join(' + ')
  const firmAr = o.firmNameAr || o.firmName
  const clientAr = o.clientAr || o.client
  const text = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    pair('Demand for payment of returned cheques', 'إنذار بسداد قيمة شيكات مرتجعة', { bold: true, size: 28 }),
    pair(`Date: ${dmy(o.date)}`, `التاريخ: ${dmy(o.date)}`),
    pair(`Our ref.: ${o.reference}`, `مرجعنا: ${o.reference}`),
    pair(`To: ${o.drawer}`, `إلى: ${o.drawer}`, { bold: true }),
    pair(`We write on behalf of our client, ${o.client}. The cheques listed below, drawn by you in our client's favour, were presented for payment and returned unpaid by the bank.`,
      `نكتب إليكم بالنيابة عن موكلنا ${clientAr}. إن الشيكات المبينة أدناه، المسحوبة منكم لصالح موكلنا، قُدمت للصرف وأعادها البنك دون صرف.`)
  ] })
  const head = (en: string, ar: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, shading: { fill: 'E2E8F0' }, children: [p(en, false, { bold: true, size: 17 }), p(ar, true, { bold: true, size: 17 })] })
  const cell = (s: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, children: [p(s, /[؀-ۿ]/.test(s), { size: 18 })] })
  const list = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ tableHeader: true, children: [head('Cheque no.', 'رقم الشيك'), head('Bank', 'البنك'), head('Date', 'التاريخ'), head('Returned', 'تاريخ الإرجاع'), head('Reason', 'السبب'), head('Unpaid', 'المبلغ المستحق')] }),
    ...o.cheques.map((c) => new TableRow({ children: [cell(c.cheque_no), cell(c.bank), cell(dmy(c.cheque_date)), cell(c.returned_on ? dmy(c.returned_on) : ''),
      cell(c.return_reason ? `${REASON[c.return_reason as keyof typeof REASON][0]} / ${REASON[c.return_reason as keyof typeof REASON][1]}` : ''), cell(money(c.amount - c.recovered, c.currency))] }))
  ] })
  const closing = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    pair(`The total unpaid is ${total}.`, `ويبلغ إجمالي المبلغ المستحق ${total}.`, { bold: true }),
    pair(`We demand that you pay this amount to our client within ${o.days} days of receiving this letter. Failing that, our client will take the legal action available to it to recover the amount, without further notice and at your cost.`,
      `ونطالبكم بسداد هذا المبلغ لموكلنا خلال ${o.days} يوماً من تاريخ استلامكم هذا الإنذار، وإلا فسيتخذ موكلنا الإجراءات القانونية المتاحة له لاستيفاء المبلغ، دون حاجة إلى إنذار آخر، مع تحميلكم كافة المصاريف.`),
    pair('This letter is without prejudice to any of our client\'s rights, all of which are reserved.', 'ويُعد هذا الإنذار دون إخلال بأي من حقوق موكلنا الأخرى، والتي يحتفظ بها كاملة.'),
    pair(`For ${o.firmName}`, `عن ${firmAr}`, { bold: true }),
    pair('______________________', '______________________')
  ] })
  const doc = new Document({
    creator: o.firmName,
    title: `Demand for returned cheques – ${o.drawer}`,
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [...letterheadParagraphs(o.letterhead, false, 'Calibri', color), text, new Paragraph({ text: '' }), list, new Paragraph({ text: '' }), closing]
    }]
  })
  return Packer.toBuffer(doc)
}
