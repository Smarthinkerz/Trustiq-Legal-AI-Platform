import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound, tooMany, unavailable } from '../lib/errors'
import { jsonBody, optUuid, uuidParam } from '../lib/http'
import { JURISDICTION_CODES, jurisdictionName, templateName, DOCUMENT_TEMPLATES } from '../services/reference'
import { analysisMessages, chatSystemPrompt, draftMessages, normalizeAnalysis, parseJsonObject, type AnalysisType } from '../services/legal-prompts'
import { assertCanCreateDocument, assertCanUseAi, recordAiUsage } from '../services/usage'
import { citedRefs, lawReferences } from '../services/library'
import { ABSTAIN, appearsIn } from '../services/ai-guard'
import { mentionedArticles } from '../services/legal-corpus'
import { allowedJurisdictions, citedSummary, crossLanguageQuery, groundQuestion, gulfToday } from '../services/grounding'
import { verifyAnswer, type Verification } from '../services/verify'
import type { ChatMessage, Completion } from '../services/ai'
import { LOG_COLUMNS, LOG_FROM, logAiUse, logCsv, logDisclosure } from '../services/ai-log'
import { contentDisposition } from '../services/export'
import { insertDocument } from './documents'
import { briefMessages, briefText, gatherCaseFile, normalizeBrief } from '../services/case-brief'
import { checkDictationDates, dictationMessages, localToday, MAX_AUDIO_BYTES, MAX_NOTES_CHARS, normalizeDictation, sniffAudio } from '../services/dictation'

const HISTORY_MESSAGES = 20
const TEMPLATE_IDS = DOCUMENT_TEMPLATES.map((t) => t.id) as unknown as [string, ...string[]]

export function throttle(c: Ctx) {
  const { user } = auth(c)
  const r = c.get('deps').limiters.ai.take(user.id)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  }
}

async function caseContext(db: Queryable, orgId: string, caseId: string | null) {
  if (!caseId) return null
  const [k] = await db.query(
    `SELECT k.reference, k.title, k.practice_area, k.jurisdiction, k.court, k.opposing_party, k.status, k.description, cl.name AS client_name
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.id = $1 AND k.org_id = $2`, [caseId, orgId])
  if (!k) throw badRequest('Selected case does not exist.')
  const notes = await db.query(
    `SELECT body FROM case_activity WHERE case_id = $1 AND org_id = $2 AND kind = 'note' ORDER BY created_at DESC LIMIT 10`, [caseId, orgId])
  return [
    `Reference: ${k.reference}`,
    `Title: ${k.title}`,
    k.client_name && `Client: ${k.client_name}`,
    k.opposing_party && `Opposing party: ${k.opposing_party}`,
    `Jurisdiction: ${jurisdictionName(k.jurisdiction)}`,
    k.court && `Court/forum: ${k.court}`,
    k.practice_area && `Practice area: ${k.practice_area}`,
    `Status: ${k.status}`,
    k.description && `Description: ${k.description}`,
    notes.length ? `Recent notes:\n- ${notes.map((n) => n.body).join('\n- ')}` : ''
  ].filter(Boolean).join('\n')
}

const aiRoutes = new Hono<AppEnv>()

