import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv, type Ctx } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, optUuid, uuidParam } from '../lib/http'
import { JURISDICTION_CODES, isGcc, jurisdictionName, templateName, DOCUMENT_TEMPLATES } from '../services/reference'
import { analysisMessages, chatSystemPrompt, draftMessages, normalizeAnalysis, parseJsonObject, type AnalysisType } from '../services/legal-prompts'
import { assertCanCreateDocument, assertCanUseAi, recordAiUsage } from '../services/usage'
import { type Passage, citationLabel, citedRefs, findReferencedSources, lawReferences, referencedPassages, searchLibrary } from '../services/library'
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
  const messages = await db.query('SELECT id, role, content, sources, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at, id', [id])
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
  library_only: z.boolean().default(false)
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
  // Retrieve from the jurisdiction's law plus GCC-wide instruments; include the previous question for follow-ups.
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  const query = `${b.message} ${lastUser}`.slice(0, 1500)
  // A law named by number (e.g. "Royal Decree 48/2009") is looked up directly, in any jurisdiction,
  // and its own text comes first; general retrieval fills the rest.
  const named = await findReferencedSources(db, org.id, lawReferences(b.message).length ? lawReferences(b.message) : lawReferences(lastUser))
  const passages: Passage[] = []
  for (const s of named) passages.push(...await referencedPassages(db, org.id, s.id, query, named.length > 1 ? 5 : 10))
  const seen = new Set(passages.map((p) => p.id))
  for (const p of await searchLibrary(db, org.id, query, { jurisdictions: isGcc(jurisdiction) ? [jurisdiction, 'gcc'] : [jurisdiction], limit: 6 })) {
    if (passages.length >= 14) break
    if (!seen.has(p.id)) { seen.add(p.id); passages.push(p) }
  }
  const sources = passages.map((p, i) => ({ ref: `S${i + 1}`, chunk_id: p.id, source_id: p.source_id, citation: citationLabel(p), status: p.status, text: p.text }))
  const system = chatSystemPrompt({ lang: b.language, jurisdiction, caseContext: await caseContext(db, org.id, conv.case_id), sources, libraryOnly: b.library_only })

  const result = await ai.complete({ messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: b.message }], maxTokens: 3000 })
  // Keep only sources the answer actually cites.
  const refs = citedRefs(result.text)
  const cited = sources.filter((s) => refs.has(s.ref)).map(({ text: _t, ...rest }) => rest)

  await db.tx(async (q) => {
    await q.query(`INSERT INTO ai_messages (org_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`, [org.id, conv.id, b.message])
    await q.query(`INSERT INTO ai_messages (org_id, conversation_id, role, content, sources, created_at) VALUES ($1, $2, 'assistant', $3, $4, now() + interval '1 millisecond')`,
      [org.id, conv.id, result.text, cited.length ? JSON.stringify(cited) : null])
    await q.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id])
    await recordAiUsage(q, org.id, user.id, 'chat', result)
  })
  return c.json({ conversation_id: conv.id, reply: result.text, sources: cited, library_matches: sources.length, model: result.model })
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
  const draftQuery = `${b.instructions} ${b.parties ?? ''}`.slice(0, 1500)
  const draftPassages: Passage[] = []
  for (const s of await findReferencedSources(db, org.id, lawReferences(draftQuery))) draftPassages.push(...await referencedPassages(db, org.id, s.id, draftQuery, 4))
  const seenDraft = new Set(draftPassages.map((p) => p.id))
  for (const p of await searchLibrary(db, org.id, draftQuery, { jurisdictions: isGcc(b.jurisdiction) ? [b.jurisdiction, 'gcc'] : [b.jurisdiction], limit: 6 })) {
    if (draftPassages.length >= 8) break
    if (!seenDraft.has(p.id)) { seenDraft.add(p.id); draftPassages.push(p) }
  }
  const draftSources = draftPassages.map((p, i) => ({ ref: `S${i + 1}`, citation: citationLabel(p), text: p.text }))
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
  const document = await db.tx(async (q) => {
    const doc = await insertDocument(q, {
      orgId: org.id, userId: user.id, title: b.title || (b.language === 'ar' ? tpl.name_ar : tpl.name), docType: b.template,
      language: b.language, jurisdiction: b.jurisdiction, source: 'ai', content, caseId: b.case_id, clientId: b.client_id
    })
    await recordAiUsage(q, org.id, user.id, 'draft', result)
    return doc
  })
  await audit(c, 'ai.drafted', 'document', document.id, { template: b.template, model: result.model })
  return c.json({ document }, 201)
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
