import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import type { Queryable } from '../db'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { jsonBody, optText, optUuid, pageSchema, paged, queryParams, uuidParam } from '../lib/http'
import { CURRENCIES } from '../services/reference'
import { computeTotals, orgBilling, recalcInvoice, roundMoney, timeAmount } from '../services/billing'
import { contentDisposition, renderInvoiceDocx, safeFileName } from '../services/export'
import { ACCEPTED_TYPES } from '../services/extract'
import { invoiceZatcaQr, isSaudiVatNumber, zatcaApplies } from '../services/zatca'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
const money = z.number().min(0).max(1e12)

async function assertCase(q: Queryable, orgId: string, caseId: string) {
  const k = await q.query('SELECT id, client_id FROM cases WHERE id = $1 AND org_id = $2', [caseId, orgId])
  if (!k.length) throw badRequest('Selected case does not exist.')
  return k[0]
}

// Staff may change their own entries; owners and admins may change anyone's.
function assertOwnsEntry(c: Ctx, entry: { user_id: string | null; invoice_id: string | null }) {
  const { user } = auth(c)
  if (entry.invoice_id) throw conflict('This entry is already on an invoice. Void or delete the invoice draft first.')
  if (entry.user_id !== user.id && !['owner', 'admin'].includes(user.role)) throw forbidden('You can only change your own entries.')
}

const billingRoutes = new Hono<AppEnv>()

// ---------------- Settings ----------------

billingRoutes.get('/settings', async (c) => {
  const { org } = auth(c)
  const { db } = c.get('deps')
  const s = await orgBilling(db, org.id)
  const rates = await db.query(`SELECT id, name, role, hourly_rate FROM users WHERE org_id = $1 AND role <> 'client' AND deactivated_at IS NULL ORDER BY name`, [org.id])
  return c.json({ settings: s, rates })
})

billingRoutes.put('/settings', jsonBody(z.object({
  vat_number: optText(60),
  vat_rate: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
  payment_terms_days: z.number().int().min(0).max(365),
  bank_details: optText(2000),
  invoice_footer: optText(1000),
  default_hourly_rate: money.nullish().transform((v) => v ?? null)
})), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const b = c.req.valid('json')
  if (b.vat_number && zatcaApplies(org.default_jurisdiction, org.default_currency) && !isSaudiVatNumber(b.vat_number.replace(/\s/g, ''))) {
    throw badRequest('A Saudi VAT registration number has 15 digits and starts and ends with 3.')
  }
  if (b.vat_number && zatcaApplies(org.default_jurisdiction, org.default_currency)) b.vat_number = b.vat_number.replace(/\s/g, '')
  await c.get('deps').db.query(
    `UPDATE organizations SET vat_number = $2, vat_rate = $3, payment_terms_days = $4, bank_details = $5, invoice_footer = $6, default_hourly_rate = $7, updated_at = now()
      WHERE id = $1`, [org.id, b.vat_number, b.vat_rate, b.payment_terms_days, b.bank_details, b.invoice_footer, b.default_hourly_rate])
  await audit(c, 'billing.settings_updated', 'organization', org.id)
  return c.json({ ok: true })
})

