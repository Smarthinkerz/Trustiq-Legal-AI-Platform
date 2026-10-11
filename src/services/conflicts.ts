import type { Queryable } from '../db'

// ---------------------------------------------------------------------------
// Conflict-of-interest matching. Names are compared through a "skeleton" that
// Arabic and Latin spellings share (consonants only, common prefixes, honorifics
// and company suffixes removed), so "Mohammed Al-Balushi LLC", "Muhammad Balushi"
// and "محمد البلوشي" all match. Small spelling differences are tolerated.
// ---------------------------------------------------------------------------

const STOP = new Set([
  'al', 'el', 'bin', 'ben', 'bint', 'ibn', 'abu', 'mr', 'mrs', 'ms', 'dr', 'sheikh', 'shaikh', 'sh', 'the', 'and', 'of', 'for',
  'llc', 'saog', 'saoc', 'spc', 'co', 'company', 'est', 'establishment', 'trading', 'trd', 'group', 'holding', 'holdings', 'ltd',
  'limited', 'inc', 'corp', 'fze', 'fzc', 'fzco', 'fzllc', 'pjsc', 'psc', 'wll', 'llp', 'plc', 'sarl', 'sae', 'sal', 'jsc', 'partnership',
  'بن', 'بنت', 'ابن', 'ابو', 'السيد', 'السيدة', 'الشيخ', 'الشيخة', 'شركة', 'شركه', 'مؤسسة', 'مؤسسه', 'مجموعة', 'مجموعه', 'للتجارة', 'للتجاره',
  'ذمم', 'شمعع', 'شمعم', 'شم', 'و', 'المحدودة', 'المحدوده', 'القابضة', 'القابضه'
])

const AR: Record<string, string> = {
  'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'x', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'S',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'G', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'ة': 'h', 'و': 'w', 'ي': 'y', 'ى': 'y', 'ئ': 'y', 'ؤ': 'w', 'پ': 'b', 'چ': 'S', 'گ': 'j', 'ڤ': 'f'
}

function latinSkeleton(w: string) {
  let s = w.replace(/sh|ch/g, 'S').replace(/kh/g, 'x').replace(/gh/g, 'G').replace(/th|dh/g, (m) => (m === 'th' ? 't' : 'd'))
    .replace(/ph/g, 'f').replace(/[qc]/g, 'k').replace(/g/g, 'j').replace(/v/g, 'f').replace(/[ou]{2}|oo/g, 'w')
  // Vowels are not written in Arabic; y and w are kept only at the start of a word.
  s = s[0] + s.slice(1).replace(/[aeiouyw]/g, '')
  s = s.replace(/^[aeiou]/, '')
  return s
}

function arabicSkeleton(w: string) {
  let out = ''
  for (const [i, ch] of [...w].entries()) {
    const m = AR[ch]
    if (!m) continue
    // و and ي are long vowels inside a word.
    if ((m === 'w' || m === 'y') && i > 0) continue
    out += m
  }
  return out
}

export function nameTokens(name: string): string[] {
  const text = name.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ْـ]/g, '') // tashkeel and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
  const out: string[] = []
  for (let w of text.split(' ').filter(Boolean)) {
    if (STOP.has(w)) continue
    const arabic = /[؀-ۿ]/.test(w)
    if (arabic) {
      if (w.startsWith('ال') && w.length > 3) w = w.slice(2)
      if (w.startsWith('وال') && w.length > 4) w = w.slice(3)
      if (STOP.has(w)) continue
      w = w.replace(/ة$/, '') // taa marbuta is a vowel ending (فاطمة = Fatima)
    } else if (/^(al|el)[a-z]{3,}$/.test(w)) w = w.slice(2)
    let s = arabic ? arabicSkeleton(w) : /^\d+$/.test(w) ? w : latinSkeleton(w)
    s = s.replace(/(.)\1+/g, '$1') // doubled letters
    if (s.length >= 4) s = s.replace(/h$/, '') // final h / ة (Fatima, فاطمة, Fatimah)
    if (s) out.push(s)
  }
  return out
}

function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length]
}

const tokenMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1)

// 0..1: the share of the shorter name's tokens found in the other name.
export function nameScore(a: string | string[], b: string | string[]) {
  const ta = Array.isArray(a) ? a : nameTokens(a)
  const tb = Array.isArray(b) ? b : nameTokens(b)
  if (!ta.length || !tb.length) return 0
  if (ta.join(' ') === tb.join(' ')) return 1
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const hits = short.filter((t) => long.some((u) => tokenMatch(t, u))).length
  // A single shared word is only a match when the shorter name is that one word and it is distinctive.
  if (short.length === 1 && (hits === 0 || short[0].length < 3)) return 0
  return hits / short.length
}

export const MATCH_THRESHOLD = 0.75
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
// Opposing-party fields often list several parties.
export const splitParties = (s: string | null | undefined) =>
  (s ?? '').split(/\s*(?:,|;|\/|\n|\band\b|&|\s+و\s+|،)\s*/i).map((p) => p.trim()).filter((p) => p.length >= 2)

