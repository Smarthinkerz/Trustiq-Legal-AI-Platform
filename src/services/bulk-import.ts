import type { Queryable } from '../db'
import { normalizeText } from './library'
import { CURRENCIES, JURISDICTIONS, PRACTICE_AREAS } from './reference'

// ---------------------------------------------------------------------------
// Bulk import of clients and cases from a spreadsheet. Columns are matched to
// fields by English or Arabic header names; values are normalised (Arabic
// digits, dates, jurisdictions, statuses) and every row is validated before
// anything is written.
// ---------------------------------------------------------------------------

export type ImportType = 'clients' | 'cases'
export type FieldDef = { key: string; required?: boolean; headers: string[] }

export const IMPORT_FIELDS: Record<ImportType, FieldDef[]> = {
  clients: [
    { key: 'name', required: true, headers: ['name', 'client', 'client name', 'full name', 'company', 'company name', 'customer', 'الاسم', 'اسم الموكل', 'الموكل', 'العميل', 'اسم العميل', 'الاسم الكامل', 'اسم الشركة'] },
    { key: 'name_ar', headers: ['arabic name', 'name arabic', 'name (arabic)', 'الاسم بالعربية', 'الاسم العربي'] },
    { key: 'kind', headers: ['type', 'kind', 'client type', 'النوع', 'نوع الموكل', 'نوع العميل', 'الصفة'] },
    { key: 'email', headers: ['email', 'e-mail', 'email address', 'البريد', 'البريد الإلكتروني', 'الإيميل'] },
    { key: 'phone', headers: ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'mobile number', 'الهاتف', 'الجوال', 'رقم الهاتف', 'رقم الجوال', 'النقال'] },
    { key: 'id_number', headers: ['id', 'id number', 'civil id', 'national id', 'passport', 'cr', 'cr number', 'commercial registration', 'الرقم المدني', 'رقم الهوية', 'البطاقة الشخصية', 'السجل التجاري', 'رقم السجل', 'رقم السجل التجاري', 'رقم الجواز'] },
    { key: 'address', headers: ['address', 'العنوان'] },
    { key: 'notes', headers: ['notes', 'note', 'comments', 'ملاحظات', 'ملاحظة'] }
  ],
  cases: [
    { key: 'title', required: true, headers: ['title', 'case', 'case title', 'matter', 'matter name', 'subject', 'العنوان', 'عنوان القضية', 'القضية', 'الموضوع', 'موضوع الدعوى', 'اسم القضية'] },
    { key: 'title_ar', headers: ['arabic title', 'title arabic', 'title (arabic)', 'العنوان بالعربية'] },
    { key: 'client', headers: ['client', 'client name', 'customer', 'الموكل', 'اسم الموكل', 'العميل', 'اسم العميل'] },
    { key: 'jurisdiction', headers: ['jurisdiction', 'country', 'الدولة', 'الولاية القضائية', 'البلد'] },
    { key: 'court', headers: ['court', 'المحكمة'] },
    { key: 'court_number', headers: ['case number', 'case no', 'court case number', 'file number', 'رقم القضية', 'رقم الدعوى', 'رقم الملف'] },
    { key: 'opposing_party', headers: ['opponent', 'opposing party', 'other party', 'defendant', 'counterparty', 'الخصم', 'المدعى عليه', 'الطرف الآخر', 'الطرف الثاني'] },
    { key: 'practice_area', headers: ['practice area', 'area', 'category', 'case type', 'matter type', 'نوع القضية', 'المجال', 'التصنيف'] },
    { key: 'status', headers: ['status', 'state', 'الحالة', 'حالة القضية'] },
    { key: 'priority', headers: ['priority', 'الأولوية'] },
    { key: 'opened_on', headers: ['opened', 'opened on', 'open date', 'start date', 'date', 'date opened', 'تاريخ الفتح', 'تاريخ القيد', 'التاريخ', 'تاريخ البدء'] },
    { key: 'estimated_value', headers: ['value', 'amount', 'claim amount', 'claim value', 'estimated value', 'القيمة', 'قيمة المطالبة', 'المبلغ', 'قيمة الدعوى'] },
    { key: 'currency', headers: ['currency', 'العملة'] },
    { key: 'description', headers: ['description', 'details', 'notes', 'summary', 'الوصف', 'التفاصيل', 'ملاحظات', 'ملخص'] }
  ]
}

