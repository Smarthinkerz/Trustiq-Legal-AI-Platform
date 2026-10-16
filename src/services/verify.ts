import type { Queryable } from '../db'
import { citedRefs, lawReferences, type LawRef, normalizeText } from './library'
import { linkedInstruments, mentionedArticles, validityOn } from './legal-corpus'

// ---------------------------------------------------------------------------
// Deterministic citation check run on every AI answer after generation. No model is involved:
//   - every quoted passage must appear word for word in the cited source;
//   - every article number stated next to a citation must exist in that source;
//   - an article that exists only in a linked instrument (the law versus its implementing
//     regulation) is reported as an instrument confusion;
//   - every cited source must have been in force on the relevant date;
//   - every cited source must belong to the matter's jurisdiction;
//   - citations to unknown references and laws named by number but absent from the sources are flagged.
// ---------------------------------------------------------------------------

export type VerifySource = {
  ref: string
  chunk_id: string
  source_id: string
  citation: string
  text: string
  title: string
  number: string | null
  jurisdiction: string
  kind: string
  status: string
  article_no: string | null
  article_status: string
  changed_on: string | null
  effective_from: string | null
  effective_to: string | null
}

export type CheckKind = 'quote' | 'article' | 'instrument' | 'in_force' | 'jurisdiction' | 'reference' | 'law_reference' | 'uncited_article' | 'source_text' | 'figure' | 'date' | 'glossary' | 'truncated'
export type Check = { kind: CheckKind; severity: 'error' | 'warning' | 'info'; ok: boolean; ref?: string; code: string; detail: string; text?: string }
export type Verification = {
  status: 'passed' | 'passed_with_warnings' | 'failed' | 'unverified'
  as_of: string
  checked_at: string
  citations: number
  errors: number
  warnings: number
  checks: Check[]
}

// Normalised words for comparison: diacritics, tatweel, alef/ya/ta marbuta variants and punctuation removed.
const words = (s: string) => normalizeText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

export function sentences(answer: string): string[] {
  return answer.split(/(?<=[.!?؟؛])\s+(?=[^\d(\[«"“])|\n+/).map((s) => s.trim()).filter(Boolean)
}

export function quotes(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/«([^»]{3,800})»|“([^”]{3,800})”|"([^"\n]{3,800})"|„([^“”]{3,800})[“”]/g)) {
    const q = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (q.split(/\s+/).length >= 3) out.push(q)
  }
  return out
}

// A quote matches when every part (split at an ellipsis) appears in order in the source.
export function quoteMatch(quote: string, source: string): 'exact' | 'normalized' | null {
  const parts = quote.split(/\.\.\.|…|\[\.\.\.\]/).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 2 || p.length > 12)
  if (!parts.length) return null
  const inOrder = (hay: string, needles: string[]) => {
    let at = 0
    for (const n of needles) {
      const i = hay.indexOf(n, at)
      if (i < 0) return false
      at = i + n.length
    }
    return true
  }
  if (inOrder(collapse(source), parts.map(collapse))) return 'exact'
  if (inOrder(` ${words(source)} `, parts.map((p) => words(p)))) return 'normalized'
  return null
}

const DIGITS: Record<string, string> = Object.fromEntries([...'٠١٢٣٤٥٦٧٨٩'].map((d, i) => [d, String(i)]).concat([...'۰۱۲۳۴۵۶۷۸۹'].map((d, i) => [d, String(i)])))
const latinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]!)

export function sourceMatchesLawRef(s: { title: string; number: string | null }, r: LawRef) {
  const years = r.years.join('|')
  const re = new RegExp(`(^|[^0-9])0*${r.number}\\s*/\\s*(${years})([^0-9]|$)|(^|[^0-9])(${years})\\s*/\\s*0*${r.number}([^0-9]|$)`)
  const num = latinDigits(s.number ?? '')
  // A bare number field ("6") with the year in the title ("... 2022") also counts.
  return re.test(latinDigits(s.title)) || re.test(num) || (num.replace(/^0+/, '') === r.number && r.years.some((y) => latinDigits(s.title).includes(y)))
}

