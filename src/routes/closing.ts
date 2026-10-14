import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { closingChecklist, closingLetter, OUTCOMES } from '../services/closing'
import { toCsv } from '../services/practice-insights'
import { caseActivity } from './cases'
import { insertDocument } from './documents'

// Closing a matter with a checklist of what is still open, and the firm's file-retention register.
const closingRoutes = new Hono<AppEnv>()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const editors = ['owner', 'admin', 'lawyer'] as const

async function loadCase(c: any, id: string) {
  const { org } = auth(c)
  const [k] = await c.get('deps').db.query(
    `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.client_id, k.jurisdiction, k.closing_outcome, k.closing_note,
            to_char(k.closed_on, 'YYYY-MM-DD') AS closed_on, to_char(k.retain_until, 'YYYY-MM-DD') AS retain_until, cb.name AS closed_by_name,
            cl.name AS client_name, cl.name_ar AS client_name_ar, cl.language AS client_language, u.name AS lawyer_name
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to LEFT JOIN users cb ON cb.id = k.closed_by
      WHERE k.id = $1 AND k.org_id = $2`, [id, org.id])
  if (!k) throw notFound('Case')
  return k
}

closingRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const k = await loadCase(c, uuidParam(c.req.param('id'), 'Case'))
  const { db } = c.get('deps')
  const [checklist, [o]] = await Promise.all([
    closingChecklist(db, org.id, k.id),
    db.query(`SELECT retention_years, to_char(${GULF_TODAY} + make_interval(years => retention_years), 'YYYY-MM-DD') AS retain_until FROM organizations WHERE id = $1`, [org.id])
  ])
  return c.json({ case: k, checklist, ready: checklist.every((i) => i.ok), retention_years: o.retention_years, suggested_retain_until: o.retain_until })
})

closingRoutes.post('/case/:id', jsonBody(z.object({
  outcome: z.enum(OUTCOMES),
  note: optText(5000),
  retain_until: day.optional(),
  override: z.boolean().default(false),
  letter: z.object({ language: z.enum(['en', 'ar']), share_with_client: z.boolean().default(false) }).nullish()
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(c, uuidParam(c.req.param('id'), 'Case'))
  if (k.status === 'closed') throw conflict('This matter is already closed.')
  const checklist = await closingChecklist(db, org.id, k.id)
  const open = checklist.filter((i) => !i.ok)
  if (open.length && !b.override) {
    throw new HttpError(409, 'closing_items_open', 'Some items on this matter are still open.', open.map((i) => ({ path: i.key, message: String(i.count) })))
  }
  if (b.letter && !k.client_id) throw badRequest('This matter has no client to write to.')
  const [o] = await db.query(
    `SELECT retention_years, to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS today, to_char(${GULF_TODAY} + make_interval(years => retention_years), 'YYYY-MM-DD') AS retain_until
       FROM organizations WHERE id = $1`, [org.id])
  const retainUntil = b.retain_until ?? o.retain_until
  if (retainUntil < o.today) throw badRequest('The retention date is in the past.')
  const document = await db.tx(async (q) => {
    await q.query(
      `UPDATE cases SET status = 'closed', closed_on = $3, closed_by = $4, closing_outcome = $5, closing_note = $6, retain_until = $7, updated_at = now()
        WHERE id = $1 AND org_id = $2`, [k.id, org.id, o.today, user.id, b.outcome, b.note, retainUntil])
    await caseActivity(q, org.id, k.id, user.id, 'status_change',
      `Matter closed (${b.outcome})${open.length ? `; closed with open items: ${open.map((i) => i.key).join(', ')}` : ''}; file kept until ${retainUntil}`)
    if (!b.letter) return null
    const lang = b.letter.language
    const [firm] = await q.query('SELECT firm_name, firm_name_ar FROM branding WHERE org_id = $1', [org.id])
    const originalsReturned = (await q.query(`SELECT 1 FROM client_originals WHERE case_id = $1 AND status = 'returned' LIMIT 1`, [k.id])).length > 0
    const years = Math.max(1, Math.round((Date.parse(retainUntil) - Date.parse(o.today)) / (365.25 * 86_400_000)))
    const content = closingLetter({
      lang, reference: k.reference, title: (lang === 'ar' && k.title_ar) || k.title, summary: b.note ?? null, originalsReturned, retainUntil, years, date: o.today,
      clientName: (lang === 'ar' && k.client_name_ar) || k.client_name, lawyerName: k.lawyer_name || user.name,
      firmName: (lang === 'ar' && firm?.firm_name_ar) || firm?.firm_name || org.name
    })
    return insertDocument(q, {
      orgId: org.id, userId: user.id, title: lang === 'ar' ? `خطاب إغلاق الملف – ${k.reference}` : `Closing letter – ${k.reference}`, docType: 'correspondence', language: lang,
      jurisdiction: k.jurisdiction, source: 'manual', content, caseId: k.id, clientId: k.client_id, sharedWithClient: b.letter.share_with_client
    })
  })
  await audit(c, 'case.closed', 'case', k.id, { outcome: b.outcome, retain_until: retainUntil, open_items: open.map((i) => ({ key: i.key, count: i.count })), letter: !!document })
  return c.json({ case: await loadCase(c, k.id), document: document ? { id: document.id, title: document.title } : null })
})

closingRoutes.put('/settings', jsonBody(z.object({ retention_years: z.coerce.number().int().min(1).max(50) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const { retention_years } = c.req.valid('json')
  await c.get('deps').db.query('UPDATE organizations SET retention_years = $2, updated_at = now() WHERE id = $1', [org.id, retention_years])
  await audit(c, 'org.retention_updated', 'organization', org.id, { retention_years })
  return c.json({ retention_years })
})

// Closed files by retention date: those past it are due for review (return or destruction).
closingRoutes.get('/retention', queryParams(z.object({ show: z.enum(['due', 'all']).default('due'), format: z.enum(['json', 'csv']).default('json') })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = await db.query(
    `SELECT k.id, k.reference, k.title, to_char(k.closed_on, 'YYYY-MM-DD') AS closed_on, to_char(k.retain_until, 'YYYY-MM-DD') AS retain_until, k.closing_outcome,
            cl.name AS client_name, u.name AS lawyer_name, (k.retain_until <= ${GULF_TODAY}) AS due,
            (SELECT count(*)::int FROM client_originals x WHERE x.case_id = k.id AND x.status <> 'returned') AS originals_held,
            (SELECT count(*)::int FROM documents d WHERE d.case_id = k.id) AS documents
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE k.org_id = $1 AND k.status = 'closed' AND ($2 = 'all' OR k.retain_until <= ${GULF_TODAY} + 90)
      ORDER BY k.retain_until NULLS LAST, k.reference LIMIT 5000`, [org.id, q.show])
  if (q.format === 'csv') {
    await audit(c, 'retention.exported', 'organization', org.id, { rows: rows.length })
    return new Response(toCsv([
      ['Reference', 'Matter', 'Client', 'Closed', 'Outcome', 'Keep until', 'Due', 'Documents', 'Originals still held', 'Lawyer'],
      ...rows.map((r: any) => [r.reference, r.title, r.client_name ?? '', r.closed_on ?? '', r.closing_outcome ?? '', r.retain_until ?? '', r.due ? 'yes' : '', r.documents, r.originals_held, r.lawyer_name ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="file-retention.csv"', 'cache-control': 'private, no-store' } })
  }
  const [{ years }] = await db.query('SELECT retention_years AS years FROM organizations WHERE id = $1', [org.id])
  return c.json({ items: rows, retention_years: years, due: rows.filter((r: any) => r.due).length })
})

export default closingRoutes