export type ConflictQuery = { names: string[]; idNumber?: string | null; email?: string | null; phone?: string | null; excludeClientId?: string | null; excludeCaseId?: string | null }
export type ClientMatch = { id: string; name: string; name_ar: string | null; id_number: string | null; archived_at: unknown; reason: 'name' | 'id_number' | 'email' | 'phone'; score: number }
export type CaseMatch = { id: string; reference: string; title: string; status: string; client_id: string | null; client_name: string | null; opposing_party: string; matched_party: string; score: number }

export async function findConflicts(db: Queryable, orgId: string, q: ConflictQuery) {
  const names = q.names.map((n) => n?.trim()).filter((n): n is string => !!n && n.length >= 2)
  const tokens = names.map(nameTokens).filter((t) => t.length)
  const [clients, cases] = await Promise.all([
    db.query(`SELECT id, name, name_ar, id_number, email, phone, archived_at FROM clients WHERE org_id = $1 AND ($2::uuid IS NULL OR id <> $2)`, [orgId, q.excludeClientId ?? null]),
    db.query(
      `SELECT k.id, k.reference, k.title, k.status, k.client_id, k.opposing_party, cl.name AS client_name FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id
        WHERE k.org_id = $1 AND k.opposing_party IS NOT NULL AND k.opposing_party <> '' AND ($2::uuid IS NULL OR k.id <> $2)`, [orgId, q.excludeCaseId ?? null])
  ])
  const best = (cand: string[]) => Math.max(0, ...tokens.flatMap((t) => cand.filter(Boolean).map((c) => nameScore(t, c))))
  const clientMatches: ClientMatch[] = []
  for (const c of clients) {
    const base = { id: c.id, name: c.name, name_ar: c.name_ar, id_number: c.id_number, archived_at: c.archived_at }
    if (q.idNumber && digits(q.idNumber).length >= 4 && digits(c.id_number) === digits(q.idNumber)) clientMatches.push({ ...base, reason: 'id_number', score: 1 })
    else if (q.email && c.email && c.email.toLowerCase() === q.email.trim().toLowerCase()) clientMatches.push({ ...base, reason: 'email', score: 1 })
    else if (q.phone && digits(q.phone).length >= 7 && digits(c.phone).endsWith(digits(q.phone).slice(-8))) clientMatches.push({ ...base, reason: 'phone', score: 1 })
    else {
      const s = best([c.name, c.name_ar])
      if (s >= MATCH_THRESHOLD) clientMatches.push({ ...base, reason: 'name', score: s })
    }
  }
  const caseMatches: CaseMatch[] = []
  for (const k of cases) {
    let top = { s: 0, p: '' }
    for (const p of splitParties(k.opposing_party)) {
      const s = best([p])
      if (s > top.s) top = { s, p }
    }
    if (top.s >= MATCH_THRESHOLD) caseMatches.push({ id: k.id, reference: k.reference, title: k.title, status: k.status, client_id: k.client_id, client_name: k.client_name, opposing_party: k.opposing_party, matched_party: top.p, score: top.s })
  }
  clientMatches.sort((a, b) => b.score - a.score)
  caseMatches.sort((a, b) => b.score - a.score)
  return { clients: clientMatches.slice(0, 20), cases: caseMatches.slice(0, 20) }
}

// ---------------- Intake enforcement ----------------

export type Blocking = { type: 'client_is_opposing' | 'opposing_is_client'; label: string; id: string; reference?: string; detail: string }

// New client or a case's client: is this person an opposing party in another matter?
export async function opposingConflicts(db: Queryable, orgId: string, names: (string | null | undefined)[], excludeCaseId?: string | null): Promise<Blocking[]> {
  const r = await findConflicts(db, orgId, { names: names.filter(Boolean) as string[], excludeCaseId })
  return r.cases.map((k) => ({ type: 'client_is_opposing', label: `${k.reference} · ${k.title}`, id: k.id, reference: k.reference, detail: k.matched_party }))
}

// A case's opposing parties: is any of them already a client of the firm?
export async function clientConflicts(db: Queryable, orgId: string, opposing: string | null | undefined, excludeClientId?: string | null): Promise<Blocking[]> {
  const parties = splitParties(opposing)
  if (!parties.length) return []
  const r = await findConflicts(db, orgId, { names: parties, excludeClientId })
  return r.clients.filter((m) => m.reason === 'name').map((m) => ({ type: 'opposing_is_client', label: m.name, id: m.id, detail: m.name_ar ?? m.name }))
}

export async function logConflictCheck(db: Queryable, v: {
  orgId: string; userId: string; subjectType: 'client' | 'case'; subjectId: string; subjectName: string; matches: Blocking[]; decision: 'clear' | 'override'; reason?: string | null
}) {
  await db.query(
    `INSERT INTO conflict_checks (org_id, user_id, subject_type, subject_id, subject_name, matches, decision, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [v.orgId, v.userId, v.subjectType, v.subjectId, v.subjectName.slice(0, 300), JSON.stringify(v.matches), v.decision, v.reason ?? null])
}