aiRoutes.get('/conversations', async (c) => {
  const { user, org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT a.id, a.title, a.case_id, k.reference AS case_reference, a.jurisdiction, a.updated_at
       FROM ai_conversations a LEFT JOIN cases k ON k.id = a.case_id
      WHERE a.org_id = $1 AND a.user_id = $2 ORDER BY a.updated_at DESC LIMIT 100`, [org.id, user.id])
  return c.json({ items })
})

aiRoutes.get('/conversations/:id', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Conversation')
  const { db } = c.get('deps')
  const conversation = await db.one('SELECT id, title, case_id, jurisdiction, created_at, updated_at FROM ai_conversations WHERE id = $1 AND org_id = $2 AND user_id = $3', [id, org.id, user.id])
  if (!conversation) throw notFound('Conversation')
  const messages = await db.query(
    `SELECT m.id, m.role, m.content, m.sources, m.verification, m.created_at, l.id AS log_id, l.reviewed_at
       FROM ai_messages m LEFT JOIN ai_use_log l ON l.message_id = m.id WHERE m.conversation_id = $1 ORDER BY m.created_at, m.id`, [id])
  return c.json({ conversation, messages })
})

aiRoutes.delete('/conversations/:id', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Conversation')
  const rows = await c.get('deps').db.query('DELETE FROM ai_conversations WHERE id = $1 AND org_id = $2 AND user_id = $3 RETURNING id', [id, org.id, user.id])
  if (!rows.length) throw notFound('Conversation')
  return c.json({ ok: true })
})

aiRoutes.post('/chat', jsonBody(z.object({
  message: z.string().trim().min(1).max(8000),
  conversation_id: optUuid,
  case_id: optUuid,
  jurisdiction: z.enum(JURISDICTION_CODES).nullish().transform((v) => v ?? undefined),
  language: z.enum(['en', 'ar']).default('en'),
  library_only: z.boolean().default(false),
  // Opt-in: allow an answer from general knowledge when the library has nothing, clearly labelled as unverified.
  allow_general: z.boolean().default(false),
  // The date the law should be applied as of (e.g. when the facts happened). Defaults to today.
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? undefined)
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
  if (!ai.configured) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
  throttle(c)
  await assertCanUseAi(db, org)

  let conv: { id: string; case_id: string | null; jurisdiction: string | null }
  if (b.conversation_id) {
    const found = await db.one('SELECT id, case_id, jurisdiction FROM ai_conversations WHERE id = $1 AND org_id = $2 AND user_id = $3', [b.conversation_id, org.id, user.id])
    if (!found) throw notFound('Conversation')
    conv = found as typeof conv
  } else {
    const ctxCase = b.case_id ?? null
    if (ctxCase && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [ctxCase, org.id])).length) throw badRequest('Selected case does not exist.')
    conv = (await db.one(
      'INSERT INTO ai_conversations (org_id, user_id, case_id, title, jurisdiction) VALUES ($1, $2, $3, $4, $5) RETURNING id, case_id, jurisdiction',
      [org.id, user.id, ctxCase, b.message.slice(0, 80), b.jurisdiction ?? org.default_jurisdiction]))! as typeof conv
  }

  const history = (await db.query(
    `SELECT role, content FROM (SELECT role, content, created_at, id FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2) h ORDER BY created_at, id`,
    [conv.id, HISTORY_MESSAGES])) as { role: 'user' | 'assistant'; content: string }[]
  const jurisdiction = b.jurisdiction ?? conv.jurisdiction ?? org.default_jurisdiction
  const asOf = b.as_of ?? gulfToday()
  // Retrieve from the jurisdiction's law plus GCC-wide instruments; include the previous question for follow-ups.
  // A law named by number (e.g. "Royal Decree 48/2009") is looked up directly, in any jurisdiction, and its own text comes first.
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  let { sources, namedSourceIds, retrieval } = await groundQuestion(c.get('deps'), org.id, { question: b.message, context: lastUser, jurisdiction, asOf, max: 14 })
  // Answers come only from library passages unless the lawyer opts in to general knowledge.
  const libraryOnly = b.library_only || !b.allow_general
  let translatedQuery: string | null = null
  // Only worth a translation when the library holds laws in the other language.
  const otherLang = (b.message.match(/[\u0600-\u06FF]/g)?.length ?? 0) > b.message.replace(/\s/g, '').length / 3 ? 'en' : 'ar'
  if (!sources.length && libraryOnly && (await db.query('SELECT 1 FROM library_sources WHERE language = $2 AND (org_id = $1 OR org_id IS NULL) LIMIT 1', [org.id, otherLang])).length) {
    const t = await crossLanguageQuery(ai, b.message).catch(() => null)
    if (t) {
      await recordAiUsage(db, org.id, user.id, 'query_translation', t.completion)
      const again = await groundQuestion(c.get('deps'), org.id, { question: t.text, jurisdiction, asOf, max: 14 })
      if (again.sources.length) { ({ sources, namedSourceIds, retrieval } = again); translatedQuery = t.text }
    }
  }
  const verify = (text: string) => verifyAnswer(db, { orgId: org.id, answer: text, sources, asOf, allowedJurisdictions: allowedJurisdictions(jurisdiction), namedSourceIds })
  const completions: Completion[] = []
  let reply: string
  let verification: Verification
  let abstained: 'no_sources' | 'failed_check' | null = null
  let withheld: string | null = null
  if (!sources.length && libraryOnly) {
    // Abstain path in code: no passage, no model call.
    abstained = 'no_sources'
    reply = b.language === 'ar'
      ? `${ABSTAIN.ar} لم تُعد مكتبة القوانين أي نص يتعلق بهذا السؤال. أضف القانون المعني إلى المكتبة، أو أعد صياغة السؤال، أو فعّل خيار المعرفة العامة غير المتحقق منها.`
      : `${ABSTAIN.en} The law library returned no passage on this question. Add the relevant law to the library, rephrase the question, or turn on unverified general knowledge.`
    verification = { status: 'unverified', as_of: asOf, checked_at: new Date().toISOString(), citations: 0, errors: 0, warnings: 0, checks: [] }
  } else {
    const system = chatSystemPrompt({ lang: b.language, jurisdiction, asOf, caseContext: await caseContext(db, org.id, conv.case_id), sources, libraryOnly })
    const base: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: b.message }]
    let r = await ai.complete({ messages: base, maxTokens: 3000, temperature: 0 })
    completions.push(r)
    // Deterministic check of quotes, article numbers, validity on the date and jurisdiction.
    verification = await verify(r.text)
    if (verification.errors) {
      // One regeneration with the failures named, then withhold.
      const problems = verification.checks.filter((x) => x.severity === 'error').map((x) => `- ${x.detail}`).join('\n')
      r = await ai.complete({ messages: [...base, { role: 'assistant', content: r.text }, { role: 'user', content: `Your answer failed the automatic citation check:\n${problems}\nRewrite it using only what the passages say, quoting only exact words, citing only articles that exist in the cited passage. If the passages do not answer the question, say so.` }], maxTokens: 3000, temperature: 0 })
      completions.push(r)
      verification = await verify(r.text)
    }
    reply = r.text
    if (verification.errors) {
      abstained = 'failed_check'
      withheld = r.text
      reply = b.language === 'ar'
        ? `${ABSTAIN.ar} لم تجتز الإجابة المقترحة الفحص الآلي للاستشهادات بعد محاولتين، فحُجبت. راجع النتائج أدناه أو ابحث في المكتبة مباشرة.`
        : `${ABSTAIN.en} The proposed answer failed the automatic citation check twice, so it was withheld. See the findings below, or search the library directly.`
    }
  }
  // Keep only sources the shown answer actually cites.
  const refs = citedRefs(abstained ? '' : reply)
  const cited = sources.filter((s) => refs.has(s.ref)).map(citedSummary)
  const result = completions.at(-1)

  const logId = await db.tx(async (q) => {
    await q.query(`INSERT INTO ai_messages (org_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [org.id, conv.id, b.message])
    const msg = await q.one<{ id: string }>(`INSERT INTO ai_messages (org_id, conversation_id, role, content, sources, verification, created_at) VALUES ($1, $2, 'assistant', $3, $4, $5, now() + interval '1 millisecond') RETURNING id`,
      [org.id, conv.id, reply, cited.length ? JSON.stringify(cited) : null, JSON.stringify({ ...verification, abstained, general: !libraryOnly && !sources.length })])
    await q.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id])
    for (const r of completions) await recordAiUsage(q, org.id, user.id, 'chat', r)
    return logAiUse(q, {
      orgId: org.id, userId: user.id, feature: 'chat', model: result?.model ?? null, caseId: conv.case_id, conversationId: conv.id, messageId: msg!.id,
      jurisdiction, asOf, prompt: b.message, output: withheld ? `[WITHHELD AFTER FAILED CHECK]\n${withheld}` : reply, sources: cited, verification
    })
  })
  return c.json({ conversation_id: conv.id, reply, sources: cited, library_matches: sources.length, model: result?.model ?? null, verification, retrieval, translated_query: translatedQuery, log_id: logId, abstained,
    general: !libraryOnly && !sources.length })
})

