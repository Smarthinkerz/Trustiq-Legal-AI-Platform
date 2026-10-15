// ---------------------------------------------------------------------------
// Firm pricing: the one place the price and the limits of a firm subscription
// are calculated. The landing page imports this file for the live quote and the
// server imports the same file to recalculate every quote it charges and to set
// the firm's limits, so the two never differ. Prices are fixed per currency
// (never converted at a live exchange rate) and exclude VAT.
// ---------------------------------------------------------------------------

export const PRICES = {
  OMR: { starter: 199, professional: 649, starterSeat: 35, professionalSeat: 30, aiPack: 25 },
  USD: { starter: 519, professional: 1690, starterSeat: 90, professionalSeat: 79, aiPack: 65 }
}

// Lawyers included in the base price of each plan.
export const INCLUDED_SEATS = { starter: 3, starter_plus: 3, professional: 10 }

export const STARTER_MAX = 3 // Starter: 1 to 3 lawyers.
export const STARTER_PLUS_MAX = 10 // Starter Plus: 4 to 10 lawyers.
export const MAX_SELF_SERVE = 25 // Professional up to 25 lawyers; above that an Enterprise quote.
export const MAX_SUPPORT = 200
export const ANNUAL_MONTHS_BILLED = 10 // Annual billing: pay 10 months, get 12.
export const AI_PACK_REQUESTS = 500 // Optional overage pack.

// Features only Professional (and Enterprise) include. Selecting one in the form recommends Professional.
export const PRO_FEATURES = ['advanced_reviews', 'playbook_review', 'unlimited_cases']

export const COUNTRIES = ['OM', 'AE', 'SA', 'QA', 'KW', 'BH', 'EG', 'JO', 'LB', 'IQ', 'MA', 'TN', 'GB', 'US', 'OTHER']

export const currencyFor = (country) => (country === 'OM' ? 'OMR' : 'USD')

// Monthly limits shared across the firm; null means unlimited. Enterprise limits
// are fair use only: they raise alerts to the team and never block the firm.
export function limitsFor(plan, lawyers) {
  const n = Math.max(1, Math.floor(Number(lawyers) || 1))
  switch (plan) {
    case 'starter': return { cases: 5, documents: 50, ai_requests: 300 }
    case 'starter_plus': return { cases: 5 * n, documents: 15 * n, ai_requests: 100 * n }
    case 'professional': return { cases: null, documents: 500, ai_requests: 3000 + 300 * Math.max(0, n - INCLUDED_SEATS.professional) }
    case 'enterprise': return { cases: null, documents: Math.max(2000, 80 * n), ai_requests: Math.max(10000, 400 * n) }
    default: return null
  }
}

const round = (n, currency) => {
  const f = currency === 'OMR' ? 1000 : 100
  return Math.round(n * f) / f
}

function option(plan, lawyers, currency, cycle) {
  const p = PRICES[currency]
  const base = plan === 'professional' ? p.professional : p.starter
  const extra = Math.max(0, lawyers - INCLUDED_SEATS[plan])
  const seatPrice = plan === 'professional' ? p.professionalSeat : p.starterSeat
  const monthly = round(base + extra * seatPrice, currency)
  const months = cycle === 'annual' ? ANNUAL_MONTHS_BILLED : 1
  const limits = limitsFor(plan, lawyers)
  return {
    plan,
    base_price: base,
    included_seats: INCLUDED_SEATS[plan],
    extra_seats: extra,
    seat_price: seatPrice,
    monthly,
    annual: round(monthly * ANNUAL_MONTHS_BILLED, currency),
    total: round(monthly * months, currency),
    months_billed: months,
    months_covered: cycle === 'annual' ? 12 : 1,
    ai_requests: limits.ai_requests,
    documents: limits.documents,
    cases: limits.cases
  }
}

// Returns null when the inputs are not a valid request. For more than
// MAX_SELF_SERVE lawyers there is no price: `enterprise` is true instead.
export function quoteFirm(input) {
  const country = String(input?.country ?? '')
  const lawyers = Number(input?.lawyers)
  const support = Number(input?.support ?? 0)
  const cycle = input?.cycle === 'annual' ? 'annual' : input?.cycle === 'monthly' ? 'monthly' : null
  const features = Array.isArray(input?.features) ? [...new Set(input.features.filter((f) => PRO_FEATURES.includes(f)))] : []
  if (!COUNTRIES.includes(country) || !cycle) return null
  if (!Number.isInteger(lawyers) || lawyers < 1 || lawyers > 10000) return null
  if (!Number.isInteger(support) || support < 0 || support > MAX_SUPPORT) return null
  const currency = currencyFor(country)
  const base = { country, currency, cycle, lawyers, support_seats: support, features }
  if (lawyers > MAX_SELF_SERVE) return { ...base, enterprise: true, options: [], recommended: null }
  const options = []
  if (lawyers <= STARTER_MAX) options.push(option('starter', lawyers, currency, cycle))
  else if (lawyers <= STARTER_PLUS_MAX) options.push(option('starter_plus', lawyers, currency, cycle))
  // Professional is always offered beside Starter Plus; for 1 to 3 lawyers only when a Professional feature is needed.
  if (lawyers > STARTER_MAX || features.length) options.push(option('professional', lawyers, currency, cycle))
  const recommended = options.length === 1 || !features.length ? options[0].plan : 'professional'
  return { ...base, enterprise: false, options, recommended }
}

// The overage pack, priced in the firm's currency.
export const aiPackPrice = (currency) => ({ requests: AI_PACK_REQUESTS, amount: PRICES[currency === 'OMR' ? 'OMR' : 'USD'].aiPack, currency: currency === 'OMR' ? 'OMR' : 'USD' })
