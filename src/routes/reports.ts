import { Hono } from 'hono'
import { z } from 'zod'
import { auth, requireRole, type AppEnv } from '../context'
import { queryParams } from '../lib/http'

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

export default reportsRoutes
