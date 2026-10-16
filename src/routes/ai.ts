import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, optUuid, uuidParam } from '../lib/http'
import { JURISDICTION_CODES, jurisdictionName, templateName, DOCUMENT_TEMPLATES } from '../services/reference'
import { analysisMessages, chatSystemPrompt, draftMessages, normalizeAnalysis, parseJsonObject, type AnalysisType } from '../services/legal-prompts'
import { assertCanCreateDocument, assertCanUseAi, recordAiUsage } from '../services/usage'
import { citedRefs } from '../services/library'
import { allowedJurisdictions, citedSummary, groundQuestion, gulfToday } from '../services/grounding'
import { verifyAnswer } from '../services/verify'
import { LOG_COLUMNS, LOG_FROM, logAiUse, logCsv, logDisclosure } from '../services/ai-log'
import { contentDisposition } from '../services/export'
import { insertDocument } from './documents'
import { briefMessages, briefText, gatherCaseFile, normalizeBrief } from '../services/case-brief'
import { dictationMessages, localToday, MAX_AUDIO_BYTES, MAX_NOTES_CHARS, normalizeDictation, sniffAudio } from '../services/dictation'

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
  // The date the law should be applied as of (e.g. when the facts happened). Defaults to today.
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? undefined)
})), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
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
  const { sources, namedSourceIds, retrieval } = await groundQuestion(c.get('deps'), org.id, { question: b.message, context: lastUser, jurisdiction, asOf, max: 14 })
  const system = chatSystemPrompt({ lang: b.language, jurisdiction, asOf, caseContext: await caseContext(db, org.id, conv.case_id), sources, libraryOnly: b.library_only })

  const result = await ai.complete({ messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: b.message }], maxTokens: 3000 })
  // Deterministic check of quotes, article numbers, validity on the date and jurisdiction.
  const verification = await verifyAnswer(db, { orgId: org.id, answer: result.text, sources, asOf, allowedJurisdictions: allowedJurisdictions(jurisdiction), namedSourceIds })
  // Keep only sources the answer actually cites.
  const refs = citedRefs(result.text)
  const cited = sources.filter((s) => refs.has(s.ref)).map(citedSummary)

  const logId = await db.tx(async (q) => {
    await q.query(`INSERT INTO ai_messages (org_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [org.id, conv.id, b.message])
    const msg = await q.one<{ id: string }>(`INSERT INTO ai_messages (org_id, conversation_id, role, content, sources, verification, created_at) VALUES ($1, $2, 'assistant', $3, $4, $5, now() + interval '1 millisecond') RETURNING id`,
      [org.id, conv.id, result.text, cited.length ? JSON.stringify(cited) : null, JSON.stringify(verification)])
    await q.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id])
    await recordAiUsage(q, org.id, user.id, 'chat', result)
    return logAiUse(q, {
      orgId: org.id, userId: user.id, feature: 'chat', model: result.model, caseId: conv.case_id, conversationId: conv.id, messageId: msg!.id,
      jurisdiction, asOf, prompt: b.message, output: result.text, sources: cited, verification
    })
  })
  return c.json({ conversation_id: conv.id, reply: result.text, sources: cited, library_matches: sources.length, model: result.model, verification, retrieval, log_id: logId })
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
  const result = await ai.complete({
    messages: draftMessages({
      templateName: tName, templateId: b.template, lang: b.language, jurisdiction: b.jurisdiction, instructions: b.instructions, parties: b.parties,
      caseContext: await caseContext(db, org.id, b.case_id), sources: draftSources
    }),
    maxTokens: 6000,
    temperature: 0.3
  })
  const content = result.text.replace(/^```[a-z]*\n?|```$/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim()
  const tpl = DOCUMENT_TEMPLATES.find((t) => t.id === b.template)!
  // Drafts cite by law name and article number; check those against the library the same way.
  const verification = await verifyAnswer(db, { orgId: org.id, answer: content, sources: draftSources, asOf, allowedJurisdictions: allowedJurisdictions(b.jurisdiction), namedSourceIds, implicitRefs: true })
  const usedRefs = new Set(verification.checks.map((x) => x.ref).filter(Boolean))
  const document = await db.tx(async (q) => {
    const doc = await insertDocument(q, {
      orgId: org.id, userId: user.id, title: b.title || (b.language === 'ar' ? tpl.name_ar : tpl.name), docType: b.template,
      language: b.language, jurisdiction: b.jurisdiction, source: 'ai', content, caseId: b.case_id, clientId: b.client_id
    })
    await recordAiUsage(q, org.id, user.id, 'draft', result)
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
  const result = await ai.complete({
    messages: analysisMessages({ type: b.type as AnalysisType, lang: b.language, jurisdiction, title: doc.title, text: doc.content }),
    json: true,
    maxTokens: 4000
  })
  let analysis
  try {
    analysis = normalizeAnalysis(parseJsonObject(result.text))
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable analysis. Please try again.')
  }
  const saved = await db.tx(async (q) => {
    const row = await q.one(
      `INSERT INTO document_analyses (org_id, document_id, analysis_type, language, jurisdiction, result, model, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, analysis_type, language, jurisdiction, result, model, created_at`,
      [org.id, id, b.type, b.language, jurisdiction, JSON.stringify(analysis), result.model, user.id])
    await recordAiUsage(q, org.id, user.id, `analysis:${b.type}`, result)
    await logAiUse(q, { orgId: org.id, userId: user.id, feature: `analysis:${b.type}`, model: result.model, documentId: id, jurisdiction, prompt: `${b.type} analysis of ${doc.title}`, output: result.text })
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
  await audit(c, 'ai.dictation', 'case', id, { audio: file instanceof File && file.size > 0, language: opts.data.output_language })
  return c.json({ transcript, result: structured, has_client: !!kase.client_name })
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
