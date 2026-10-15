import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { outstanding, renderDemandDocx, RETURN_REASONS, status, UNACTIONED_DAYS } from '../services/cheques'
import { GULF_TODAY } from '../services/credentials'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { caseActivity } from './cases'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
const editors = ['owner', 'admin', 'lawyer', 'staff'] as const

const fields = {
  drawer: z.string().trim().min(2).max(300),
  drawer_id_number: optText(100),
  bank: z.string().trim().min(2).max(200),
  cheque_no: z.string().trim().min(1).max(50),
  account_no: optText(60),
  amount: z.coerce.number().positive().max(1e13),
  currency: z.enum(CURRENCIES).nullish(),
  cheque_date: day,
  presented_on: optDay,
  returned_on: optDay,
  return_reason: z.enum(RETURN_REASONS).nullish().or(z.literal('')).transform((v) => v || null),
  complaint_on: optDay,
  complaint_ref: optText(100),
  written_off: z.boolean().default(false),
  original_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(2000)
}
type Fields = z.infer<z.ZodObject<typeof fields>>

const COLS = `q.id, q.case_id, q.drawer, q.drawer_id_number, q.bank, q.cheque_no, q.account_no, q.amount::float8 AS amount, q.currency,
  to_char(q.cheque_date, 'YYYY-MM-DD') AS cheque_date, to_char(q.presented_on, 'YYYY-MM-DD') AS presented_on, to_char(q.returned_on, 'YYYY-MM-DD') AS returned_on,
  q.return_reason, to_char(q.complaint_on, 'YYYY-MM-DD') AS complaint_on, q.complaint_ref, q.recovered::float8 AS recovered,
  to_char(q.last_recovered_on, 'YYYY-MM-DD') AS last_recovered_on, q.written_off, q.original_id, q.notes, q.created_at, q.updated_at,
  (${GULF_TODAY} - q.returned_on)::int AS days_since_return`
// Returned a week ago or more with nothing done: no complaint, nothing recovered, not written off.
const UNACTIONED = `q.returned_on IS NOT NULL AND q.returned_on <= ${GULF_TODAY} - ${UNACTIONED_DAYS} AND q.complaint_on IS NULL AND q.recovered = 0 AND NOT q.written_off`

const present = (r: any) => ({ ...r, status: status(r), outstanding: outstanding(r) })

function validate(r: Fields) {
  if (r.returned_on && r.presented_on && r.returned_on < r.presented_on) throw badRequest('The cheque was returned before it was presented.')
  if (r.returned_on && !r.presented_on) r.presented_on = r.returned_on
  if (r.complaint_on && !r.returned_on) throw badRequest('Record when the bank returned the cheque before the complaint.')
  if (r.complaint_on && r.returned_on && r.complaint_on < r.returned_on) throw badRequest('The complaint date is before the cheque was returned.')
  if (r.return_reason && !r.returned_on) throw badRequest('Enter the date the bank returned the cheque.')
}

async function checkOriginal(db: Queryable, orgId: string, caseId: string, id: string | null) {
  if (!id) return
  const ok = await db.query(
    `SELECT 1 FROM client_originals o JOIN cases k ON k.client_id = o.client_id WHERE o.id = $1 AND o.org_id = $2 AND k.id = $3 AND o.kind = 'cheque'`, [id, orgId, caseId])
  if (!ok.length) throw badRequest('Choose an original cheque held for this client.')
}

async function loadCheque(db: Queryable, orgId: string, id: string): Promise<any> {
  const [r] = await db.query(`SELECT ${COLS}, k.reference FROM case_cheques q JOIN cases k ON k.id = q.case_id WHERE q.id = $1 AND q.org_id = $2`, [id, orgId])
  if (!r) throw notFound('Cheque')
  return r
}

const chequeRoutes = new Hono<AppEnv>()

chequeRoutes.get('/case/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  if (!(await db.one('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2', [id, org.id]))) throw notFound('Case')
  const rows = (await db.query(`SELECT ${COLS} FROM case_cheques q WHERE q.case_id = $1 AND q.org_id = $2 ORDER BY q.cheque_date, q.created_at`, [id, org.id])).map(present)
  const totals: Record<string, { amount: number; recovered: number; outstanding: number }> = {}
  for (const r of rows) {
    const t = (totals[r.currency] ??= { amount: 0, recovered: 0, outstanding: 0 })
    t.amount += r.amount; t.recovered += r.recovered; t.outstanding += r.outstanding
  }
  return c.json({ items: rows, totals })
})

