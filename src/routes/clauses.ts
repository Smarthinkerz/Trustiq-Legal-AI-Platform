import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, likePattern, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { CLAUSE_CATEGORIES, CLAUSE_LIMIT } from '../services/playbook'
import { cleanTranslation, termsInText, translationMessages, type GlossaryTerm } from '../services/translation'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

// The firm's clause bank: approved wording in English and Arabic, ready to insert into drafts.
const body = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null))
const clauseFields = {
  title: z.string().trim().min(2).max(200),
  category: z.enum(CLAUSE_CATEGORIES).default('general'),
  body_en: body(20_000),
  body_ar: body(20_000),
  note: optText(2000)
}
const clauseSchema = z.object(clauseFields)
export const CLAUSE_COLS = 'id, title, category, body_en, body_ar, note, usage_count, created_at, updated_at'

const clauseRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

clauseRoutes.get('/', queryParams(z.object({ q: z.string().trim().max(200).optional(), category: z.enum(CLAUSE_CATEGORIES).optional() })), async (c) => {
  const { org } = auth(c)
  const { q, category } = c.req.valid('query')
  const items = await c.get('deps').db.query(
    `SELECT ${CLAUSE_COLS} FROM clauses WHERE org_id = $1 AND ($2::text IS NULL OR category = $2)
        AND ($3::text IS NULL OR title ILIKE $3 OR body_en ILIKE $3 OR body_ar ILIKE $3 OR note ILIKE $3)
      ORDER BY category, usage_count DESC, lower(title) LIMIT ${CLAUSE_LIMIT}`, [org.id, category ?? null, q ? likePattern(q) : null])
  return c.json({ items })
})

clauseRoutes.post('/', jsonBody(clauseSchema), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (!b.body_en && !b.body_ar) throw badRequest('Enter the clause wording in English, Arabic or both.')
  const { db } = c.get('deps')
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM clauses WHERE org_id = $1', [org.id])
  if (n >= CLAUSE_LIMIT) throw badRequest(`The clause bank can hold up to ${CLAUSE_LIMIT} clauses.`)
  const clause = await db.one(
    `INSERT INTO clauses (org_id, title, category, body_en, body_ar, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CLAUSE_COLS}`,
    [org.id, b.title, b.category, b.body_en, b.body_ar, b.note, user.id])
  await audit(c, 'clause.created', 'clause', clause!.id)
  return c.json({ clause }, 201)
})

clauseRoutes.patch('/:id', jsonBody(updateBody(clauseFields)), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Clause')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await db.one('SELECT body_en, body_ar FROM clauses WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!cur) throw notFound('Clause')
  const next = { body_en: b.body_en !== undefined ? b.body_en : cur.body_en, body_ar: b.body_ar !== undefined ? b.body_ar : cur.body_ar }
  if (!next.body_en && !next.body_ar) throw badRequest('Enter the clause wording in English, Arabic or both.')
  const clause = await db.one(
    `UPDATE clauses SET title = coalesce($3, title), category = coalesce($4, category), body_en = $5, body_ar = $6,
        note = CASE WHEN $7::boolean THEN $8 ELSE note END, updated_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING ${CLAUSE_COLS}`,
    [id, org.id, b.title ?? null, b.category ?? null, next.body_en, next.body_ar, b.note !== undefined, b.note ?? null])
  await audit(c, 'clause.updated', 'clause', id)
  return c.json({ clause })
})

clauseRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Clause')
  const rows = await c.get('deps').db.query('DELETE FROM clauses WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Clause')
  await audit(c, 'clause.deleted', 'clause', id)
  return c.json({ ok: true })
})

// Counts insertions so the most used wording rises to the top of the picker.
clauseRoutes.post('/:id/used', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Clause')
  const rows = await c.get('deps').db.query('UPDATE clauses SET usage_count = usage_count + 1 WHERE id = $1 AND org_id = $2 RETURNING usage_count', [id, org.id])
  if (!rows.length) throw notFound('Clause')
  return c.json({ usage_count: rows[0].usage_count })
})

// Drafts the missing language with AI, following the firm's glossary. The lawyer reviews it before saving.
clauseRoutes.post('/:id/translate', jsonBody(z.object({ to: z.enum(['en', 'ar']) })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Clause')
  const { to } = c.req.valid('json')
  const deps = c.get('deps')
  const { db, ai } = deps
  const clause = await db.one('SELECT body_en, body_ar FROM clauses WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!clause) throw notFound('Clause')
  const from = to === 'ar' ? 'en' : 'ar'
  const source: string | null = from === 'en' ? clause.body_en : clause.body_ar
  if (!source) throw badRequest('There is no text to translate from.')
  if (!deps.limiters.ai.take(user.id).ok) throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  await assertCanUseAi(db, org)
  const terms = await db.query<GlossaryTerm>('SELECT term_en, term_ar, note FROM glossary_terms WHERE org_id = $1', [org.id])
  const out = await ai.complete({ messages: translationMessages(source, from, to, termsInText(terms, source, from)), maxTokens: 4000, temperature: 0.1 })
  await recordAiUsage(db, org.id, user.id, 'clause_translation', out)
  const text = cleanTranslation(out.text)
  if (!text) throw new HttpError(502, 'ai_bad_output', 'The AI returned an empty translation. Please try again.')
  return c.json({ text: text.slice(0, 20_000) })
})

export default clauseRoutes
