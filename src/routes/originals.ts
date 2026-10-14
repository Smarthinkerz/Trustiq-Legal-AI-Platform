import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, optText, optUuid, queryParams, updateBody, uuidParam } from '../lib/http'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { applyMove, KINDS, MOVES, receiptNo, renderReceiptDocx } from '../services/originals'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())
const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

const itemShape = {
  kind: z.enum(KINDS).default('other'),
  description: z.string().trim().min(2).max(1000),
  reference_no: optText(200),
  amount: optNumber(z.coerce.number().min(0).max(1e13)),
  currency: z.enum(CURRENCIES).nullish(),
  copies: z.coerce.number().int().min(1).max(999).default(1),
  notes: optText(2000)
}

const COLS = `o.id, o.receipt_no, o.client_id, o.case_id, o.kind, o.description, o.reference_no, o.amount::float8 AS amount, o.currency, o.copies,
  to_char(o.received_on, 'YYYY-MM-DD') AS received_on, o.received_from, o.location, o.status, o.lodged_with, to_char(o.returned_on, 'YYYY-MM-DD') AS returned_on,
  o.returned_to, o.notes, o.created_at, o.updated_at, cl.name AS client_name, cl.name_ar AS client_name_ar, k.reference, k.title AS case_title, k.status AS case_status`
const FROM = 'client_originals o JOIN clients cl ON cl.id = o.client_id LEFT JOIN cases k ON k.id = o.case_id'
// Still with the firm (or lodged) although the client has no open matter it could be for.
const TO_RETURN = `o.status <> 'returned' AND (CASE WHEN o.case_id IS NOT NULL THEN k.status = 'closed'
  ELSE NOT EXISTS (SELECT 1 FROM cases x WHERE x.client_id = o.client_id AND x.status <> 'closed') END)`

async function withMovements(db: Queryable, rows: any[]) {
  if (!rows.length) return rows
  const moves = await db.query(
    `SELECT m.id, m.original_id, m.action, to_char(m.on_date, 'YYYY-MM-DD') AS on_date, m.location, m.party, m.note, u.name AS user_name, m.created_at
       FROM original_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.original_id = ANY($1::uuid[]) ORDER BY m.created_at`, [rows.map((r) => r.id)])
  return rows.map((r) => ({ ...r, receipt: receiptNo(r.receipt_no), movements: moves.filter((m: any) => m.original_id === r.id) }))
}

async function loadOriginal(db: Queryable, orgId: string, id: string): Promise<any> {
  const [o] = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE o.id = $1 AND o.org_id = $2`, [id, orgId])
  if (!o) throw notFound('Original')
  return o
}

async function checkCase(db: Queryable, orgId: string, clientId: string, caseId: string | null | undefined) {
  if (caseId && !(await db.query('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [caseId, orgId, clientId])).length) {
    throw badRequest('Choose a matter of this client.')
  }
}

const originalRoutes = new Hono<AppEnv>()

originalRoutes.get('/', queryParams(z.object({ client_id: z.string().uuid().optional(), case_id: z.string().uuid().optional() })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  if (!q.client_id && !q.case_id) throw badRequest('Choose a client or a matter.')
  const { db } = c.get('deps')
  const rows = await db.query(
    `SELECT ${COLS} FROM ${FROM} WHERE o.org_id = $1 AND ($2::uuid IS NULL OR o.client_id = $2) AND ($3::uuid IS NULL OR o.case_id = $3)
      ORDER BY (o.status = 'returned'), o.received_on DESC, o.receipt_no DESC`, [org.id, q.client_id ?? null, q.case_id ?? null])
  return c.json({ items: await withMovements(db, rows) })
})

// Records originals handed over together; each gets its own receipt number.
originalRoutes.post('/', jsonBody(z.object({
  client_id: z.string().uuid(),
  case_id: optUuid,
  received_on: day,
  received_from: optText(300),
  location: optText(300),
  items: z.array(z.object(itemShape)).min(1).max(50)
})), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const client = await db.one('SELECT id FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])
  if (!client) throw notFound('Client')
  await checkCase(db, org.id, b.client_id, b.case_id)
  const [{ currency }] = await db.query(`SELECT COALESCE((SELECT currency FROM cases WHERE id = $2), (SELECT default_currency FROM organizations WHERE id = $1), 'OMR') AS currency`, [org.id, b.case_id ?? null])
  const ids = await db.tx(async (q) => {
    // Receipt numbers run per firm without gaps or duplicates.
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('originals:' || $1::text))`, [org.id])
    const [{ n }] = await q.query('SELECT COALESCE(max(receipt_no), 0)::int AS n FROM client_originals WHERE org_id = $1', [org.id])
    const out: string[] = []
    for (const [i, it] of b.items.entries()) {
      const [row] = await q.query(
        `INSERT INTO client_originals (org_id, receipt_no, client_id, case_id, kind, description, reference_no, amount, currency, copies, received_on, received_from, location, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [org.id, n + i + 1, b.client_id, b.case_id, it.kind, it.description, it.reference_no, it.amount, it.amount != null ? it.currency ?? currency : null,
          it.copies, b.received_on, b.received_from, b.location, it.notes, user.id])
      await q.query(`INSERT INTO original_movements (org_id, original_id, action, on_date, location, party, user_id) VALUES ($1, $2, 'received', $3, $4, $5, $6)`,
        [org.id, row.id, b.received_on, b.location, b.received_from, user.id])
      out.push(row.id as string)
    }
    return out
  })
  await audit(c, 'original.received', 'client', b.client_id, { originals: ids.length })
  const rows = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE o.id = ANY($1::uuid[]) ORDER BY o.receipt_no`, [ids])
  return c.json({ items: await withMovements(db, rows) }, 201)
})

