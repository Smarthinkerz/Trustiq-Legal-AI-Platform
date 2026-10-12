import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, likePattern, optText, queryParams, uuidParam } from '../lib/http'
import { parseGlossary } from '../services/translation'

// The firm's English <-> Arabic legal glossary, applied to every AI translation.
const MAX_TERMS = 5000
const termSchema = z.object({
  term_en: z.string().trim().min(1).max(200),
  term_ar: z.string().trim().min(1).max(200),
  note: optText(300)
})
const COLS = 'id, term_en, term_ar, note, created_at, updated_at'

const glossaryRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

glossaryRoutes.get('/', queryParams(z.object({ q: z.string().trim().max(200).optional() })), async (c) => {
  const { org } = auth(c)
  const { q } = c.req.valid('query')
  const { db } = c.get('deps')
  const items = await db.query(
    `SELECT ${COLS} FROM glossary_terms WHERE org_id = $1 AND ($2::text IS NULL OR term_en ILIKE $2 OR term_ar ILIKE $2 OR note ILIKE $2)
      ORDER BY lower(term_en) LIMIT ${MAX_TERMS}`, [org.id, q ? likePattern(q) : null])
  return c.json({ items })
})

glossaryRoutes.post('/', jsonBody(termSchema), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM glossary_terms WHERE org_id = $1', [org.id])
  if (n >= MAX_TERMS) throw badRequest(`The glossary can hold up to ${MAX_TERMS} terms.`)
  const [term] = await db.query(
    `INSERT INTO glossary_terms (org_id, term_en, term_ar, note, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, lower(term_en)) DO NOTHING RETURNING ${COLS}`, [org.id, b.term_en, b.term_ar, b.note, user.id])
  if (!term) throw conflict(`"${b.term_en}" is already in the glossary.`)
  await audit(c, 'glossary.created', 'glossary_term', term.id)
  return c.json({ term }, 201)
})

// Paste many lines at once: "term = مصطلح", CSV or tab separated. Existing terms are updated.
glossaryRoutes.post('/import', jsonBody(z.object({ text: z.string().max(500_000) })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const rows = parseGlossary(c.req.valid('json').text)
  if (!rows.length) throw badRequest('No terms found. Put one English term and its Arabic translation on each line, for example: Lessee = المستأجر')
  const { db } = c.get('deps')
  const result = await db.tx(async (q) => {
    const [{ n }] = await q.query('SELECT count(*)::int AS n FROM glossary_terms WHERE org_id = $1', [org.id])
    let added = 0
    let updated = 0
    for (const r of rows) {
      const [row] = await q.query(
        `INSERT INTO glossary_terms (org_id, term_en, term_ar, note, created_by) SELECT $1, $2, $3, $4, $5
          WHERE $6::int < ${MAX_TERMS} OR EXISTS (SELECT 1 FROM glossary_terms WHERE org_id = $1 AND lower(term_en) = lower($2))
         ON CONFLICT (org_id, lower(term_en)) DO UPDATE SET term_ar = EXCLUDED.term_ar, note = coalesce(EXCLUDED.note, glossary_terms.note), updated_at = now()
         RETURNING (xmax = 0) AS inserted`, [org.id, r.term_en, r.term_ar, r.note, user.id, n + added])
      if (!row) continue
      if (row.inserted) added++
      else updated++
    }
    return { added, updated, skipped: rows.length - added - updated }
  })
  await audit(c, 'glossary.imported', 'glossary_term', undefined, result)
  return c.json(result)
})

glossaryRoutes.patch('/:id', jsonBody(termSchema.partial()), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Term')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  try {
    const [term] = await db.query(
      `UPDATE glossary_terms SET term_en = coalesce($3, term_en), term_ar = coalesce($4, term_ar), note = CASE WHEN $5::boolean THEN $6 ELSE note END, updated_at = now()
        WHERE id = $1 AND org_id = $2 RETURNING ${COLS}`, [id, org.id, b.term_en ?? null, b.term_ar ?? null, b.note !== undefined, b.note ?? null])
    if (!term) throw notFound('Term')
    await audit(c, 'glossary.updated', 'glossary_term', id)
    return c.json({ term })
  } catch (err: any) {
    if (err?.code === '23505') throw conflict(`"${b.term_en}" is already in the glossary.`)
    throw err
  }
})

glossaryRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Term')
  const rows = await c.get('deps').db.query('DELETE FROM glossary_terms WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Term')
  await audit(c, 'glossary.deleted', 'glossary_term', id)
  return c.json({ ok: true })
})

export default glossaryRoutes