const norm = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Best column for each field: exact header match first, then a header containing a known name.
export function guessMapping(type: ImportType, headers: string[]): Record<string, number | null> {
  const used = new Set<number>()
  const out: Record<string, number | null> = {}
  const normalized = headers.map(norm)
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of IMPORT_FIELDS[type]) {
      if (out[f.key] != null) continue
      const names = f.headers.map(norm)
      const idx = normalized.findIndex((h, i) => !used.has(i) && h && (pass === 'exact' ? names.includes(h) : names.some((n) => n.length > 3 && h.includes(n))))
      if (idx >= 0) { out[f.key] = idx; used.add(idx) }
    }
  }
  for (const f of IMPORT_FIELDS[type]) out[f.key] ??= null
  return out
}

// ---------------- Value normalisation ----------------

const asciiDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

export function parseDate(raw: string): string | null {
  const s = asciiDigits(raw).trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  let y: number, m: number, d: number
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])] // Day first, as written across the region.
  else if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    // Excel serial date (days since 30 Dec 1899).
    const t = Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000
    return new Date(t).toISOString().slice(0, 10)
  } else return null
  const t = Date.UTC(y, m - 1, d)
  const out = new Date(t).toISOString().slice(0, 10)
  return y >= 1900 && y <= 2100 && new Date(t).getUTCMonth() === m - 1 ? out : null
}

