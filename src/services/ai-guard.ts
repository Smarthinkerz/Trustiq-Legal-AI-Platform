import type { AiService, ChatMessage, Completion } from './ai'
import { normalizeText } from './library'
import { parseJsonObject } from './legal-prompts'

// ---------------------------------------------------------------------------
// Code checks on AI output, shared by every feature. The model is asked to return, next to each
// extracted value, the exact words of the source it read the value from ("evidence"). Code then
// checks that those words are in the source and that the value really follows from them. A value
// that cannot be proved is left empty for the lawyer, never guessed.
// ---------------------------------------------------------------------------

const AR_DIGITS = /[٠-٩۰-۹]/g
const latin = (s: string) => s.replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d) % 10))

// Text compared ignoring case, diacritics, letter variants, punctuation and spacing.
export const matchKey = (s: string) => normalizeText(latin(s)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Whether the quoted words appear in the source.
export function appearsIn(evidence: string | null | undefined, source: string): boolean {
  const e = matchKey(evidence ?? '')
  if (e.length < 2) return false
  return ` ${matchKey(source)} `.includes(` ${e} `) || matchKey(source).includes(e)
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
// Gregorian month names used in the Gulf and in the Levant, normalised (ة -> ه, أ -> ا, ى -> ي).
const AR_MONTHS: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'اغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  'كانون الثاني': 1, 'شباط': 2, 'اذار': 3, 'نيسان': 4, 'ايار': 5, 'حزيران': 6, 'تموز': 7, 'اب': 8, 'ايلول': 9, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الاول': 12
}
const HIJRI_MONTHS: Record<string, number> = {
  'محرم': 1, 'صفر': 2, 'ربيع الاول': 3, 'ربيع الثاني': 4, 'ربيع الاخر': 4, 'جمادي الاولي': 5, 'جمادي الاول': 5, 'جمادي الثانيه': 6, 'جمادي الاخره': 6, 'جمادي الاخر': 6,
  'رجب': 7, 'شعبان': 8, 'رمضان': 9, 'شوال': 10, 'ذو القعده': 11, 'ذي القعده': 11, 'ذو الحجه': 12, 'ذي الحجه': 12,
  'muharram': 1, 'safar': 2, 'rabi al awwal': 3, 'rabi al thani': 4, 'jumada al ula': 5, 'jumada al akhirah': 6, 'rajab': 7, 'shaban': 8, 'ramadan': 9, 'shawwal': 10, 'dhu al qadah': 11, 'dhu al hijjah': 12
}

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' })
function toHijri(t: number) {
  const parts = Object.fromEntries(hijriFmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]))
  return { y: Number(String(parts.year).replace(/\D/g, '')), m: Number(parts.month), d: Number(parts.day) }
}

// Umm al-Qura Hijri date to Gregorian, by searching around an estimate (done in code, never by the model).
export function hijriToGregorian(y: number, m: number, d: number): string | null {
  if (!(y >= 1300 && y <= 1600 && m >= 1 && m <= 12 && d >= 1 && d <= 30)) return null
  const estimate = Date.UTC(622, 6, 16) + ((y - 1) * 354.367 + (m - 1) * 29.53 + (d - 1)) * 86_400_000
  for (let off = -45; off <= 45; off++) {
    const t = estimate + off * 86_400_000
    const h = toHijri(t)
    if (h.y === y && h.m === m && h.d === d) return new Date(t).toISOString().slice(0, 10)
  }
  return null
}

const isHijriText = (k: string) => /(^|\s)(ه|هـ|h|ah|hijri|هجري|هجريه)(\s|$)/.test(k) || Object.keys(HIJRI_MONTHS).some((n) => k.includes(n))

