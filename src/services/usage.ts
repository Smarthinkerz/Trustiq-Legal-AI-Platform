import type { Queryable } from '../db'
import type { Org } from '../context'
import { paymentRequired } from '../lib/errors'
import { planOf } from '../lib/plans'

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

export async function assertCanOpenCase(db: Queryable, org: Org) {
  const limit = planOf(org).maxActiveCases
  if (limit === null) return
  const u = await usageThisMonth(db, org.id)
  if (u.active_cases >= limit) {
    throw paymentRequired('plan_limit_cases', `Your plan allows ${limit} open cases. Close a case or upgrade your plan.`)
  }
}

export async function assertCanCreateDocument(db: Queryable, org: Org) {
  const limit = planOf(org).documentsPerMonth
  if (limit === null) return
  const u = await usageThisMonth(db, org.id)
  if (u.documents_this_month >= limit) {
    throw paymentRequired('plan_limit_documents', `Your plan allows ${limit} new documents per month. Upgrade your plan for more.`)
  }
}

export async function assertCanUseAi(db: Queryable, org: Org, advanced = false) {
  const plan = planOf(org)
  if (advanced && !plan.advancedAnalysis) {
    throw paymentRequired('plan_feature_advanced_analysis', 'Risk, compliance and full reviews are available on the Professional plan and above.')
  }
  if (plan.aiRequestsPerMonth === null) return
  const u = await usageThisMonth(db, org.id)
  if (u.ai_requests_this_month >= plan.aiRequestsPerMonth) {
    throw paymentRequired('plan_limit_ai', `You have used all ${plan.aiRequestsPerMonth} AI requests included this month. Upgrade your plan for more.`)
  }
}

export async function recordAiUsage(db: Queryable, orgId: string, userId: string | null, feature: string, usage: { model: string; promptTokens: number; completionTokens: number }) {
  await db.query(
    'INSERT INTO ai_usage (org_id, user_id, feature, model, prompt_tokens, completion_tokens) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, userId, feature, usage.model, usage.promptTokens, usage.completionTokens]
  )
}
