import { Hono } from 'hono'
import { auth, type AppEnv } from '../context'
import { usageThisMonth } from '../services/usage'

const dashboardRoutes = new Hono<AppEnv>()

dashboardRoutes.get('/', async (c) => {
  const { user, org } = auth(c)
  const { db } = c.get('deps')
  const [counts] = await db.query(
    `SELECT
       (SELECT count(*)::int FROM cases WHERE org_id = $1 AND status <> 'closed') AS open_cases,
       (SELECT count(*)::int FROM cases WHERE org_id = $1 AND status <> 'closed' AND priority IN ('high','urgent')) AS priority_cases,
       (SELECT count(*)::int FROM cases WHERE org_id = $1 AND status <> 'closed' AND assigned_to = $2) AS my_cases,
       (SELECT count(*)::int FROM clients WHERE org_id = $1 AND archived_at IS NULL) AS clients,
       (SELECT count(*)::int FROM documents WHERE org_id = $1) AS documents,
       (SELECT count(*)::int FROM events WHERE org_id = $1 AND kind IN ('deadline','filing') AND completed_at IS NULL AND starts_at < now()) AS overdue_deadlines`,
    [org.id, user.id])
  const [byStatus, upcoming, recentCases, recentDocs] = await Promise.all([
    db.query(`SELECT status, count(*)::int AS n FROM cases WHERE org_id = $1 GROUP BY status`, [org.id]),
    db.query(
      `SELECT e.id, e.title, e.kind, e.starts_at, e.all_day, e.location, e.case_id, k.reference AS case_reference
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.completed_at IS NULL AND e.starts_at >= date_trunc('day', now()) AND e.starts_at < now() + interval '14 days'
        ORDER BY e.starts_at LIMIT 10`, [org.id]),
    db.query(
      `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.priority, k.updated_at, cl.name AS client_name
         FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.org_id = $1 ORDER BY k.updated_at DESC LIMIT 6`, [org.id]),
    db.query(`SELECT id, title, doc_type, status, source, updated_at FROM documents WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 6`, [org.id])
  ])
  return c.json({
    counts,
    cases_by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    upcoming,
    recent_cases: recentCases,
    recent_documents: recentDocs,
    usage: await usageThisMonth(db, org.id)
  })
})

export default dashboardRoutes