originalRoutes.patch('/:id', jsonBody(updateBody({ ...itemShape, case_id: optUuid, location: optText(300), received_from: optText(300) })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Original')
  const b = c.req.valid('json') as Record<string, any>
  const { db } = c.get('deps')
  const cur = await loadOriginal(db, org.id, id)
  if (b.case_id !== undefined) await checkCase(db, org.id, cur.client_id, b.case_id)
  const m: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) m[k] = v
  m.currency = m.amount == null ? null : m.currency ?? 'OMR'
  await db.query(
    `UPDATE client_originals SET kind = $3, description = $4, reference_no = $5, amount = $6, currency = $7, copies = $8, notes = $9,
            case_id = $10, location = $11, received_from = $12, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [id, org.id, m.kind, m.description, m.reference_no, m.amount, m.currency, m.copies, m.notes, m.case_id, m.location, m.received_from])
  return c.json({ original: (await withMovements(db, [await loadOriginal(db, org.id, id)]))[0] })
})

const moveBody = z.object({
  action: z.enum(MOVES),
  on_date: day,
  location: optText(300),
  party: optText(300),
  note: optText(2000)
})

async function move(q: Queryable, orgId: string, userId: string, cur: any, b: z.infer<typeof moveBody>) {
  let next
  try { next = applyMove(cur, b.action) } catch (err) { throw conflict((err as Error).message) }
  if (b.on_date < cur.received_on) throw badRequest('The date is before the original was received.')
  if ((b.action === 'lodged' || b.action === 'returned') && !b.party) throw badRequest(b.action === 'lodged' ? 'Say where it was lodged.' : 'Say who received it.')
  if (b.action === 'moved' && !b.location) throw badRequest('Say where it is now kept.')
  await q.query(
    `UPDATE client_originals SET status = $3,
            location = CASE WHEN $4 IN ('moved', 'retrieved') AND $5::text IS NOT NULL THEN $5 ELSE location END,
            lodged_with = CASE WHEN $4 = 'lodged' THEN $6 WHEN $4 = 'retrieved' THEN NULL ELSE lodged_with END,
            returned_on = CASE WHEN $4 = 'returned' THEN $7::date ELSE returned_on END,
            returned_to = CASE WHEN $4 = 'returned' THEN $6 ELSE returned_to END, updated_at = now()
      WHERE id = $1 AND org_id = $2`, [cur.id, orgId, next.status, b.action, b.location, b.party, b.on_date])
  await q.query(`INSERT INTO original_movements (org_id, original_id, action, on_date, location, party, note, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, cur.id, b.action, b.on_date, b.location, b.party, b.note, userId])
}

originalRoutes.post('/:id/move', jsonBody(moveBody), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Original')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadOriginal(db, org.id, id)
  await db.tx((q) => move(q, org.id, user.id, cur, b))
  await audit(c, `original.${b.action}`, 'client', cur.client_id, { original: id })
  return c.json({ original: (await withMovements(db, [await loadOriginal(db, org.id, id)]))[0] })
})

