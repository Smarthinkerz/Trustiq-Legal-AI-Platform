import { appearsIn } from '../services/ai-guard'
import { logAiUse } from '../services/ai-log'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, optText, optUuid, queryParams, updateBody, uuidParam } from '../lib/http'
import { parseJsonObject } from '../services/legal-prompts'
import { CLAUSE_CATEGORIES, CLAUSE_LIMIT, normalizeReview, scoreReview, reviewMessages, RULE_LIMIT, SEVERITIES, STARTER_CLAUSES, STARTER_RULES, type Rule } from '../services/playbook'
import { jurisdictionName } from '../services/reference'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

// The firm's negotiation playbook, and AI review of a contract against it.
const ruleFields = {
  category: z.enum(CLAUSE_CATEGORIES).default('general'),
  topic: z.string().trim().min(2).max(200),
  standard_position: z.string().trim().min(2).max(3000),
  fallback_position: optText(3000),
  red_flags: optText(3000),
  severity: z.enum(SEVERITIES).default('medium'),
  clause_id: optUuid,
  active: z.boolean().default(true)
}
const ruleSchema = z.object(ruleFields)
const RULE_COLS = `r.id, r.category, r.topic, r.standard_position, r.fallback_position, r.red_flags, r.severity, r.clause_id, r.active, r.created_at, r.updated_at, cl.title AS clause_title`
const REVIEW_COLS = `v.id, v.document_id, v.document_version, v.language, v.acting_for, v.result, v.model, v.created_at, u.name AS created_by_name`

const playbookRoutes = new Hono<AppEnv>()
const managers = ['owner', 'admin'] as const

async function assertClause(db: any, orgId: string, clauseId: string | null | undefined) {
  if (clauseId && !(await db.one('SELECT 1 FROM clauses WHERE id = $1 AND org_id = $2', [clauseId, orgId]))) throw badRequest('That clause is not in your clause bank.')
}

playbookRoutes.get('/rules', async (c) => {
  const { org } = auth(c)
  const items = await c.get('deps').db.query(
    `SELECT ${RULE_COLS} FROM playbook_rules r LEFT JOIN clauses cl ON cl.id = r.clause_id
      WHERE r.org_id = $1 ORDER BY r.active DESC, CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, lower(r.topic)`, [org.id])
  return c.json({ items })
})

