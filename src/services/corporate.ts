import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { Queryable } from '../db'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Company secretarial (السجل المؤسسي): for corporate clients, the company's
// particulars, its shareholders, directors, managers and authorised
// signatories, and the recurring filings (commercial registration and chamber
// renewals, AGM, accounts) kept on the calendar and rolled forward each year.
// ---------------------------------------------------------------------------

export const LEGAL_FORMS = ['llc', 'spc', 'saog', 'saoc', 'partnership', 'branch', 'sole', 'free_zone', 'other'] as const
export const PERSON_ROLES = ['shareholder', 'director', 'manager', 'signatory', 'secretary', 'auditor'] as const
export const OBLIGATION_KINDS = ['cr_renewal', 'chamber_renewal', 'licence_renewal', 'agm', 'accounts', 'tax_return', 'other'] as const
export const DUE_SOON_DAYS = 30

export const KIND_LABEL: Record<(typeof OBLIGATION_KINDS)[number], [string, string]> = {
  cr_renewal: ['Commercial registration renewal', 'تجديد السجل التجاري'],
  chamber_renewal: ['Chamber of commerce membership renewal', 'تجديد عضوية غرفة التجارة'],
  licence_renewal: ['Licence renewal', 'تجديد الترخيص'],
  agm: ['Annual general meeting', 'اجتماع الجمعية العامة السنوي'],
  accounts: ['Audited accounts filing', 'إيداع الحسابات المدققة'],
  tax_return: ['Tax return', 'الإقرار الضريبي'],
  other: ['Corporate filing', 'إجراء مؤسسي']
}
const ROLE_LABEL: Record<(typeof PERSON_ROLES)[number], [string, string]> = {
  shareholder: ['Shareholder', 'شريك / مساهم'], director: ['Director', 'عضو مجلس الإدارة'], manager: ['Manager', 'مدير'],
  signatory: ['Authorised signatory', 'مفوض بالتوقيع'], secretary: ['Secretary', 'أمين السر'], auditor: ['Auditor', 'مراقب الحسابات']
}
const FORM_LABEL: Record<(typeof LEGAL_FORMS)[number], [string, string]> = {
  llc: ['Limited liability company', 'شركة محدودة المسؤولية'], spc: ['Single-person company', 'شركة الشخص الواحد'],
  saog: ['Public joint stock company (SAOG)', 'شركة مساهمة عامة'], saoc: ['Closed joint stock company (SAOC)', 'شركة مساهمة مقفلة'],
  partnership: ['Partnership', 'شركة تضامن / توصية'], branch: ['Branch of a foreign company', 'فرع شركة أجنبية'], sole: ['Sole proprietorship', 'مؤسسة فردية'],
  free_zone: ['Free zone company', 'شركة منطقة حرة'], other: ['Other', 'أخرى']
}

export type Person = {
  id: string; name: string; name_ar: string | null; role: (typeof PERSON_ROLES)[number]; is_entity: boolean; nationality: string | null; id_number: string | null
  shares: number | null; position: string | null; signing_authority: string | null; appointed_on: string | null; ceased_on: string | null
}

// Still in office (or still holding shares) on the given Gulf date.
export const isCurrent = (p: Pick<Person, 'ceased_on'>, today: string) => !p.ceased_on || p.ceased_on > today

// Each current shareholder's percentage, from the issued shares or the total held.
export function ownership(people: Person[], totalShares: number | null, today: string) {
  const holders = people.filter((p) => p.role === 'shareholder' && isCurrent(p, today))
  const held = holders.reduce((n, p) => n + (p.shares ?? 0), 0)
  const base = totalShares || held
  return {
    held,
    issued: totalShares,
    holders: holders.map((p) => ({ id: p.id, name: p.name, shares: p.shares, percent: base && p.shares != null ? Math.round((p.shares / base) * 10000) / 100 : null }))
  }
}

// What a partner should look at before relying on the record.
export function warnings(people: Person[], totalShares: number | null, today: string) {
  const current = people.filter((p) => isCurrent(p, today))
  const out: string[] = []
  const own = ownership(people, totalShares, today)
  if (!own.holders.length) out.push('no_shareholders')
  else if (totalShares && Math.abs(own.held - totalShares) > 0.0005) out.push('shares_mismatch')
  if (!current.some((p) => p.role === 'director' || p.role === 'manager')) out.push('no_management')
  if (!current.some((p) => p.role === 'signatory' || p.signing_authority)) out.push('no_signatory')
  return out
}