// Hands several originals back at once (one return receipt).
originalRoutes.post('/return', jsonBody(z.object({ ids: z.array(z.string().uuid()).min(1).max(50), on_date: day, party: z.string().trim().min(1).max(300), note: optText(2000) })), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const rows = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE o.id = ANY($1::uuid[]) AND o.org_id = $2`, [b.ids, org.id])
  if (rows.length !== new Set(b.ids).size) throw notFound('Original')
  if (new Set(rows.map((r: any) => r.client_id)).size > 1) throw badRequest('Return originals of one client at a time.')
  await db.tx(async (q) => { for (const r of rows) await move(q, org.id, user.id, r, { action: 'returned', on_date: b.on_date, party: b.party, note: b.note, location: null }) })
  await audit(c, 'original.returned', 'client', rows[0].client_id, { originals: rows.length })
  return c.json({ returned: rows.length })
})

originalRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Original')
  const { db } = c.get('deps')
  const cur = await loadOriginal(db, org.id, id)
  await db.query('DELETE FROM client_originals WHERE id = $1 AND org_id = $2', [id, org.id])
  await audit(c, 'original.deleted', 'client', cur.client_id, { original: id, receipt: receiptNo(cur.receipt_no), description: cur.description })
  return c.json({ ok: true })
})

// Bilingual receipt for taking originals in, or handing them back.
originalRoutes.get('/receipt', queryParams(z.object({ ids: z.string().min(36).max(2000), type: z.enum(['receipt', 'return']).default('receipt'), letterhead: z.enum(['true', 'false']).default('true') })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const ids = q.ids.split(',').map((s) => uuidParam(s.trim(), 'Original'))
  const { db } = c.get('deps')
  const rows = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE o.id = ANY($1::uuid[]) AND o.org_id = $2 ORDER BY o.receipt_no`, [ids, org.id])
  if (!rows.length || rows.length !== new Set(ids).size) throw notFound('Original')
  if (new Set(rows.map((r: any) => r.client_id)).size > 1) throw badRequest('A receipt covers the originals of one client.')
  if (q.type === 'return' && rows.some((r: any) => r.status !== 'returned')) throw badRequest('Record the return before printing the return receipt.')
  const first = rows[0]
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const cases = [...new Set(rows.map((r: any) => r.case_id))]
  const buf = await renderReceiptDocx({
    type: q.type, firmName: lh?.firm_name || org.name, firmNameAr: lh?.firm_name_ar ?? null, letterhead: q.letterhead === 'true' ? lh : null,
    clientName: first.client_name, clientNameAr: first.client_name_ar, party: q.type === 'return' ? first.returned_to : first.received_from,
    date: q.type === 'return' ? first.returned_on : first.received_on,
    reference: cases.length === 1 ? first.reference : null, caseTitle: cases.length === 1 ? first.case_title : null, items: rows as any[]
  })
  await audit(c, 'original.receipt_printed', 'client', first.client_id, { type: q.type, originals: rows.length })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`${q.type === 'return' ? 'return' : 'receipt'}-${receiptNo(first.receipt_no)}.docx`), 'cache-control': 'private, no-store' }
  })
})

// Firm-wide register.
originalRoutes.get('/register', queryParams(z.object({
  show: z.enum(['held', 'to_return', 'all']).default('held'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const filter = q.show === 'held' ? `o.status <> 'returned'` : q.show === 'to_return' ? TO_RETURN : 'true'
  const rows = await db.query(
    `SELECT ${COLS}, (${TO_RETURN}) AS to_return FROM ${FROM} WHERE o.org_id = $1 AND ${filter} ORDER BY (o.status = 'returned'), o.receipt_no DESC LIMIT 5000`, [org.id])
  if (q.format === 'csv') {
    await audit(c, 'original.register_exported', 'organization', org.id, { rows: rows.length })
    return new Response(toCsv([
      ['Receipt', 'Client', 'Matter', 'Type', 'Description', 'Reference', 'Amount', 'Currency', 'Copies', 'Received', 'Received from', 'Status', 'Location', 'Lodged with', 'Returned', 'Returned to'],
      ...rows.map((r: any) => [receiptNo(r.receipt_no), r.client_name, r.reference ?? '', r.kind, r.description, r.reference_no ?? '', r.amount ?? '', r.currency ?? '', r.copies,
        r.received_on, r.received_from ?? '', r.status, r.location ?? '', r.lodged_with ?? '', r.returned_on ?? '', r.returned_to ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="originals-register.csv"', 'cache-control': 'private, no-store' } })
  }
  const [counts] = await db.query(
    `SELECT count(*) FILTER (WHERE o.status = 'held')::int AS held, count(*) FILTER (WHERE o.status = 'lodged')::int AS lodged,
            count(*) FILTER (WHERE ${TO_RETURN})::int AS to_return
       FROM ${FROM} WHERE o.org_id = $1`, [org.id])
  return c.json({ items: rows.map((r: any) => ({ ...r, receipt: receiptNo(r.receipt_no) })), counts })
})

export async function originalsToReturn(db: Queryable, orgId: string) {
  const [r] = await db.query(`SELECT count(*)::int AS n FROM ${FROM} WHERE o.org_id = $1 AND ${TO_RETURN}`, [orgId])
  return r.n as number
}

export default originalRoutes
