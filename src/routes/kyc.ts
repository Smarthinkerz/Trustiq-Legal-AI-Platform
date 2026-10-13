import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, uuidParam } from '../lib/http'
import { approvalBlockers, BLOCKER_TEXT, nextReview, riskScore, type Owner, type RiskLevel } from '../services/kyc'
import { toCsv } from '../services/practice-insights'

const GULF_TODAY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
const COLS = `k.client_id, k.identity_verified, k.identity_method, k.nationality, k.residence_country, k.occupation, k.purpose,
  k.source_of_funds, k.source_of_wealth, k.pep, k.pep_details, k.high_risk_country, k.cash_involved, k.complex_structure, k.non_face_to_face,
  k.beneficial_owners, to_char(k.sanctions_checked_on, 'YYYY-MM-DD') AS sanctions_checked_on, k.sanctions_lists, k.sanctions_match, k.sanctions_notes,
  k.risk_score, k.risk_level, k.risk_override, k.override_reason, k.status, k.decided_at, k.decision_note,
  to_char(k.next_review_on, 'YYYY-MM-DD') AS next_review_on, k.updated_at, d.name AS decided_by_name, u.name AS updated_by_name`

const ownerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nationality: z.string().trim().max(100).optional().default(''),
  ownership_pct: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
  pep: z.boolean().default(false)
})
const answersSchema = z.object({
  identity_verified: z.boolean().default(false),
  identity_method: z.enum(['in_person', 'video', 'certified_copy', 'other']).nullish().or(z.literal('')).transform((v) => v || null),
  nationality: optText(100), residence_country: optText(100), occupation: optText(300), purpose: optText(1000),
  source_of_funds: optText(1000), source_of_wealth: optText(1000),
  pep: z.boolean().default(false), pep_details: optText(1000),
  high_risk_country: z.boolean().default(false), cash_involved: z.boolean().default(false),
  complex_structure: z.boolean().default(false), non_face_to_face: z.boolean().default(false),
  beneficial_owners: z.array(ownerSchema).max(30).default([]),
  sanctions_checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  sanctions_lists: optText(500), sanctions_match: z.boolean().default(false), sanctions_notes: optText(2000),
  risk_override: z.enum(['low', 'medium', 'high']).nullish().or(z.literal('')).transform((v) => v || null),
  override_reason: optText(1000)
})

async function loadKyc(db: Queryable, orgId: string, clientId: string) {
  const [client] = await db.query('SELECT id, kind, name FROM clients WHERE id = $1 AND org_id = $2', [clientId, orgId])
  if (!client) return null
  const [kyc] = await db.query(
    `SELECT ${COLS} FROM client_kyc k LEFT JOIN users d ON d.id = k.decided_by LEFT JOIN users u ON u.id = k.updated_by WHERE k.client_id = $1`, [clientId])
  const a: any = kyc ?? { beneficial_owners: [], pep: false, high_risk_country: false, cash_involved: false, complex_structure: false, non_face_to_face: false, sanctions_match: false, source_of_funds: null, identity_verified: false, sanctions_checked_on: null }
  const risk = riskScore(a, client.kind)
  const effective: RiskLevel = (kyc?.risk_override ?? risk.level) as RiskLevel
  const today = GULF_TODAY()
  return {
    client: { id: client.id, kind: client.kind, name: client.name },
    kyc: kyc ?? null,
    status: kyc ? (kyc.status === 'approved' && kyc.next_review_on && kyc.next_review_on < today ? 'review_due' : kyc.status) : 'not_started',
    risk: { ...risk, effective },
    blockers: approvalBlockers(a, client.kind, a.beneficial_owners as Owner[])
  }
}

const kycRoutes = new Hono<AppEnv>()

kycRoutes.get('/client/:id', async (c) => {
  const { org } = auth(c)
  const data = await loadKyc(c.get('deps').db, org.id, uuidParam(c.req.param('id'), 'Client'))
  if (!data) throw notFound('Client')
  return c.json(data)
})

