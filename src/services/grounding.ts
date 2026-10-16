import { isGcc } from './reference'
import { type Passage, citationLabel, findReferencedSources, lawReferences, referencedPassages } from './library'
import { instrumentNote, linkedInstruments } from './legal-corpus'
import { hybridSearch, type RetrievalDeps, type RetrievalInfo } from './retrieval'
import type { PromptSource } from './legal-prompts'
import type { VerifySource } from './verify'

export type GroundedSource = VerifySource & PromptSource

// Today in the Gulf (UTC+4 covers Oman and the UAE; the others are UTC+3, so the date rarely differs).
export const gulfToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)

export const allowedJurisdictions = (jurisdiction: string) => (isGcc(jurisdiction) ? [jurisdiction, 'gcc'] : [jurisdiction])

// Library passages for a question: laws named by number first (any jurisdiction), then hybrid retrieval
// in the matter's jurisdiction, limited to the versions in force on the relevant date.
export async function groundQuestion(deps: RetrievalDeps, orgId: string, opts: {
  question: string
  // Earlier text that may name the law (e.g. the previous question in a conversation).
  context?: string
  jurisdiction: string
  asOf: string
  max: number
  perNamed?: number
  searchLimit?: number
}): Promise<{ sources: GroundedSource[]; namedSourceIds: string[]; retrieval: RetrievalInfo }> {
  const { db } = deps
  const query = `${opts.question} ${opts.context ?? ''}`.slice(0, 1500)
  const refs = lawReferences(opts.question).length ? lawReferences(opts.question) : lawReferences(opts.context ?? '')
  const named = await findReferencedSources(db, orgId, refs)
  const passages: Passage[] = []
  for (const s of named) passages.push(...await referencedPassages(db, orgId, s.id, query, opts.perNamed ?? (named.length > 1 ? 5 : 10)))
  const seen = new Set(passages.map((p) => p.id))
  const { passages: found, info } = await hybridSearch(deps, orgId, query, { jurisdictions: allowedJurisdictions(opts.jurisdiction), asOf: opts.asOf, limit: opts.searchLimit ?? 6 })
  for (const p of found) {
    if (passages.length >= opts.max) break
    if (!seen.has(p.id)) { seen.add(p.id); passages.push(p) }
  }
  const links = await linkedInstruments(db, orgId, [...new Set(passages.map((p) => p.source_id))])
  const sources = passages.slice(0, opts.max).map((p, i) => ({
    ref: `S${i + 1}`, chunk_id: p.id, source_id: p.source_id, citation: citationLabel(p), text: p.text, title: p.title, number: p.number,
    jurisdiction: p.jurisdiction, kind: p.kind, status: p.status, article_no: p.article_no, article_status: p.article_status, changed_on: p.changed_on,
    effective_from: p.effective_from, effective_to: p.effective_to, note: instrumentNote(p.kind, links.get(p.source_id)) || undefined
  }))
  return { sources, namedSourceIds: named.map((s) => s.id), retrieval: info }
}

// What is stored with an answer and in the AI log for each cited source.
export const citedSummary = (s: GroundedSource) => ({
  ref: s.ref, chunk_id: s.chunk_id, source_id: s.source_id, citation: s.citation, status: s.article_status === 'repealed' ? 'repealed' : s.status, jurisdiction: s.jurisdiction
})
