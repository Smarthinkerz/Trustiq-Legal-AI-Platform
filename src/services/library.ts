import type { Queryable } from '../db'
import { applyArticleFlags, articleNumber, mentionedArticles as mentionedArticleNumbers, validityOn } from './legal-corpus'

// ---------------------------------------------------------------------------
// Text normalisation shared by indexing and querying.
// Postgres' built-in dictionaries have no Arabic stemmer, so we normalise in the
// app and index with the 'simple' configuration.
// ---------------------------------------------------------------------------

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g
const TATWEEL = /ـ/g
const ARABIC_DIGITS = /[٠-٩]/g
const PERSIAN_DIGITS = /[۰-۹]/g

const AR_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال']
const AR_SUFFIXES = ['ات', 'ون', 'ين', 'ان', 'ها', 'هم', 'ية', 'ه']
const EN_STOP = new Set('a an the of to in on for and or is are was were be by with as at from that this which what how who whom when where why do does did can could should would may might shall will under per into about any all not no'.split(' '))
const AR_STOP = new Set(['في', 'من', 'على', 'الى', 'عن', 'او', 'و', 'ما', 'هل', 'هي', 'هو', 'التي', 'الذي', 'ذلك', 'هذا', 'هذه', 'كل', 'اي', 'ان', 'لا', 'مع', 'بين', 'كيف', 'متى', 'لماذا', 'قد', 'تم'])

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
}

const isArabic = (w: string) => /[؀-ۿ]/.test(w)

function stem(word: string): string {
  if (isArabic(word)) {
    let w = word
    for (const p of AR_PREFIXES) if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break }
    for (const s of AR_SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break }
    return w
  }
  // Light English stemming: plural and common verb endings.
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 5 && (word.endsWith('ing') || word.endsWith('ed'))) return word.replace(/(ing|ed)$/, '')
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map(stem)
}

// Text stored in the tsvector: stemmed tokens so that query and index match.
export const indexText = (text: string) => tokenize(text).join(' ')

export function buildTsQuery(question: string): string | null {
  const terms = [...new Set(tokenize(question).filter((w) => !EN_STOP.has(w) && !AR_STOP.has(w)))]
    .filter((w) => /^[\p{L}\p{N}]+$/u.test(w))
    .slice(0, 24)
  if (!terms.length) return null
  // OR of all terms with prefix matching; ranking decides relevance.
  return terms.map((t) => `${t}:*`).join(' | ')
}

// ---------------------------------------------------------------------------
// Segmentation: split a law into articles so citations can point at them.
// ---------------------------------------------------------------------------

const ARTICLE_HEADING = new RegExp(
  String.raw`^[\t ]*(?:` +
    String.raw`(?:article|art\.)\s*\(?\s*(\d+[a-z]?|[ivxlc]+)\s*\)?` + '|' +
    String.raw`(?:المادة|مادة)\s*\(?\s*([\d٠-٩]+|[؀-ۿ]+(?:\s+[؀-ۿ]+){0,3}?)\s*\)?(?=\s*[:\-–—\n]|\s*$)` +
  String.raw`)`,
  'gimu'
)

export type Segment = { label: string | null; text: string }

