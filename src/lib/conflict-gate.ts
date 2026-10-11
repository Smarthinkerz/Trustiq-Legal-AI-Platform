import type { Ctx } from '../context'
import { auth } from '../context'
import { HttpError } from './errors'
import type { Blocking } from '../services/conflicts'
import { z } from 'zod'

// A partner (owner or admin) may proceed despite a conflict by giving a reason; it is logged.
export const conflictOverride = z.object({ reason: z.string().trim().min(5).max(1000) }).nullish()

export function gateConflicts(c: Ctx, matches: Blocking[], override: { reason: string } | null | undefined): { decision: 'clear' | 'override'; reason: string | null } {
  if (!matches.length) return { decision: 'clear', reason: null }
  const { user } = auth(c)
  const canOverride = user.role === 'owner' || user.role === 'admin'
  if (override?.reason && canOverride) return { decision: 'override', reason: override.reason }
  throw new HttpError(409, 'conflict_of_interest',
    canOverride ? 'Possible conflict of interest. Review the matches and give a reason to proceed.'
      : 'Possible conflict of interest. A partner (owner or admin) must review and approve this.',
    { conflicts: matches, can_override: canOverride })
}
