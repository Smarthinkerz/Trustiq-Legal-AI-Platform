import type { Db } from '../db'
import type { AiService } from './ai'
import { citedRefs, lawReferences } from './library'
import { chatSystemPrompt } from './legal-prompts'
import { groundQuestion, gulfToday, type GroundedSource } from './grounding'
import type { RetrievalDeps } from './retrieval'
import { recordAiUsage } from './usage'
import { mentionedArticles } from './legal-corpus'
import { sentences, sourceMatchesLawRef, verifyAnswer } from './verify'
import { type EvalCase, type LawId, GCC_EVAL_CASES } from './legal-eval-cases'

// ---------------------------------------------------------------------------
// Runs the standing GCC evaluation set through the same pipeline as the research assistant
// (retrieval, model, deterministic verifier) and scores each answer.
// ---------------------------------------------------------------------------

type Lang = 'en' | 'ar'
export type EvalResult = {
  case_id: string
  category: string
  lang: Lang
  pass: boolean
  reasons: string[]
  coverage_gap: boolean
  cited: { ref: string; citation: string; jurisdiction: string; law: string }[]
  verification: { status: string; errors: number; warnings: number; codes: string[] }
  retrieval: { mode: string; bm25: number; dense: number; reranked: boolean }
}

const lawKey = (s: { jurisdiction: string; title: string; number: string | null }) => {
  const r = lawReferences(`${s.number ?? ''} ${s.title}`, 1)[0]
  return r ? `${s.jurisdiction}:${r.number}/${r.years[0]}` : `${s.jurisdiction}:${s.title}`
}
const matches = (s: { jurisdiction: string; title: string; number: string | null }, l: LawId) =>
  s.jurisdiction === l.jurisdiction && sourceMatchesLawRef(s, { number: String(Number(l.number)), years: [l.year, l.year.slice(2)] })

export async function runEvalCase(deps: RetrievalDeps & { ai: AiService }, ctx: { orgId: string; userId: string; library: { jurisdiction: string; title: string; number: string | null }[] }, k: EvalCase, lang: Lang, today = gulfToday()): Promise<EvalResult> {
  const asOf = k.as_of ?? today
  const question = k.question[lang]
  const { sources, namedSourceIds, retrieval } = await groundQuestion(deps, ctx.orgId, { question, jurisdiction: k.jurisdiction, asOf, max: 14 })
  const system = chatSystemPrompt({ lang, jurisdiction: k.jurisdiction, asOf, sources, libraryOnly: false })
  const result = await deps.ai.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: question }], maxTokens: 2000, temperature: 0 })
  await recordAiUsage(deps.db, ctx.orgId, ctx.userId, 'eval', result)
  const verification = await verifyAnswer(deps.db, { orgId: ctx.orgId, answer: result.text, sources, asOf, allowedJurisdictions: k.jurisdiction === 'gcc' ? undefined : [k.jurisdiction, 'gcc'], namedSourceIds })
  const refs = citedRefs(result.text)
  const cited = sources.filter((s) => refs.has(s.ref))
  const reasons: string[] = []
  if (verification.errors) reasons.push(`verifier: ${verification.checks.filter((c) => c.severity === 'error').map((c) => c.code).join(', ')}`)

  let gap = false
  if (k.cite_any?.length) {
    const inLibrary = k.cite_any.filter((l) => ctx.library.some((s) => matches(s, l)))
    if (!inLibrary.length) gap = true
    else if (!cited.some((s) => inLibrary.some((l) => matches(s, l)))) reasons.push(`did not cite ${inLibrary.map((l) => l.label).join(' or ')}`)
  }
  for (const bad of k.must_not_cite ?? []) {
    if (cited.some((s) => matches(s, bad))) reasons.push(`cited ${bad.label} (${bad.reason})`)
  }
  if (k.trap_article) {
    // Stating the non-existent article as if it existed, with or without a citation, fails the trap.
    const claimed = sentences(result.text).some((x) => mentionedArticles(x).includes(String(Number(k.trap_article))) && !/not|no such|does not|لا |غير|ليس/i.test(x))
    if (claimed) reasons.push(`stated Article ${k.trap_article}, which does not exist`)
  }
  return {
    case_id: k.id, category: k.category, lang, pass: !reasons.length && !gap, reasons, coverage_gap: gap,
    cited: cited.map((s: GroundedSource) => ({ ref: s.ref, citation: s.citation, jurisdiction: s.jurisdiction, law: lawKey(s) })),
    verification: { status: verification.status, errors: verification.errors, warnings: verification.warnings, codes: [...new Set(verification.checks.filter((c) => c.severity !== 'info').map((c) => c.code))] },
    retrieval: { mode: retrieval.mode, bm25: retrieval.bm25, dense: retrieval.dense, reranked: retrieval.reranked }
  }
}

