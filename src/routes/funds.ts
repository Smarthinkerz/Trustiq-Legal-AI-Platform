import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Db } from '../db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, optText, optUuid, uuidParam } from '../lib/http'
import { orgBilling, roundMoney } from '../services/billing'
import { contentDisposition, renderFundReceipt, safeFileName } from '../services/export'
import { ACCEPTED_TYPES } from '../services/extract'
import { balances, caseBalances, ENTRY_COLUMNS, FUND_METHODS, postEntry } from '../services/funds'
import { CURRENCIES } from '../services/reference'

const GULF_TODAY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function clientOf(db: Db, orgId: string, id: string) {
  const client = await db.one('SELECT id, name, name_ar FROM clients WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!client) throw notFound('Client')
  return client
}

async function entries(db: Db, orgId: string, where: string, params: unknown[]) {
  return db.query(
    `SELECT ${ENTRY_COLUMNS} FROM client_fund_entries e LEFT JOIN cases k ON k.id = e.case_id LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN users u ON u.id = e.created_by
      WHERE e.org_id = $1 AND ${where} ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 1000`, [orgId, ...params])
}

const fundsRoutes = new Hono<AppEnv>()

fundsRoutes.get('/client/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  await clientOf(db, org.id, id)
  const [bal, list, invoices, billing] = await Promise.all([
    balances(db, org.id, id),
    entries(db, org.id, 'e.client_id = $2', [id]),
    db.query(`SELECT id, number, currency, total, amount_paid, (total - amount_paid) AS outstanding, case_id FROM invoices
               WHERE org_id = $1 AND client_id = $2 AND status = 'issued' AND total > amount_paid ORDER BY issue_date`, [org.id, id]),
    orgBilling(db, org.id)
  ])
  return c.json({ balances: bal, entries: list, open_invoices: invoices, default_currency: billing.default_currency })
})

fundsRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id])).length) throw notFound('Case')
  return c.json({ balances: await caseBalances(db, org.id, id) })
})

// Money received from, paid out for, or returned to the client.
fundsRoutes.post('/client/:id/entries', jsonBody(z.object({
  kind: z.enum(['deposit', 'disbursement', 'refund']),
  amount: z.number().positive().max(1e10),
  currency: z.enum(CURRENCIES as unknown as [string, ...string[]]).optional(),
  entry_date: day.optional(),
  description: z.string().trim().min(2).max(500),
  method: z.enum(FUND_METHODS).nullish(),
  reference: optText(100),
  case_id: optUuid
})), async (c) => {
  const b = c.req.valid('json')
  if (b.kind === 'refund') requireRole(c, 'owner', 'admin')
  else requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  await clientOf(db, org.id, id)
  if (b.case_id && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [b.case_id, org.id, id])).length) {
    throw badRequest('The case does not belong to this client.')
  }
  const date = b.entry_date ?? GULF_TODAY()
  if (date > GULF_TODAY()) throw badRequest('The date cannot be in the future.')
  const currency = b.currency ?? (await orgBilling(db, org.id)).default_currency
  const res = await db.tx((q) => postEntry(q, {
    orgId: org.id, clientId: id, caseId: b.case_id, kind: b.kind, amount: b.amount, currency, entryDate: date,
    description: b.description, method: b.method ?? null, reference: b.reference, userId: user.id
  }))
  await audit(c, `funds.${b.kind}`, 'client', id, { amount: b.amount, currency, entry: res.id })
  return c.json({ entry_id: res.id, balance: res.balance, balances: await balances(db, org.id, id) }, 201)
})

