import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { addDays, FREQUENCIES, noticeBy, NOTICE_SOON_DAYS, renderNoticeDocx, rentSchedule, STATUSES, syncLeaseEvents, USES } from '../services/leases'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { caseActivity } from './cases'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Empty form fields mean "not set", never zero.
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())
const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

const fields = {
  client_role: z.enum(['landlord', 'tenant']).default('landlord'),
  case_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  property: z.string().trim().min(3).max(500),
  use: z.enum(USES).default('residential'),
  counterparty: z.string().trim().min(2).max(300),
  counterparty_id_number: optText(100),
  registration_no: optText(100),
  starts_on: day,
  ends_on: day,
  annual_rent: z.coerce.number().positive().max(1e13),
  currency: z.enum(CURRENCIES).nullish(),
  frequency: z.enum(FREQUENCIES).default('monthly'),
  deposit: optNumber(z.coerce.number().min(0).max(1e13)),
  notice_days: z.coerce.number().int().min(0).max(730).default(90),
  status: z.enum(STATUSES).default('active'),
  notes: optText(3000)
}
type Fields = z.infer<z.ZodObject<typeof fields>>
// Changing any of these rebuilds the rent schedule.
const TERMS = ['starts_on', 'ends_on', 'annual_rent', 'frequency'] as const

const COLS = `l.id, l.client_id, l.case_id, l.client_role, l.property, l.use, l.counterparty, l.counterparty_id_number, l.registration_no,
  to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on, l.annual_rent::float8 AS annual_rent, l.currency, l.frequency,
  l.deposit::float8 AS deposit, l.notice_days, l.status, l.end_event_id, l.notice_event_id, l.notes, l.created_at, l.updated_at,
  (l.ends_on - ${GULF_TODAY})::int AS days_to_end, ((l.ends_on - l.notice_days) - ${GULF_TODAY})::int AS days_to_notice,
  COALESCE((SELECT sum(p.amount - p.paid) FROM lease_payments p WHERE p.lease_id = l.id AND p.due_on <= ${GULF_TODAY}), 0)::float8 AS arrears,
  COALESCE((SELECT sum(p.paid) FROM lease_payments p WHERE p.lease_id = l.id), 0)::float8 AS collected`

const present = (r: any) => ({ ...r, notice_by: noticeBy(r.ends_on, r.notice_days), arrears: Math.round(r.arrears * 1000) / 1000 })

function validate(r: Fields) {
  if (r.ends_on <= r.starts_on) throw badRequest('The lease must end after it starts.')
}

async function loadLease(db: Queryable, orgId: string, id: string): Promise<any> {
  const [r] = await db.query(`SELECT ${COLS}, cl.name AS client_name, cl.name_ar AS client_name_ar FROM leases l JOIN clients cl ON cl.id = l.client_id WHERE l.id = $1 AND l.org_id = $2`, [id, orgId])
  if (!r) throw notFound('Lease')
  return present(r)
}

async function checkCase(db: Queryable, orgId: string, clientId: string, caseId: string | null) {
  if (caseId && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [caseId, orgId, clientId])).length) throw badRequest('Choose a matter of this client.')
}

async function writeSchedule(q: Queryable, orgId: string, leaseId: string, r: Pick<Fields, 'starts_on' | 'ends_on' | 'annual_rent' | 'frequency'>) {
  await q.query('DELETE FROM lease_payments WHERE lease_id = $1', [leaseId])
  for (const s of rentSchedule(r.starts_on, r.ends_on, r.annual_rent, r.frequency)) {
    await q.query('INSERT INTO lease_payments (lease_id, org_id, due_on, amount) VALUES ($1, $2, $3, $4)', [leaseId, orgId, s.due_on, s.amount])
  }
}

