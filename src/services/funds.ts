import type { Queryable } from '../db'
import { badRequest, conflict } from '../lib/errors'
import { roundMoney } from './billing'

// ---------------------------------------------------------------------------
// Client funds (advance fees / retainers / court-fee deposits held for a client).
// An append-only ledger: every movement is an entry with a signed delta, the
// balance per client and currency is their sum and may never go below zero,
// and mistakes are corrected by a reversal entry, never by editing or deleting.
// ---------------------------------------------------------------------------

export const FUND_KINDS = ['deposit', 'disbursement', 'applied', 'refund'] as const
export type FundKind = typeof FUND_KINDS[number]
export const FUND_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const

export const ENTRY_COLUMNS = `e.id, e.client_id, e.case_id, e.kind, e.delta, e.currency, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.description,
  e.method, e.reference, e.receipt_no, e.invoice_id, e.reversal_of, e.created_at,
  (SELECT r.id FROM client_fund_entries r WHERE r.reversal_of = e.id) AS reversed_by,
  k.reference AS case_reference, i.number AS invoice_number, u.name AS created_by_name`

export async function balances(q: Queryable, orgId: string, clientId: string) {
  const rows = await q.query(
    `SELECT currency, sum(delta)::numeric AS balance,
            sum(CASE WHEN kind = 'deposit' THEN delta ELSE 0 END)::numeric AS received,
            -sum(CASE WHEN kind <> 'deposit' THEN delta ELSE 0 END)::numeric AS used
       FROM client_fund_entries WHERE org_id = $1 AND client_id = $2 GROUP BY currency ORDER BY currency`, [orgId, clientId])
  return rows.map((r) => ({ currency: r.currency, balance: Number(r.balance), received: Number(r.received), used: Number(r.used) }))
}

export async function caseBalances(q: Queryable, orgId: string, caseId: string) {
  const rows = await q.query(
    `SELECT currency, sum(delta)::numeric AS balance FROM client_fund_entries WHERE org_id = $1 AND case_id = $2 GROUP BY currency ORDER BY currency`, [orgId, caseId])
  return rows.map((r) => ({ currency: r.currency, balance: Number(r.balance) }))
}

// Inserts one movement inside a transaction, refusing anything that would overdraw the client's funds.
export async function postEntry(q: Queryable, e: {
  orgId: string; clientId: string; caseId: string | null; kind: FundKind; amount: number; currency: string; entryDate: string
  description: string; method?: string | null; reference?: string | null; invoiceId?: string | null; reversalOf?: string | null; userId: string
  signedDelta?: number
}) {
  // Serialise all movements for this client so two withdrawals cannot both pass the balance check.
  await q.query('SELECT id FROM clients WHERE id = $1 AND org_id = $2 FOR UPDATE', [e.clientId, e.orgId])
  const amount = roundMoney(e.amount, e.currency)
  if (!(amount > 0) && e.signedDelta === undefined) throw badRequest('Enter an amount greater than zero.')
  const delta = e.signedDelta ?? (e.kind === 'deposit' ? amount : -amount)
  const [{ bal }] = await q.query(`SELECT coalesce(sum(delta), 0)::numeric AS bal FROM client_fund_entries WHERE org_id = $1 AND client_id = $2 AND currency = $3`,
    [e.orgId, e.clientId, e.currency])
  const after = roundMoney(Number(bal) + delta, e.currency)
  if (after < 0) throw conflict(`Not enough client funds: the balance is ${Number(bal).toFixed(3)} ${e.currency}.`)
  let receiptNo: string | null = null
  if (e.kind === 'deposit' && !e.reversalOf) {
    const [o] = await q.query('UPDATE organizations SET fund_receipt_seq = fund_receipt_seq + 1 WHERE id = $1 RETURNING fund_receipt_seq', [e.orgId])
    receiptNo = `RV-${e.entryDate.slice(0, 4)}-${String(o.fund_receipt_seq).padStart(4, '0')}`
  }
  const [row] = await q.query(
    `INSERT INTO client_fund_entries (org_id, client_id, case_id, kind, delta, currency, entry_date, description, method, reference, receipt_no, invoice_id, reversal_of, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [e.orgId, e.clientId, e.caseId, e.kind, delta, e.currency, e.entryDate, e.description, e.method ?? null, e.reference ?? null, receiptNo, e.invoiceId ?? null, e.reversalOf ?? null, e.userId])
  return { id: row.id as string, balance: after }
}