// The same day next year (29 February becomes 28 February).
export function nextYear(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate()
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export type Obligation = { id: string; client_id: string; kind: (typeof OBLIGATION_KINDS)[number]; title: string; due_on: string; done_on: string | null; event_id: string | null; notes: string | null }

// Keeps one all-day deadline on the firm calendar per obligation; completes it when done.
export async function syncObligationEvent(q: Queryable, o: { orgId: string; userId: string; clientName: string; ob: Obligation }) {
  const title = `${o.ob.title} – ${o.clientName}`
  const note = o.ob.notes || `Corporate filing for ${o.clientName}. Check the date with the registry and the company's constitutional documents.`
  const open = !o.ob.done_on
  if (o.ob.event_id) {
    const updated = await q.query(
      `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4, notes = $5,
              completed_at = CASE WHEN $6::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now()
        WHERE id = $1 AND org_id = $2 RETURNING id`, [o.ob.event_id, o.orgId, o.ob.due_on, title, note, open])
    if (updated.length) return o.ob.event_id
  }
  const [e] = await q.query(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
     VALUES ($1, NULL, $2, 'deadline', ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $4, CASE WHEN $5::boolean THEN NULL ELSE now() END, $6) RETURNING id`,
    [o.orgId, title, o.ob.due_on, note, open, o.userId])
  return e.id as string
}

// Bilingual register of shareholders and officers, as recorded by the firm.
export async function renderRegisterDocx(o: {
  firmName: string; letterhead: Letterhead | null; date: string
  company: { name: string; name_ar: string | null }
  profile: { legal_form: (typeof LEGAL_FORMS)[number]; cr_number: string | null; registered_on: string | null; capital: number | null; currency: string | null; total_shares: number | null; registered_address: string | null } | null
  people: Person[]; percents: Map<string, number | null>; today: string
}) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  const ar = (s: string) => /[؀-ۿ]/.test(s)
  const p = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({
    bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 60 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 19, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
  })
  const pair = (en: string, arText: string, opts: { bold?: boolean; size?: number } = {}) => new TableRow({ children: [
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children: [p(en, false, opts)] }),
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none }, children: [p(arText, true, opts)] })
  ] })
  const pr = o.profile
  const money = pr?.capital != null ? `${pr.capital.toFixed(3)} ${pr.currency ?? ''}`.trim() : ''
  const header = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    pair('Register of shareholders and officers', 'سجل الشركاء والمسؤولين', { bold: true, size: 28 }),
    pair(o.company.name, o.company.name_ar || o.company.name, { bold: true, size: 22 }),
    ...(pr ? [pair(`Legal form: ${FORM_LABEL[pr.legal_form][0]}`, `الشكل القانوني: ${FORM_LABEL[pr.legal_form][1]}`)] : []),
    ...(pr?.cr_number ? [pair(`Commercial registration: ${pr.cr_number}${pr.registered_on ? ` (registered ${pr.registered_on})` : ''}`, `السجل التجاري: ${pr.cr_number}${pr.registered_on ? ` (تاريخ القيد ${pr.registered_on})` : ''}`)] : []),
    ...(money ? [pair(`Capital: ${money}${pr?.total_shares ? `, ${pr.total_shares} shares` : ''}`, `رأس المال: ${money}${pr?.total_shares ? `، ${pr.total_shares} حصة / سهم` : ''}`)] : []),
    ...(pr?.registered_address ? [pair(`Registered address: ${pr.registered_address}`, `العنوان المسجل: ${pr.registered_address}`)] : []),
    pair(`As at ${o.date}, according to the records held by ${o.firmName}.`, `كما في ${o.date}، وفقاً للسجلات المحفوظة لدى ${o.firmName}.`)
  ] })
  const head = (en: string, arText: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, shading: { fill: 'E2E8F0' }, children: [p(en, false, { bold: true, size: 17 }), p(arText, true, { bold: true, size: 17 })] })
  const cell = (text: string) => new TableCell({ borders: { top: thin, bottom: thin, left: thin, right: thin }, children: [p(text, ar(text), { size: 18 })] })
  const name = (x: Person) => (x.name_ar && x.name_ar !== x.name ? `${x.name} / ${x.name_ar}` : x.name)
  const current = o.people.filter((x) => isCurrent(x, o.today))
  const section = (en: string, arText: string) => [new Paragraph({ text: '' }), pair2(en, arText)]
  const pair2 = (en: string, arText: string) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [pair(en, arText, { bold: true, size: 22 })] })
  const holders = current.filter((x) => x.role === 'shareholder')
  const officers = current.filter((x) => x.role !== 'shareholder')
  const holdersTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ tableHeader: true, children: [head('Name', 'الاسم'), head('Nationality', 'الجنسية'), head('ID / CR no.', 'رقم الهوية / السجل'), head('Shares', 'الحصص'), head('%', 'النسبة'), head('Since', 'منذ')] }),
    ...holders.map((x) => new TableRow({ children: [cell(name(x)), cell(x.nationality ?? ''), cell(x.id_number ?? ''), cell(x.shares != null ? String(x.shares) : ''),
      cell(o.percents.get(x.id) != null ? `${o.percents.get(x.id)}%` : ''), cell(x.appointed_on ?? '')] }))
  ] })
  const officersTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ tableHeader: true, children: [head('Name', 'الاسم'), head('Role', 'الصفة'), head('Nationality', 'الجنسية'), head('ID no.', 'رقم الهوية'), head('Signing authority', 'صلاحية التوقيع'), head('Appointed', 'تاريخ التعيين')] }),
    ...officers.map((x) => new TableRow({ children: [cell(name(x)), cell(`${ROLE_LABEL[x.role][0]} / ${ROLE_LABEL[x.role][1]}${x.position ? ` (${x.position})` : ''}`),
      cell(x.nationality ?? ''), cell(x.id_number ?? ''), cell(x.signing_authority ?? ''), cell(x.appointed_on ?? '')] }))
  ] })
  const doc = new Document({
    creator: o.firmName,
    title: `Register of shareholders and officers – ${o.company.name}`,
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [
        ...letterheadParagraphs(o.letterhead, false, 'Calibri', color), header,
        ...section('Shareholders', 'الشركاء / المساهمون'), holders.length ? holdersTable : p('None recorded / لا يوجد', false),
        ...section('Directors, managers and signatories', 'أعضاء مجلس الإدارة والمديرون والمفوضون بالتوقيع'), officers.length ? officersTable : p('None recorded / لا يوجد', false),
        new Paragraph({ text: '' }),
        p('This register reflects the firm\'s records and is not an official extract. Check it against the commercial registry before relying on it.', false, { size: 16 }),
        p('يعكس هذا السجل ما هو مقيد لدى المكتب وليس مستخرجاً رسمياً، ويجب مطابقته مع السجل التجاري قبل الاعتماد عليه.', true, { size: 16 })
      ]
    }]
  })
  return Packer.toBuffer(doc)
}