async function insertLease(q: Queryable, orgId: string, userId: string, clientId: string, clientName: string, r: Fields & { currency: string }) {
  const [row] = await q.query(
    `INSERT INTO leases (org_id, client_id, case_id, client_role, property, use, counterparty, counterparty_id_number, registration_no, starts_on, ends_on,
       annual_rent, currency, frequency, deposit, notice_days, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
    [orgId, clientId, r.case_id, r.client_role, r.property, r.use, r.counterparty, r.counterparty_id_number, r.registration_no, r.starts_on, r.ends_on,
      r.annual_rent, r.currency, r.frequency, r.deposit, r.notice_days, r.status, r.notes, userId])
  await writeSchedule(q, orgId, row.id, r)
  const ev = await syncLeaseEvents(q, { orgId, userId, clientName, lease: { ...r, id: row.id, client_id: clientId, end_event_id: null, notice_event_id: null } as any })
  await q.query('UPDATE leases SET end_event_id = $2, notice_event_id = $3 WHERE id = $1', [row.id, ev.end_event_id, ev.notice_event_id])
  return row.id as string
}

const leaseRoutes = new Hono<AppEnv>()

leaseRoutes.get('/client/:id', async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  if (!(await db.one('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [id, org.id]))) throw notFound('Client')
  const rows = (await db.query(`SELECT ${COLS} FROM leases l WHERE l.client_id = $1 AND l.org_id = $2 ORDER BY (l.status <> 'active'), l.ends_on`, [id, org.id])).map(present)
  const payments = rows.length ? await db.query(
    `SELECT id, lease_id, to_char(due_on, 'YYYY-MM-DD') AS due_on, amount::float8 AS amount, paid::float8 AS paid, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, method, reference,
            (due_on - ${GULF_TODAY})::int AS days FROM lease_payments WHERE lease_id = ANY($1::uuid[]) ORDER BY due_on`, [rows.map((r: any) => r.id)]) : []
  return c.json({ items: rows.map((r: any) => ({ ...r, payments: payments.filter((p: any) => p.lease_id === r.id) })) })
})

leaseRoutes.post('/client/:id', jsonBody(z.object(fields)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [cl] = await db.query('SELECT id, name FROM clients WHERE id = $1 AND org_id = $2', [uuidParam(c.req.param('id'), 'Client'), org.id])
  if (!cl) throw notFound('Client')
  validate(b)
  await checkCase(db, org.id, cl.id, b.case_id)
  const id = await db.tx((q) => insertLease(q, org.id, user.id, cl.id, cl.name, { ...b, currency: (b.currency ?? org.default_currency ?? 'OMR') as any }))
  if (b.case_id) await caseActivity(db, org.id, b.case_id, user.id, 'lease', `Lease recorded: ${b.property} with ${b.counterparty}, ${b.starts_on} to ${b.ends_on}`)
  await audit(c, 'lease.created', 'client', cl.id, { lease: id })
  return c.json({ lease: await loadLease(db, org.id, id) }, 201)
})

leaseRoutes.patch('/:id', jsonBody(updateBody(fields)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lease')
  const b = c.req.valid('json') as Partial<Fields>
  const { db } = c.get('deps')
  const cur = await loadLease(db, org.id, id)
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  if (!r.currency) r.currency = cur.currency
  validate(r)
  await checkCase(db, org.id, cur.client_id, r.case_id)
  const termsChanged = TERMS.some((k) => b[k] !== undefined && b[k] !== cur[k])
  if (termsChanged && cur.collected > 0) throw conflict('Rent has been recorded against this lease. Renew it to change the term or rent.')
  await db.tx(async (q) => {
    await q.query(
      `UPDATE leases SET case_id = $3, client_role = $4, property = $5, use = $6, counterparty = $7, counterparty_id_number = $8, registration_no = $9, starts_on = $10,
         ends_on = $11, annual_rent = $12, currency = $13, frequency = $14, deposit = $15, notice_days = $16, status = $17, notes = $18, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, r.case_id, r.client_role, r.property, r.use, r.counterparty, r.counterparty_id_number, r.registration_no, r.starts_on, r.ends_on,
        r.annual_rent, r.currency, r.frequency, r.deposit, r.notice_days, r.status, r.notes])
    if (termsChanged) await writeSchedule(q, org.id, id, r)
    const ev = await syncLeaseEvents(q, { orgId: org.id, userId: user.id, clientName: cur.client_name, lease: r })
    await q.query('UPDATE leases SET end_event_id = $2, notice_event_id = $3 WHERE id = $1', [id, ev.end_event_id, ev.notice_event_id])
  })
  await audit(c, 'lease.updated', 'client', cur.client_id, { lease: id })
  return c.json({ lease: await loadLease(db, org.id, id) })
})

