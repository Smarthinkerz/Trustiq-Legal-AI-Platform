import type { Queryable } from '../db'
import { normalizeText } from './library'

// ---------------------------------------------------------------------------
// Versioned law library: article numbers, point-in-time validity, and links
// between instruments (amends, repeals, implements, replaces).
// "implements" links an implementing regulation to the law it implements, the
// confusion behind most fabricated GCC citations.
// ---------------------------------------------------------------------------

export const RELATIONS = ['amends', 'repeals', 'implements', 'replaces'] as const
export type Relation = (typeof RELATIONS)[number]

// Arabic ordinal article headings ("المادة الأولى") as numbers. Normalised spelling (ة -> ه, أ -> ا).
const AR_UNITS: Record<string, number> = {
  'الاولي': 1, 'الحاديه': 1, 'الثانيه': 2, 'الثالثه': 3, 'الرابعه': 4, 'الخامسه': 5, 'السادسه': 6, 'السابعه': 7, 'الثامنه': 8, 'التاسعه': 9, 'العاشره': 10
}
const AR_TENS: Record<string, number> = { 'عشره': 10, 'العشرون': 20, 'الثلاثون': 30, 'الاربعون': 40, 'الخمسون': 50 }

function arabicOrdinal(words: string): number | null {
  const parts = normalizeText(words).replace(/[()]/g, ' ').split(/\s+/).filter((w) => w && w !== 'و')
  if (!parts.length) return null
  let total = 0
  for (const raw of parts) {
    const w = raw.startsWith('و') && !AR_UNITS[raw] && !AR_TENS[raw] ? raw.slice(1) : raw
    if (AR_UNITS[w] !== undefined) total += AR_UNITS[w]!
    else if (AR_TENS[w] !== undefined) total += AR_TENS[w]!
    else if (w === 'عشر') total += 10
    else return total || null
  }
  return total || null
}

function roman(s: string): number | null {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  let total = 0
  const t = s.toLowerCase()
  for (let i = 0; i < t.length; i++) {
    const v = map[t[i]!]
    if (!v) return null
    const next = map[t[i + 1] ?? ''] ?? 0
    total += v < next ? -v : v
  }
  return total || null
}

