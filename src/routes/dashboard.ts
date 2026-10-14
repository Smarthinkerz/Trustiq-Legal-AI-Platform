import { Hono } from 'hono'
import { auth, type AppEnv } from '../context'
import { usageThisMonth } from '../services/usage'
import { CREDENTIAL_COLUMNS, GULF_TODAY } from '../services/credentials'
import { gaps, onboardingRows } from '../services/onboarding'
import { updatesDue } from '../services/client-updates'
import { expertDeadlinesDue } from './experts'
import { originalsToReturn } from './originals'
import { teamWorkload } from '../services/workload'
import { corporateFilingsDue } from './corporate'

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
       (SELECT count(*)::int FROM events WHERE org_id = $1 AND kind IN ('deadline','filing') AND completed_at IS NULL AND starts_at < now()) AS overdue_deadlines,
       (SELECT count(*)::int FROM clients cl LEFT JOIN client_kyc ky ON ky.client_id = cl.id
         WHERE cl.org_id = $1 AND cl.archived_at IS NULL AND EXISTS (SELECT 1 FROM cases x WHERE x.client_id = cl.id AND x.status <> 'closed')
           AND (ky.client_id IS NULL OR ky.status <> 'approved' OR ky.next_review_on < (now() AT TIME ZONE 'Asia/Muscat')::date)) AS kyc_attention,
       (SELECT count(*)::int FROM legal_notices WHERE org_id = $1 AND status IN ('sent', 'delivered') AND response_due <= (now() AT TIME ZONE 'Asia/Muscat')::date + 7) AS notices_due,
       (SELECT count(*)::int FROM settlement_offers WHERE org_id = $1 AND status = 'open' AND expires_on <= (now() AT TIME ZONE 'Asia/Muscat')::date + 3) AS offers_expiring`,
    [org.id, user.id])
  const [byStatus, upcoming, recentCases, recentDocs, credentials] = await Promise.all([
    db.query(`SELECT status, count(*)::int AS n FROM cases WHERE org_id = $1 GROUP BY status`, [org.id]),
    db.query(
      `SELECT e.id, e.title, e.kind, e.starts_at, e.all_day, e.location, e.case_id, k.reference AS case_reference
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.completed_at IS NULL AND e.starts_at >= date_trunc('day', now()) AND e.starts_at < now() + interval '14 days'
        ORDER BY e.starts_at LIMIT 10`, [org.id]),
    db.query(
      `SELECT k.id, k.reference, k.title, k.title_ar, k.status, k.priority, k.updated_at, cl.name AS client_name
         FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.org_id = $1 ORDER BY k.updated_at DESC LIMIT 6`, [org.id]),
    db.query(`SELECT id, title, doc_type, status, source, updated_at FROM documents WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 6`, [org.id]),
    db.query(
      `SELECT ${CREDENTIAL_COLUMNS()}, cl.name AS client_name FROM client_credentials cc JOIN clients cl ON cl.id = cc.client_id
        WHERE cc.org_id = $1 AND cc.revoked_at IS NULL AND cc.replaced_by IS NULL AND cl.archived_at IS NULL AND cc.expires_on <= ${GULF_TODAY} + 30
        ORDER BY cc.expires_on LIMIT 8`, [org.id])
  ])
  const o = await db.one('SELECT onboarding_checks FROM organizations WHERE id = $1', [org.id])
  const required: string[] = o?.onboarding_checks ?? []
  counts.onboarding_gaps = required.length ? (await onboardingRows(db, org.id)).filter((r) => gaps(r, required).length).length : 0
  // My open matters whose client has not had an update for a month.
  counts.client_updates_due = (await updatesDue(db, org.id, { userId: user.id })).length
  counts.expert_deadlines = await expertDeadlinesDue(db, org.id)
  counts.originals_to_return = await originalsToReturn(db, org.id)
  // Court clashes in the next two weeks (a person due in two courts on one day), for those who plan the team.
  counts.court_clashes = user.role === 'staff' ? 0 : (await teamWorkload(db, org.id)).clashes
  counts.corporate_due = await corporateFilingsDue(db, org.id)
  counts.retention_due = (await db.query(`SELECT count(*)::int AS n FROM cases WHERE org_id = $1 AND status = 'closed' AND retain_until <= ${GULF_TODAY}`, [org.id]))[0].n
  return c.json({
    counts,
    cases_by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    upcoming,
    recent_cases: recentCases,
    recent_documents: recentDocs,
    credentials,
    usage: await usageThisMonth(db, org.id)
  })
})

export default dashboardRoutes