export function segmentLaw(text: string, maxChars = 2500): Segment[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  const matches = [...clean.matchAll(ARTICLE_HEADING)].filter((m) => m.index !== undefined)
  const segments: Segment[] = []
  if (matches.length >= 2) {
    const preamble = clean.slice(0, matches[0].index).trim()
    if (preamble.length > 40) segments.push({ label: null, text: preamble })
    matches.forEach((m, i) => {
      const end = i + 1 < matches.length ? matches[i + 1].index! : clean.length
      const body = clean.slice(m.index, end).trim()
      const label = m[0].trim().replace(/\s+/g, ' ').replace(/[:\-–—]\s*$/, '')
      for (const piece of splitLong(body, maxChars)) segments.push({ label, text: piece })
    })
    return segments
  }
  // No article structure (e.g. a judgment): chunk by paragraphs.
  let buf = ''
  for (const para of clean.split(/\n\s*\n/)) {
    if (buf && buf.length + para.length > maxChars) {
      segments.push({ label: null, text: buf.trim() })
      buf = ''
    }
    buf += para + '\n\n'
  }
  if (buf.trim()) segments.push({ label: null, text: buf.trim() })
  return segments.flatMap((s) => splitLong(s.text, maxChars).map((t) => ({ label: s.label, text: t })))
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('. ', maxChars)
    if (cut < maxChars * 0.5) cut = maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export async function indexSource(q: Queryable, sourceId: string, orgId: string | null, text: string): Promise<number> {
  await q.query('DELETE FROM library_chunks WHERE source_id = $1', [sourceId])
  const segments = segmentLaw(text)
  // Batch inserts to keep large laws fast.
  for (let i = 0; i < segments.length; i += 100) {
    const batch = segments.slice(i, i + 100)
    const params: unknown[] = []
    const rows = batch.map((s, j) => {
      params.push(sourceId, orgId, i + j, s.label, s.text, indexText(`${s.label ?? ''} ${s.text}`), articleNumber(s.label))
      const b = params.length - 7
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, to_tsvector('simple', $${b + 6}), $${b + 7})`
    })
    await q.query(`INSERT INTO library_chunks (source_id, org_id, ordinal, label, text, search, article_no) VALUES ${rows.join(', ')}`, params)
  }
  await applyArticleFlags(q, sourceId)
  const articles = segments.filter((s) => s.label).length
  await q.query('UPDATE library_sources SET articles = $2, updated_at = now() WHERE id = $1', [sourceId, articles || segments.length])
  return segments.length
}

export type Passage = {
  id: string
  source_id: string
  label: string | null
  text: string
  title: string
  number: string | null
  year: number | null
  kind: string
  status: string
  jurisdiction: string
  article_no: string | null
  article_status: string
  changed_on: string | null
  effective_from: string | null
  effective_to: string | null
  rank: number
}

export const PASSAGE_COLUMNS = `c.id, c.source_id, c.label, c.text, s.title, s.number, s.year, s.kind, s.status, s.jurisdiction,
  c.article_no, c.status AS article_status, to_char(c.changed_on, 'YYYY-MM-DD') AS changed_on,
  to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to`

export type SearchOpts = { jurisdictions?: string[]; limit?: number; sourceId?: string; asOf?: string }

// Scope shared by every library query: the firm's own library plus the shared one, optionally a jurisdiction,
// one source, and the versions in force on a date. Parameters start after `params`.
export function scopeFilter(params: unknown[], orgId: string, opts: SearchOpts) {
  params.push(orgId)
  let sql = `(s.org_id = $${params.length} OR s.org_id IS NULL)`
  if (opts.jurisdictions?.length) { params.push(opts.jurisdictions); sql += ` AND s.jurisdiction = ANY($${params.length})` }
  if (opts.sourceId) { params.push(opts.sourceId); sql += ` AND s.id = $${params.length}` }
  if (opts.asOf) {
    params.push(opts.asOf)
    sql += ` AND (s.effective_from IS NULL OR s.effective_from <= $${params.length}::date) AND (s.effective_to IS NULL OR s.effective_to > $${params.length}::date)`
  }
  return sql
}

// Whether a passage was out of force on the date (or, with no date, is marked repealed today).
export function outOfForce(p: Pick<Passage, 'status' | 'article_status' | 'changed_on' | 'effective_from' | 'effective_to'>, asOf?: string) {
  if (!asOf) return p.status === 'repealed' || p.article_status === 'repealed'
  return !validityOn(p, { status: p.article_status, changed_on: p.changed_on }, asOf).in_force
}

const BM25_K1 = 1.2
const BM25_B = 0.75
const statsCache = new Map<string, { at: number; n: number; avgdl: number }>()

// Okapi BM25 over the visible library. Postgres finds the candidates (any query term, GIN index);
// document frequencies come from the same scope, and term frequencies from the passage text.
export async function searchLibrary(q: Queryable, orgId: string, question: string, opts: SearchOpts = {}): Promise<Passage[]> {
  const tsq = buildTsQuery(question)
  if (!tsq) return []
  const terms = tsq.split(' | ').map((t) => t.replace(/:\*$/, ''))
  const params: unknown[] = []
  const scope = scopeFilter(params, orgId, opts)
  params.push(tsq)
  const tsqParam = `$${params.length}`
  const candidates = await q.query<Passage & { lexemes: number }>(
    `SELECT ${PASSAGE_COLUMNS}, length(c.search) AS lexemes
       FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
      WHERE ${scope} AND c.search @@ to_tsquery('simple', ${tsqParam})
      ORDER BY ts_rank_cd(c.search, to_tsquery('simple', ${tsqParam})) DESC LIMIT 200`, params)
  if (!candidates.length) return []

  // Corpus statistics for this scope, cached briefly.
  const key = `${orgId}|${(opts.jurisdictions ?? []).join(',')}|${opts.sourceId ?? ''}|${opts.asOf ?? ''}`
  let stats = statsCache.get(key)
  if (!stats || Date.now() - stats.at > 5 * 60_000) {
    const p: unknown[] = []
    const sc = scopeFilter(p, orgId, opts)
    const [row] = await q.query(`SELECT count(*)::int AS n, COALESCE(avg(length(c.search)), 1)::float AS avgdl FROM library_chunks c JOIN library_sources s ON s.id = c.source_id WHERE ${sc}`, p)
    stats = { at: Date.now(), n: Number(row.n), avgdl: Number(row.avgdl) || 1 }
    statsCache.set(key, stats)
    if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value!)
  }
  const dfParams: unknown[] = []
  const dfScope = scopeFilter(dfParams, orgId, opts)
  const dfSql = terms.map((t, k) => {
    dfParams.push(`${t}:*`)
    return `SELECT ${k} AS i, count(*)::int AS df FROM library_chunks c JOIN library_sources s ON s.id = c.source_id WHERE ${dfScope} AND c.search @@ to_tsquery('simple', $${dfParams.length})`
  }).join(' UNION ALL ')
  const dfRows = await q.query<{ i: number; df: number }>(dfSql, dfParams)
  const df = new Map(dfRows.map((r) => [terms[Number(r.i)]!, Number(r.df)]))

  const scored = candidates.map(({ lexemes, ...p }) => {
    const tokens = tokenize(`${p.label ?? ''} ${p.text}`)
    const dl = Number(lexemes) || tokens.length || 1
    let score = 0
    for (const t of terms) {
      const tf = tokens.reduce((n, w) => n + (w.startsWith(t) ? 1 : 0), 0)
      if (!tf) continue
      const d = df.get(t) ?? 1
      const idf = Math.log(1 + (stats!.n - d + 0.5) / (d + 0.5))
      score += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / stats!.avgdl))
    }
    // Repealed law still answers history questions, but ranks after law in force on the date.
    if (outOfForce(p, opts.asOf)) score *= 0.3
    return { ...p, rank: score }
  })
  return scored.sort((a, b) => b.rank - a.rank).slice(0, opts.limit ?? 8)
}

// ---------------------------------------------------------------------------
// Laws named by number in a question, e.g. "المرسوم السلطاني رقم ٤٨ / ٢٠٠٩",
// "Royal Decree 6/2022", "القانون رقم 35 لسنة 2003" or "32/97".
// ---------------------------------------------------------------------------

export type LawRef = { number: string; years: string[] }

const fullYear = (y: string) => (y.length === 4 ? y : Number(y) >= 50 ? `19${y}` : `20${y}`)

export function lawReferences(text: string, max = 3): LawRef[] {
  const t = normalizeText(text)
  const out = new Map<string, LawRef>()
  const add = (num: string, year: string) => {
    const n = String(Number(num))
    const y = fullYear(year)
    if (Number(y) < 1950 || Number(y) > 2100 || n === '0') return
    // Omani decrees before 2000 are usually written with a two-digit year (32/97).
    const years = [...new Set([y, y.slice(2)])]
    out.set(`${n}/${y}`, { number: n, years })
  }
  for (const m of t.matchAll(/(?<![\d/])(\d{1,4})\s*[/\\]\s*(\d{4}|\d{2})(?![\d/])/g)) {
    // "2009/48" is year-first; "48/2009" and "32/97" are number-first.
    if (m[1]!.length === 4 && m[2]!.length < 4) add(m[2]!, m[1]!)
    else add(m[1]!, m[2]!)
  }
  for (const m of t.matchAll(/(?:رقم|no\.?|number)\s*\(?\s*(\d{1,4})\s*\)?\s*(?:لسنه|لعام|of|for)\s*(\d{4})/g)) add(m[1]!, m[2]!)
  return [...out.values()].slice(0, max)
}

const DIGITS_FROM = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'
const DIGITS_TO = '01234567890123456789'

// Finds library laws whose number or title carries one of the referenced numbers.
export async function findReferencedSources(q: Queryable, orgId: string, refs: LawRef[]): Promise<{ id: string; title: string }[]> {
  if (!refs.length) return []
  const params: unknown[] = [orgId, DIGITS_FROM, DIGITS_TO]
  const conds = refs.map((r) => {
    const years = r.years.join('|')
    params.push(`(^|[^0-9])0*${r.number}\\s*/\\s*(${years})([^0-9]|$)|(^|[^0-9])(${years})\\s*/\\s*0*${r.number}([^0-9]|$)`)
    const p = `$${params.length}`
    return `translate(s.title, $2, $3) ~ ${p} OR coalesce(s.number, '') ~ ${p}`
  })
  // Prefer the law whose title starts with the reference over later laws that merely amend it.
  return q.query(
    `SELECT s.id, s.title FROM library_sources s
      WHERE (s.org_id = $1 OR s.org_id IS NULL) AND (${conds.join(' OR ')})
      ORDER BY (s.title ~* '(تعديل|amend)') ASC, length(s.title) ASC LIMIT 3`,
    params)
}

// Passages from one named law: its opening (title and preamble) plus the parts that best match the question.
export async function referencedPassages(q: Queryable, orgId: string, sourceId: string, question: string, limit = 8): Promise<Passage[]> {
  const select = `SELECT ${PASSAGE_COLUMNS}, 1 AS rank
       FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
      WHERE c.source_id = $1 AND (s.org_id = $2 OR s.org_id IS NULL)`
  const opening = await q.query<Passage>(`${select} ORDER BY c.ordinal LIMIT 4`, [sourceId, orgId])
  // Articles named in the question ("Article 12 of Royal Decree 6/2022") come straight after the opening.
  const named = mentionedArticleNumbers(question)
  const articles = named.length ? await q.query<Passage>(`${select} AND c.article_no = ANY($3) ORDER BY c.ordinal LIMIT 6`, [sourceId, orgId, named]) : []
  const matched = await searchLibrary(q, orgId, question, { sourceId, limit })
  const seen = new Set<string>()
  return [...opening, ...articles, ...matched].filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, limit)
}

export function citationLabel(p: Pick<Passage, 'title' | 'number' | 'year' | 'label'>) {
  // "35/2003" already carries its year; "35" with year 2003 becomes "No. 35/2003".
  const hasYear = !!p.number && !!p.year && String(p.number).includes(String(p.year))
  const ref = p.number ? `No. ${p.number}${p.year && !hasYear ? `/${p.year}` : ''}` : p.year ? String(p.year) : ''
  return `${p.title}${ref ? ` (${ref})` : ''}${p.label ? ` – ${p.label}` : ''}`
}

// Returns the source refs (e.g. "S1") cited in an answer, supporting "[S1]", "[S1][S2]" and "[S1, S3]".
export function citedRefs(answer: string): Set<string> {
  const refs = new Set<string>()
  for (const m of answer.matchAll(/\[([^\]]{1,60})\]/g)) for (const r of m[1].matchAll(/S(\d{1,3})/g)) refs.add(`S${r[1]}`)
  return refs
}