aiRoutes.post('/draft', jsonBody(z.object({
  template: z.enum(TEMPLATE_IDS),
  title: z.string().trim().max(300).nullish().transform((v) => v || undefined),
  language: z.enum(['en', 'ar']).default('en'),
  jurisdiction: z.enum(JURISDICTION_CODES),
  parties: z.string().trim().max(2000).nullish().transform((v) => v || undefined),
  instructions: z.string().trim().min(10, 'Describe the key facts and terms (at least 10 characters).').max(20_000),
  case_id: optUuid,
  client_id: optUuid
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
  throttle(c)
  await assertCanUseAi(db, org)
  await assertCanCreateDocument(db, org)
  if (b.client_id && !(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])).length) throw badRequest('Selected client does not exist.')
  const tName = templateName(b.template)
  // Ground the draft in the firm's library: laws named in the instructions first, then the best matches.
  const asOf = gulfToday()
  const { sources: draftSources, namedSourceIds } = await groundQuestion(c.get('deps'), org.id, {
    question: `${b.instructions} ${b.parties ?? ''}`, jurisdiction: b.jurisdiction, asOf, max: 8, perNamed: 4
  })
  const base = draftMessages({
    templateName: tName, templateId: b.template, lang: b.language, jurisdiction: b.jurisdiction, instructions: b.instructions, parties: b.parties,
    caseContext: await caseContext(db, org.id, b.case_id), sources: draftSources
  })
  const clean = (t: string) => t.replace(/^```[a-z]*\n?|```$/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim()
  // Drafts cite by law name and article number; check those against the library the same way.
  const verifyDraft = (text: string) => verifyAnswer(db, { orgId: org.id, answer: text, sources: draftSources, asOf, allowedJurisdictions: allowedJurisdictions(b.jurisdiction), namedSourceIds, implicitRefs: true })
  let result = await ai.complete({ messages: base, maxTokens: 6000, temperature: 0.1 })
  const completions = [result]
  let content = clean(result.text)
  let verification = await verifyDraft(content)
  if (verification.errors) {
    const problems = verification.checks.filter((x) => x.severity === 'error').map((x) => `- ${x.detail}`).join('\n')
    result = await ai.complete({ messages: [...base, { role: 'assistant', content: result.text }, { role: 'user', content: `The draft failed the automatic citation check:\n${problems}\nRewrite the full draft. Cite only articles that exist in the <sources>; where a legal basis is needed but not in the sources, write [LEGAL BASIS – ARTICLE TO BE CONFIRMED].` }], maxTokens: 6000, temperature: 0.1 })
    completions.push(result)
    content = clean(result.text)
    verification = await verifyDraft(content)
  }
  for (const r of completions) await recordAiUsage(db, org.id, user.id, 'draft', r)
  if (verification.errors) {
    // Blocked after one regeneration: nothing is saved.
    return c.json({ error: { code: 'draft_failed_check', message: b.language === 'ar'
      ? 'لم تُحفظ المسودة لأن استشهاداتها القانونية لم تجتز الفحص الآلي بعد محاولتين. أضف القوانين المعنية إلى المكتبة أو عدّل التعليمات.'
      : 'The draft was not saved because its legal citations failed the automatic check twice. Add the relevant laws to the library or adjust the instructions.' }, verification }, 422)
  }
  const tpl = DOCUMENT_TEMPLATES.find((t) => t.id === b.template)!
  const usedRefs = new Set(verification.checks.map((x) => x.ref).filter(Boolean))
  const document = await db.tx(async (q) => {
    const doc = await insertDocument(q, {
      orgId: org.id, userId: user.id, title: b.title || (b.language === 'ar' ? tpl.name_ar : tpl.name), docType: b.template,
      language: b.language, jurisdiction: b.jurisdiction, source: 'ai', content, caseId: b.case_id, clientId: b.client_id
    })
    await logAiUse(q, {
      orgId: org.id, userId: user.id, feature: 'draft', model: result.model, documentId: doc.id, caseId: b.case_id ?? null, jurisdiction: b.jurisdiction, asOf,
      prompt: `${tName}: ${b.instructions}`, output: content, sources: draftSources.filter((x) => usedRefs.has(x.ref)).map(citedSummary), verification
    })
    return doc
  })
  await audit(c, 'ai.drafted', 'document', document.id, { template: b.template, model: result.model })
  return c.json({ document, verification }, 201)
})

aiRoutes.post('/documents/:id/analyze', jsonBody(z.object({
  type: z.enum(['summary', 'risk', 'compliance', 'review']).default('review'),
  language: z.enum(['en', 'ar']).default('en'),
  jurisdiction: z.enum(JURISDICTION_CODES).nullish().transform((v) => v ?? undefined)
})), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Document')
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
  const doc = await db.one('SELECT id, title, content, jurisdiction FROM documents WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!doc) throw notFound('Document')
  if (doc.content.trim().length < 50) throw badRequest('This document has too little text to analyse. Scanned PDFs need OCR before upload.')
  throttle(c)
  await assertCanUseAi(db, org, b.type !== 'summary')
  const jurisdiction = b.jurisdiction ?? doc.jurisdiction ?? org.default_jurisdiction
  const asOf = gulfToday()
  // Legal points are grounded in the firm's library, found from the document's own text.
  const { sources, namedSourceIds } = b.type === 'summary' ? { sources: [], namedSourceIds: [] }
    : await groundQuestion(c.get('deps'), org.id, { question: `${doc.title} ${doc.content.slice(0, 1500)}`, jurisdiction, asOf, max: 10 })
  const result = await ai.complete({
    messages: analysisMessages({ type: b.type as AnalysisType, lang: b.language, jurisdiction, title: doc.title, text: doc.content, sources }),
    json: true,
    maxTokens: 4500,
    temperature: 0.1
  })
  let analysis
  try {
    analysis = normalizeAnalysis(parseJsonObject(result.text))
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable analysis. Please try again.')
  }
  // Code checks: each issue must quote the document word for word; each legal basis must pass the citation check.
  const checks = { issues_kept: 0, issues_removed: 0, legal_basis_removed: 0, truncated: doc.content.length > 60_000 }
  const kept: typeof analysis.issues = []
  for (const i of analysis.issues) {
    if (!i.quote || !appearsIn(i.quote, doc.content)) { checks.issues_removed++; continue }
    if (i.legal_basis) {
      const v = await verifyAnswer(db, { orgId: org.id, answer: i.legal_basis, sources, asOf, allowedJurisdictions: allowedJurisdictions(jurisdiction), namedSourceIds })
      if (v.errors || !v.citations) { i.legal_basis = ''; checks.legal_basis_removed++ }
    }
    // Law named anywhere else in the issue without a verified basis is not shown as fact.
    if (!i.legal_basis && (mentionedArticles(i.issue).length || lawReferences(i.issue).length)) i.issue = `${i.issue}\n(${b.language === 'ar' ? 'الإشارة القانونية غير متحقق منها في المكتبة' : 'Legal reference not verified in the library'})`
    kept.push(i)
  }
  checks.issues_kept = kept.length
  analysis = { ...analysis, issues: kept, checks }
  const saved = await db.tx(async (q) => {
    const row = await q.one(
      `INSERT INTO document_analyses (org_id, document_id, analysis_type, language, jurisdiction, result, model, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, analysis_type, language, jurisdiction, result, model, created_at`,
      [org.id, id, b.type, b.language, jurisdiction, JSON.stringify(analysis), result.model, user.id])
    await recordAiUsage(q, org.id, user.id, `analysis:${b.type}`, result)
    await logAiUse(q, { orgId: org.id, userId: user.id, feature: `analysis:${b.type}`, model: result.model, documentId: id, jurisdiction, asOf, prompt: `${b.type} analysis of ${doc.title}`, output: result.text,
      sources: sources.filter((s) => kept.some((i: any) => i.legal_basis.includes(`[${s.ref}]`))).map(citedSummary),
      verification: { status: checks.issues_removed || checks.legal_basis_removed ? 'passed_with_warnings' : 'passed', errors: 0, warnings: checks.issues_removed + checks.legal_basis_removed, citations: 0, as_of: asOf, checked_at: new Date().toISOString(),
        checks: [
          ...(checks.issues_removed ? [{ kind: 'quote' as const, severity: 'warning' as const, ok: false, code: 'issue_quote_not_found', detail: `${checks.issues_removed} issue(s) removed because their quoted clause was not found in the document.` }] : []),
          ...(checks.legal_basis_removed ? [{ kind: 'reference' as const, severity: 'warning' as const, ok: false, code: 'legal_basis_removed', detail: `${checks.legal_basis_removed} legal basis reference(s) removed because they failed the citation check.` }] : [])
        ] } })
    return row
  })
  await audit(c, 'ai.analyzed', 'document', id, { type: b.type })
  return c.json({ analysis: saved }, 201)
})

// ---------------- Case brief ----------------

const BRIEF_COLUMNS = `b.id, b.case_id, b.language, b.content, b.model, b.document_id, b.created_at, u.name AS created_by_name`

aiRoutes.get('/cases/:id/brief', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const language = c.req.query('language') === 'ar' ? 'ar' : 'en'
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])).length) throw notFound('Case')
  const [brief] = await db.query(
    `SELECT ${BRIEF_COLUMNS} FROM case_briefs b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.case_id = $1 AND b.org_id = $2 AND b.language = $3 ORDER BY b.created_at DESC LIMIT 1`, [id, org.id, language])
  // Anything recorded on the case after the brief makes it out of date.
  const [latest] = brief ? await db.query(
    `SELECT GREATEST((SELECT max(created_at) FROM case_activity WHERE case_id = $1), (SELECT max(updated_at) FROM documents WHERE case_id = $1),
                     (SELECT max(created_at) FROM hearing_records WHERE case_id = $1), (SELECT max(updated_at) FROM cases WHERE id = $1)) AS at`, [id]) : [null]
  return c.json({ brief: brief ?? null, stale: !!(brief && latest?.at && new Date(latest.at) > new Date(brief.created_at)) })
})