billingRoutes.put('/rates/:userId', jsonBody(z.object({ hourly_rate: money.nullish().transform((v) => v ?? null) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('userId'), 'Member')
  const rows = await c.get('deps').db.query(`UPDATE users SET hourly_rate = $3 WHERE id = $1 AND org_id = $2 AND role <> 'client' RETURNING id`, [id, org.id, c.req.valid('json').hourly_rate])
  if (!rows.length) throw notFound('Member')
  await audit(c, 'billing.rate_updated', 'user', id)
  return c.json({ ok: true })
})

// ---------------- Time entries ----------------

const timeFilters = z.object({
  ...pageSchema,
  case_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  unbilled: z.enum(['true', 'false']).optional()
})

billingRoutes.get('/time', queryParams(timeFilters), async (c) => {
  const { org } = auth(c)
  const f = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = ['t.org_id = $1']
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)) }
  if (f.case_id) add('t.case_id = ?', f.case_id)
  if (f.user_id) add('t.user_id = ?', f.user_id)
  if (f.from) add('t.work_date >= ?', f.from)
  if (f.to) add('t.work_date <= ?', f.to)
  if (f.unbilled === 'true') conds.push('t.invoice_id IS NULL AND t.billable')
  const where = conds.join(' AND ')
  const { db } = c.get('deps')
  const [agg] = await db.query(
    `SELECT count(*)::int AS n, COALESCE(sum(t.minutes), 0)::int AS minutes,
            COALESCE(sum(CASE WHEN t.billable THEN t.minutes ELSE 0 END), 0)::int AS billable_minutes,
            COALESCE(sum(CASE WHEN t.billable THEN t.minutes * t.rate / 60.0 ELSE 0 END), 0)::float8 AS value
       FROM time_entries t WHERE ${where}`, params)
  const items = await db.query(
    `SELECT t.id, t.case_id, k.reference AS case_reference, k.title AS case_title, k.currency, t.user_id, u.name AS user_name,
            t.work_date, t.minutes, t.description, t.rate, t.billable, t.invoice_id, i.number AS invoice_number
       FROM time_entries t JOIN cases k ON k.id = t.case_id LEFT JOIN users u ON u.id = t.user_id LEFT JOIN invoices i ON i.id = t.invoice_id
      WHERE ${where} ORDER BY t.work_date DESC, t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize])
  return c.json({ ...paged(items.map((t) => ({ ...t, amount: timeAmount(t.minutes, Number(t.rate), t.currency) })), agg.n, f.page, f.pageSize), summary: agg })
})

const timeFields = {
  case_id: z.string().uuid(),
  work_date: isoDate,
  minutes: z.number().int().min(1).max(1440),
  description: z.string().trim().min(2).max(2000),
  rate: money.nullish(),
  billable: z.boolean()
}

billingRoutes.post('/time', jsonBody(z.object({ ...timeFields, billable: timeFields.billable.default(true), work_date: timeFields.work_date.optional() })), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertCase(db, org.id, b.case_id)
  let rate = b.rate
  if (rate == null) {
    const [r] = await db.query('SELECT COALESCE(u.hourly_rate, o.default_hourly_rate, 0)::float8 AS rate FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1', [user.id])
    rate = r.rate
  }
  const entry = await db.one(
    `INSERT INTO time_entries (org_id, case_id, user_id, work_date, minutes, description, rate, billable)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8) RETURNING *`,
    [org.id, b.case_id, user.id, b.work_date ?? null, b.minutes, b.description, rate, b.billable])
  await audit(c, 'billing.time_logged', 'time_entry', entry!.id, { minutes: b.minutes })
  return c.json({ entry }, 201)
})

billingRoutes.patch('/time/:id', jsonBody(z.object(timeFields).partial()), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Entry')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const entry = await db.one('SELECT user_id, invoice_id FROM time_entries WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!entry) throw notFound('Time entry')
  assertOwnsEntry(c, entry as any)
  if (b.case_id) await assertCase(db, org.id, b.case_id)
  const sets: string[] = []
  const values: unknown[] = []
  for (const k of ['case_id', 'work_date', 'minutes', 'description', 'rate', 'billable'] as const) {
    if (b[k] !== undefined && b[k] !== null) { values.push(b[k]); sets.push(`${k} = $${values.length + 2}`) }
  }
  if (!sets.length) return c.json({ ok: true })
  const updated = await db.one(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`, [id, org.id, ...values])
  return c.json({ entry: updated })
})

billingRoutes.delete('/time/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Entry')
  const { db } = c.get('deps')
  const entry = await db.one('SELECT user_id, invoice_id FROM time_entries WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!entry) throw notFound('Time entry')
  assertOwnsEntry(c, entry as any)
  await db.query('DELETE FROM time_entries WHERE id = $1', [id])
  await audit(c, 'billing.time_deleted', 'time_entry', id)
  return c.json({ ok: true })
})

// ---------------- Expenses ----------------

