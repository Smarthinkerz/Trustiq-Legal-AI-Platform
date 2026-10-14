import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { HttpError, notFound } from '../lib/errors'
import { jsonBody, queryParams, uuidParam } from '../lib/http'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition, renderDocx, safeFileName } from '../services/export'
import { baseChecklist, gatherPrep, normalizePrep, prepMessages, prepText, type CheckItem } from '../services/hearing-prep'
import { parseJsonObject } from '../services/legal-prompts'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { throttle } from './ai'

// Preparing for one hearing: the facts, an AI preparation note and a checklist.
const hearingPrepRoutes = new Hono<AppEnv>()
const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

async function load(c: any) {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Hearing')
  const { db } = c.get('deps')
  const facts = await gatherPrep(db, org.id, id)
  if (!facts) throw notFound('Hearing')
  const [prep] = await db.query(
    `SELECT p.language, p.content, p.checklist, p.model, p.updated_at, u.name AS created_by_name FROM hearing_preps p LEFT JOIN users u ON u.id = p.created_by WHERE p.event_id = $1`, [id])
  return { id, facts, prep: prep ?? null }
}

hearingPrepRoutes.get('/:id', async (c) => {
  requireRole(c, ...staff)
  const { user } = auth(c)
  const { facts, prep } = await load(c)
  const { text: _text, ...rest } = facts
  const lang = user.locale === 'ar' ? 'ar' : 'en'
  return c.json({ ...rest, prep, checklist: (prep?.checklist as CheckItem[] | undefined)?.length ? prep.checklist : baseChecklist(facts, lang) })
})

hearingPrepRoutes.post('/:id/ai', jsonBody(z.object({ language: z.enum(['en', 'ar']) })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const { id, facts, prep } = await load(c)
  const { language } = c.req.valid('json')
  const { db, ai } = c.get('deps')
  throttle(c)
  await assertCanUseAi(db, org)
  const result = await ai.complete({ messages: prepMessages(language, facts.text), json: true, maxTokens: 2500, temperature: 0.2 })
  let note
  try { note = normalizePrep(parseJsonObject(result.text)) } catch { throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable note. Please try again.') }
  if (!note.summary && !note.objectives.length) throw new HttpError(502, 'ai_bad_output', 'The AI returned an empty note. Please try again.')
  // Keep what is already on the checklist (and ticked), then add the AI's items.
  const current: CheckItem[] = prep?.checklist?.length ? prep.checklist : baseChecklist(facts, language)
  const seen = new Set(current.map((x) => x.text.trim().toLowerCase()))
  const checklist = [...current, ...note.checklist.filter((t) => !seen.has(t.toLowerCase())).map((text) => ({ text, done: false }))].slice(0, 40)
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO hearing_preps (event_id, org_id, case_id, language, content, checklist, model, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO UPDATE SET language = $4, content = $5, checklist = $6, model = $7, created_by = $8, updated_at = now()`,
      [id, org.id, facts.case.id, language, JSON.stringify(note), JSON.stringify(checklist), result.model, user.id])
    await recordAiUsage(q, org.id, user.id, 'hearing_prep', result)
  })
  await audit(c, 'ai.hearing_prep', 'event', id, { language, model: result.model })
  return c.json({ prep: { language, content: note, checklist, model: result.model } }, 201)
})

hearingPrepRoutes.put('/:id/checklist', jsonBody(z.object({
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() })).max(40)
})), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const { id, facts } = await load(c)
  const { checklist } = c.req.valid('json')
  await c.get('deps').db.query(
    `INSERT INTO hearing_preps (event_id, org_id, case_id, checklist, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO UPDATE SET checklist = $4, updated_at = now()`, [id, org.id, facts.case.id, JSON.stringify(checklist), user.id])
  return c.json({ checklist })
})

// The preparation sheet as a Word document (internal).
hearingPrepRoutes.get('/:id/docx', queryParams(z.object({ lang: z.enum(['en', 'ar']).optional() })), async (c) => {
  requireRole(c, ...staff)
  const { org, user } = auth(c)
  const { id, facts, prep } = await load(c)
  const lang = c.req.valid('query').lang ?? prep?.language ?? (user.locale === 'ar' ? 'ar' : 'en')
  const checklist = prep?.checklist?.length ? prep.checklist : baseChecklist(facts, lang)
  const date = new Date(facts.event.starts_at).toISOString().slice(0, 10)
  const content = prepText({ lang, reference: facts.case.reference, title: facts.case.title, date, court: facts.case.court, note: prep?.content ?? null, checklist,
    last: facts.last ? { date: facts.last.date, outcome: facts.last.outcome, next_steps: facts.last.next_steps } : null })
  const [lh] = await c.get('deps').db.query('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const buf = await renderDocx({ title: lang === 'ar' ? `تحضير الجلسة – ${facts.case.reference}` : `Hearing preparation – ${facts.case.reference}`, content, language: lang, letterhead: lh ?? null })
  await audit(c, 'hearing_prep.exported', 'event', id)
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(`hearing-prep-${facts.case.reference}-${date}`, 'docx')), 'cache-control': 'private, no-store' }
  })
})

export default hearingPrepRoutes
