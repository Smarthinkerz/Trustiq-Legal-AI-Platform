import type { Config } from '../config'
import type { Queryable } from '../db'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'
import { roundMoney } from './billing'

// ---------------------------------------------------------------------------
// Matter budgets and profitability. "Recorded value" is billable time at the
// rates it was logged at; it is compared with the budget (hourly matters) or
// the agreed fee (fixed and capped), and with what was invoiced and collected.
// ---------------------------------------------------------------------------

export const FEE_ARRANGEMENTS = ['hourly', 'fixed', 'capped', 'contingency'] as const
export type FeeArrangement = (typeof FEE_ARRANGEMENTS)[number]

export async function matterFinancials(q: Queryable, orgId: string, opts: { caseIds?: string[]; includeClosed?: boolean } = {}) {
  const rows = await q.query(
    `SELECT k.id, k.reference, k.title, k.status, k.currency, k.fee_arrangement, k.fee_amount::float8, k.budget_amount::float8, k.budget_alert_level,
            k.client_id, k.assigned_to, cl.name AS client_name, u.name AS assignee_name,
            COALESCE(t.minutes, 0)::int AS minutes, COALESCE(t.billable_minutes, 0)::int AS billable_minutes,
            COALESCE(t.value, 0)::float8 AS recorded_value, COALESCE(t.unbilled, 0)::float8 AS unbilled_time,
            COALESCE(x.total, 0)::float8 AS expenses, COALESCE(x.unbilled, 0)::float8 AS unbilled_expenses, COALESCE(x.billed, 0)::float8 AS billed_expenses,
            COALESCE(i.net, 0)::float8 AS invoiced_net, COALESCE(i.gross, 0)::float8 AS invoiced, COALESCE(i.paid, 0)::float8 AS collected,
            COALESCE(i.outstanding, 0)::float8 AS outstanding
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
       LEFT JOIN LATERAL (
         SELECT sum(minutes) AS minutes, sum(minutes) FILTER (WHERE billable) AS billable_minutes,
                sum(minutes * rate / 60.0) FILTER (WHERE billable) AS value, sum(minutes * rate / 60.0) FILTER (WHERE billable AND invoice_id IS NULL) AS unbilled
           FROM time_entries WHERE case_id = k.id) t ON true
       LEFT JOIN LATERAL (
         SELECT sum(amount) AS total, sum(amount) FILTER (WHERE billable AND invoice_id IS NULL) AS unbilled, sum(amount) FILTER (WHERE invoice_id IS NOT NULL) AS billed
           FROM expenses WHERE case_id = k.id) x ON true
       LEFT JOIN LATERAL (
         SELECT sum(subtotal) AS net, sum(total) AS gross, sum(amount_paid) AS paid, sum(total - amount_paid) FILTER (WHERE status = 'issued') AS outstanding
           FROM invoices WHERE case_id = k.id AND status IN ('issued', 'paid')) i ON true
      WHERE k.org_id = $1 AND ($2::uuid[] IS NULL OR k.id = ANY($2::uuid[])) AND ($3::boolean OR k.status <> 'closed')
      ORDER BY k.reference`, [orgId, opts.caseIds ?? null, opts.includeClosed ?? false])
  return rows.map(derive)
}

function derive(r: any) {
  const cur = r.currency as string
  const m = (n: number | null) => (n == null ? null : roundMoney(n, cur))
  const arrangement = r.fee_arrangement as FeeArrangement
  const hours = r.billable_minutes / 60
  // What the time is measured against: the budget for hourly work, the agreed fee for fixed and capped.
  const limit = arrangement === 'hourly' ? r.budget_amount : arrangement === 'contingency' ? null : r.fee_amount
  const usedPct = limit ? Math.round((r.recorded_value / limit) * 1000) / 10 : null
  const feeIncome = arrangement === 'fixed' ? r.fee_amount
    : arrangement === 'capped' ? (r.fee_amount != null ? Math.min(r.recorded_value, r.fee_amount) : r.recorded_value)
    : arrangement === 'hourly' ? r.recorded_value : null
  const invoicedFees = Math.max(0, r.invoiced_net - r.billed_expenses)
  const earned = arrangement === 'fixed' || arrangement === 'capped' ? feeIncome : invoicedFees || r.recorded_value
  return {
    ...r,
    recorded_value: m(r.recorded_value), unbilled_time: m(r.unbilled_time), expenses: m(r.expenses), unbilled_expenses: m(r.unbilled_expenses),
    invoiced_net: m(r.invoiced_net), invoiced: m(r.invoiced), collected: m(r.collected), outstanding: m(r.outstanding),
    hours: Math.round(hours * 100) / 100,
    limit: m(limit), used_pct: usedPct,
    budget_state: usedPct == null ? null : usedPct >= 100 ? 'over' : usedPct >= 80 ? 'warning' : 'ok',
    fee_income: m(feeIncome),
    // Fees billed (excluding expenses) against the value of the time recorded.
    realization_pct: r.recorded_value > 0 && invoicedFees > 0 ? Math.round((invoicedFees / r.recorded_value) * 1000) / 10 : null,
    effective_rate: hours > 0 && earned ? m(earned / hours) : null,
    write_down: (arrangement === 'fixed' || arrangement === 'capped') && r.fee_amount != null && r.recorded_value > r.fee_amount ? m(r.recorded_value - r.fee_amount) : null
  }
}

// Emails the responsible lawyer and the owners/admins once when a matter reaches 80% and 100% of its budget or fee.
export async function checkBudgetAlert(deps: { db: Queryable; mailer: Mailer; config: Config; log: Logger }, orgId: string, caseId: string) {
  const [f] = await matterFinancials(deps.db, orgId, { caseIds: [caseId], includeClosed: true })
  if (!f || f.used_pct == null) return null
  const level = f.used_pct >= 100 ? 100 : f.used_pct >= 80 ? 80 : 0
  if (level <= f.budget_alert_level) return null
  const rows = await deps.db.query(
    'UPDATE cases SET budget_alert_level = $3 WHERE id = $1 AND org_id = $2 AND budget_alert_level < $3 RETURNING id', [caseId, orgId, level])
  if (!rows.length || !deps.mailer.configured) return level
  const to = await deps.db.query(
    `SELECT DISTINCT email FROM users WHERE org_id = $1 AND deactivated_at IS NULL AND notify_email AND role <> 'client' AND (id = $2 OR role IN ('owner', 'admin'))`,
    [orgId, f.assigned_to])
  const what = f.fee_arrangement === 'hourly' ? 'budget' : 'agreed fee'
  const fmt = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${f.currency}`
  for (const r of to.slice(0, 10)) {
    await deps.mailer.send({
      to: r.email,
      subject: `${level === 100 ? 'Over budget' : 'Budget at 80%'}: ${f.reference} ${f.title.slice(0, 60)}`,
      text: [
        `Time recorded on ${f.reference} – ${f.title} is now ${f.used_pct}% of the ${what}.`,
        `Recorded value: ${fmt(f.recorded_value)} of ${fmt(f.limit)} (${f.hours} billable hours).`,
        '', `${deps.config.appUrl}/app#/cases/${caseId}`, '', '—', '',
        `بلغ الوقت المسجل على القضية ${f.reference} نسبة ${f.used_pct}% من ${f.fee_arrangement === 'hourly' ? 'الميزانية' : 'الأتعاب المتفق عليها'}.`
      ].join('\n')
    }).catch((err) => deps.log.warn('budget alert email failed', { err }))
  }
  return level
}
