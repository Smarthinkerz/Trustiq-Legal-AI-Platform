export type FirmCurrency = 'OMR' | 'USD'
export type FirmPlan = 'starter' | 'starter_plus' | 'professional'
export type BillingCycle = 'monthly' | 'annual'
export type ProFeature = 'advanced_reviews' | 'playbook_review' | 'unlimited_cases'

export const PRICES: Record<FirmCurrency, { starter: number; professional: number; starterSeat: number; professionalSeat: number; aiPack: number }>
export const INCLUDED_SEATS: Record<FirmPlan, number>
export const STARTER_MAX: number
export const STARTER_PLUS_MAX: number
export const MAX_SELF_SERVE: number
export const MAX_SUPPORT: number
export const ANNUAL_MONTHS_BILLED: number
export const AI_PACK_REQUESTS: number
export const PRO_FEATURES: ProFeature[]
export const COUNTRIES: string[]
export function currencyFor(country: string): FirmCurrency
export type FirmLimits = { cases: number | null; documents: number | null; ai_requests: number | null }
export function limitsFor(plan: string, lawyers: number): FirmLimits | null

export type FirmOption = {
  plan: FirmPlan
  base_price: number
  included_seats: number
  extra_seats: number
  seat_price: number
  monthly: number
  annual: number
  total: number
  months_billed: number
  months_covered: number
  ai_requests: number
  documents: number
  cases: number | null
}

export type FirmQuote = {
  country: string
  currency: FirmCurrency
  cycle: BillingCycle
  lawyers: number
  support_seats: number
  features: ProFeature[]
  enterprise: boolean
  options: FirmOption[]
  recommended: FirmPlan | null
}

export function quoteFirm(input: { country?: unknown; lawyers?: unknown; support?: unknown; cycle?: unknown; features?: unknown }): FirmQuote | null
export function aiPackPrice(currency: string): { requests: number; amount: number; currency: FirmCurrency }