playbookRoutes.post('/rules', jsonBody(ruleSchema), async (c) => {
  requireRole(c, ...managers)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM playbook_rules WHERE org_id = $1', [org.id])
  if (n >= RULE_LIMIT) throw badRequest(`The playbook can hold up to ${RULE_LIMIT} rules.`)
  await assertClause(db, org.id, b.clause_id)
  const row = await db.one(
    `INSERT INTO playbook_rules (org_id, category, topic, standard_position, fallback_position, red_flags, severity, clause_id, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [org.id, b.category, b.topic, b.standard_position, b.fallback_position, b.red_flags, b.severity, b.clause_id, b.active, user.id])
  await audit(c, 'playbook.rule_created', 'playbook_rule', row!.id)
  const rule = await db.one(`SELECT ${RULE_COLS} FROM playbook_rules r LEFT JOIN clauses cl ON cl.id = r.clause_id WHERE r.id = $1`, [row!.id])
  return c.json({ rule }, 201)
})

playbookRoutes.patch('/rules/:id', jsonBody(updateBody(ruleFields)), async (c) => {
  requireRole(c, ...managers)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Rule')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertClause(db, org.id, b.clause_id)
  const has = (k: keyof typeof b) => b[k] !== undefined
  const rows = await db.query(
    `UPDATE playbook_rules SET category = coalesce($3, category), topic = coalesce($4, topic), standard_position = coalesce($5, standard_position),
        fallback_position = CASE WHEN $6::boolean THEN $7 ELSE fallback_position END,
        red_flags = CASE WHEN $8::boolean THEN $9 ELSE red_flags END,
        severity = coalesce($10, severity),
        clause_id = CASE WHEN $11::boolean THEN $12::uuid ELSE clause_id END,
        active = coalesce($13, active), updated_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING id`,
    [id, org.id, has('category') ? b.category : null, b.topic ?? null, b.standard_position ?? null,
      has('fallback_position'), b.fallback_position ?? null, has('red_flags'), b.red_flags ?? null,
      b.severity ?? null, has('clause_id'), b.clause_id ?? null, has('active') ? b.active : null])
  if (!rows.length) throw notFound('Rule')
  await audit(c, 'playbook.rule_updated', 'playbook_rule', id)
  const rule = await db.one(`SELECT ${RULE_COLS} FROM playbook_rules r LEFT JOIN clauses cl ON cl.id = r.clause_id WHERE r.id = $1`, [id])
  return c.json({ rule })
})

playbookRoutes.delete('/rules/:id', async (c) => {
  requireRole(c, ...managers)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Rule')
  const rows = await c.get('deps').db.query('DELETE FROM playbook_rules WHERE id = $1 AND org_id = $2 RETURNING id', [id, org.id])
  if (!rows.length) throw notFound('Rule')
  await audit(c, 'playbook.rule_deleted', 'playbook_rule', id)
  return c.json({ ok: true })
})

// Loads the GCC starter playbook and its bilingual clauses. Topics and titles the firm already has are skipped.
playbookRoutes.post('/starter', jsonBody(z.object({ language: z.enum(['en', 'ar']).default('en') })), async (c) => {
  requireRole(c, ...managers)
  const { user, org } = auth(c)
  const { language } = c.req.valid('json')
  const { db } = c.get('deps')
  const result = await db.tx(async (q) => {
    const clauseIds = new Map<string, string>()
    let clauses = 0
    let rules = 0
    const [{ nc }] = await q.query('SELECT count(*)::int AS nc FROM clauses WHERE org_id = $1', [org.id])
    for (const s of STARTER_CLAUSES) {
      const title = s.title[language]
      const existing = await q.one('SELECT id FROM clauses WHERE org_id = $1 AND lower(title) = lower($2)', [org.id, title])
      if (existing) { clauseIds.set(s.key, existing.id); continue }
      if (nc + clauses >= CLAUSE_LIMIT) continue
      const row = await q.one(
        `INSERT INTO clauses (org_id, title, category, body_en, body_ar, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [org.id, title, s.category, s.body_en, s.body_ar, user.id])
      clauseIds.set(s.key, row!.id)
      clauses++
    }
    const [{ nr }] = await q.query('SELECT count(*)::int AS nr FROM playbook_rules WHERE org_id = $1', [org.id])
    for (const r of STARTER_RULES) {
      const [topic, standard, fallback, flags] = r[language]
      if (await q.one('SELECT 1 FROM playbook_rules WHERE org_id = $1 AND lower(topic) = lower($2)', [org.id, topic])) continue
      if (nr + rules >= RULE_LIMIT) continue
      await q.query(
        `INSERT INTO playbook_rules (org_id, category, topic, standard_position, fallback_position, red_flags, severity, clause_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [org.id, r.category, topic, standard, fallback, flags, r.severity, r.clause ? clauseIds.get(r.clause) ?? null : null, user.id])
      rules++
    }
    return { clauses, rules }
  })
  await audit(c, 'playbook.starter_loaded', 'playbook_rule', undefined, result)
  return c.json(result)
})

playbookRoutes.get('/reviews', queryParams(z.object({ document_id: z.string().uuid() })), async (c) => {
  const { org } = auth(c)
  const { document_id } = c.req.valid('query')
  const items = await c.get('deps').db.query(
    `SELECT ${REVIEW_COLS} FROM playbook_reviews v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.document_id = $1 AND v.org_id = $2 ORDER BY v.created_at DESC LIMIT 10`, [document_id, org.id])
  return c.json({ items })
})

playbookRoutes.post('/review', jsonBody(z.object({
  document_id: z.string().uuid(),
  language: z.enum(['en', 'ar']).default('en'),
  acting_for: optText(200)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const deps = c.get('deps')
  const { db, ai } = deps
  const doc = await db.one('SELECT id, title, content, version, jurisdiction, client_id, language FROM documents WHERE id = $1 AND org_id = $2', [b.document_id, org.id])
  if (!doc) throw notFound('Document')
  if (doc.content.trim().length < 50) throw badRequest('This document has too little text to review. Scanned PDFs need OCR before upload.')
  const rules = await db.query<Rule & { clause_en: string | null; clause_ar: string | null; clause_title: string | null }>(
    `SELECT r.id, r.category, r.topic, r.standard_position, r.fallback_position, r.red_flags, r.severity,
            cl.title AS clause_title, cl.body_en AS clause_en, cl.body_ar AS clause_ar
       FROM playbook_rules r LEFT JOIN clauses cl ON cl.id = r.clause_id
      WHERE r.org_id = $1 AND r.active
      ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at, lower(r.topic), r.id LIMIT 60`, [org.id])
  if (!rules.length) throw badRequest('Your playbook has no active rules yet. Add rules or load the GCC starter playbook first.')
  if (!deps.limiters.ai.take(user.id).ok) throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  await assertCanUseAi(db, org, true)
  let actingFor = b.acting_for
  if (!actingFor && doc.client_id) actingFor = (await db.one('SELECT name FROM clients WHERE id = $1 AND org_id = $2', [doc.client_id, org.id]))?.name ?? null
  const jurisdiction = doc.jurisdiction ?? org.default_jurisdiction
  const out = await ai.complete({
    messages: reviewMessages({ title: doc.title, text: doc.content, rules, lang: b.language, actingFor, jurisdiction: jurisdiction ? jurisdictionName(jurisdiction) : null }),
    json: true, maxTokens: 6000, temperature: 0.1
  })
  let review
  try { review = normalizeReview(parseJsonObject(out.text), rules) } catch { throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable review. Please try again.') }
  // Contracts longer than the model reads are flagged: a "missing" finding may sit in the unread part.
  const truncated = doc.content.length > 60_000
  const ar = b.language === 'ar'
  // Attach the firm's approved wording, in the contract's language, to every gap the playbook links to a clause.
  let quotesRemoved = 0
  const items = review.items.map((i, n) => {
    const r = rules[n]!
    const approved = doc.language === 'ar' ? r.clause_ar ?? r.clause_en : r.clause_en ?? r.clause_ar
    // Code check: the quoted contract words must be in the contract.
    let { found, issue, status } = i
    if (found && !appearsIn(found, doc.content)) {
      quotesRemoved++
      found = ''
      issue = `${issue}${issue ? '\n' : ''}${ar ? 'لم يُعثر على النص المقتبس في العقد؛ راجع هذا البند يدوياً.' : 'The quoted words were not found in the contract; check this rule by hand.'}`
      if (status === 'meets' || status === 'fallback') status = 'deviates'
    }
    if (truncated && status === 'missing') issue = `${issue}${issue ? '\n' : ''}${ar ? 'العقد أطول مما قرئ؛ قد يكون هذا البند في الجزء غير المقروء.' : 'The contract is longer than the part reviewed; this clause may be in the unread part.'}`
    return { ...i, found, issue, status, found_verified: !!found, approved_clause: status === 'meets' || status === 'not_applicable' || !approved ? null : { title: r.clause_title, text: approved } }
  })
  const result = { ...review, items, ...scoreReview(items), truncated, quotes_removed: quotesRemoved }
  const saved = await db.tx(async (q) => {
    const row = await q.one(
      `INSERT INTO playbook_reviews (org_id, document_id, document_version, language, acting_for, result, model, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [org.id, doc.id, doc.version, b.language, actingFor, JSON.stringify(result), out.model, user.id])
    await recordAiUsage(q, org.id, user.id, 'playbook_review', out)
    await logAiUse(q, { orgId: org.id, userId: user.id, feature: 'playbook_review', model: out.model, documentId: doc.id, prompt: `Playbook review of ${doc.title}`, output: out.text,
      verification: { status: quotesRemoved || truncated ? 'passed_with_warnings' : 'passed', errors: 0, warnings: quotesRemoved + (truncated ? 1 : 0), citations: 0, as_of: new Date().toISOString().slice(0, 10), checked_at: new Date().toISOString(),
        checks: [
          ...(quotesRemoved ? [{ kind: 'quote' as const, severity: 'warning' as const, ok: false, code: 'quote_not_found', detail: `${quotesRemoved} quoted clause(s) were not found in the contract and were removed.` }] : []),
          ...(truncated ? [{ kind: 'quote' as const, severity: 'warning' as const, ok: false, code: 'truncated', detail: 'The contract is longer than the part reviewed.' }] : [])
        ] } })
    return row!
  })
  await audit(c, 'ai.playbook_review', 'document', doc.id, { score: result.score, rules: rules.length })
  const review_row = await db.one(`SELECT ${REVIEW_COLS} FROM playbook_reviews v LEFT JOIN users u ON u.id = v.created_by WHERE v.id = $1`, [saved.id])
  return c.json({ review: review_row }, 201)
})

export default playbookRoutes
