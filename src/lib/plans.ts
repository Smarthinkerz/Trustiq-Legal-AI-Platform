export type PlanId = 'trial' | 'starter' | 'professional' | 'enterprise'

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
  professional: { name: 'Professional', maxActiveCases: null, documentsPerMonth: 500, aiRequestsPerMonth: 3000, advancedAnalysis: true },
  enterprise: { name: 'Enterprise', maxActiveCases: null, documentsPerMonth: null, aiRequestsPerMonth: null, advancedAnalysis: true }
}

export const TRIAL_DAYS = 14

// Self-serve prices (monthly, excluding VAT). Enterprise is sold by the sales team.
export const PLAN_PRICES: Partial<Record<PlanId, { amount: number; currency: string }>> = {
  starter: { amount: 199, currency: 'OMR' },
  professional: { amount: 499, currency: 'OMR' }
}

export const isPlanId = (v: string): v is PlanId => v in PLANS

export function planOf(org: { plan: string }): PlanLimits {
  return isPlanId(org.plan) ? PLANS[org.plan] : PLANS.trial
}

export function trialExpired(org: { plan: string; trial_ends_at: Date | string | null }): boolean {
  return org.plan === 'trial' && !!org.trial_ends_at && new Date(org.trial_ends_at).getTime() < Date.now()
}

// A paid plan with an end date that has passed (plans set manually without an end date never expire).
export function subscriptionExpired(org: { plan: string; plan_expires_at?: Date | string | null }): boolean {
  return org.plan !== 'trial' && !!org.plan_expires_at && new Date(org.plan_expires_at).getTime() < Date.now()
}
