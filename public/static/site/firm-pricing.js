// ---------------------------------------------------------------------------
// Firm pricing: the one place the price of a firm subscription is calculated.
// The landing page imports this file for the live quote and the server imports
// the same file to recalculate every quote it charges, so the two never differ.
// Prices are fixed per currency (never converted at a live exchange rate) and
// exclude VAT.
// ---------------------------------------------------------------------------

export const PRICES = {
  OMR: { starter: 199, professional: 649, starterSeat: 35, professionalSeat: 30 },
  USD: { starter: 519, professional: 1690, starterSeat: 90, professionalSeat: 79 }
}

// Lawyer seats included in each plan, and the firm-wide AI request pool.
export const INCLUDED_SEATS = { starter: 3, professional: 10 }
export const AI_POOL = { starter: 300, professional: 3000, starterSeat: 100, professionalSeat: 300 }

export const MAX_STARTER = 10 // Starter plus extra seats is offered up to this many lawyers.
export const MAX_SELF_SERVE = 25 // Above this the firm asks for an Enterprise quote.
export const RECOMMEND_PRO_FROM = 7 // From this many lawyers Starter's shared limits are too tight.
export const MAX_SUPPORT = 200
export const ANNUAL_MONTHS_BILLED = 10 // Annual billing: pay 10 months, get 12.

export const COUNTRIES = ['OM', 'AE', 'SA', 'QA', 'KW', 'BH', 'EG', 'JO', 'LB', 'IQ', 'MA', 'TN', 'GB', 'US', 'OTHER']

export const currencyFor = (country) => (country === 'OM' ? 'OMR' : 'USD')

const round = (n, currency) => {
  const f = currency === 'OMR' ? 1000 : 100
  return Math.round(n * f) / f
}

function option(plan, lawyers, currency, cycle) {
  const p = PRICES[currency]
  const extra = Math.max(0, lawyers - INCLUDED_SEATS[plan])
  const seatPrice = plan === 'starter' ? p.starterSeat : p.professionalSeat
  const monthly = round(p[plan] + extra * seatPrice, currency)
  const months = cycle === 'annual' ? ANNUAL_MONTHS_BILLED : 1
  return {
    plan,
    base_price: p[plan],
    included_seats: INCLUDED_SEATS[plan],
    extra_seats: extra,
    seat_price: seatPrice,
    monthly,
    annual: round(monthly * ANNUAL_MONTHS_BILLED, currency),
    total: round(monthly * months, currency),
    months_billed: months,
    months_covered: cycle === 'annual' ? 12 : 1,
    ai_requests: AI_POOL[plan] + extra * (plan === 'starter' ? AI_POOL.starterSeat : AI_POOL.professionalSeat)
  }
}

// Returns null when the inputs are not a valid request. For more than
// MAX_SELF_SERVE lawyers there is no price: `enterprise` is true instead.
export function quoteFirm(input) {
  const country = String(input?.country ?? '')
  const lawyers = Number(input?.lawyers)
  const support = Number(input?.support ?? 0)
  const cycle = input?.cycle === 'annual' ? 'annual' : input?.cycle === 'monthly' ? 'monthly' : null
  if (!COUNTRIES.includes(country) || !cycle) return null
  if (!Number.isInteger(lawyers) || lawyers < 1 || lawyers > 10000) return null
  if (!Number.isInteger(support) || support < 0 || support > MAX_SUPPORT) return null
  const currency = currencyFor(country)
  const base = { country, currency, cycle, lawyers, support_seats: support }
  if (lawyers > MAX_SELF_SERVE) return { ...base, enterprise: true, options: [], recommended: null }
  const options = []
  if (lawyers <= MAX_STARTER) options.push(option('starter', lawyers, currency, cycle))
  if (lawyers > INCLUDED_SEATS.starter) options.push(option('professional', lawyers, currency, cycle))
  let recommended = options[0].plan
  if (options.length === 2) {
    const [s, p] = options
    recommended = p.monthly <= s.monthly || lawyers >= RECOMMEND_PRO_FROM ? 'professional' : 'starter'
  }
  return { ...base, enterprise: false, options, recommended }
}
