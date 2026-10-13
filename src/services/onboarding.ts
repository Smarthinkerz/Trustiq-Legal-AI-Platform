import type { Queryable } from '../db'
import { EXPIRING_DAYS, GULF_TODAY } from './credentials'
import { letterStatus } from './engagement'

// ---------------------------------------------------------------------------
// Matter onboarding: before acting on a matter a GCC firm needs a cleared
// conflict check, approved client due diligence (KYC/AML), a valid power of
// attorney and a signed engagement letter. One query gives every open matter's
// position on each, so the register, the dashboard and exports agree.
// ---------------------------------------------------------------------------

export const ONBOARDING_CHECKS = ['conflict', 'kyc', 'poa', 'engagement'] as const
export type OnboardingCheck = (typeof ONBOARDING_CHECKS)[number]

// The states that count as done for each check.
const PASSES: Record<OnboardingCheck, string[]> = {
  conflict: ['clear', 'override'],
  kyc: ['approved'],
  poa: ['valid', 'expiring'],
  engagement: ['signed']
}

export async function onboardingRows(db: Queryable, orgId: string, opts: { caseId?: string } = {}) {
  const today = GULF_TODAY
  const rows = await db.query(
    `SELECT k.id, k.reference, k.title, k.status, k.opened_on, k.client_id, cl.name AS client_name, u.name AS lawyer_name,
            cf.decision AS conflict,
            CASE WHEN k.client_id IS NULL THEN 'no_client' WHEN ky.client_id IS NULL THEN 'not_started'
                 WHEN ky.status = 'approved' AND ky.next_review_on < ${today} THEN 'review_due' ELSE ky.status END AS kyc,
            CASE WHEN k.client_id IS NULL THEN 'no_client' ELSE coalesce(poa.st, 'missing') END AS poa,
            to_char(poa.expires_on, 'YYYY-MM-DD') AS poa_expires_on,
            EXISTS (SELECT 1 FROM engagement_letters e JOIN signature_requests r ON r.document_id = e.document_id AND r.org_id = e.org_id
                     WHERE e.case_id = k.id AND r.status = 'completed') AS engagement_signed,
            el.document_id AS engagement_document_id, el.sig_status, el.sig_expires_at
       FROM cases k
       LEFT JOIN clients cl ON cl.id = k.client_id
       LEFT JOIN users u ON u.id = k.assigned_to
       LEFT JOIN client_kyc ky ON ky.client_id = k.client_id
       LEFT JOIN LATERAL (SELECT decision FROM conflict_checks c WHERE c.org_id = k.org_id AND c.subject_type = 'case' AND c.subject_id = k.id
                           ORDER BY c.created_at DESC LIMIT 1) cf ON true
       LEFT JOIN LATERAL (
         SELECT CASE WHEN cc.expires_on IS NULL THEN 'valid' WHEN cc.expires_on < ${today} THEN 'expired'
                     WHEN cc.expires_on <= ${today} + ${EXPIRING_DAYS} THEN 'expiring' ELSE 'valid' END AS st, cc.expires_on
           FROM client_credentials cc
          WHERE cc.org_id = k.org_id AND cc.client_id = k.client_id AND cc.kind = 'power_of_attorney' AND cc.revoked_at IS NULL AND cc.replaced_by IS NULL
            AND (cc.all_cases OR EXISTS (SELECT 1 FROM client_credential_cases x WHERE x.credential_id = cc.id AND x.case_id = k.id))
          ORDER BY CASE WHEN cc.expires_on IS NULL OR cc.expires_on > ${today} + ${EXPIRING_DAYS} THEN 0 WHEN cc.expires_on >= ${today} THEN 1 ELSE 2 END,
                   cc.expires_on DESC NULLS FIRST LIMIT 1) poa ON true
       LEFT JOIN LATERAL (
         SELECT e.document_id, r.status AS sig_status, r.expires_at AS sig_expires_at
           FROM engagement_letters e
           LEFT JOIN LATERAL (SELECT status, expires_at FROM signature_requests r WHERE r.document_id = e.document_id AND r.org_id = e.org_id
                               ORDER BY r.created_at DESC LIMIT 1) r ON true
          WHERE e.case_id = k.id AND e.document_id IS NOT NULL ORDER BY e.created_at DESC LIMIT 1) el ON true
      WHERE k.org_id = $1 AND k.status <> 'closed' AND ($2::uuid IS NULL OR k.id = $2)
      ORDER BY k.opened_on DESC, k.reference LIMIT 5000`, [orgId, opts.caseId ?? null])
  return rows.map((r: any) => {
    const engagement = r.client_id == null ? 'no_client'
      : r.engagement_signed ? 'signed'
        : r.engagement_document_id ? letterStatus(r.sig_status ? { status: r.sig_status, expires_at: r.sig_expires_at } : null)
          : 'none'
    return {
      id: r.id as string, reference: r.reference as string, title: r.title as string, status: r.status as string,
      opened_on: r.opened_on, client_id: r.client_id as string | null, client_name: r.client_name as string | null, lawyer_name: r.lawyer_name as string | null,
      checks: { conflict: (r.conflict ?? 'missing') as string, kyc: r.kyc as string, poa: r.poa as string, engagement },
      poa_expires_on: r.poa_expires_on as string | null
    }
  })
}

export type OnboardingRow = Awaited<ReturnType<typeof onboardingRows>>[number]

// Which required checks are still open for a matter. A matter with no client fails every client-based check.
export function gaps(row: OnboardingRow, required: readonly string[]): OnboardingCheck[] {
  return ONBOARDING_CHECKS.filter((c) => required.includes(c) && !PASSES[c].includes(row.checks[c]))
}

export function summarize(rows: OnboardingRow[], required: readonly string[]) {
  const s = { total: rows.length, ready: 0, not_ready: 0, conflict: 0, kyc: 0, poa: 0, engagement: 0 }
  for (const r of rows) {
    const g = gaps(r, required)
    if (g.length) s.not_ready++
    else s.ready++
    for (const c of g) s[c]++
  }
  return s
}
