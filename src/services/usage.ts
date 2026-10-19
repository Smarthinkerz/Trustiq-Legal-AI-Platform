import type { Queryable } from '../db'
import type { Org } from '../context'
import { forbidden, paymentRequired } from '../lib/errors'
import { planOf } from '../lib/plans'
import { assertDemoAiAllowance } from './demo'

export async function usageThisMonth(db: Queryable, orgId: string) {
  const [row] = await db.query(
    `SELECT
       (SELECT count(*)::int FROM cases WHERE org_id = $1 AND status <> 'closed') AS active_cases,
       (SELECT count(*)::int FROM documents WHERE org_id = $1 AND created_at >= date_trunc('month', now())) AS documents_this_month,
       (SELECT count(*)::int FROM ai_usage WHERE org_id = $1 AND created_at >= date_trunc('month', now())) AS ai_requests_this_month`,
    [orgId]
  )
  return row as { active_cases: number; documents_this_month: number; ai_requests_this_month: number }
}

// The firm's own limits, loaded when the caller built the org without them (public pages, background work).
async function limitsOf(db: Queryable, org: Org) {
  if (org.limits_custom !== undefined) return planOf(org)
  const [row] = await db.query('SELECT plan, limits_custom, cases_limit, documents_limit, ai_requests_limit FROM organizations WHERE id = $1', [org.id])
  return planOf((row as any) ?? org)
}

export async function assertCanOpenCase(db: Queryable, org: Org) {
  const limit = (await limitsOf(db, org)).maxActiveCases
  if (limit === null) return
  const u = await usageThisMonth(db, org.id)
  if (u.active_cases >= limit) {
    throw paymentRequired('plan_limit_cases', `Your plan allows ${limit} open cases. Close a case or upgrade your plan.`)
  }
}

export async function assertCanCreateDocument(db: Queryable, org: Org) {
  const limit = (await limitsOf(db, org)).documentsPerMonth
  if (limit === null) return
  const u = await usageThisMonth(db, org.id)
  if (u.documents_this_month >= limit) {
    throw paymentRequired('plan_limit_documents', `Your plan allows ${limit} new documents per month. Upgrade your plan for more.`)
  }
}

// Extra AI requests bought for this calendar month.
export async function aiPackRequests(db: Queryable, orgId: string): Promise<number> {
  const [row] = await db.query(`SELECT COALESCE(sum(requests), 0)::int AS n FROM ai_packs WHERE org_id = $1 AND month = date_trunc('month', now())::date`, [orgId])
  return row?.n ?? 0
}

export async function assertCanUseAi(db: Queryable, org: Org, advanced = false) {
  // Support staff seats bought with a firm subscription can view, upload and organize, but not use AI.
  // Firms that existed before seats (support_seats is NULL) keep AI for their staff users.
  if (org.acting_role === 'staff' && org.support_seats != null) throw forbidden('AI features are not included in support staff seats. Ask a lawyer or an admin.')
  // Demo workspaces run on SmarThinkerz's AI budget, with a daily allowance per session.
  if (org.is_demo) await assertDemoAiAllowance(db, org.id)
  const plan = await limitsOf(db, org)
  if (advanced && !plan.advancedAnalysis) {
    throw paymentRequired('plan_feature_advanced_analysis', 'Risk, compliance and full reviews are available on the Professional plan and above.')
  }
  if (plan.aiRequestsPerMonth === null) return
  const [u, extra] = await Promise.all([usageThisMonth(db, org.id), aiPackRequests(db, org.id)])
  if (u.ai_requests_this_month >= plan.aiRequestsPerMonth + extra) {
    throw paymentRequired('plan_limit_ai', `You have used all ${plan.aiRequestsPerMonth + extra} AI requests included this month. Buy an extra pack or upgrade your plan for more.`)
  }
}

export async function recordAiUsage(db: Queryable, orgId: string, userId: string | null, feature: string, usage: { model: string; promptTokens: number; completionTokens: number }) {
  await db.query(
    'INSERT INTO ai_usage (org_id, user_id, feature, model, prompt_tokens, completion_tokens) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, userId, feature, usage.model, usage.promptTokens, usage.completionTokens]
  )
}
