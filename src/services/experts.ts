import type { Queryable } from '../db'

// ---------------------------------------------------------------------------
// Court-appointed experts (الخبرة القضائية): a referral carries up to four
// deadlines (fee deposit, submissions to the expert, the report, objections
// to it). Each is kept on the calendar while it is still open.
// ---------------------------------------------------------------------------

export const EXPERT_TYPES = ['accounting', 'engineering', 'medical', 'real_estate', 'it', 'other'] as const
export const FEE_PAYERS = ['client', 'other_party', 'shared', 'court'] as const
export const RESULTS = ['favourable', 'partly', 'unfavourable'] as const
export type DeadlineKey = 'fee' | 'memo' | 'report' | 'objection'

export type Referral = {
  id: string; case_id: string; closed: boolean; expert_name: string | null; fee_payer: string
  fee_due: string | null; fee_paid_on: string | null; memo_due: string | null
  report_due: string | null; report_filed_on: string | null
  objection_due: string | null; objections_filed_on: string | null
  event_ids: Partial<Record<DeadlineKey, string>>
}

export function stage(r: Pick<Referral, 'closed' | 'fee_paid_on' | 'report_filed_on' | 'objections_filed_on'>) {
  if (r.closed) return 'closed'
  if (r.objections_filed_on) return 'objections_filed'
  if (r.report_filed_on) return 'report_filed'
  if (r.fee_paid_on) return 'in_progress'
  return 'appointed'
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Every deadline the referral has, and whether it is still open.
export function deadlines(r: Referral, reference: string) {
  const who = r.expert_name ? ` (${r.expert_name})` : ''
  const live = !r.closed
  return [
    { key: 'fee' as const, date: r.fee_due, open: live && !r.fee_paid_on, title: `Expert fee deposit due – ${reference}`,
      note: `Deposit the expert's fee${who}. Payer: ${r.fee_payer.replace('_', ' ')}. Unpaid fees can lead the court to drop the referral.` },
    { key: 'memo' as const, date: r.memo_due, open: live && !r.report_filed_on, title: `Submissions to the expert due – ${reference}`,
      note: `Last day to give the expert${who} our memorandum and documents.` },
    { key: 'report' as const, date: r.report_due, open: live && !r.report_filed_on, title: `Expert report due – ${reference}`,
      note: `The expert${who} is due to file the report. Follow up with the expert or the court if it is late.` },
    { key: 'objection' as const, date: r.objection_due, open: live && !!r.report_filed_on && !r.objections_filed_on, title: `Objections to expert report due – ${reference}`,
      note: `Last day to file objections (comments) on the expert report${who}. Check the period against the court's order and the applicable law.` }
  ]
}

// The earliest open deadline, for lists and the dashboard.
export function nextDeadline(r: Referral) {
  const open = deadlines(r, '').filter((d) => d.open && d.date).sort((a, b) => a.date!.localeCompare(b.date!))
  return open[0] ? { key: open[0].key, date: open[0].date! } : null
}

// Creates, moves, completes or removes the calendar events; returns the new event id map.
export async function syncExpertEvents(q: Queryable, o: { orgId: string; userId: string; reference: string; r: Referral }) {
  const ids: Partial<Record<DeadlineKey, string>> = { ...o.r.event_ids }
  for (const d of deadlines(o.r, o.reference)) {
    const id = ids[d.key]
    if (id && !d.date) {
      await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [id, o.orgId])
      delete ids[d.key]
      continue
    }
    if (!d.date) continue
    if (id) {
      const updated = await q.query(
        `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4, notes = $5,
                completed_at = CASE WHEN $6::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now()
          WHERE id = $1 AND org_id = $2 RETURNING id`, [id, o.orgId, d.date, d.title, d.note, d.open])
      if (updated.length) continue
    }
    const [e] = await q.query(
      `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
       VALUES ($1, $2, $3, 'deadline', ($4::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7) RETURNING id`,
      [o.orgId, o.r.case_id, d.title, d.date, d.note, d.open, o.userId])
    ids[d.key] = e.id
  }
  return ids
}
