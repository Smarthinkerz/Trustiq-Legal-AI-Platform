// ---------------------------------------------------------------------------
// Client due diligence (KYC / AML). GCC lawyers are designated non-financial
// businesses under the AML laws (e.g. UAE Decree-Law 20/2018, Oman Royal Decree
// 30/2016, KSA AML Law): they must identify the client and its beneficial owners,
// screen for PEPs and sanctions, rate the risk and review it periodically.
// The score below is a transparent starting point; the firm can override it with
// a recorded reason.
// ---------------------------------------------------------------------------

export type Owner = { name: string; nationality?: string; ownership_pct?: number | null; pep?: boolean }
export type KycAnswers = {
  pep: boolean; high_risk_country: boolean; cash_involved: boolean; complex_structure: boolean; non_face_to_face: boolean
  sanctions_match: boolean; source_of_funds: string | null; beneficial_owners: Owner[]
}
export type RiskLevel = 'low' | 'medium' | 'high'

export const RISK_FACTORS = [
  ['pep', 3], ['owner_pep', 3], ['high_risk_country', 3], ['sanctions_match', 5], ['cash_involved', 2],
  ['complex_structure', 2], ['no_beneficial_owners', 2], ['non_face_to_face', 1], ['no_source_of_funds', 1]
] as const

export function riskScore(a: KycAnswers, kind: 'individual' | 'company') {
  const hits: Record<string, boolean> = {
    pep: a.pep,
    owner_pep: a.beneficial_owners.some((o) => o.pep),
    high_risk_country: a.high_risk_country,
    sanctions_match: a.sanctions_match,
    cash_involved: a.cash_involved,
    complex_structure: a.complex_structure,
    no_beneficial_owners: kind === 'company' && !a.beneficial_owners.length,
    non_face_to_face: a.non_face_to_face,
    no_source_of_funds: !a.source_of_funds?.trim()
  }
  const factors = RISK_FACTORS.filter(([k]) => hits[k]).map(([k, w]) => ({ factor: k, points: w }))
  const score = factors.reduce((s, f) => s + f.points, 0)
  const level: RiskLevel = score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low'
  return { score, level, factors }
}

// Enhanced due diligence for high risk: yearly review; medium every two years; low every three.
export const REVIEW_MONTHS: Record<RiskLevel, number> = { high: 12, medium: 24, low: 36 }

export function nextReview(fromIso: string, level: RiskLevel) {
  const d = new Date(`${fromIso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + REVIEW_MONTHS[level])
  return d.toISOString().slice(0, 10)
}

// What must be on file before the file can be approved.
export function approvalBlockers(k: { identity_verified: boolean; sanctions_checked_on: string | null; sanctions_match: boolean; source_of_funds: string | null }, kind: string, owners: Owner[]) {
  const out: string[] = []
  if (!k.identity_verified) out.push('identity_not_verified')
  if (!k.sanctions_checked_on) out.push('sanctions_not_screened')
  if (k.sanctions_match) out.push('sanctions_match')
  if (!k.source_of_funds?.trim()) out.push('source_of_funds_missing')
  if (kind === 'company' && !owners.length) out.push('beneficial_owners_missing')
  return out
}

export const BLOCKER_TEXT: Record<string, string> = {
  identity_not_verified: 'Verify the client\'s identity first.',
  sanctions_not_screened: 'Record the sanctions screening first.',
  sanctions_match: 'A possible sanctions match is recorded. Resolve it or reject the client.',
  source_of_funds_missing: 'Record the source of funds first.',
  beneficial_owners_missing: 'List the company\'s beneficial owners first.'
}
