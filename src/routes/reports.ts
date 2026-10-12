import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, HttpError, tooMany } from '../lib/errors'
import { jsonBody, queryParams } from '../lib/http'
import { matterFinancials } from '../services/matter-finance'
import { parseJsonObject } from '../services/legal-prompts'
import { insightsMessages, normalizeSummary, practiceInsights, toCsv } from '../services/practice-insights'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Practice analytics for owners and admins: productivity, billing and matter mix.
const reportsRoutes = new Hono<AppEnv>()

reportsRoutes.get('/', queryParams(z.object({ from: isoDate.optional(), to: isoDate.optional() })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const q = c.req.valid('query')
  const to = q.to ?? new Date().toISOString().slice(0, 10)
  const from = q.from ?? new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
  const p = [org.id, from, to]

  const [byUser, byCase, invoiceTotals, aging, casesByMonth, byArea, byStatus, ai] = await Promise.all([
    db.query(
      `SELECT u.id, u.name,
              COALESCE(sum(t.minutes), 0)::int AS minutes,
              COALESCE(sum(t.minutes) FILTER (WHERE t.billable), 0)::int AS billable_minutes,
              COALESCE(sum(t.minutes * t.rate / 60.0) FILTER (WHERE t.billable), 0)::float8 AS value
         FROM users u LEFT JOIN time_entries t ON t.user_id = u.id AND t.work_date BETWEEN $2 AND $3
        WHERE u.org_id = $1 AND u.role <> 'client' AND u.deactivated_at IS NULL
        GROUP BY u.id, u.name ORDER BY minutes DESC`, p),
    db.query(
      `SELECT k.id, k.reference, k.title, sum(t.minutes)::int AS minutes, COALESCE(sum(t.minutes * t.rate / 60.0) FILTER (WHERE t.billable), 0)::float8 AS value
         FROM time_entries t JOIN cases k ON k.id = t.case_id
        WHERE t.org_id = $1 AND t.work_date BETWEEN $2 AND $3
        GROUP BY k.id, k.reference, k.title ORDER BY minutes DESC LIMIT 10`, p),
    db.query(
      `SELECT currency,
              COALESCE(sum(total) FILTER (WHERE status IN ('issued','paid')), 0)::float8 AS invoiced,
              COALESCE(sum(amount_paid) FILTER (WHERE status IN ('issued','paid')), 0)::float8 AS collected,
              COALESCE(sum(total - amount_paid) FILTER (WHERE status = 'issued'), 0)::float8 AS outstanding,
              COALESCE(sum(total - amount_paid) FILTER (WHERE status = 'issued' AND due_date < CURRENT_DATE), 0)::float8 AS overdue
         FROM invoices WHERE org_id = $1 AND issue_date BETWEEN $2 AND $3 GROUP BY currency`, p),
    db.query(
      `SELECT currency,
              COALESCE(sum(total - amount_paid) FILTER (WHERE due_date >= CURRENT_DATE), 0)::float8 AS current,
              COALESCE(sum(total - amount_paid) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 30), 0)::float8 AS d30,
              COALESCE(sum(total - amount_paid) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60), 0)::float8 AS d60,
              COALESCE(sum(total - amount_paid) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 61 AND 90), 0)::float8 AS d90,
              COALESCE(sum(total - amount_paid) FILTER (WHERE CURRENT_DATE - due_date > 90), 0)::float8 AS d90plus
         FROM invoices WHERE org_id = $1 AND status = 'issued' GROUP BY currency`, [org.id]),
    db.query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              (SELECT count(*)::int FROM cases WHERE org_id = $1 AND date_trunc('month', opened_on) = m) AS opened,
              (SELECT count(*)::int FROM cases WHERE org_id = $1 AND date_trunc('month', closed_on) = m) AS closed
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
        ORDER BY m`, [org.id]),
    db.query(`SELECT COALESCE(practice_area, 'other') AS key, count(*)::int AS n FROM cases WHERE org_id = $1 AND status <> 'closed' GROUP BY 1 ORDER BY n DESC`, [org.id]),
    db.query(`SELECT status AS key, count(*)::int AS n FROM cases WHERE org_id = $1 GROUP BY 1`, [org.id]),
    db.query(`SELECT feature, count(*)::int AS n FROM ai_usage WHERE org_id = $1 AND created_at::date BETWEEN $2 AND $3 GROUP BY feature ORDER BY n DESC`, p)
  ])
  return c.json({ from, to, by_user: byUser, by_case: byCase, invoices: invoiceTotals, aging, cases_by_month: casesByMonth, by_practice_area: byArea, by_status: byStatus, ai_usage: ai })
})

// Every matter's fees, budget use, billing and collection, for the profitability table.
reportsRoutes.get('/matters', queryParams(z.object({ include_closed: z.enum(['true', 'false']).default('false') })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const items = await matterFinancials(c.get('deps').db, org.id, { includeClosed: c.req.valid('query').include_closed === 'true' })
  // Most at risk first: over budget, then highest budget use, then most unbilled work.
  items.sort((a, b) => (b.used_pct ?? -1) - (a.used_pct ?? -1) || (b.unbilled_time ?? 0) - (a.unbilled_time ?? 0))
  return c.json({ items: items.filter((i) => i.minutes > 0 || i.invoiced > 0 || i.limit != null) })
})

// ---------------- Partner analytics ----------------

const periodSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() })
function period(q: { from?: string; to?: string }) {
  const to = q.to ?? new Date().toISOString().slice(0, 10)
  const from = q.from ?? new Date(Date.parse(to) - 89 * 86400_000).toISOString().slice(0, 10)
  if (from > to) throw badRequest('The start date must be before the end date.')
  if (Date.parse(to) - Date.parse(from) > 3 * 366 * 86400_000) throw badRequest('Choose a period of three years or less.')
  return { from, to }
}

const insightsFor = (c: Ctx, q: { from?: string; to?: string }) => {
  const { org } = auth(c)
  const { from, to } = period(q)
  return practiceInsights(c.get('deps').db, org.id, org.default_currency, from, to)
}

reportsRoutes.get('/insights', queryParams(periodSchema), async (c) => {
  requireRole(c, 'owner', 'admin')
  return c.json(await insightsFor(c, c.req.valid('query')))
})

// A short written summary of the numbers for the partners, in Arabic or English.
reportsRoutes.post('/insights/summary', jsonBody(periodSchema.extend({ language: z.enum(['en', 'ar']).default('en') })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai, limiters } = c.get('deps')
  const r = limiters.ai.take(user.id)
  if (!r.ok) {
    c.header('Retry-After', String(r.retryAfterSec))
    throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  }
  await assertCanUseAi(db, org)
  const data = await insightsFor(c, b)
  const [br] = await db.query('SELECT firm_name, firm_name_ar FROM branding WHERE org_id = $1', [org.id])
  const firm = (b.language === 'ar' ? br?.firm_name_ar || br?.firm_name : br?.firm_name) || org.name
  const result = await ai.complete({ messages: insightsMessages(data, b.language, firm), json: true, maxTokens: 1500, temperature: 0.2 })
  await recordAiUsage(db, org.id, user.id, 'partner_summary', result)
  let summary
  try { summary = normalizeSummary(parseJsonObject(result.text)) } catch { summary = null }
  if (!summary?.headline && !summary?.points.length) throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable summary. Please try again.')
  await audit(c, 'ai.partner_summary', 'organization', org.id, { from: data.from, to: data.to, language: b.language })
  return c.json({ summary, from: data.from, to: data.to, language: b.language })
})

// Lawyers or clients as CSV (UTF-8 with BOM so Excel shows Arabic correctly).
reportsRoutes.get('/insights/export', queryParams(periodSchema.extend({ section: z.enum(['lawyers', 'clients']) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const q = c.req.valid('query')
  const d = await insightsFor(c, q)
  const rows: unknown[][] = q.section === 'lawyers'
    ? [['Lawyer', 'Hours', 'Billable hours', 'Utilisation %', `Recorded value (${d.currency})`, `Billed value (${d.currency})`, 'Realisation %', 'Open matters', 'Overdue tasks'],
      ...d.lawyers.map((l) => [l.name, (l.minutes / 60).toFixed(2), (l.billable_minutes / 60).toFixed(2), l.utilisation_pct, l.recorded_value, l.billed_value, l.realization_pct, l.open_matters, l.overdue_tasks])]
    : [['Client', 'Client (Arabic)', `Invoiced (${d.currency})`, `Collected (${d.currency})`, `Outstanding (${d.currency})`, 'Share of billing %', 'Open matters'],
      ...d.clients.map((cl) => [cl.name, cl.name_ar, cl.invoiced, cl.collected, cl.outstanding, cl.share_pct, cl.open_matters])]
  await audit(c, 'reports.exported', 'organization', auth(c).org.id, { section: q.section, from: d.from, to: d.to })
  return new Response(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8', 'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="trustiqlegal-${q.section}-${d.from}-to-${d.to}.csv"`
    }
  })
})

export default reportsRoutes
