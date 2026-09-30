import type { Queryable } from '../db'

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
      params.push(sourceId, orgId, i + j, s.label, s.text, indexText(`${s.label ?? ''} ${s.text}`))
      const b = params.length - 6
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, to_tsvector('simple', $${b + 6}))`
    })
    await q.query(`INSERT INTO library_chunks (source_id, org_id, ordinal, label, text, search) VALUES ${rows.join(', ')}`, params)
  }
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
  rank: number
}

// Ranked retrieval across the organisation's private library and the shared platform library.
export async function searchLibrary(q: Queryable, orgId: string, question: string, opts: { jurisdictions?: string[]; limit?: number; sourceId?: string } = {}): Promise<Passage[]> {
  const tsq = buildTsQuery(question)
  if (!tsq) return []
  const params: unknown[] = [orgId, tsq]
  let filter = ''
  if (opts.jurisdictions?.length) {
    params.push(opts.jurisdictions)
    filter += ` AND s.jurisdiction = ANY($${params.length})`
  }
  if (opts.sourceId) {
    params.push(opts.sourceId)
    filter += ` AND s.id = $${params.length}`
  }
  params.push(opts.limit ?? 8)
  return q.query<Passage>(
    `SELECT c.id, c.source_id, c.label, c.text, s.title, s.number, s.year, s.kind, s.status, s.jurisdiction,
            ts_rank_cd(c.search, to_tsquery('simple', $2)) * CASE WHEN s.status = 'repealed' THEN 0.3 ELSE 1 END AS rank
       FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
      WHERE (s.org_id = $1 OR s.org_id IS NULL) AND c.search @@ to_tsquery('simple', $2) ${filter}
      ORDER BY rank DESC LIMIT $${params.length}`,
    params
  )
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
