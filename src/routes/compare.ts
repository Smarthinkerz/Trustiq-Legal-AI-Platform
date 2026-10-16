import { logAiUse } from '../services/ai-log'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, type AppEnv } from '../context'
import type { Db } from '../db'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, optText, queryParams } from '../lib/http'
import { compareTexts, checkSummaryRefs, normalizeSummary, summaryMessages } from '../services/compare'
import { contentDisposition, renderRedlineDocx, safeFileName } from '../services/export'
import { ACCEPTED_TYPES } from '../services/extract'
import { parseJsonObject } from '../services/legal-prompts'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

// ---------------------------------------------------------------------------
// Compare two documents, or two versions of one document (redline).
// ---------------------------------------------------------------------------

const side = z.object({ document_id: z.string().uuid(), version: z.coerce.number().int().positive().nullish() })
const pair = z.object({ left: side, right: side })
const MAX_CHARS = 600_000

async function loadSide(db: Db, orgId: string, s: z.infer<typeof side>) {
  const doc = await db.one('SELECT id, title, content, language, version, client_id FROM documents WHERE id = $1 AND org_id = $2', [s.document_id, orgId])
  if (!doc) throw notFound('Document')
  if (s.version && s.version !== doc.version) {
    const v = await db.one('SELECT version, content FROM document_versions WHERE document_id = $1 AND org_id = $2 AND version = $3', [s.document_id, orgId, s.version])
    if (!v) throw notFound('Version')
    return { id: doc.id as string, title: doc.title as string, label: `${doc.title} (v${v.version})`, version: v.version as number, content: v.content as string, language: doc.language as 'en' | 'ar', client_id: doc.client_id }
  }
  return { id: doc.id as string, title: doc.title as string, label: `${doc.title} (v${doc.version})`, version: doc.version as number, content: doc.content as string, language: doc.language as 'en' | 'ar', client_id: doc.client_id }
}

async function run(db: Db, orgId: string, b: z.infer<typeof pair>) {
  const [left, right] = [await loadSide(db, orgId, b.left), await loadSide(db, orgId, b.right)]
  if (left.content.length + right.content.length > MAX_CHARS) throw new HttpError(422, 'document_too_long', 'These documents are too long to compare in one go.')
  return { left, right, result: compareTexts(left.content, right.content) }
}

const meta = (s: Awaited<ReturnType<typeof loadSide>>) => ({ document_id: s.id, title: s.title, label: s.label, version: s.version, language: s.language })

const compareRoutes = new Hono<AppEnv>()

compareRoutes.post('/', jsonBody(pair), async (c) => {
  const { org } = auth(c)
  const { left, right, result } = await run(c.get('deps').db, org.id, c.req.valid('json'))
  return c.json({ left: meta(left), right: meta(right), ops: result.ops, stats: result.stats })
})

// GET so the browser can download it directly.
compareRoutes.get('/docx', queryParams(z.object({
  left: z.string().uuid(), lv: z.coerce.number().int().positive().optional(), right: z.string().uuid(), rv: z.coerce.number().int().positive().optional(),
  letterhead: z.enum(['true', 'false']).default('true')
})), async (c) => {
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const { left, right, result } = await run(db, org.id, { left: { document_id: q.left, version: q.lv }, right: { document_id: q.right, version: q.rv } })
  const ar = right.language === 'ar'
  const lh = q.letterhead === 'true' ? await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id]) : null
  const title = ar ? `مقارنة: ${right.title}` : `Comparison: ${right.title}`
  const subtitle = ar ? `${left.label} ← ${right.label}` : `${left.label} → ${right.label}`
  const buf = await renderRedlineDocx({
    title, subtitle, ops: result.ops, language: right.language, letterhead: lh as any,
    legend: ar ? { inserted: 'نص مضاف', deleted: 'نص محذوف' } : { inserted: 'Inserted text', deleted: 'Deleted text' }
  })
  await audit(c, 'document.compared', 'document', right.id, { left: left.id, format: 'docx' })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(`${right.title} - redline`, 'docx')), 'cache-control': 'private, no-store' }
  })
})

compareRoutes.post('/summary', jsonBody(pair.extend({ language: z.enum(['en', 'ar']).default('en'), acting_for: optText(200) })), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const deps = c.get('deps')
  const { db, ai } = deps
  const { left, right, result } = await run(db, org.id, b)
  if (result.stats.identical) throw badRequest('The two texts are identical; there is nothing to summarise.')
  const r = deps.limiters.ai.take(user.id)
  if (!r.ok) throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  await assertCanUseAi(db, org)
  let actingFor = b.acting_for
  if (!actingFor && (right.client_id || left.client_id)) {
    actingFor = (await db.one('SELECT name FROM clients WHERE id = $1 AND org_id = $2', [right.client_id ?? left.client_id, org.id]))?.name ?? null
  }
  const out = await ai.complete({ messages: summaryMessages({ leftTitle: left.label, rightTitle: right.label, hunks: result.hunks, lang: b.language, actingFor }), json: true, maxTokens: 3000, temperature: 0.1 })
  await recordAiUsage(db, org.id, user.id, 'compare_summary', out)
  let parsed
  try { parsed = normalizeSummary(parseJsonObject(out.text), Math.min(80, result.hunks.length)) } catch { throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable summary. Please try again.') }
  const { summary, removed, clauseCleared } = checkSummaryRefs(parsed, result.hunks)
  const warnings = removed + clauseCleared
  await logAiUse(db, { orgId: org.id, userId: user.id, feature: 'compare_summary', model: out.model, documentId: right.id, prompt: `Compare ${left.label} with ${right.label}`, output: JSON.stringify(summary),
    verification: { status: warnings ? 'passed_with_warnings' : 'passed', errors: 0, warnings,
      checks: [...(removed ? [{ kind: 'quote' as const, severity: 'warning' as const, ok: false, code: 'item_without_change', detail: `${removed} item(s) removed: they did not point at a real change.` }] : []),
        ...(clauseCleared ? [{ kind: 'article' as const, severity: 'warning' as const, ok: false, code: 'clause_not_in_change', detail: `${clauseCleared} clause number(s) cleared: not found in the change.` }] : [])] } })
  await audit(c, 'ai.compare_summary', 'document', right.id, { left: left.id, changes: result.stats.changes })
  return c.json({ summary, acting_for: actingFor, truncated: result.hunks.length > 80, checks: { removed, clause_cleared: clauseCleared } })
})

export default compareRoutes