// Pays an issued invoice out of the client's funds (records a payment on the invoice).
fundsRoutes.post('/client/:id/apply', jsonBody(z.object({ invoice_id: z.string().uuid(), amount: z.number().positive().max(1e10) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await clientOf(db, org.id, id)
  const res = await db.tx(async (q) => {
    const [inv] = await q.query('SELECT id, number, client_id, case_id, status, total, amount_paid, currency FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [b.invoice_id, org.id])
    if (!inv || inv.client_id !== id) throw notFound('Invoice')
    if (inv.status !== 'issued') throw conflict('Only issued, unpaid invoices can be paid from client funds.')
    const amount = roundMoney(b.amount, inv.currency)
    const paid = roundMoney(Number(inv.amount_paid) + amount, inv.currency)
    if (paid > Number(inv.total) + 1e-9) throw badRequest('The amount is more than the invoice\'s outstanding balance.')
    const posted = await postEntry(q, {
      orgId: org.id, clientId: id, caseId: inv.case_id, kind: 'applied', amount, currency: inv.currency, entryDate: GULF_TODAY(),
      description: `Applied to invoice ${inv.number}`, invoiceId: inv.id, userId: user.id
    })
    const full = paid >= Number(inv.total) - 1e-9
    await q.query(`UPDATE invoices SET amount_paid = $3, status = $4, paid_at = CASE WHEN $4 = 'paid' THEN now() ELSE paid_at END, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [inv.id, org.id, paid, full ? 'paid' : 'issued'])
    await q.query(`INSERT INTO invoice_payments (org_id, invoice_id, method, amount, currency, status, recorded_by, paid_at) VALUES ($1, $2, 'client_funds', $3, $4, 'paid', $5, now())`,
      [org.id, inv.id, amount, inv.currency, user.id])
    return { ...posted, invoice_status: full ? 'paid' : 'issued' }
  })
  await audit(c, 'funds.applied', 'invoice', b.invoice_id, { amount: b.amount, entry: res.id })
  return c.json({ entry_id: res.id, balance: res.balance, invoice_status: res.invoice_status, balances: await balances(db, org.id, id) }, 201)
})

// Corrections are reversal entries, so the ledger keeps its full history.
fundsRoutes.post('/entries/:id/reverse', jsonBody(z.object({ reason: z.string().trim().min(3).max(500) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Entry')
  const { reason } = c.req.valid('json')
  const { db } = c.get('deps')
  const res = await db.tx(async (q) => {
    const [e] = await q.query(`SELECT * FROM client_fund_entries WHERE id = $1 AND org_id = $2`, [id, org.id])
    if (!e) throw notFound('Entry')
    if (e.reversal_of) throw conflict('A reversal cannot itself be reversed.')
    if (e.kind === 'applied') throw conflict('A payment applied to an invoice cannot be reversed here.')
    if ((await q.query('SELECT 1 FROM client_fund_entries WHERE reversal_of = $1', [id])).length) throw conflict('This entry has already been reversed.')
    return postEntry(q, {
      orgId: org.id, clientId: e.client_id, caseId: e.case_id, kind: e.kind, amount: Math.abs(Number(e.delta)), signedDelta: -Number(e.delta),
      currency: e.currency, entryDate: GULF_TODAY(), description: `Reversal: ${reason}`, reversalOf: id, userId: user.id
    })
  })
  await audit(c, 'funds.reversed', 'client_fund_entry', id, { reason, reversal: res.id })
  return c.json({ entry_id: res.id, balance: res.balance }, 201)
})

// Receipt voucher (سند قبض) for money received, as Word on the letterhead.
fundsRoutes.get('/entries/:id/receipt', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Entry')
  const { db } = c.get('deps')
  const [e] = await db.query(
    `SELECT e.*, to_char(e.entry_date, 'YYYY-MM-DD') AS day, cl.name AS client_name, cl.name_ar AS client_name_ar, k.reference AS case_reference, k.title AS case_title, u.name AS received_by
       FROM client_fund_entries e JOIN clients cl ON cl.id = e.client_id LEFT JOIN cases k ON k.id = e.case_id LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = $1 AND e.org_id = $2 AND e.kind = 'deposit' AND e.reversal_of IS NULL`, [id, org.id])
  if (!e) throw notFound('Receipt')
  const lh = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const buf = await renderFundReceipt({
    receiptNo: e.receipt_no, date: e.day, firmName: (lh as any)?.firm_name || org.name, clientName: e.client_name, clientNameAr: e.client_name_ar,
    amount: Number(e.delta), currency: e.currency, method: e.method, reference: e.reference, description: e.description,
    caseLabel: e.case_reference ? `${e.case_reference} – ${e.case_title}` : null, receivedBy: e.received_by, letterhead: lh as any
  })
  await audit(c, 'funds.receipt_downloaded', 'client_fund_entry', id)
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(safeFileName(`Receipt ${e.receipt_no}`, 'docx')), 'cache-control': 'private, no-store' }
  })
})

// Firm-wide: what the firm holds for each client (owners and admins).
fundsRoutes.get('/report', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const rows = await c.get('deps').db.query(
    `SELECT cl.id AS client_id, cl.name, e.currency, sum(e.delta)::numeric AS balance, max(e.entry_date) AS last_movement
       FROM client_fund_entries e JOIN clients cl ON cl.id = e.client_id WHERE e.org_id = $1
      GROUP BY cl.id, cl.name, e.currency HAVING sum(e.delta) <> 0 ORDER BY e.currency, sum(e.delta) DESC`, [org.id])
  const totals: Record<string, number> = {}
  for (const r of rows) totals[r.currency] = roundMoney((totals[r.currency] ?? 0) + Number(r.balance), r.currency)
  return c.json({ items: rows.map((r) => ({ ...r, balance: Number(r.balance) })), totals })
})

export default fundsRoutes