// Reads a date as written in a document (Arabic or English, Gregorian or Hijri) into YYYY-MM-DD.
// Numeric dates are read day first, as in the GCC. Returns null when the text is not one clear date.
export function parseDateText(text: string | null | undefined): string | null {
  if (!text) return null
  const raw = latin(text).replace(/هـ/g, ' هـ ')
  const k = matchKey(raw)
  const hijri = isHijriText(k)
  const make = (y: number, m: number, d: number) => {
    if (y < 100) y += y >= 50 ? 1900 : 2000
    if (hijri || y < 1600) return hijriToGregorian(y, m, d)
    return iso(y, m, d)
  }
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw)
  if (m) return make(+m[1]!, +m[2]!, +m[3]!)
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(raw)
  if (m) return make(+m[3]!, +m[2]!, +m[1]!)
  const names: [string, number][] = [
    ...EN_MONTHS.map((n, i) => [n, i + 1] as [string, number]), ...EN_MONTHS.map((n, i) => [n.slice(0, 3), i + 1] as [string, number]),
    ...Object.entries(hijri ? HIJRI_MONTHS : AR_MONTHS)
  ].sort((a, b) => b[0].length - a[0].length)
  for (const [name, month] of names) {
    const re = new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(?:من\\s+)?${name}(?:\\s+(?:سنه|عام|لسنه|لعام))?\\s*,?\\s+(\\d{2,4})|(?:^|\\s)${name}\\s+(\\d{1,2})\\s*,?\\s+(\\d{4})`)
    const g = re.exec(` ${k} `)
    if (g) return g[1] ? make(+g[2]!, month, +g[1]!) : make(+g[4]!, month, +g[3]!)
  }
  return null
}

// Numbers written in words, as in Arabic notices ("خمسة عشر يوماً") and English ("fifteen days"). 1 to 999.
const AR_UNIT_WORDS: Record<string, number> = { 'واحد': 1, 'واحده': 1, 'احد': 1, 'احدي': 1, 'اثنان': 2, 'اثنين': 2, 'اثنا': 2, 'اثني': 2, 'ثلاثه': 3, 'ثلاث': 3, 'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5, 'سته': 6, 'ست': 6, 'سبعه': 7, 'سبع': 7, 'ثمانيه': 8, 'ثماني': 8, 'ثمان': 8, 'تسعه': 9, 'تسع': 9 }
const AR_TENS_WORDS: Record<string, number> = { 'عشره': 10, 'عشر': 10, 'عشرون': 20, 'عشرين': 20, 'ثلاثون': 30, 'ثلاثين': 30, 'اربعون': 40, 'اربعين': 40, 'خمسون': 50, 'خمسين': 50, 'ستون': 60, 'ستين': 60, 'سبعون': 70, 'سبعين': 70, 'ثمانون': 80, 'ثمانين': 80, 'تسعون': 90, 'تسعين': 90 }
const AR_SINGLE: Record<string, number> = { 'يوم': 1, 'يوما': 1, 'يومان': 2, 'يومين': 2, 'شهر': 1, 'شهرا': 1, 'شهران': 2, 'شهرين': 2 }
const AR_HUNDREDS: Record<string, number> = { 'مايه': 100, 'ميه': 100, 'مئه': 100, 'مائه': 100, 'مايتان': 200, 'مئتان': 200, 'مائتين': 200, 'مئتين': 200, 'ثلاثمايه': 300, 'ثلاثمئه': 300, 'اربعمايه': 400, 'خمسمايه': 500, 'خمسمئه': 500 }
const EN_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 }

export function numberWords(text: string): number | null {
  const words = matchKey(text).split(' ').map((w) => (w.startsWith('و') && !AR_UNIT_WORDS[w] && !AR_TENS_WORDS[w] ? w.slice(1) : w))
  let total = 0
  let seen = false
  for (const w of words) {
    if (AR_HUNDREDS[w] !== undefined) { total += AR_HUNDREDS[w]!; seen = true }
    else if (AR_UNIT_WORDS[w] !== undefined) { total += AR_UNIT_WORDS[w]!; seen = true }
    else if (AR_TENS_WORDS[w] !== undefined) { total += AR_TENS_WORDS[w]!; seen = true }
    else if (!seen && AR_SINGLE[w] !== undefined) { return AR_SINGLE[w]! }
    else if (EN_WORDS[w] !== undefined) { total = w === 'hundred' ? Math.max(total, 1) * 100 : total + EN_WORDS[w]!; seen = true }
    else if (seen) break
  }
  return seen && total > 0 ? total : null
}

// A plain number written in the text ("1,250.500", "١٢٥٠٫٥", "OMR 3 500"), or in words.
export function parseNumberText(text: string | null | undefined): number | null {
  if (!text) return null
  if (!/[\d٠-٩۰-۹]/.test(text)) return numberWords(text)
  const t = latin(text).replace(/٫/g, '.').replace(/٬/g, ',')
  const m = /\d[\d,\s]*(?:\.\d+)?/.exec(t)
  if (!m) return null
  const n = Number(m[0].replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export type FieldKind = 'date' | 'number' | 'integer' | 'text'
export type GuardResult<T> = { fields: T; unverified: string[]; verified: string[]; corrected: string[] }

// Keeps each listed field only if its evidence is in the source and the value follows from the evidence.
export function verifyFields<T extends Record<string, any>>(fields: T, evidence: Record<string, unknown> | null | undefined, source: string, spec: Record<string, FieldKind>): GuardResult<T> {
  const out: Record<string, any> = { ...fields }
  const unverified: string[] = []
  const verified: string[] = []
  const corrected: string[] = []
  const ev = evidence && typeof evidence === 'object' ? evidence : {}
  for (const [key, kind] of Object.entries(spec)) {
    const value = out[key]
    if (value === '' || value === null || value === undefined) continue
    const quote = typeof ev[key] === 'string' ? (ev[key] as string).trim() : typeof ev[key] === 'number' ? String(ev[key]) : ''
    let ok = !!quote && appearsIn(quote, source)
    if (ok && kind === 'date') {
      // The date is read from the quoted words by code (including Hijri conversion), not taken from the model.
      const parsed = parseDateText(quote)
      ok = !!parsed
      if (parsed && parsed !== value) { corrected.push(key); out[key] = parsed }
    }
    if (ok && (kind === 'number' || kind === 'integer')) ok = parseNumberText(quote) === Number(value)
    if (ok && kind === 'text') ok = appearsIn(String(value), source) || matchKey(quote).includes(matchKey(String(value)))
    if (ok) verified.push(key)
    else { unverified.push(key); out[key] = typeof value === 'number' ? null : '' }
  }
  return { fields: out as T, unverified, verified, corrected }
}

// Calls the model for a JSON extraction, verifies the listed fields against the source, and when a
// critical field fails, asks once more with the failures named. Fields still unproved are left empty.
export async function extractWithEvidence<T extends Record<string, any>>(o: {
  ai: AiService
  messages: ChatMessage[]
  normalize: (raw: any) => T
  spec: Record<string, FieldKind>
  source: string
  critical?: string[]
  maxTokens: number
}): Promise<GuardResult<T> & { completions: Completion[]; raw: any }> {
  const completions: Completion[] = []
  const run = async (messages: ChatMessage[]) => {
    const c = await o.ai.complete({ messages, json: true, maxTokens: o.maxTokens, temperature: 0 })
    completions.push(c)
    const raw = parseJsonObject(c.text)
    return { c, raw, checked: verifyFields(o.normalize(raw), raw?.evidence, o.source, o.spec) }
  }
  let r = await run(o.messages)
  const failed = r.checked.unverified.filter((k) => !o.critical || o.critical.includes(k))
  if (failed.length) {
    try {
      const again = await run([...o.messages, { role: 'assistant', content: r.c.text },
        { role: 'user', content: `Code could not find these values word for word in the document: ${failed.join(', ')}. Read the document again. For each, copy the exact words into "evidence", or leave the field empty if the document does not state it. Return the full JSON again.` }])
      // Keep the second reading only if it proves at least as much and fails less.
      if (again.checked.verified.length >= r.checked.verified.length && again.checked.unverified.length < r.checked.unverified.length) r = again
    } catch { /* keep the first reading; its unproved fields are already empty */ }
  }
  return { ...r.checked, completions, raw: r.raw }
}

// A Verification-shaped record of a field check, for the AI use log.
export function fieldCheckRecord(r: { unverified: string[]; verified: string[]; corrected: string[] }, asOf: string) {
  const checks = [
    ...r.verified.map((k) => ({ kind: 'quote' as const, severity: 'info' as const, ok: true, code: 'field_verified', detail: `${k} found in the document.` })),
    ...r.corrected.map((k) => ({ kind: 'quote' as const, severity: 'info' as const, ok: true, code: 'field_recomputed', detail: `${k} was recalculated by code from the date as written in the document.` })),
    ...r.unverified.map((k) => ({ kind: 'quote' as const, severity: 'warning' as const, ok: false, code: 'field_not_found', detail: `${k} could not be found in the document and was left empty.` }))
  ]
  return {
    status: (r.unverified.length ? 'passed_with_warnings' : r.verified.length ? 'passed' : 'unverified') as 'passed' | 'passed_with_warnings' | 'unverified',
    as_of: asOf, checked_at: new Date().toISOString(), citations: 0, errors: 0, warnings: r.unverified.length, checks
  }
}

// Evidence instructions added to extraction prompts.
export const EVIDENCE_RULE = `- In "evidence", copy for each filled field the exact words from the document you read it from (for a date, the date exactly as written, including any Hijri marker). Code checks every value against these words and drops any it cannot find.`

// Every date written in a text (numeric, or day + month name + year, Arabic or English), as YYYY-MM-DD.
export function datesIn(text: string): { raw: string; date: string }[] {
  const t = latin(text).replace(/[\u2066-\u2069\u200e\u200f]/g, '')
  const out: { raw: string; date: string }[] = []
  const seen = new Set<string>()
  const add = (raw: string) => { const d = parseDateText(raw); if (d && !seen.has(`${raw}|${d}`)) { seen.add(`${raw}|${d}`); out.push({ raw, date: d }) } }
  for (const m of t.matchAll(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g)) add(m[0])
  for (const m of t.matchAll(/(\d{1,2})\s+(?:من\s+)?([\p{L}]+(?:\s+[\p{L}]+)?)\s*,?\s+(\d{4})(\s*هـ)?/gu)) add(m[0])
  for (const m of t.matchAll(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/g)) add(m[0])
  return out
}

export const ABSTAIN = {
  en: 'I could not find this in the available sources.',
  ar: 'لم أجد هذا في المصادر المتاحة.'
}