chequeRoutes.post('/case/:id', jsonBody(z.object(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [k] = await db.query('SELECT id, currency FROM cases WHERE id = $1 AND org_id = $2', [uuidParam(c.req.param('id'), 'Case'), org.id])
  if (!k) throw notFound('Case')
  validate(b)
  await checkOriginal(db, org.id, k.id, b.original_id)
  const [row] = await db.query(
    `INSERT INTO case_cheques (org_id, case_id, drawer, drawer_id_number, bank, cheque_no, account_no, amount, currency, cheque_date, presented_on, returned_on,
       return_reason, complaint_on, complaint_ref, written_off, original_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
    [org.id, k.id, b.drawer, b.drawer_id_number, b.bank, b.cheque_no, b.account_no, b.amount, b.currency ?? k.currency, b.cheque_date, b.presented_on, b.returned_on,
      b.return_reason, b.complaint_on, b.complaint_ref, b.written_off, b.original_id, b.notes, user.id])
  await caseActivity(db, org.id, k.id, user.id, 'cheque', `Cheque no. ${b.cheque_no} (${b.bank}) for ${b.amount} ${b.currency ?? k.currency} recorded${b.returned_on ? `, returned on ${b.returned_on}` : ''}`)
  await audit(c, 'cheque.created', 'case', k.id, { cheque: row.id })
  return c.json({ cheque: present(await loadCheque(db, org.id, row.id)) }, 201)
})

chequeRoutes.patch('/:id', jsonBody(updateBody(fields)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Cheque')
  const b = c.req.valid('json') as Partial<Fields>
  const { db } = c.get('deps')
  const cur = await loadCheque(db, org.id, id)
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  if (!r.currency) r.currency = cur.currency
  validate(r)
  if (r.amount < cur.recovered) throw badRequest('The amount is less than what has already been recovered.')
  await checkOriginal(db, org.id, cur.case_id, b.original_id !== undefined ? r.original_id : null)
  await db.query(
    `UPDATE case_cheques SET drawer = $3, drawer_id_number = $4, bank = $5, cheque_no = $6, account_no = $7, amount = $8, currency = $9, cheque_date = $10,
       presented_on = $11, returned_on = $12, return_reason = $13, complaint_on = $14, complaint_ref = $15, written_off = $16, original_id = $17, notes = $18, updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [id, org.id, r.drawer, r.drawer_id_number, r.bank, r.cheque_no, r.account_no, r.amount, r.currency, r.cheque_date, r.presented_on, r.returned_on,
      r.return_reason, r.complaint_on, r.complaint_ref, r.written_off, r.original_id, r.notes])
  const before = status(cur), after = status(r)
  if (before !== after) await caseActivity(db, org.id, cur.case_id, user.id, 'cheque', `Cheque no. ${r.cheque_no}: ${before.replace('_', ' ')} → ${after.replace('_', ' ')}`)
  await audit(c, 'cheque.updated', 'case', cur.case_id, { cheque: id })
  return c.json({ cheque: present(await loadCheque(db, org.id, id)) })
})

// Records money recovered against a cheque (never more than is owed).
chequeRoutes.post('/:id/recovered', jsonBody(z.object({ amount: z.coerce.number().positive().max(1e13), on: day })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Cheque')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadCheque(db, org.id, id)
  const left = Math.round((cur.amount - cur.recovered) * 1000) / 1000
  if (b.amount > left + 0.0005) throw badRequest(`Only ${left} ${cur.currency} is still owed on this cheque.`)
  if (b.on > (await db.one(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`))!.d) throw badRequest('The payment date is in the future.')
  await db.query(`UPDATE case_cheques SET recovered = recovered + $3, last_recovered_on = GREATEST(COALESCE(last_recovered_on, $4::date), $4::date), updated_at = now() WHERE id = $1 AND org_id = $2`,
    [id, org.id, b.amount, b.on])
  const after = await loadCheque(db, org.id, id)
  await caseActivity(db, org.id, cur.case_id, user.id, 'cheque', `Recovered ${b.amount} ${cur.currency} on cheque no. ${cur.cheque_no}${outstanding(after) === 0 ? ' (paid in full)' : `, ${outstanding(after)} ${cur.currency} still owed`}`)
  await audit(c, 'cheque.recovered', 'case', cur.case_id, { cheque: id, amount: b.amount })
  return c.json({ cheque: present(after) })
})

chequeRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Cheque')
  const { db } = c.get('deps')
  const cur = await loadCheque(db, org.id, id)
  await db.query('DELETE FROM case_cheques WHERE id = $1 AND org_id = $2', [id, org.id])
  await audit(c, 'cheque.deleted', 'case', cur.case_id, { cheque: id, cheque_no: cur.cheque_no })
  return c.json({ ok: true })
})

// Bilingual demand letter to one drawer for the unpaid returned cheques on a matter.
chequeRoutes.get('/case/:id/demand', queryParams(z.object({
  drawer: z.string().trim().min(2).max(300),
  days: z.coerce.number().int().min(1).max(90).default(7),
  letterhead: z.enum(['true', 'false']).default('true')
})), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const [k] = await db.query(
    `SELECT k.id, k.reference, cl.name AS client_name, cl.name_ar AS client_name_ar FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.id = $1 AND k.org_id = $2`,
    [uuidParam(c.req.param('id'), 'Case'), org.id])
  if (!k) throw notFound('Case')
  const rows = (await db.query(`SELECT ${COLS} FROM case_cheques q WHERE q.case_id = $1 AND q.org_id = $2 AND q.drawer = $3 AND q.returned_on IS NOT NULL ORDER BY q.cheque_date`,
    [k.id, org.id, q.drawer])).map(present).filter((r: any) => r.outstanding > 0)
  if (!rows.length) throw badRequest('This drawer has no unpaid returned cheques on this matter.')
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const [{ d }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`)
  const buf = await renderDemandDocx({
    firmName: lh?.firm_name || org.name, firmNameAr: lh?.firm_name_ar ?? null, letterhead: q.letterhead === 'true' ? lh : null, date: d, days: q.days,
    drawer: q.drawer, client: k.client_name ?? '', clientAr: k.client_name_ar, reference: k.reference, cheques: rows
  })
  await audit(c, 'cheque.demand_printed', 'case', k.id, { drawer: q.drawer, cheques: rows.length })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`cheque-demand-${k.reference}.docx`), 'cache-control': 'private, no-store' }
  })
})