export function parseAmount(raw: string): number | null {
  const s = asciiDigits(raw).replace(/٫/g, '.').replace(/[٬,\s]/g, '').replace(/[^\d.-]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const JURISDICTION_ALIASES: Record<string, string[]> = {
  oman: ['oman', 'om', 'muscat', 'عمان', 'سلطنة عمان', 'مسقط'],
  uae: ['uae', 'ae', 'emirates', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah', 'الامارات', 'دبي', 'ابوظبي', 'الشارقة'],
  ksa: ['ksa', 'sa', 'saudi', 'saudi arabia', 'riyadh', 'jeddah', 'السعوديه', 'المملكه العربيه السعوديه', 'الرياض', 'جده'],
  qatar: ['qatar', 'qa', 'doha', 'قطر', 'الدوحه'],
  kuwait: ['kuwait', 'kw', 'الكويت'],
  bahrain: ['bahrain', 'bh', 'manama', 'البحرين', 'المنامه'],
  egypt: ['egypt', 'eg', 'cairo', 'مصر', 'القاهره'],
  jordan: ['jordan', 'jo', 'amman', 'الاردن', 'عمان الاردن'],
  lebanon: ['lebanon', 'lb', 'beirut', 'لبنان', 'بيروت'],
  iraq: ['iraq', 'iq', 'baghdad', 'العراق', 'بغداد'],
  morocco: ['morocco', 'ma', 'المغرب'],
  tunisia: ['tunisia', 'tn', 'تونس'],
  algeria: ['algeria', 'dz', 'الجزاير'],
  libya: ['libya', 'ly', 'ليبيا']
}

export function parseJurisdiction(raw: string): string | null {
  const v = norm(raw)
  if (!v) return null
  for (const j of JURISDICTIONS) if (v === j.code || v === norm(j.name) || v === norm(j.name_ar)) return j.code
  for (const [code, names] of Object.entries(JURISDICTION_ALIASES)) if (names.some((n) => norm(n) === v)) return code
  for (const [code, names] of Object.entries(JURISDICTION_ALIASES)) if (names.some((n) => n.length > 3 && v.includes(norm(n)))) return code
  return null
}

const STATUS_WORDS: [string, string[]][] = [
  ['closed', ['closed', 'close', 'done', 'finished', 'completed', 'archived', 'won', 'lost', 'منتهيه', 'مغلقه', 'منتهي', 'مغلق', 'محفوظه', 'صدر الحكم']],
  ['on_hold', ['on hold', 'hold', 'suspended', 'stayed', 'موقوفه', 'معلقه مؤقتا', 'متوقفه']],
  ['pending', ['pending', 'new', 'waiting', 'قيد الانتظار', 'جديده', 'معلقه']],
  ['under_review', ['under review', 'review', 'قيد المراجعه', 'قيد الدراسه']],
  ['active', ['active', 'open', 'ongoing', 'in progress', 'جاريه', 'قيد النظر', 'مفتوحه', 'نشطه', 'متداوله']]
]
const PRIORITY_WORDS: [string, string[]][] = [
  ['urgent', ['urgent', 'critical', 'عاجل', 'عاجله', 'طارئ']],
  ['high', ['high', 'عاليه', 'مرتفعه', 'مهم']],
  ['low', ['low', 'منخفضه', 'عاديه']],
  ['medium', ['medium', 'normal', 'متوسطه']]
]
const pick = (raw: string, table: [string, string[]][]) => {
  const v = norm(raw)
  if (!v) return null
  for (const [key, words] of table) if (key.replace('_', ' ') === v || words.some((w) => norm(w) === v)) return key
  for (const [key, words] of table) if (words.some((w) => v.includes(norm(w)))) return key
  return undefined
}

export function parsePracticeArea(raw: string): string | null | undefined {
  const v = norm(raw)
  if (!v) return null
  for (const p of PRACTICE_AREAS) if (v === p.id || v === norm(p.name) || v === norm(p.name_ar)) return p.id
  for (const p of PRACTICE_AREAS) if (norm(p.name).split(' ').some((w) => w.length > 4 && v.includes(w)) || norm(p.name_ar).split(' ').some((w) => w.length > 3 && v.includes(w))) return p.id
  return undefined
}

const COMPANY_HINT = /\b(llc|l\.l\.c|saog|saoc|spc|ltd|limited|inc|co\.|company|corp|group|est|establishment|holding)\b|شركه|مؤسسه|ش م م|ش م ع|مجموعه|القابضه/i

// ---------------- Row validation ----------------

export type RowResult = { row: number; values: Record<string, unknown>; errors: string[]; warnings: string[] }

export function buildRows(type: ImportType, rows: string[][], mapping: Record<string, number | null>, defaults: { jurisdiction: string; currency: string }): RowResult[] {
  const cell = (r: string[], key: string) => (mapping[key] != null ? (r[mapping[key]!] ?? '').trim() : '')
  return rows.map((r, i) => {
    const errors: string[] = []
    const warnings: string[] = []
    const v: Record<string, unknown> = {}
    const text = (key: string, max: number) => {
      const s = cell(r, key)
      if (s.length > max) warnings.push(`${key} was shortened to ${max} characters`)
      return s ? s.slice(0, max) : null
    }
    if (type === 'clients') {
      v.name = text('name', 200)
      if (!v.name || String(v.name).length < 2) errors.push('Name is missing')
      v.name_ar = text('name_ar', 200)
      const kind = norm(cell(r, 'kind'))
      v.kind = /company|corporate|entity|شركه|مؤسسه|اعتباري/.test(kind) ? 'company' : kind ? 'individual' : COMPANY_HINT.test(normalizeText(`${v.name ?? ''} ${v.name_ar ?? ''}`)) ? 'company' : 'individual'
      const email = cell(r, 'email')
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push('Email is not valid and was left blank')
      v.email = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase().slice(0, 254) : null
      v.phone = text('phone', 60) && asciiDigits(String(text('phone', 60)))
      v.id_number = text('id_number', 80) && asciiDigits(String(text('id_number', 80)))
      v.address = text('address', 500)
      v.notes = text('notes', 5000)
    } else {
      v.title = text('title', 300)
      if (!v.title || String(v.title).length < 3) errors.push('Title is missing')
      v.title_ar = text('title_ar', 300)
      v.client = text('client', 200)
      const jRaw = cell(r, 'jurisdiction')
      const j = jRaw ? parseJurisdiction(jRaw) : defaults.jurisdiction
      if (!j) warnings.push(`Jurisdiction "${jRaw}" was not recognised; the firm default was used`)
      v.jurisdiction = j ?? defaults.jurisdiction
      v.court = text('court', 200)
      v.opposing_party = text('opposing_party', 300)
      const pa = parsePracticeArea(cell(r, 'practice_area'))
      if (pa === undefined) warnings.push(`Practice area "${cell(r, 'practice_area')}" was not recognised`)
      v.practice_area = pa ?? null
      const st = pick(cell(r, 'status'), STATUS_WORDS)
      if (st === undefined) warnings.push(`Status "${cell(r, 'status')}" was not recognised; set to active`)
      v.status = st ?? 'active'
      const pr = pick(cell(r, 'priority'), PRIORITY_WORDS)
      v.priority = pr ?? 'medium'
      const dRaw = cell(r, 'opened_on')
      v.opened_on = dRaw ? parseDate(dRaw) : null
      if (dRaw && !v.opened_on) warnings.push(`Date "${dRaw}" was not recognised; today was used`)
      const aRaw = cell(r, 'estimated_value')
      v.estimated_value = aRaw ? parseAmount(aRaw) : null
      if (aRaw && v.estimated_value == null) warnings.push(`Amount "${aRaw}" was not recognised`)
      const cur = cell(r, 'currency').toUpperCase().replace(/[^A-Z]/g, '')
      v.currency = (CURRENCIES as readonly string[]).includes(cur) ? cur : JURISDICTIONS.find((x) => x.code === v.jurisdiction)?.currency ?? defaults.currency
      const courtNo = text('court_number', 100)
      const desc = text('description', 9000)
      v.description = [courtNo ? `Court case no.: ${courtNo}` : '', desc ?? ''].filter(Boolean).join('\n') || null
    }
    return { row: i + 2, values: v, errors, warnings } // Row numbers as shown in Excel (header is row 1).
  })
}

// ---------------- Duplicates ----------------

export async function existingClients(q: Queryable, orgId: string) {
  const rows = await q.query<{ id: string; name: string; name_ar: string | null; email: string | null; id_number: string | null }>(
    'SELECT id, name, name_ar, email, id_number FROM clients WHERE org_id = $1', [orgId])
  const byName = new Map<string, string>()
  const byKey = new Map<string, string>()
  for (const c of rows) {
    byName.set(norm(c.name), c.id)
    if (c.name_ar) byName.set(norm(c.name_ar), c.id)
    if (c.email) byKey.set(`e:${c.email.toLowerCase()}`, c.id)
    if (c.id_number) byKey.set(`i:${norm(c.id_number)}`, c.id)
  }
  return {
    find(v: { name?: unknown; name_ar?: unknown; email?: unknown; id_number?: unknown }): string | undefined {
      return (v.email ? byKey.get(`e:${String(v.email).toLowerCase()}`) : undefined)
        ?? (v.id_number ? byKey.get(`i:${norm(String(v.id_number))}`) : undefined)
        ?? (v.name ? byName.get(norm(String(v.name))) : undefined)
        ?? (v.name_ar ? byName.get(norm(String(v.name_ar))) : undefined)
    },
    add(id: string, v: { name?: unknown; name_ar?: unknown; email?: unknown; id_number?: unknown }) {
      if (v.name) byName.set(norm(String(v.name)), id)
      if (v.name_ar) byName.set(norm(String(v.name_ar)), id)
      if (v.email) byKey.set(`e:${String(v.email).toLowerCase()}`, id)
      if (v.id_number) byKey.set(`i:${norm(String(v.id_number))}`, id)
    }
  }
}

export const caseKey = (title: unknown, clientId: string | null | undefined) => `${norm(String(title ?? ''))}|${clientId ?? ''}`

// A downloadable CSV template (UTF-8 with BOM so Excel shows Arabic correctly).
export function templateCsv(type: ImportType): string {
  const sample = type === 'clients'
    ? [['Name', 'Arabic name', 'Type', 'Email', 'Phone', 'Civil ID / CR', 'Address', 'Notes'],
       ['Gulf Trading LLC', 'شركة الخليج للتجارة', 'Company', 'legal@gulftrading.example', '+968 2400 0000', '1234567', 'Muscat', ''],
       ['Ahmed Al Balushi', 'أحمد البلوشي', 'Individual', '', '+968 9900 0000', '', '', '']]
    : [['Title', 'Client', 'Jurisdiction', 'Court', 'Case number', 'Opposing party', 'Practice area', 'Status', 'Priority', 'Opened', 'Claim amount', 'Currency', 'Description'],
       ['Unpaid invoices claim', 'Gulf Trading LLC', 'Oman', 'Muscat Primary Court', '123/2026', 'Al Noor Contracting', 'Commercial', 'Active', 'High', '15/09/2026', '12,500.000', 'OMR', ''],
       ['مطالبة عمالية', 'أحمد البلوشي', 'عمان', 'المحكمة الابتدائية بمسقط', '', 'شركة المثال', 'العمل والعمال', 'جارية', 'متوسطة', '2026-08-01', '', '', '']]
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return '﻿' + sample.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}
