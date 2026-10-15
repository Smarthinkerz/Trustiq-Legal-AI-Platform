import { PRICES as FIRM_PRICES } from '../../public/static/site/firm-pricing.js'

export type PlanId = 'trial' | 'starter' | 'starter_plus' | 'professional' | 'enterprise'

export type PlanLimits = {
  name: string
  // null means unlimited
  maxActiveCases: number | null
  documentsPerMonth: number | null
  aiRequestsPerMonth: number | null
  advancedAnalysis: boolean
}

// Keep in sync with the pricing section on the landing page.
export const PLANS: Record<PlanId, PlanLimits> = {
  trial: { name: 'Free trial', maxActiveCases: 10, documentsPerMonth: 50, aiRequestsPerMonth: 100, advancedAnalysis: true },
  starter: { name: 'Starter', maxActiveCases: 5, documentsPerMonth: 50, aiRequestsPerMonth: 300, advancedAnalysis: false },
  // Starter Plus limits depend on the number of lawyers; these are for 4 lawyers and are replaced by the firm's own limits.
  starter_plus: { name: 'Starter Plus', maxActiveCases: 20, documentsPerMonth: 60, aiRequestsPerMonth: 400, advancedAnalysis: false },
  professional: { name: 'Professional', maxActiveCases: null, documentsPerMonth: 500, aiRequestsPerMonth: 3000, advancedAnalysis: true },
  enterprise: { name: 'Enterprise', maxActiveCases: null, documentsPerMonth: null, aiRequestsPerMonth: null, advancedAnalysis: true }
}

export const TRIAL_DAYS = 14

// Self-serve prices (monthly, excluding VAT). Enterprise is sold by the sales team.
// The firm prices themselves live in public/static/site/firm-pricing.js, shared with the landing page.
export const PLAN_PRICES: Partial<Record<PlanId, { amount: number; currency: string }>> = {
  starter: { amount: FIRM_PRICES.OMR.starter, currency: 'OMR' },
  professional: { amount: FIRM_PRICES.OMR.professional, currency: 'OMR' }
}

export const isPlanId = (v: string): v is PlanId => v in PLANS

// The firm's own limits (set when a firm subscription is paid) replace the plan defaults.
export type OrgLimits = { plan: string; limits_custom?: boolean | null; cases_limit?: number | null; documents_limit?: number | null; ai_requests_limit?: number | null }

export function planOf(org: OrgLimits): PlanLimits {
  const plan = isPlanId(org.plan) ? PLANS[org.plan] : PLANS.trial
  if (!org.limits_custom) return plan
  return { ...plan, maxActiveCases: org.cases_limit ?? null, documentsPerMonth: org.documents_limit ?? null, aiRequestsPerMonth: org.ai_requests_limit ?? null }
}

export function trialExpired(org: { plan: string; trial_ends_at: Date | string | null }): boolean {
  return org.plan === 'trial' && !!org.trial_ends_at && new Date(org.trial_ends_at).getTime() < Date.now()
}

// A paid plan with an end date that has passed (plans set manually without an end date never expire).
export function subscriptionExpired(org: { plan: string; plan_expires_at?: Date | string | null }): boolean {
  return org.plan !== 'trial' && !!org.plan_expires_at && new Date(org.plan_expires_at).getTime() < Date.now()
}