aiRoutes.post('/cases/:id/brief', jsonBody(z.object({ language: z.enum(['en', 'ar']).default('en') })), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { language } = c.req.valid('json')
  const { db, ai } = c.get('deps')
  const file = await gatherCaseFile(db, org.id, id)
  if (!file) throw notFound('Case')
  throttle(c)
  await assertCanUseAi(db, org)
  const result = await ai.complete({ messages: briefMessages(language, file.text), json: true, maxTokens: 3000, temperature: 0.2 })
  let content
  try {
    content = normalizeBrief(parseJsonObject(result.text))
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable brief. Please try again.')
  }
  if (!content.overview) throw new HttpError(502, 'ai_bad_output', 'The AI returned an empty brief. Please try again.')
  const brief = await db.tx(async (q) => {
    const [row] = await q.query(
      `INSERT INTO case_briefs (org_id, case_id, language, content, model, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [org.id, id, language, JSON.stringify(content), result.model, user.id])
    await recordAiUsage(q, org.id, user.id, 'brief', result)
    await logAiUse(q, { orgId: org.id, userId: user.id, feature: 'brief', model: result.model, caseId: id, prompt: `Case brief (${language})`, output: result.text })
    return row
  })
  await audit(c, 'ai.case_brief', 'case', id, { language, model: result.model })
  const [saved] = await db.query(`SELECT ${BRIEF_COLUMNS} FROM case_briefs b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = $1`, [brief.id])
  return c.json({ brief: saved, stale: false, sources: file.counts }, 201)
})

// Saves a brief as a document on the case (so it can be exported to Word or shared).
aiRoutes.post('/cases/:id/brief/:briefId/save', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const briefId = uuidParam(c.req.param('briefId'), 'Brief')
  const { db } = c.get('deps')
  const [b] = await db.query(
    `SELECT b.*, k.reference, k.title, k.client_id, k.jurisdiction FROM case_briefs b JOIN cases k ON k.id = b.case_id
      WHERE b.id = $1 AND b.case_id = $2 AND b.org_id = $3`, [briefId, id, org.id])
  if (!b) throw notFound('Brief')
  if (b.document_id && (await db.query('SELECT 1 FROM documents WHERE id = $1', [b.document_id])).length) return c.json({ document: { id: b.document_id } })
  await assertCanCreateDocument(db, org)
  const ar = b.language === 'ar'
  const content = briefText(b.content, b.language, b.reference, b.title, new Date(b.created_at).toISOString().slice(0, 10))
  const document = await db.tx(async (q) => {
    const doc = await insertDocument(q, {
      orgId: org.id, userId: user.id, title: `${ar ? 'ملخص القضية' : 'Case brief'} – ${b.reference}`, docType: 'legal_memo', language: b.language,
      jurisdiction: b.jurisdiction, source: 'ai', content, caseId: id, clientId: b.client_id
    })
    await q.query('UPDATE case_briefs SET document_id = $2 WHERE id = $1', [briefId, doc.id])
    // The brief's AI use now belongs to the saved document's record.
    await q.query(`UPDATE ai_use_log SET document_id = $3 WHERE org_id = $1 AND case_id = $2 AND feature = 'brief' AND document_id IS NULL AND created_at <= $4`, [org.id, id, doc.id, b.created_at])
    return doc
  })
  await audit(c, 'ai.case_brief_saved', 'document', document.id)
  return c.json({ document: { id: document.id } }, 201)
})

export default aiRoutes

// Voice note or rough notes on a matter -> transcript plus a reviewed-before-saving file note,
// tasks, dates and client update. Nothing is stored here; /api/cases/:id/dictation saves the result.
aiRoutes.post('/cases/:id/dictation', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db, ai } = c.get('deps')
  const [kase] = await db.query(
    `SELECT k.reference, k.title, k.opposing_party, k.court, k.jurisdiction, cl.name AS client_name
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.id = $1 AND k.org_id = $2`, [id, org.id])
  if (!kase) throw notFound('Case')
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a recording or notes.') })
  const opts = z.object({
    language: z.enum(['auto', 'en', 'ar']).default('auto'),
    output_language: z.enum(['en', 'ar']).default('en'),
    text: z.string().max(MAX_NOTES_CHARS).optional()
  }).safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')))
  if (!opts.success) throw badRequest('Please check the dictation details.')
  const file = form.get('file')
  const typed = opts.data.text?.trim() ?? ''
  if (!(file instanceof File && file.size > 0) && !typed) throw badRequest('Record a voice note, upload one, or type your notes.')
  throttle(c)
  await assertCanUseAi(db, org)

  let transcript = typed
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'file_too_large', 'Recordings must be smaller than 25 MB (about 25 minutes).')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = sniffAudio(bytes, file.name)
    if (!kind) throw new HttpError(415, 'unsupported_file', 'Upload a voice note as MP3, M4A, OGG/Opus (WhatsApp), WebM or WAV.')
    const lang = opts.data.language === 'auto' ? undefined : opts.data.language
    const heard = await ai.transcribe({
      bytes, mime: kind.mime, fileName: `dictation.${kind.ext}`, language: lang,
      prompt: [kase.reference, kase.title, kase.client_name, kase.opposing_party, kase.court].filter(Boolean).join(', ')
    })
    await recordAiUsage(db, org.id, user.id, 'transcribe', heard)
    if (!heard.text) throw new HttpError(422, 'audio_silent', 'No speech was found in this recording.')
    transcript = typed ? `${heard.text}\n\n${typed}` : heard.text
  }

  const result = await ai.complete({
    messages: dictationMessages({ transcript, lang: opts.data.output_language, today: localToday(kase.jurisdiction), kase: kase as any, lawyer: user.name }),
    json: true, maxTokens: 3000, temperature: 0.1
  })
  await recordAiUsage(db, org.id, user.id, 'dictation', result)
  let structured
  try {
    structured = normalizeDictation(parseJsonObject(result.text))
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable result. Please try again.')
  }
  if (!structured.note) structured.note = transcript
  const checked = checkDictationDates(structured, transcript)
  await logAiUse(db, { orgId: org.id, userId: user.id, feature: 'dictation', model: result.model, caseId: id, prompt: `Dictation: ${transcript.slice(0, 900)}`, output: JSON.stringify(checked),
    verification: { status: checked.dates_removed ? 'passed_with_warnings' : 'passed', errors: 0, warnings: checked.dates_removed,
      checks: checked.dates_removed ? [{ kind: 'date', severity: 'warning', ok: false, code: 'date_not_in_dictation', detail: `${checked.dates_removed} date(s) removed: they could not be traced to the dictation.` }] : [] } })
  await audit(c, 'ai.dictation', 'case', id, { audio: file instanceof File && file.size > 0, language: opts.data.output_language })
  return c.json({ transcript, result: checked, has_client: !!kase.client_name })
})

// ---------------- AI use and verification log ----------------

const logFilter = z.object({ document_id: optUuid, case_id: optUuid, conversation_id: optUuid })

async function logRows(db: Queryable, orgId: string, f: { document_id?: string | null; case_id?: string | null; conversation_id?: string | null }) {
  const params: unknown[] = [orgId]
  const conds = ['l.org_id = $1']
  for (const [k, v] of Object.entries(f)) if (v) { params.push(v); conds.push(`l.${k} = $${params.length}`) }
  return db.query(`SELECT ${LOG_COLUMNS} FROM ${LOG_FROM} WHERE ${conds.join(' AND ')} ORDER BY l.created_at LIMIT 1000`, params)
}

aiRoutes.get('/log', async (c) => {
  const { org } = auth(c)
  const f = logFilter.safeParse(c.req.query())
  if (!f.success) throw badRequest('Invalid filter.')
  return c.json({ items: await logRows(c.get('deps').db, org.id, f.data) })
})

// Links an AI answer (e.g. a research chat answer) to the document it was used in.
aiRoutes.post('/log/:id/attach', jsonBody(z.object({ document_id: z.string().uuid() })), async (c) => {
  const { org } = auth(c)
  requireRole(c, 'owner', 'admin', 'lawyer')
  const id = uuidParam(c.req.param('id'), 'Log entry')
  const { document_id } = c.req.valid('json')
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM documents WHERE id = $1 AND org_id = $2', [document_id, org.id])).length) throw badRequest('Selected document does not exist.')
  const rows = await db.query('UPDATE ai_use_log SET document_id = $3 WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id, document_id])
  if (!rows.length) throw notFound('Log entry')
  await audit(c, 'ai.log_attached', 'document', document_id, { log_id: id })
  return c.json({ ok: true })
})

// A lawyer records that they checked the AI output against the primary sources.
aiRoutes.post('/log/:id/review', jsonBody(z.object({ note: z.string().trim().max(1000).nullish() })), async (c) => {
  const { user, org } = auth(c)
  requireRole(c, 'owner', 'admin', 'lawyer')
  const id = uuidParam(c.req.param('id'), 'Log entry')
  const rows = await c.get('deps').db.query(
    'UPDATE ai_use_log SET reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id, user.id, c.req.valid('json').note ?? null])
  if (!rows.length) throw notFound('Log entry')
  await audit(c, 'ai.output_verified', 'ai_use_log', id)
  return c.json({ ok: true })
})

// Export: format=txt (disclosure statement, en or ar), csv or json.
aiRoutes.get('/log/export', async (c) => {
  const { org } = auth(c)
  const f = logFilter.extend({ format: z.enum(['txt', 'csv', 'json']).default('txt'), lang: z.enum(['en', 'ar']).default('en') }).safeParse(c.req.query())
  if (!f.success) throw badRequest('Invalid export options.')
  const { format, lang, ...filter } = f.data
  const { db } = c.get('deps')
  const document = filter.document_id ? await db.one<{ title: string }>('SELECT title FROM documents WHERE id = $1 AND org_id = $2', [filter.document_id, org.id]) : null
  if (filter.document_id && !document) throw notFound('Document')
  const rows = await logRows(db, org.id, filter)
  const base = `ai-use-log${document ? `-${document.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}` : ''}`
  await audit(c, 'ai.log_exported', document ? 'document' : 'organization', filter.document_id ?? org.id, { format, entries: rows.length })
  if (format === 'json') {
    return new Response(JSON.stringify({ firm: org.name, document, generated_at: new Date().toISOString(), entries: rows }, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': contentDisposition(`${base}.json`), 'cache-control': 'private, no-store' }
    })
  }
  if (format === 'csv') {
    return new Response(logCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': contentDisposition(`${base}.csv`), 'cache-control': 'private, no-store' } })
  }
  return new Response(logDisclosure(rows, { lang, firm: org.name, document }), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': contentDisposition(`${base}.txt`), 'cache-control': 'private, no-store' }
  })
})

// ---------------- Report a problem with AI output ----------------

export const FEEDBACK_REASONS = ['wrong_fact', 'wrong_citation', 'not_in_source', 'wrong_date', 'unsafe', 'other'] as const

aiRoutes.post('/feedback', jsonBody(z.object({
  feature: z.string().trim().min(2).max(60),
  log_id: z.string().uuid().nullish(),
  reason: z.enum(FEEDBACK_REASONS),
  note: z.string().trim().max(2000).nullish(),
  // The part of the output the user is reporting (kept short; no need to copy whole documents).
  excerpt: z.string().trim().max(1000).nullish()
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, mailer, config, log } = c.get('deps')
  if (b.log_id && !(await db.query('SELECT 1 FROM ai_use_log WHERE id = $1 AND org_id = $2', [b.log_id, org.id])).length) throw notFound('Log entry')
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ai_feedback (org_id, user_id, log_id, feature, reason, note, excerpt) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [org.id, user.id, b.log_id ?? null, b.feature, b.reason, b.note ?? null, b.excerpt ?? null])
  await audit(c, 'ai.problem_reported', 'ai_feedback', row!.id, { feature: b.feature, reason: b.reason })
  if (mailer.configured && config.platformAdminEmails.length) {
    mailer.send({
      to: config.platformAdminEmails[0]!,
      subject: `AI problem reported: ${b.feature} (${b.reason})`,
      text: [`Firm: ${org.name}`, `Feature: ${b.feature}`, `Reason: ${b.reason}`, b.note ? `Note: ${b.note}` : '', b.log_id ? `AI log entry: ${b.log_id}` : '', `Review: ${config.appUrl}/app#/admin`].filter(Boolean).join('\n')
    }).catch((err) => log.warn('ai feedback email failed', { err }))
  }
  return c.json({ id: row!.id }, 201)
})