billingRoutes.get('/expenses', queryParams(timeFilters), async (c) => {
  const { org } = auth(c)
  const f = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = ['e.org_id = $1']
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)) }
  if (f.case_id) add('e.case_id = ?', f.case_id)
  if (f.user_id) add('e.user_id = ?', f.user_id)
  if (f.from) add('e.incurred_on >= ?', f.from)
  if (f.to) add('e.incurred_on <= ?', f.to)
  if (f.unbilled === 'true') conds.push('e.invoice_id IS NULL AND e.billable')
  const where = conds.join(' AND ')
  const { db } = c.get('deps')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM expenses e WHERE ${where}`, params)
  const items = await db.query(
    `SELECT e.id, e.case_id, k.reference AS case_reference, k.title AS case_title, k.currency, e.user_id, u.name AS user_name,
            e.incurred_on, e.description, e.amount, e.billable, e.invoice_id, i.number AS invoice_number
       FROM expenses e JOIN cases k ON k.id = e.case_id LEFT JOIN users u ON u.id = e.user_id LEFT JOIN invoices i ON i.id = e.invoice_id
      WHERE ${where} ORDER BY e.incurred_on DESC, e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize])
  return c.json(paged(items, n, f.page, f.pageSize))
})

const expenseFields = {
  case_id: z.string().uuid(),
  incurred_on: isoDate,
  description: z.string().trim().min(2).max(2000),
  amount: money,
  billable: z.boolean()
}

billingRoutes.post('/expenses', jsonBody(z.object({ ...expenseFields, billable: expenseFields.billable.default(true), incurred_on: expenseFields.incurred_on.optional() })), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await assertCase(db, org.id, b.case_id)
  const expense = await db.one(
    `INSERT INTO expenses (org_id, case_id, user_id, incurred_on, description, amount, billable)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7) RETURNING *`,
    [org.id, b.case_id, user.id, b.incurred_on ?? null, b.description, b.amount, b.billable])
  await audit(c, 'billing.expense_added', 'expense', expense!.id)
  return c.json({ expense }, 201)
})

billingRoutes.delete('/expenses/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Expense')
  const { db } = c.get('deps')
  const entry = await db.one('SELECT user_id, invoice_id FROM expenses WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!entry) throw notFound('Expense')
  assertOwnsEntry(c, entry as any)
  await db.query('DELETE FROM expenses WHERE id = $1', [id])
  await audit(c, 'billing.expense_deleted', 'expense', id)
  return c.json({ ok: true })
})

// ---------------- Invoices ----------------

billingRoutes.get('/unbilled', queryParams(z.object({ client_id: z.string().uuid(), case_id: z.string().uuid().optional() })), async (c) => {
  const { org } = auth(c)
  const { client_id, case_id } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = [org.id, client_id]
  let caseFilter = ''
  if (case_id) { params.push(case_id); caseFilter = ' AND k.id = $3' }
  const time = await db.query(
    `SELECT t.id, t.work_date, t.minutes, t.description, t.rate, k.reference AS case_reference, k.currency, u.name AS user_name
       FROM time_entries t JOIN cases k ON k.id = t.case_id LEFT JOIN users u ON u.id = t.user_id
      WHERE t.org_id = $1 AND k.client_id = $2 AND t.invoice_id IS NULL AND t.billable ${caseFilter} ORDER BY t.work_date`, params)
  const expenses = await db.query(
    `SELECT e.id, e.incurred_on, e.description, e.amount, k.reference AS case_reference, k.currency
       FROM expenses e JOIN cases k ON k.id = e.case_id
      WHERE e.org_id = $1 AND k.client_id = $2 AND e.invoice_id IS NULL AND e.billable ${caseFilter} ORDER BY e.incurred_on`, params)
  return c.json({
    time: time.map((t) => ({ ...t, amount: timeAmount(t.minutes, Number(t.rate), t.currency) })),
    expenses
  })
})

billingRoutes.get('/invoices', queryParams(z.object({
  ...pageSchema,
  status: z.enum(['draft', 'issued', 'paid', 'void', 'outstanding', 'overdue']).optional(),
  client_id: z.string().uuid().optional(),
  case_id: z.string().uuid().optional()
})), async (c) => {
  const { org } = auth(c)
  const f = c.req.valid('query')
  const params: unknown[] = [org.id]
  const conds = ['i.org_id = $1']
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)) }
  if (f.status === 'outstanding') conds.push(`i.status = 'issued'`)
  else if (f.status === 'overdue') conds.push(`i.status = 'issued' AND i.due_date < CURRENT_DATE`)
  else if (f.status) add('i.status = ?', f.status)
  if (f.client_id) add('i.client_id = ?', f.client_id)
  if (f.case_id) add('i.case_id = ?', f.case_id)
  if (f.q) { params.push(`%${f.q}%`); conds.push(`(i.number ILIKE $${params.length} OR cl.name ILIKE $${params.length})`) }
  const where = conds.join(' AND ')
  const { db } = c.get('deps')
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM invoices i JOIN clients cl ON cl.id = i.client_id WHERE ${where}`, params)
  const items = await db.query(
    `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.currency, i.total, i.amount_paid, i.created_at,
            (i.status = 'issued' AND i.due_date < CURRENT_DATE) AS overdue,
            i.client_id, cl.name AS client_name, i.case_id, k.reference AS case_reference
       FROM invoices i JOIN clients cl ON cl.id = i.client_id LEFT JOIN cases k ON k.id = i.case_id
      WHERE ${where} ORDER BY i.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, (f.page - 1) * f.pageSize])
  return c.json(paged(items, n, f.page, f.pageSize))
})

