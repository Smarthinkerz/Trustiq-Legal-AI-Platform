export type FirmCurrency = 'OMR' | 'USD'
export type FirmPlan = 'starter' | 'professional'
export type BillingCycle = 'monthly' | 'annual'

export const PRICES: Record<FirmCurrency, { starter: number; professional: number; starterSeat: number; professionalSeat: number }>
export const INCLUDED_SEATS: Record<FirmPlan, number>
export const AI_POOL: { starter: number; professional: number; starterSeat: number; professionalSeat: number }
export const MAX_STARTER: number
export const MAX_SELF_SERVE: number
export const RECOMMEND_PRO_FROM: number
export const MAX_SUPPORT: number
export const ANNUAL_MONTHS_BILLED: number
export const COUNTRIES: string[]
export function currencyFor(country: string): FirmCurrency

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
}

export type FirmQuote = {
  country: string
  currency: FirmCurrency
  cycle: BillingCycle
  lawyers: number
  support_seats: number
  enterprise: boolean
  options: FirmOption[]
  recommended: FirmPlan | null
}

export function quoteFirm(input: { country?: unknown; lawyers?: unknown; support?: unknown; cycle?: unknown }): FirmQuote | null