// Firm-wide register: what is still owed, by currency, and cheques nobody has acted on.
chequeRoutes.get('/register', queryParams(z.object({
  show: z.enum(['open', 'unactioned', 'all']).default('open'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const filter = q.show === 'unactioned' ? UNACTIONED : q.show === 'open' ? 'q.recovered < q.amount AND NOT q.written_off' : 'true'
  const rows = (await db.query(
    `SELECT ${COLS}, (${UNACTIONED}) AS unactioned, k.reference, k.title AS case_title, cl.name AS client_name, u.name AS lawyer_name
       FROM case_cheques q JOIN cases k ON k.id = q.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE q.org_id = $1 AND ${filter} ORDER BY q.returned_on NULLS LAST, q.cheque_date LIMIT 5000`, [org.id])).map(present)
  if (q.format === 'csv') {
    await audit(c, 'cheque.register_exported', 'organization', org.id, { rows: rows.length })
    return new Response(toCsv([
      ['Reference', 'Matter', 'Client', 'Drawer', 'Bank', 'Cheque no.', 'Cheque date', 'Amount', 'Currency', 'Returned', 'Reason', 'Complaint', 'Complaint ref.', 'Recovered', 'Outstanding', 'Status', 'Lawyer'],
      ...rows.map((r: any) => [r.reference, r.case_title, r.client_name ?? '', r.drawer, r.bank, r.cheque_no, r.cheque_date, r.amount, r.currency, r.returned_on ?? '', r.return_reason ?? '',
        r.complaint_on ?? '', r.complaint_ref ?? '', r.recovered, r.outstanding, r.status, r.lawyer_name ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="returned-cheques.csv"', 'cache-control': 'private, no-store' } })
  }
  const all = (await db.query(`SELECT q.amount::float8 AS amount, q.recovered::float8 AS recovered, q.written_off, q.currency, (${UNACTIONED}) AS unactioned FROM case_cheques q WHERE q.org_id = $1`, [org.id]))
  const owed: Record<string, number> = {}
  for (const r of all as any[]) { const n = outstanding(r); if (n > 0) owed[r.currency] = Math.round(((owed[r.currency] ?? 0) + n) * 1000) / 1000 }
  return c.json({ items: rows, counts: { open: all.filter((r: any) => outstanding(r) > 0).length, unactioned: all.filter((r: any) => r.unactioned).length }, outstanding: owed })
})

// Returned cheques with no complaint, payment or write-off after a week (for the dashboard).
export async function chequesUnactioned(db: Queryable, orgId: string) {
  const [r] = await db.query(`SELECT count(*)::int AS n FROM case_cheques q WHERE q.org_id = $1 AND ${UNACTIONED}`, [orgId])
  return r.n as number
}

export default chequeRoutes