async function loadInvoice(q: Queryable, orgId: string, id: string) {
  const [invoice] = await q.query(
    `SELECT i.*, cl.name AS client_name, cl.name_ar AS client_name_ar, cl.email AS client_email, cl.address AS client_address, cl.id_number AS client_id_number, cl.vat_number AS client_vat_number,
            k.reference AS case_reference, k.title AS case_title, (i.status = 'issued' AND i.due_date < CURRENT_DATE) AS overdue
       FROM invoices i JOIN clients cl ON cl.id = i.client_id LEFT JOIN cases k ON k.id = i.case_id
      WHERE i.id = $1 AND i.org_id = $2`, [id, orgId])
  if (!invoice) throw notFound('Invoice')
  const lines = await q.query('SELECT id, kind, description, quantity, unit_price, amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY position', [id])
  return { invoice, lines }
}

async function zatcaFor(q: Queryable, orgId: string, invoice: Record<string, any>) {
  const [o] = await q.query('SELECT name, vat_number, default_jurisdiction FROM organizations WHERE id = $1', [orgId])
  return invoiceZatcaQr(invoice, { name: o.name, vat_number: o.vat_number, jurisdiction: o.default_jurisdiction })
}

async function invoiceJson(q: Queryable, orgId: string, id: string) {
  const data = await loadInvoice(q, orgId, id)
  const qr = await zatcaFor(q, orgId, data.invoice)
  return { ...data, zatca: qr ? { qr: qr.dataUrl, tlv: qr.tlv, simplified: qr.simplified } : null }
}

billingRoutes.get('/invoices/:id', async (c) => {
  const { org } = auth(c)
  return c.json(await invoiceJson(c.get('deps').db, org.id, uuidParam(c.req.param('id'), 'Invoice')))
})