// Renews a lease: the old one is marked renewed and a new one starts the next day.
leaseRoutes.post('/:id/renew', jsonBody(z.object({
  ends_on: day,
  annual_rent: optNumber(z.coerce.number().positive().max(1e13)),
  frequency: z.enum(FREQUENCIES).optional(),
  registration_no: optText(100)
})), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lease')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadLease(db, org.id, id)
  if (cur.status !== 'active') throw conflict('Only an active lease can be renewed.')
  const starts = addDays(cur.ends_on, 1)
  if (b.ends_on <= starts) throw badRequest('The renewed lease must end after it starts.')
  const newId = await db.tx(async (q) => {
    await q.query(`UPDATE leases SET status = 'renewed', updated_at = now() WHERE id = $1`, [id])
    await syncLeaseEvents(q, { orgId: org.id, userId: user.id, clientName: cur.client_name, lease: { ...cur, status: 'renewed' } })
    return insertLease(q, org.id, user.id, cur.client_id, cur.client_name, {
      ...cur, starts_on: starts, ends_on: b.ends_on, annual_rent: b.annual_rent ?? cur.annual_rent, frequency: b.frequency ?? cur.frequency,
      registration_no: b.registration_no ?? cur.registration_no, status: 'active'
    })
  })
  if (cur.case_id) await caseActivity(db, org.id, cur.case_id, user.id, 'lease', `Lease of ${cur.property} renewed to ${b.ends_on}${b.annual_rent ? ` at ${b.annual_rent} ${cur.currency} a year` : ''}`)
  await audit(c, 'lease.renewed', 'client', cur.client_id, { lease: id, renewal: newId })
  return c.json({ lease: await loadLease(db, org.id, newId) }, 201)
})

// Records rent received against an instalment.
leaseRoutes.post('/payments/:id', jsonBody(z.object({ amount: z.coerce.number().positive().max(1e13), paid_on: day, method: optText(40), reference: optText(100) })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Payment')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [p] = await db.query('SELECT p.id, p.lease_id, p.amount::float8 AS amount, p.paid::float8 AS paid, l.client_id FROM lease_payments p JOIN leases l ON l.id = p.lease_id WHERE p.id = $1 AND p.org_id = $2', [id, org.id])
  if (!p) throw notFound('Payment')
  const left = Math.round((p.amount - p.paid) * 1000) / 1000
  if (b.amount > left + 0.0005) throw badRequest(`Only ${left} is still due on this instalment.`)
  if (b.paid_on > (await db.one(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`))!.d) throw badRequest('The payment date is in the future.')
  await db.query('UPDATE lease_payments SET paid = paid + $2, paid_on = $3, method = COALESCE($4, method), reference = COALESCE($5, reference) WHERE id = $1', [id, b.amount, b.paid_on, b.method, b.reference])
  await audit(c, 'lease.rent_recorded', 'client', p.client_id, { lease: p.lease_id, amount: b.amount })
  return c.json({ lease: await loadLease(db, org.id, p.lease_id) })
})

leaseRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lease')
  const { db } = c.get('deps')
  const cur = await loadLease(db, org.id, id)
  await db.tx(async (q) => {
    const ids = [cur.end_event_id, cur.notice_event_id].filter(Boolean)
    if (ids.length) await q.query('DELETE FROM events WHERE id = ANY($1::uuid[]) AND org_id = $2 AND completed_at IS NULL', [ids, org.id])
    await q.query('DELETE FROM leases WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'lease.deleted', 'client', cur.client_id, { lease: id })
  return c.json({ ok: true })
})

// Bilingual notice of non-renewal or renewal terms to the other party.
leaseRoutes.get('/:id/notice', queryParams(z.object({
  kind: z.enum(['non_renewal', 'renewal_terms']),
  new_rent: z.coerce.number().positive().max(1e13).optional(),
  terms: z.string().trim().max(1000).optional(),
  letterhead: z.enum(['true', 'false']).default('true')
})), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const l = await loadLease(db, org.id, uuidParam(c.req.param('id'), 'Lease'))
  if (q.kind === 'renewal_terms' && !q.new_rent && !q.terms) throw badRequest('Give the new rent or the renewal terms.')
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const [{ d }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`)
  const buf = await renderNoticeDocx({
    firmName: lh?.firm_name || org.name, firmNameAr: lh?.firm_name_ar ?? null, letterhead: q.letterhead === 'true' ? lh : null, date: d, kind: q.kind,
    clientRole: l.client_role, client: l.client_name, clientAr: l.client_name_ar, counterparty: l.counterparty, property: l.property, endsOn: l.ends_on,
    registrationNo: l.registration_no, newRent: q.new_rent ?? null, currency: l.currency, terms: q.terms ?? null
  })
  if (l.case_id) await caseActivity(db, org.id, l.case_id, user.id, 'lease', `Lease notice prepared (${q.kind.replace('_', ' ')}) for ${l.property}`)
  await audit(c, 'lease.notice_printed', 'client', l.client_id, { lease: l.id, kind: q.kind })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`lease-notice-${l.property}.docx`), 'cache-control': 'private, no-store' }
  })
})

