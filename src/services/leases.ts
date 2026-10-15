import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { Queryable } from '../db'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Leases (عقود الإيجار): a client's tenancies as landlord or tenant, the rent
// schedule and arrears, the expiry and the last day to give notice kept on
// the calendar, and a bilingual notice of non-renewal or new terms.
// ---------------------------------------------------------------------------

export const USES = ['residential', 'commercial', 'industrial', 'land', 'other'] as const
export const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const
export const STATUSES = ['active', 'renewed', 'ended', 'terminated'] as const
export const NOTICE_SOON_DAYS = 30
const STEP: Record<(typeof FREQUENCIES)[number], number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }

const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return { y, m, d } }
const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// The same day n months later, kept within the month (31 January + 1 month = 28 or 29 February).
export function addMonths(iso: string, n: number) {
  const { y, m, d } = parse(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return fmt(ny, nm, Math.min(d, last))
}

// Rent instalments over the term (the end date is the last day of the lease).
// Each period's rent is a share of the annual rent; a short final period pays for its months only.
export function rentSchedule(startsOn: string, endsOn: string, annualRent: number, frequency: (typeof FREQUENCIES)[number]) {
  const step = STEP[frequency]
  const endExclusive = addDays(endsOn, 1)
  const out: { due_on: string; amount: number }[] = []
  for (let k = 0; k < 600; k++) {
    const due = addMonths(startsOn, k * step)
    if (due >= endExclusive) break
    let months = step
    // Whole months left in a short last period (at least one).
    while (months > 1 && addMonths(startsOn, k * step + months) > endExclusive) months--
    out.push({ due_on: due, amount: Math.round((annualRent * months / 12) * 1000) / 1000 })
  }
  return out
}

export const noticeBy = (endsOn: string, noticeDays: number) => (noticeDays > 0 ? addDays(endsOn, -noticeDays) : null)

type Lease = { id: string; client_id: string; case_id: string | null; property: string; counterparty: string; ends_on: string; notice_days: number; status: string
  end_event_id: string | null; notice_event_id: string | null }

async function upsertEvent(q: Queryable, o: { orgId: string; userId: string; caseId: string | null; id: string | null; date: string | null; title: string; note: string; open: boolean }) {
  if (o.id && !o.date) { await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [o.id, o.orgId]); return null }
  if (!o.date) return null
  if (o.id) {
    const updated = await q.query(
      `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4, notes = $5, case_id = $6,
              completed_at = CASE WHEN $7::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now()
        WHERE id = $1 AND org_id = $2 RETURNING id`, [o.id, o.orgId, o.date, o.title, o.note, o.caseId, o.open])
    if (updated.length) return o.id
  }
  const [e] = await q.query(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
     VALUES ($1, $2, $3, 'deadline', ($4::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7) RETURNING id`,
    [o.orgId, o.caseId, o.title, o.date, o.note, o.open, o.userId])
  return e.id as string
}

// Keeps the lease's expiry and last notice day on the calendar while it is active.
export async function syncLeaseEvents(q: Queryable, o: { orgId: string; userId: string; clientName: string; lease: Lease }) {
  const l = o.lease
  const open = l.status === 'active'
  const end = await upsertEvent(q, {
    orgId: o.orgId, userId: o.userId, caseId: l.case_id, id: l.end_event_id, date: l.ends_on, open,
    title: `Lease expires – ${l.property} (${o.clientName})`, note: `Lease with ${l.counterparty} ends. Agree renewal, hand-over or vacation in time.`
  })
  const notice = await upsertEvent(q, {
    orgId: o.orgId, userId: o.userId, caseId: l.case_id, id: l.notice_event_id, date: noticeBy(l.ends_on, l.notice_days), open,
    title: `Last day for lease notice – ${l.property} (${o.clientName})`,
    note: `Last day to notify ${l.counterparty} of non-renewal or new terms (${l.notice_days} days before expiry, as recorded on the lease). Check the period against the lease and the applicable law.`
  })
  return { end_event_id: end, notice_event_id: notice }
}

const dmy = (iso: string) => iso.split('-').reverse().join('/')
const money = (n: number, cur: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${cur}`

// Bilingual notice to the other party: non-renewal, or renewal on new terms.
export async function renderNoticeDocx(o: {
  firmName: string; firmNameAr: string | null; letterhead: Letterhead | null; date: string; kind: 'non_renewal' | 'renewal_terms'
  clientRole: 'landlord' | 'tenant'; client: string; clientAr: string | null; counterparty: string; property: string; endsOn: string
  registrationNo: string | null; newRent: number | null; currency: string; terms: string | null
}) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const p = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({
    bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 120 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 21, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
  })
  const cell = (c: Paragraph[]) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children: c })
  const pair = (en: string, ar: string, opts: { bold?: boolean; size?: number } = {}) => new TableRow({ children: [cell([p(en, false, opts)]), cell([p(ar, true, opts)])] })
  const firmAr = o.firmNameAr || o.firmName
  const clientAr = o.clientAr || o.client
  const reg = o.registrationNo ? ` (registration no. ${o.registrationNo})` : ''
  const regAr = o.registrationNo ? ` (المسجل برقم ${o.registrationNo})` : ''
  const landlord = o.clientRole === 'landlord'
  const body: [string, string][] = o.kind === 'non_renewal'
    ? [
        [`We write on behalf of our client, ${o.client}, ${landlord ? 'the landlord' : 'the tenant'} under the lease of ${o.property}${reg}, which expires on ${dmy(o.endsOn)}.`,
          `نكتب إليكم بالنيابة عن موكلنا ${clientAr}، ${landlord ? 'المؤجر' : 'المستأجر'} بموجب عقد إيجار ${o.property}${regAr}، والذي ينتهي في ${dmy(o.endsOn)}.`],
        [`Our client hereby gives notice that it does not wish to renew the lease when it expires.`, 'ويخطركم موكلنا بموجب هذا بعدم رغبته في تجديد العقد عند انتهائه.'],
        landlord
          ? [`You are therefore requested to vacate the property and hand it over in good condition, with all utility bills settled, on or before ${dmy(o.endsOn)}.`,
              `وعليه نطلب منكم إخلاء العين المؤجرة وتسليمها بحالة جيدة مع سداد جميع فواتير الخدمات في موعد أقصاه ${dmy(o.endsOn)}.`]
          : [`Our client will vacate and hand over the property on ${dmy(o.endsOn)} and asks that the security deposit be returned on hand-over.`,
              `وسيقوم موكلنا بإخلاء العين المؤجرة وتسليمها في ${dmy(o.endsOn)}، ويطلب رد مبلغ التأمين عند التسليم.`]
      ]
    : [
        [`We write on behalf of our client, ${o.client}, ${landlord ? 'the landlord' : 'the tenant'} under the lease of ${o.property}${reg}, which expires on ${dmy(o.endsOn)}.`,
          `نكتب إليكم بالنيابة عن موكلنا ${clientAr}، ${landlord ? 'المؤجر' : 'المستأجر'} بموجب عقد إيجار ${o.property}${regAr}، والذي ينتهي في ${dmy(o.endsOn)}.`],
        [`Our client is willing to renew the lease on the following terms${o.newRent ? `: an annual rent of ${money(o.newRent, o.currency)}` : ''}${o.terms ? `${o.newRent ? '; ' : ': '}${o.terms}` : ''}.`,
          `ويبدي موكلنا استعداده لتجديد العقد وفق الشروط التالية${o.newRent ? `: أجرة سنوية قدرها ${money(o.newRent, o.currency)}` : ''}${o.terms ? `${o.newRent ? '؛ ' : ': '}${o.terms}` : ''}.`],
        ['Please confirm your acceptance in writing before the lease expires. Failing agreement, the lease will end on its expiry date.',
          'نرجو تأكيد موافقتكم كتابةً قبل انتهاء العقد، وفي حال عدم الاتفاق ينتهي العقد في تاريخ انتهائه.']
      ]
  const title = o.kind === 'non_renewal' ? ['Notice of non-renewal of lease', 'إخطار بعدم تجديد عقد الإيجار'] : ['Notice of renewal terms', 'إخطار بشروط تجديد عقد الإيجار']
  const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    pair(title[0]!, title[1]!, { bold: true, size: 28 }),
    pair(`Date: ${dmy(o.date)}`, `التاريخ: ${dmy(o.date)}`),
    pair(`To: ${o.counterparty}`, `إلى: ${o.counterparty}`, { bold: true }),
    ...body.map(([en, ar]) => pair(en, ar)),
    pair('This notice is without prejudice to any of our client\'s rights.', 'ويُعد هذا الإخطار دون إخلال بأي من حقوق موكلنا.'),
    pair(`For ${o.firmName}`, `عن ${firmAr}`, { bold: true }),
    pair('______________________', '______________________')
  ] })
  const doc = new Document({
    creator: o.firmName, title: `${title[0]} – ${o.property}`,
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: [...letterheadParagraphs(o.letterhead, false, 'Calibri', color), table] }]
  })
  return Packer.toBuffer(doc)
}