export function summarize(results: EvalResult[]) {
  const by = <T extends string>(key: (r: EvalResult) => T) => {
    const out: Record<string, { passed: number; total: number; gaps: number }> = {}
    for (const r of results) {
      const k = key(r)
      out[k] ??= { passed: 0, total: 0, gaps: 0 }
      if (r.coverage_gap) out[k].gaps++
      else { out[k].total++; if (r.pass) out[k].passed++ }
    }
    return out
  }
  // Parity: the Arabic and English answers to a case rest on the same instruments.
  const pairs = new Map<string, Partial<Record<Lang, EvalResult>>>()
  for (const r of results) pairs.set(r.case_id, { ...pairs.get(r.case_id), [r.lang]: r })
  let parityTotal = 0
  let parityMatched = 0
  const parityMismatches: string[] = []
  for (const [id, p] of pairs) {
    if (!p.en || !p.ar || p.en.coverage_gap) continue
    parityTotal++
    const en = [...new Set(p.en.cited.map((c) => c.law))].sort().join('|')
    const ar = [...new Set(p.ar.cited.map((c) => c.law))].sort().join('|')
    if (en === ar && p.en.pass === p.ar.pass) parityMatched++
    else parityMismatches.push(id)
  }
  const scored = results.filter((r) => !r.coverage_gap)
  const codes: Record<string, number> = {}
  for (const r of results) for (const c of r.verification.codes) codes[c] = (codes[c] ?? 0) + 1
  return {
    answers: results.length,
    scored: scored.length,
    passed: scored.filter((r) => r.pass).length,
    pass_rate: scored.length ? Math.round((scored.filter((r) => r.pass).length / scored.length) * 1000) / 10 : null,
    coverage_gaps: results.filter((r) => r.coverage_gap).length,
    by_category: by((r) => r.category),
    by_language: by((r) => r.lang),
    parity: { matched: parityMatched, total: parityTotal, mismatched_cases: parityMismatches },
    verifier_findings: codes
  }
}

export async function runLegalEval(deps: RetrievalDeps & { ai: AiService; db: Db }, opts: { orgId: string; userId: string; cases?: EvalCase[]; languages?: Lang[]; today?: string }) {
  const cases = opts.cases ?? GCC_EVAL_CASES
  const languages = opts.languages ?? ['en', 'ar']
  const library = await deps.db.query<{ jurisdiction: string; title: string; number: string | null }>(
    'SELECT jurisdiction, title, number FROM library_sources WHERE org_id = $1 OR org_id IS NULL', [opts.orgId])
  const results: EvalResult[] = []
  for (const k of cases) for (const lang of languages) {
    try {
      results.push(await runEvalCase(deps, { orgId: opts.orgId, userId: opts.userId, library }, k, lang, opts.today))
    } catch (err) {
      results.push({
        case_id: k.id, category: k.category, lang, pass: false, reasons: [`error: ${(err as Error).message}`], coverage_gap: false, cited: [],
        verification: { status: 'error', errors: 0, warnings: 0, codes: [] }, retrieval: { mode: 'none', bm25: 0, dense: 0, reranked: false }
      })
    }
  }
  return { results, summary: summarize(results) }
}
