import type { Queryable } from '../db'
import { paymentRequired } from '../lib/errors'

// ---------------------------------------------------------------------------
// Seats bought with a firm subscription. Owners, admins and lawyers use lawyer
// seats; staff (paralegals, secretaries) use the free support seats. Pending
// invitations hold a seat until they expire or are revoked. Firms without a
// seat count (trials and older plans) are not limited.
// ---------------------------------------------------------------------------

export const LAWYER_ROLES = ['owner', 'admin', 'lawyer']
export const seatKind = (role: string): 'lawyer' | 'support' | null => (LAWYER_ROLES.includes(role) ? 'lawyer' : role === 'staff' ? 'support' : null)

export async function seatUsage(db: Queryable, orgId: string) {
  const [row] = await db.query(
    `SELECT o.lawyer_seats, o.support_seats,
       (SELECT count(*)::int FROM users WHERE org_id = $1 AND deactivated_at IS NULL AND role IN ('owner', 'admin', 'lawyer'))
       + (SELECT count(*)::int FROM auth_tokens WHERE org_id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now() AND role IN ('admin', 'lawyer')) AS lawyers_used,
       (SELECT count(*)::int FROM users WHERE org_id = $1 AND deactivated_at IS NULL AND role = 'staff')
       + (SELECT count(*)::int FROM auth_tokens WHERE org_id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now() AND role = 'staff') AS support_used
     FROM organizations o WHERE o.id = $1`, [orgId])
  return row as { lawyer_seats: number | null; support_seats: number | null; lawyers_used: number; support_used: number }
}

// Throws when adding one more member with `role` would go beyond the seats bought.
export async function assertSeatAvailable(db: Queryable, orgId: string, role: string) {
  const kind = seatKind(role)
  if (!kind) return
  const u = await seatUsage(db, orgId)
  if (kind === 'lawyer' && u.lawyer_seats !== null && u.lawyers_used >= u.lawyer_seats) {
    throw paymentRequired('seat_limit_lawyers', `All ${u.lawyer_seats} lawyer seats are in use. Add lawyer seats to your subscription, or remove a member or a pending invitation.`)
  }
  if (kind === 'support' && u.support_seats !== null && u.support_used >= u.support_seats) {
    throw paymentRequired('seat_limit_support', `All ${u.support_seats} support staff seats are in use. Ask us to add support seats (they are free), or remove a member or a pending invitation.`)
  }
}