// Firm-wide register: notices due, leases expiring and rent in arrears.
leaseRoutes.get('/register', queryParams(z.object({
  show: z.enum(['attention', 'active', 'all']).default('attention'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = (await db.query(
    `SELECT ${COLS}, cl.name AS client_name FROM leases l JOIN clients cl ON cl.id = l.client_id
      WHERE l.org_id = $1 AND ($2 = 'all' OR l.status = 'active') ORDER BY l.ends_on LIMIT 5000`, [org.id, q.show])).map(present)
  const attention = (r: any) => r.status === 'active' && (r.arrears > 0 || (r.days_to_notice <= NOTICE_SOON_DAYS && r.days_to_end >= 0) || r.days_to_end < 0)
  const items = q.show === 'attention' ? rows.filter(attention) : rows
  if (q.format === 'csv') {
    await audit(c, 'lease.register_exported', 'organization', org.id, { rows: items.length })
    return new Response(toCsv([
      ['Client', 'Role', 'Property', 'Use', 'Other party', 'Registration', 'Starts', 'Ends', 'Notice by', 'Annual rent', 'Currency', 'Frequency', 'Deposit', 'Arrears', 'Status'],
      ...items.map((r: any) => [r.client_name, r.client_role, r.property, r.use, r.counterparty, r.registration_no ?? '', r.starts_on, r.ends_on, r.notice_by ?? '',
        r.annual_rent, r.currency, r.frequency, r.deposit ?? '', r.arrears, r.status])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leases.csv"', 'cache-control': 'private, no-store' } })
  }
  const active = rows.filter((r: any) => r.status === 'active')
  const arrears: Record<string, number> = {}
  for (const r of active) if (r.arrears > 0) arrears[r.currency] = Math.round(((arrears[r.currency] ?? 0) + r.arrears) * 1000) / 1000
  return c.json({
    items,
    counts: {
      active: active.length,
      notice_soon: active.filter((r: any) => r.days_to_notice <= NOTICE_SOON_DAYS && r.days_to_end >= 0).length,
      in_arrears: active.filter((r: any) => r.arrears > 0).length
    },
    arrears
  })
})

// Active leases whose notice day is within the month, or that have expired without being closed (for the dashboard).
export async function leasesNeedingNotice(db: Queryable, orgId: string) {
  const [r] = await db.query(
    `SELECT count(*)::int AS n FROM leases WHERE org_id = $1 AND status = 'active' AND (ends_on - notice_days) <= ${GULF_TODAY} + ${NOTICE_SOON_DAYS}`, [orgId])
  return r.n as number
}

export default leaseRoutes