const ABSENCE_WORDS = /does not exist|doesn't exist|no such article|no article|not found|is not in|does not contain|لا توجد|لا يوجد|غير موجود|ليست موجود|لم ترد|لا تتضمن|لا يتضمن/i
const REPEAL_WORDS = /repeal|no longer in force|superseded|replaced|ceased|not yet in force|الغي|ملغ|منسوخ|لم يعد|استبدل|حل محل|لم يدخل/i
const AMEND_WORDS = /amend|عدل|تعديل|معدل/i

export async function verifyAnswer(q: Queryable, opts: {
  orgId: string
  answer: string
  sources: VerifySource[]
  asOf: string
  allowedJurisdictions?: string[]
  namedSourceIds?: string[]
  // Drafts cite by law name and article ("Article 43 of the Labour Law") rather than [S1].
  implicitRefs?: boolean
}): Promise<Verification> {
  const checks: Check[] = []
  const byRef = new Map(opts.sources.map((s) => [s.ref, s]))
  const titleWords = (s: VerifySource) => words(s.title.replace(/\(.*?\)/g, ' '))
  const refsIn = (text: string): Set<string> => {
    if (!opts.implicitRefs) return citedRefs(text)
    const w = ` ${words(text)} `
    const laws = lawReferences(text, 20)
    return new Set(opts.sources.filter((s) => (titleWords(s).length > 3 && w.includes(` ${titleWords(s)} `)) || laws.some((r) => sourceMatchesLawRef(s, r))).map((s) => s.ref))
  }
  const refs = refsIn(opts.answer)
  const cited = [...refs].map((r) => byRef.get(r)).filter(Boolean) as VerifySource[]
  const sents = sentences(opts.answer)

  for (const r of refs) {
    if (!byRef.has(r)) checks.push({ kind: 'reference', severity: 'error', ok: false, ref: r, code: 'unknown_reference', detail: `[${r}] is cited but no such source was given to the model.` })
  }

  // Article numbers and full text of every cited source, and the instruments linked to them.
  const sourceIds = [...new Set(cited.map((s) => s.source_id))]
  const articleRows = sourceIds.length
    ? await q.query<{ source_id: string; article_no: string | null; text: string }>(
        `SELECT source_id, article_no, text FROM library_chunks WHERE source_id = ANY($1) ORDER BY source_id, ordinal`, [sourceIds])
    : []
  const articlesOf = new Map<string, Set<string>>()
  const fullText = new Map<string, string>()
  for (const r of articleRows) {
    if (r.article_no) articlesOf.set(r.source_id, (articlesOf.get(r.source_id) ?? new Set()).add(r.article_no))
    fullText.set(r.source_id, `${fullText.get(r.source_id) ?? ''}\n${r.text}`)
  }
  const links = await linkedInstruments(q, opts.orgId, sourceIds)
  const linkedIds = [...new Set([...links.values()].flat().filter((l) => ['implements', 'replaces'].includes(l.relation)).map((l) => l.id))]
  const linkedArticles = new Map<string, Set<string>>()
  if (linkedIds.length) {
    for (const r of await q.query<{ source_id: string; article_no: string }>(
      `SELECT DISTINCT source_id, article_no FROM library_chunks WHERE source_id = ANY($1) AND article_no IS NOT NULL`, [linkedIds])) {
      linkedArticles.set(r.source_id, (linkedArticles.get(r.source_id) ?? new Set()).add(r.article_no))
    }
  }

  for (const sentence of sents) {
    // In a draft, "Article 5" with no law named is usually a clause of the draft itself, so only
    // sentences that name a library law are checked.
    const sRefs = [...refsIn(sentence)].map((r) => byRef.get(r)).filter(Boolean) as VerifySource[]
    const snippet = sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence

    // 1. Quotes, word for word.
    for (const quote of quotes(sentence)) {
      const pool = sRefs.length ? sRefs : opts.sources
      if (opts.implicitRefs && !sRefs.length) continue
      let found: { ref: string; how: 'exact' | 'normalized'; where: 'passage' | 'source' } | null = null
      for (const s of pool) {
        const how = quoteMatch(quote, s.text)
        if (how) { found = { ref: s.ref, how, where: 'passage' }; break }
      }
      if (!found) for (const s of pool) {
        const how = quoteMatch(quote, fullText.get(s.source_id) ?? '')
        if (how) { found = { ref: s.ref, how, where: 'source' }; break }
      }
      const short = quote.length > 120 ? `${quote.slice(0, 117)}...` : quote
      if (!found) {
        checks.push({ kind: 'quote', severity: 'error', ok: false, ref: sRefs[0]?.ref, code: 'quote_not_found', text: short,
          detail: sRefs.length ? `The quoted words do not appear in ${sRefs.map((s) => `[${s.ref}]`).join(' ')}.` : 'The quoted words do not appear in any library source given to the model.' })
      } else {
        const uncited = !sRefs.length
        checks.push({ kind: 'quote', severity: uncited || found.where === 'source' ? 'warning' : 'info', ok: true, ref: found.ref, text: short,
          code: uncited ? 'quote_uncited' : found.where === 'source' ? 'quote_other_article' : found.how === 'exact' ? 'quote_exact' : 'quote_normalized',
          detail: uncited ? `Quote found in [${found.ref}] but the sentence does not cite it.`
            : found.where === 'source' ? `Quote found in the same instrument as [${found.ref}], but in a different article from the cited passage.`
            : found.how === 'exact' ? `Quote matches [${found.ref}] word for word.` : `Quote matches [${found.ref}] word for word, ignoring diacritics and letter variants.` })
      }
    }

    // 2. Article numbers next to citations.
    const arts = mentionedArticles(sentence)
    if (arts.length && !sRefs.length && opts.sources.length && !opts.implicitRefs) {
      checks.push({ kind: 'uncited_article', severity: 'warning', ok: false, code: 'uncited_article', text: snippet,
        detail: `Article ${arts.join(', ')} is stated without a citation to a library source.` })
    }
    for (const n of sRefs.length ? arts : []) {
      if (sRefs.some((s) => s.article_no === n)) {
        checks.push({ kind: 'article', severity: 'info', ok: true, ref: sRefs.find((s) => s.article_no === n)!.ref, code: 'article_matches', detail: `Article ${n} is the cited passage.` })
        continue
      }
      const holder = sRefs.find((s) => articlesOf.get(s.source_id)?.has(n))
      if (holder) {
        checks.push({ kind: 'article', severity: 'warning', ok: true, ref: holder.ref, code: 'article_not_in_passage', text: snippet,
          detail: `Article ${n} exists in ${holder.title}, but the cited passage [${holder.ref}] is ${holder.article_no ? `Article ${holder.article_no}` : 'another part'}. Check the citation points at the right article.` })
        continue
      }
      // The article is not in the cited instrument. Is it in the law it implements, or its implementing regulation?
      let confused: { s: VerifySource; other: { title: string; number: string | null; kind: string } } | null = null
      for (const s of sRefs) {
        for (const l of links.get(s.source_id) ?? []) {
          if (['implements', 'replaces'].includes(l.relation) && linkedArticles.get(l.id)?.has(n)) { confused = { s, other: l }; break }
        }
        if (confused) break
      }
      if (confused) {
        checks.push({ kind: 'instrument', severity: 'error', ok: false, ref: confused.s.ref, code: 'instrument_confusion', text: snippet,
          detail: `Article ${n} is not in ${confused.s.title}; it is in ${confused.other.title}${confused.other.number ? ` (No. ${confused.other.number})` : ''}. The answer may confuse the law with its implementing regulation or another version.` })
      } else if (ABSENCE_WORDS.test(sentence) || ABSENCE_WORDS.test(normalizeText(sentence))) {
        checks.push({ kind: 'article', severity: 'info', ok: true, ref: sRefs[0]!.ref, code: 'article_absence_stated', detail: `The answer says Article ${n} is not in the cited source, which matches the library.` })
      } else {
        const known = sRefs.filter((s) => articlesOf.has(s.source_id))
        checks.push({ kind: 'article', severity: known.length ? 'error' : 'warning', ok: false, ref: sRefs[0]!.ref, code: known.length ? 'article_not_found' : 'article_unnumbered', text: snippet,
          detail: known.length ? `Article ${n} does not exist in ${known.map((s) => s.title).join(' or ')} in the library.` : `Article ${n} could not be checked: the cited source has no article numbering in the library.` })
      }
    }
  }

  // 3. In force on the relevant date, and 4. jurisdiction, once per cited passage.
  for (const s of cited) {
    const v = validityOn(s, { status: s.article_status, changed_on: s.changed_on }, opts.asOf)
    const said = sents.filter((x) => refsIn(x).has(s.ref)).join(' ')
    if (!v.in_force) {
      const acknowledged = REPEAL_WORDS.test(normalizeText(said)) || REPEAL_WORDS.test(said)
      const what = v.reason === 'not_yet_in_force' ? `was not yet in force on ${opts.asOf} (in force from ${v.date})`
        : `was ${v.reason === 'superseded' ? 'superseded' : 'repealed'}${v.date ? ` on ${v.date}` : ''} and was not in force on ${opts.asOf}`
      checks.push({ kind: 'in_force', severity: acknowledged ? 'info' : 'error', ok: acknowledged, ref: s.ref, code: acknowledged ? 'not_in_force_acknowledged' : 'not_in_force',
        detail: `${s.citation} ${what}.${acknowledged ? ' The answer says so.' : ''}` })
    } else if (v.reason === 'amended') {
      const acknowledged = AMEND_WORDS.test(normalizeText(said)) || AMEND_WORDS.test(said)
      checks.push({ kind: 'in_force', severity: acknowledged ? 'info' : 'warning', ok: true, ref: s.ref, code: 'amended',
        detail: `${s.citation} has been amended${v.date ? ` (from ${v.date})` : ''}. Check the current wording.` })
    } else {
      checks.push({ kind: 'in_force', severity: 'info', ok: true, ref: s.ref, code: 'in_force', detail: `${s.citation} was in force on ${opts.asOf}.` })
    }
    if (opts.allowedJurisdictions?.length && !opts.allowedJurisdictions.includes(s.jurisdiction)) {
      const named = opts.namedSourceIds?.includes(s.source_id)
      checks.push({ kind: 'jurisdiction', severity: named ? 'info' : 'error', ok: !!named, ref: s.ref, code: named ? 'jurisdiction_named' : 'jurisdiction_mismatch',
        detail: named ? `${s.citation} is from ${s.jurisdiction}; the user asked for this law by number.`
          : `${s.citation} is from ${s.jurisdiction}, not the matter's jurisdiction (${opts.allowedJurisdictions.join(', ')}).` })
    }
  }

  // Source text read from a scan (OCR) that nobody has checked against the original yet.
  if (sourceIds.length) {
    const unreviewed = await q.query<{ id: string }>('SELECT id FROM library_sources WHERE id = ANY($1) AND ocr AND ocr_reviewed_at IS NULL', [sourceIds])
    for (const r of unreviewed) {
      const s = cited.find((x) => x.source_id === r.id)!
      checks.push({ kind: 'source_text', severity: 'warning', ok: true, ref: s.ref, code: 'ocr_unreviewed',
        detail: `${s.citation} was read from a scan (OCR) and its text has not yet been checked against the original. Confirm the wording before relying on it.` })
    }
  }

  // 5. Laws named by number in the answer must be among the library sources.
  for (const r of lawReferences(opts.answer.replace(/\[[^\]]*\]/g, ' '), 20)) {
    if (!opts.sources.some((s) => sourceMatchesLawRef(s, r))) {
      checks.push({ kind: 'law_reference', severity: 'warning', ok: false, code: 'unverified_law_reference', text: `${r.number}/${r.years[0]}`,
        detail: `The answer names law ${r.number}/${r.years[0]}, which is not among the library sources. Verify it against the official text.` })
    }
  }

  const errors = checks.filter((c) => c.severity === 'error').length
  const warnings = checks.filter((c) => c.severity === 'warning').length
  return {
    status: errors ? 'failed' : !cited.length ? 'unverified' : warnings ? 'passed_with_warnings' : 'passed',
    as_of: opts.asOf,
    checked_at: new Date().toISOString(),
    citations: cited.length,
    errors,
    warnings,
    checks
  }
}