// "Article 12", "Art. (12 bis)", "المادة (١٢)", "المادة الثانية عشرة", "Article IV" -> "12" / "4".
export function articleNumber(label: string | null | undefined): string | null {
  if (!label) return null
  const t = normalizeText(label)
  const digits = /(\d+)/.exec(t)
  if (digits) return String(Number(digits[1]))
  const ar = /(?:الماده|ماده)\s*\(?\s*([؀-ۿ\s]+)/.exec(t)
  if (ar) {
    const n = arabicOrdinal(ar[1]!)
    if (n) return String(n)
  }
  const r = /(?:article|art\.?)\s*\(?\s*([ivxlc]+)\b/.exec(t)
  if (r) {
    const n = roman(r[1]!)
    if (n) return String(n)
  }
  return null
}

// Article numbers mentioned in a sentence: "Article 12", "Articles 12 and 13", "المادة (12)", "المادتين 12 و13".
export function mentionedArticles(sentence: string): string[] {
  const t = normalizeText(sentence)
  const out = new Set<string>()
  for (const m of t.matchAll(/\b(?:articles?|art\.?)\s*\(?\s*(\d+)(?:\s*\)?\s*(?:,|and|&|to)\s*\(?\s*(\d+))?/g)) {
    out.add(String(Number(m[1])))
    if (m[2]) out.add(String(Number(m[2])))
  }
  for (const m of t.matchAll(/(?:^|[^؀-ۿ])[وبلف]{0,2}(?:ال)?(?:ماده|مواد|المادتين|المادتان|مادتين)\s*\(?\s*(\d+)(?:\s*\)?\s*(?:و|،|,|الي)\s*\(?\s*(\d+))?/g)) {
    out.add(String(Number(m[1])))
    if (m[2]) out.add(String(Number(m[2])))
  }
  for (const m of t.matchAll(/(?:^|[^؀-ۿ])[وبلف]{0,2}(?:ال)?ماده\s+((?:ال)?[؀-ۿ]+(?:\s+(?:و?ال)?[؀-ۿ]+)?)/g)) {
    const n = arabicOrdinal(m[1]!)
    if (n) out.add(String(n))
  }
  return [...out]
}

export type Validity = { in_force: boolean; reason: 'in_force' | 'not_yet_in_force' | 'repealed' | 'amended' | 'superseded'; date?: string | null }

const day = (d: string | Date | null | undefined) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null)

// Whether a source (and optionally one of its articles) applied on a date (YYYY-MM-DD).
export function validityOn(
  source: { status: string; effective_from?: string | Date | null; effective_to?: string | Date | null },
  article: { status?: string | null; changed_on?: string | Date | null } | null,
  asOf: string
): Validity {
  const from = day(source.effective_from)
  const to = day(source.effective_to)
  if (from && from > asOf) return { in_force: false, reason: 'not_yet_in_force', date: from }
  if (to && to <= asOf) return { in_force: false, reason: source.status === 'repealed' ? 'repealed' : 'superseded', date: to }
  if (source.status === 'repealed' && !to) return { in_force: false, reason: 'repealed', date: null }
  if (article?.status === 'repealed') {
    const on = day(article.changed_on)
    if (!on || on <= asOf) return { in_force: false, reason: 'repealed', date: on }
  }
  if (article?.status === 'amended' || source.status === 'amended') return { in_force: true, reason: 'amended', date: day(article?.changed_on) }
  return { in_force: true, reason: 'in_force' }
}

// Sets each article's status from the relations that target it (re-run after re-indexing).
export async function applyArticleFlags(q: Queryable, sourceId: string) {
  await q.query(`UPDATE library_chunks SET status = 'in_force', changed_on = NULL WHERE source_id = $1 AND status <> 'in_force'`, [sourceId])
  const rels = await q.query<{ relation: Relation; to_article: string; effective_on: string | null }>(
    `SELECT relation, to_article, effective_on FROM library_relations
      WHERE to_source_id = $1 AND to_article IS NOT NULL AND relation IN ('amends', 'repeals', 'replaces')
      ORDER BY (relation = 'amends') DESC, effective_on NULLS FIRST`, [sourceId])
  for (const r of rels) {
    const status = r.relation === 'amends' ? 'amended' : 'repealed'
    await q.query(
      `UPDATE library_chunks SET status = $3, changed_on = $4 WHERE source_id = $1 AND article_no = $2 AND (status <> 'repealed' OR $3 = 'repealed')`,
      [sourceId, articleNumber(`Article ${r.to_article}`) ?? r.to_article, status, r.effective_on])
  }
}

// Whole-instrument effects of a new relation: a repeal or replacement ends the target's validity.
export async function applySourceRelation(q: Queryable, rel: { from_source_id: string; to_source_id: string; relation: Relation; to_article: string | null; effective_on: string | null }) {
  if (rel.to_article) return applyArticleFlags(q, rel.to_source_id)
  if (rel.relation === 'repeals' || rel.relation === 'replaces') {
    await q.query(
      `UPDATE library_sources SET status = 'repealed', effective_to = COALESCE(effective_to, $2::date), updated_at = now() WHERE id = $1`,
      [rel.to_source_id, rel.effective_on])
  } else if (rel.relation === 'amends') {
    await q.query(`UPDATE library_sources SET status = 'amended', updated_at = now() WHERE id = $1 AND status = 'in_force'`, [rel.to_source_id])
  }
  if (rel.relation === 'replaces') {
    // Versions of one instrument share a work id (the first version's id).
    await q.query(
      `WITH w AS (SELECT COALESCE(work_id, id) AS id FROM library_sources WHERE id = $2)
       UPDATE library_sources SET work_id = (SELECT id FROM w) WHERE id IN ($1, $2)`, [rel.from_source_id, rel.to_source_id])
    await q.query(`UPDATE library_sources SET effective_from = COALESCE(effective_from, $2::date) WHERE id = $1`, [rel.from_source_id, rel.effective_on])
  }
}

export type LinkedInstrument = { id: string; title: string; number: string | null; kind: string; relation: Relation; direction: 'out' | 'in'; from_article: string | null; to_article: string | null; effective_on: string | null }

// Relations of the given sources that the viewer may see (own library plus the shared one).
export async function linkedInstruments(q: Queryable, orgId: string, sourceIds: string[]): Promise<Map<string, LinkedInstrument[]>> {
  const out = new Map<string, LinkedInstrument[]>()
  if (!sourceIds.length) return out
  const rows = await q.query(
    `SELECT r.from_source_id, r.to_source_id, r.relation, r.from_article, r.to_article, r.effective_on,
            f.title AS from_title, f.number AS from_number, f.kind AS from_kind, t.title AS to_title, t.number AS to_number, t.kind AS to_kind
       FROM library_relations r JOIN library_sources f ON f.id = r.from_source_id JOIN library_sources t ON t.id = r.to_source_id
      WHERE (r.from_source_id = ANY($2) OR r.to_source_id = ANY($2))
        AND (f.org_id = $1 OR f.org_id IS NULL) AND (t.org_id = $1 OR t.org_id IS NULL) AND (r.org_id = $1 OR r.org_id IS NULL)`,
    [orgId, sourceIds])
  const push = (id: string, v: LinkedInstrument) => { if (sourceIds.includes(id)) out.set(id, [...(out.get(id) ?? []), v]) }
  for (const r of rows) {
    const base = { relation: r.relation, from_article: r.from_article, to_article: r.to_article, effective_on: day(r.effective_on) }
    push(r.from_source_id, { ...base, id: r.to_source_id, title: r.to_title, number: r.to_number, kind: r.to_kind, direction: 'out' })
    push(r.to_source_id, { ...base, id: r.from_source_id, title: r.from_title, number: r.from_number, kind: r.from_kind, direction: 'in' })
  }
  return out
}

// One line telling the model what an instrument is and how it relates to others.
export function instrumentNote(kind: string, links: LinkedInstrument[] = []): string {
  const name = (l: LinkedInstrument) => `${l.title}${l.number ? ` (No. ${l.number})` : ''}`
  const parts: string[] = []
  const parents = links.filter((l) => l.relation === 'implements' && l.direction === 'out')
  const regs = links.filter((l) => l.relation === 'implements' && l.direction === 'in')
  if (parents.length) parts.push(`This is an implementing regulation of ${parents.map(name).join('; ')}, not the law itself; its article numbers are the regulation's own`)
  else if (['regulation', 'ministerial_decision'].includes(kind)) parts.push('This is a regulation or decision, not a law')
  if (regs.length) parts.push(`Implemented by ${regs.map(name).join('; ')} (separate article numbering)`)
  for (const l of links.filter((x) => x.direction === 'in' && (x.relation === 'repeals' || x.relation === 'replaces'))) {
    parts.push(`${l.to_article ? `Article ${l.to_article} ` : ''}${l.relation === 'replaces' ? 'replaced' : 'repealed'} by ${name(l)}${l.effective_on ? ` from ${l.effective_on}` : ''}`)
  }
  for (const l of links.filter((x) => x.direction === 'in' && x.relation === 'amends')) {
    parts.push(`${l.to_article ? `Article ${l.to_article} ` : ''}amended by ${name(l)}${l.effective_on ? ` from ${l.effective_on}` : ''}`)
  }
  return parts.join('. ')
}