billingRoutes.post('/invoices', jsonBody(z.object({
  client_id: z.string().uuid(),
  case_id: optUuid,
  time_entry_ids: z.array(z.string().uuid()).max(2000).default([]),
  expense_ids: z.array(z.string().uuid()).max(2000).default([]),
  fixed_lines: z.array(z.object({ description: z.string().trim().min(1).max(1000), quantity: z.number().min(0).max(1e6).default(1), unit_price: money })).max(100).default([]),
  currency: z.enum(CURRENCIES).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  notes: optText(2000)
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  if (!b.time_entry_ids.length && !b.expense_ids.length && !b.fixed_lines.length) throw badRequest('Add at least one time entry, expense or fixed-fee line.')
  const { db } = c.get('deps')
  const client = await db.one('SELECT id FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])
  if (!client) throw badRequest('Selected client does not exist.')
  if (b.case_id) {
    const k = await assertCase(db, org.id, b.case_id)
    if (k.client_id !== b.client_id) throw badRequest('The case does not belong to this client.')
  }
  const billing = await orgBilling(db, org.id)
  const currency = b.currency ?? org.default_currency
  const vatRate = b.vat_rate ?? billing.effective_vat_rate

  const invoiceId = await db.tx(async (q) => {
    const inv = await q.one(
      `INSERT INTO invoices (org_id, client_id, case_id, currency, vat_rate, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [org.id, b.client_id, b.case_id, currency, vatRate, b.notes, user.id])
    const id = inv!.id as string
    let pos = 0
    // Claim entries atomically: only unbilled entries for this client are attached.
    const time = b.time_entry_ids.length ? await q.query(
      `UPDATE time_entries t SET invoice_id = $1 FROM cases k
        WHERE t.id = ANY($2) AND t.org_id = $3 AND t.invoice_id IS NULL AND t.billable AND k.id = t.case_id AND k.client_id = $4
        RETURNING t.id, t.work_date, t.minutes, t.description, t.rate`, [id, b.time_entry_ids, org.id, b.client_id]) : []
    if (time.length !== b.time_entry_ids.length) throw conflict('Some time entries are no longer available to invoice. Refresh and try again.')
    for (const t of time.sort((a, z2) => String(a.work_date).localeCompare(String(z2.work_date)))) {
      const hours = Math.round((t.minutes / 60) * 1000) / 1000
      await q.query(
        `INSERT INTO invoice_lines (org_id, invoice_id, kind, description, quantity, unit_price, amount, position) VALUES ($1, $2, 'time', $3, $4, $5, $6, $7)`,
        [org.id, id, `${new Date(t.work_date).toISOString().slice(0, 10)} – ${t.description}`, hours, t.rate, timeAmount(t.minutes, Number(t.rate), currency), pos++])
    }
    const exps = b.expense_ids.length ? await q.query(
      `UPDATE expenses e SET invoice_id = $1 FROM cases k
        WHERE e.id = ANY($2) AND e.org_id = $3 AND e.invoice_id IS NULL AND e.billable AND k.id = e.case_id AND k.client_id = $4
        RETURNING e.id, e.incurred_on, e.description, e.amount`, [id, b.expense_ids, org.id, b.client_id]) : []
    if (exps.length !== b.expense_ids.length) throw conflict('Some expenses are no longer available to invoice. Refresh and try again.')
    for (const e of exps) {
      await q.query(
        `INSERT INTO invoice_lines (org_id, invoice_id, kind, description, quantity, unit_price, amount, position) VALUES ($1, $2, 'expense', $3, 1, $4, $4, $5)`,
        [org.id, id, `${new Date(e.incurred_on).toISOString().slice(0, 10)} – ${e.description}`, roundMoney(Number(e.amount), currency), pos++])
    }
    for (const l of b.fixed_lines) {
      await q.query(
        `INSERT INTO invoice_lines (org_id, invoice_id, kind, description, quantity, unit_price, amount, position) VALUES ($1, $2, 'fixed', $3, $4, $5, $6, $7)`,
        [org.id, id, l.description, l.quantity, l.unit_price, roundMoney(l.quantity * l.unit_price, currency), pos++])
    }
    await recalcInvoice(q, id)
    return id
  })
  await audit(c, 'billing.invoice_created', 'invoice', invoiceId)
  return c.json(await loadInvoice(db, org.id, invoiceId), 201)
})

billingRoutes.patch('/invoices/:id', jsonBody(z.object({
  notes: optText(2000),
  vat_rate: z.number().min(0).max(100),
  due_date: isoDate
}).partial()), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  await db.tx(async (q) => {
    const [inv] = await q.query('SELECT status FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!inv) throw notFound('Invoice')
    if (inv.status !== 'draft' && (b.vat_rate !== undefined)) throw conflict('VAT can only be changed on a draft invoice.')
    if (inv.status === 'void' || inv.status === 'paid') throw conflict('This invoice can no longer be edited.')
    await q.query(
      `UPDATE invoices SET notes = COALESCE($3, notes), vat_rate = COALESCE($4, vat_rate), due_date = COALESCE($5::date, due_date), updated_at = now()
        WHERE id = $1 AND org_id = $2`, [id, org.id, b.notes ?? null, b.vat_rate ?? null, b.due_date ?? null])
    await recalcInvoice(q, id)
  })
  await audit(c, 'billing.invoice_updated', 'invoice', id)
  return c.json(await loadInvoice(db, org.id, id))
})

billingRoutes.post('/invoices/:id/issue', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const { db } = c.get('deps')
  await db.tx(async (q) => {
    const [inv] = await q.query('SELECT status, total FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!inv) throw notFound('Invoice')
    if (inv.status !== 'draft') throw conflict('Only draft invoices can be issued.')
    const [o] = await q.query('UPDATE organizations SET invoice_seq = invoice_seq + 1 WHERE id = $1 RETURNING invoice_seq, payment_terms_days', [org.id])
    const number = `INV-${new Date().getFullYear()}-${String(o.invoice_seq).padStart(4, '0')}`
    await q.query(
      `UPDATE invoices SET status = 'issued', number = $3, issue_date = CURRENT_DATE, issued_at = now(),
              due_date = COALESCE(due_date, CURRENT_DATE + $4::int), updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, number, o.payment_terms_days])
  })
  await audit(c, 'billing.invoice_issued', 'invoice', id)
  return c.json(await invoiceJson(db, org.id, id))
})

billingRoutes.post('/invoices/:id/payments', jsonBody(z.object({ amount: z.number().positive().max(1e12) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const { amount } = c.req.valid('json')
  const { db } = c.get('deps')
  await db.tx(async (q) => {
    const [inv] = await q.query('SELECT status, total, amount_paid, currency FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!inv) throw notFound('Invoice')
    if (inv.status !== 'issued') throw conflict('Payments can only be recorded against issued invoices.')
    const paid = roundMoney(Number(inv.amount_paid) + amount, inv.currency)
    if (paid > Number(inv.total) + 1e-9) throw badRequest('The payment is more than the amount outstanding.')
    const fullyPaid = paid >= Number(inv.total) - 1e-9
    await q.query(
      `UPDATE invoices SET amount_paid = $3, status = $4, paid_at = CASE WHEN $4 = 'paid' THEN now() ELSE paid_at END, updated_at = now()
        WHERE id = $1 AND org_id = $2`, [id, org.id, paid, fullyPaid ? 'paid' : 'issued'])
  })
  await audit(c, 'billing.payment_recorded', 'invoice', id, { amount })
  return c.json(await loadInvoice(db, org.id, id))
})

billingRoutes.post('/invoices/:id/void', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const { db } = c.get('deps')
  await db.tx(async (q) => {
    const [inv] = await q.query('SELECT status, amount_paid FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!inv) throw notFound('Invoice')
    if (inv.status === 'void') return
    if (Number(inv.amount_paid) > 0) throw conflict('An invoice with recorded payments cannot be voided.')
    await q.query(`UPDATE invoices SET status = 'void', updated_at = now() WHERE id = $1`, [id])
    // Released entries can be billed again on a new invoice.
    await q.query('UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = $1', [id])
    await q.query('UPDATE expenses SET invoice_id = NULL WHERE invoice_id = $1', [id])
  })
  await audit(c, 'billing.invoice_voided', 'invoice', id)
  return c.json(await loadInvoice(db, org.id, id))
})

billingRoutes.delete('/invoices/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  const { db } = c.get('deps')
  await db.tx(async (q) => {
    const [inv] = await q.query('SELECT status FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE', [id, org.id])
    if (!inv) throw notFound('Invoice')
    if (inv.status !== 'draft') throw conflict('Only draft invoices can be deleted. Void issued invoices instead.')
    await q.query('UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = $1', [id])
    await q.query('UPDATE expenses SET invoice_id = NULL WHERE invoice_id = $1', [id])
    await q.query('DELETE FROM invoices WHERE id = $1', [id])
  })
  await audit(c, 'billing.invoice_deleted', 'invoice', id)
  return c.json({ ok: true })
})

export async function invoiceDocxResponse(db: Queryable, orgId: string, id: string, language: 'en' | 'ar') {
  const { invoice, lines } = await loadInvoice(db, orgId, id)
  const [lh] = await db.query('SELECT * FROM branding WHERE org_id = $1', [orgId])
  const billing = await orgBilling(db, orgId)
  const qr = await zatcaFor(db, orgId, invoice)
  const buf = await renderInvoiceDocx({ invoice, lines, letterhead: lh ?? null, billing, language, zatca: qr ? { png: qr.png, simplified: qr.simplified } : null })
  const name = safeFileName(invoice.number ?? `draft-invoice-${String(invoice.id).slice(0, 8)}`, 'docx')
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(name), 'cache-control': 'private, no-store' }
  })
}

billingRoutes.get('/invoices/:id/export', queryParams(z.object({ lang: z.enum(['en', 'ar']).default('en') })), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Invoice')
  await audit(c, 'billing.invoice_exported', 'invoice', id)
  return invoiceDocxResponse(c.get('deps').db, org.id, id, c.req.valid('query').lang)
})

export { computeTotals }
export default billingRoutes