// Saving answers always reopens the file: an approved file that changes needs approving again.
kycRoutes.put('/client/:id', jsonBody(answersSchema), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [client] = await db.query('SELECT kind FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!client) throw notFound('Client')
  if (b.risk_override && !b.override_reason) throw badRequest('Give a reason for overriding the calculated risk.')
  const risk = riskScore(b, client.kind)
  const vals = [id, org.id, b.identity_verified, b.identity_method, b.nationality, b.residence_country, b.occupation, b.purpose, b.source_of_funds, b.source_of_wealth,
    b.pep, b.pep_details, b.high_risk_country, b.cash_involved, b.complex_structure, b.non_face_to_face, JSON.stringify(b.beneficial_owners),
    b.sanctions_checked_on, b.sanctions_lists, b.sanctions_match, b.sanctions_notes, risk.score, risk.level, b.risk_override, b.risk_override ? b.override_reason : null, user.id]
  await db.query(
    `INSERT INTO client_kyc (client_id, org_id, identity_verified, identity_method, nationality, residence_country, occupation, purpose, source_of_funds, source_of_wealth,
       pep, pep_details, high_risk_country, cash_involved, complex_structure, non_face_to_face, beneficial_owners,
       sanctions_checked_on, sanctions_lists, sanctions_match, sanctions_notes, risk_score, risk_level, risk_override, override_reason, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22, $23, $24, $25, $26)
     ON CONFLICT (client_id) DO UPDATE SET identity_verified = $3, identity_method = $4, nationality = $5, residence_country = $6, occupation = $7, purpose = $8,
       source_of_funds = $9, source_of_wealth = $10, pep = $11, pep_details = $12, high_risk_country = $13, cash_involved = $14, complex_structure = $15,
       non_face_to_face = $16, beneficial_owners = $17::jsonb, sanctions_checked_on = $18, sanctions_lists = $19, sanctions_match = $20, sanctions_notes = $21,
       risk_score = $22, risk_level = $23, risk_override = $24, override_reason = $25, updated_by = $26, updated_at = now(),
       status = 'in_progress', decided_by = NULL, decided_at = NULL, decision_note = NULL`, vals)
  await audit(c, 'kyc.updated', 'client', id, { risk: b.risk_override ?? risk.level, score: risk.score })
  return c.json(await loadKyc(db, org.id, id))
})

// Approval or rejection is a partner decision (owner/admin) and sets the next review date.
kycRoutes.post('/client/:id/decision', jsonBody(z.object({ decision: z.enum(['approved', 'rejected']), note: optText(2000) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { decision, note } = c.req.valid('json')
  const { db } = c.get('deps')
  const data = await loadKyc(db, org.id, id)
  if (!data) throw notFound('Client')
  if (!data.kyc) throw badRequest('Fill in the due diligence first.')
  if (decision === 'approved' && data.blockers.length) throw new HttpError(422, 'kyc_incomplete', BLOCKER_TEXT[data.blockers[0]!]!, { blockers: data.blockers })
  if (decision === 'approved' && data.risk.effective === 'high' && !note) throw badRequest('Record why the firm accepts this high-risk client (enhanced due diligence).')
  const review = decision === 'approved' ? nextReview(GULF_TODAY(), data.risk.effective) : null
  await db.query(`UPDATE client_kyc SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, next_review_on = $5 WHERE client_id = $1`,
    [id, decision, user.id, note, review])
  await audit(c, `kyc.${decision}`, 'client', id, { risk: data.risk.effective, next_review_on: review })
  return c.json(await loadKyc(db, org.id, id))
})

// Firm-wide register for the compliance officer or a regulator's inspection.
kycRoutes.get('/register', queryParams(z.object({ format: z.enum(['json', 'csv']).default('json') })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const today = GULF_TODAY()
  const rows = await db.query(
    `SELECT cl.id, cl.name, cl.kind, (SELECT count(*)::int FROM cases x WHERE x.client_id = cl.id AND x.status <> 'closed') AS open_cases,
            k.status, coalesce(k.risk_override, k.risk_level) AS risk, k.risk_score, k.pep, k.sanctions_match,
            to_char(k.sanctions_checked_on, 'YYYY-MM-DD') AS sanctions_checked_on, to_char(k.next_review_on, 'YYYY-MM-DD') AS next_review_on,
            k.decided_at, d.name AS decided_by_name
       FROM clients cl LEFT JOIN client_kyc k ON k.client_id = cl.id LEFT JOIN users d ON d.id = k.decided_by
      WHERE cl.org_id = $1 AND cl.archived_at IS NULL ORDER BY cl.name LIMIT 5000`, [org.id])
  const items: any[] = rows.map((r) => ({ ...r, status: !r.status ? 'not_started' : r.status === 'approved' && r.next_review_on && r.next_review_on < today ? 'review_due' : r.status }))
  await audit(c, 'kyc.register_viewed', 'organization', org.id, { format: c.req.valid('query').format })
  if (c.req.valid('query').format === 'csv') {
    const csv = toCsv([
      ['Client', 'Type', 'Open cases', 'KYC status', 'Risk', 'Score', 'PEP', 'Sanctions match', 'Sanctions screened', 'Next review', 'Decided by', 'Decided at'],
      ...items.map((r) => [r.name, r.kind, r.open_cases, r.status, r.risk ?? '', r.risk_score ?? '', r.pep ? 'yes' : 'no', r.sanctions_match ? 'yes' : 'no',
        r.sanctions_checked_on ?? '', r.next_review_on ?? '', r.decided_by_name ?? '', r.decided_at ? new Date(r.decided_at).toISOString().slice(0, 10) : ''])
    ])
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="kyc-register-${today}.csv"`, 'cache-control': 'private, no-store' } })
  }
  const summary = { total: items.length, approved: 0, in_progress: 0, rejected: 0, not_started: 0, review_due: 0, high: 0 }
  for (const r of items) { (summary as any)[r.status]++; if (r.risk === 'high') summary.high++ }
  return c.json({ items, summary })
})

export default kycRoutes
