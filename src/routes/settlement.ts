import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { outsideAuthority, standing, type Authority } from '../services/settlement'
import { caseActivity } from './cases'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
const editors = ['owner', 'admin', 'lawyer'] as const
const STATUSES = ['open', 'accepted', 'rejected', 'countered', 'expired', 'withdrawn'] as const

const offerShape = {
  direction: z.enum(['ours', 'theirs']),
  amount: z.coerce.number().min(0).max(1e13),
  currency: z.enum(CURRENCIES).optional(),
  terms: optText(5000),
  made_on: day,
  expires_on: optDay,
  without_prejudice: z.boolean().default(true),
  status: z.enum(STATUSES).default('open'),
  responded_on: optDay,
  document_id: z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(5000),
  // Accepting an offer outside the client's instructions needs a deliberate confirmation.
  confirm_outside_authority: z.boolean().default(false)
}

const COLS = `o.id, o.case_id, o.direction, o.amount::float8 AS amount, o.currency, o.terms, to_char(o.made_on, 'YYYY-MM-DD') AS made_on,
  to_char(o.expires_on, 'YYYY-MM-DD') AS expires_on, o.without_prejudice, o.status, to_char(o.responded_on, 'YYYY-MM-DD') AS responded_on,
  o.outside_authority, o.document_id, d.title AS document_title, o.event_id, o.notes, o.created_at, u.name AS created_by_name,
  (o.expires_on - ${GULF_TODAY})::int AS days_left`
const FROM = 'settlement_offers o LEFT JOIN documents d ON d.id = o.document_id LEFT JOIN users u ON u.id = o.created_by'

async function loadCase(db: Queryable, orgId: string, id: string) {
  const [k] = await db.query('SELECT id, reference, currency FROM cases WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!k) throw notFound('Case')
  return k
}

async function loadAuthority(db: Queryable, caseId: string): Promise<any> {
  const [a] = await db.query(
    `SELECT a.position, a.amount::float8 AS amount, a.currency, to_char(a.given_on, 'YYYY-MM-DD') AS given_on, a.note, a.updated_at, u.name AS updated_by_name
       FROM settlement_authority a LEFT JOIN users u ON u.id = a.updated_by WHERE a.case_id = $1`, [caseId])
  return a ?? null
}

async function loadOffer(db: Queryable, orgId: string, id: string): Promise<any> {
  const [o] = await db.query(`SELECT ${COLS}, k.reference FROM ${FROM} JOIN cases k ON k.id = o.case_id WHERE o.id = $1 AND o.org_id = $2`, [id, orgId])
  if (!o) throw notFound('Offer')
  return o
}

// Keeps the expiry of an open offer on the calendar.
async function syncExpiry(q: Queryable, orgId: string, userId: string, reference: string, o: any) {
  const open = o.status === 'open' && !!o.expires_on
  const title = o.direction === 'theirs' ? `Settlement offer expires – ${reference}` : `Our settlement offer expires – ${reference}`
  const note = o.direction === 'theirs'
    ? `The other side's offer of ${o.amount} ${o.currency} lapses. Get the client's instructions before then.`
    : `Our offer of ${o.amount} ${o.currency} lapses. Follow up with the other side.`
  if (o.event_id) {
    if (!o.expires_on) {
      await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [o.event_id, orgId])
      await q.query('UPDATE settlement_offers SET event_id = NULL WHERE id = $1', [o.id])
      return
    }
    await q.query(
      `UPDATE events SET starts_at = ($3::date::timestamp AT TIME ZONE 'Asia/Muscat'), title = $4, notes = $5,
              completed_at = CASE WHEN $6::boolean THEN NULL ELSE coalesce(completed_at, now()) END, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [o.event_id, orgId, o.expires_on, title, note, open])
    return
  }
  if (!o.expires_on) return
  const [e] = await q.query(
    `INSERT INTO events (org_id, case_id, title, kind, starts_at, all_day, notes, completed_at, created_by)
     VALUES ($1, $2, $3, 'deadline', ($4::date::timestamp AT TIME ZONE 'Asia/Muscat'), true, $5, CASE WHEN $6::boolean THEN NULL ELSE now() END, $7) RETURNING id`,
    [orgId, o.case_id, title, o.expires_on, note, open, userId])
  await q.query('UPDATE settlement_offers SET event_id = $2 WHERE id = $1', [o.id, e.id])
}

function check(o: any, authority: Authority, confirm: boolean) {
  if (o.expires_on && o.expires_on < o.made_on) throw badRequest('The expiry date is before the offer date.')
  if (o.responded_on && o.responded_on < o.made_on) throw badRequest('The response date is before the offer date.')
  const outside = outsideAuthority(authority, o)
  if (o.status === 'accepted' && o.direction === 'theirs' && outside && !confirm) {
    throw new HttpError(409, 'outside_authority', "This offer is outside the client's instructions. Confirm that the client has agreed before accepting it.")
  }
  return outside
}

const settlementRoutes = new Hono<AppEnv>()

settlementRoutes.get('/case/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer', 'staff')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  const [offers, authority] = await Promise.all([
    db.query(`SELECT ${COLS} FROM ${FROM} WHERE o.case_id = $1 AND o.org_id = $2 ORDER BY o.made_on DESC, o.created_at DESC`, [k.id, org.id]),
    loadAuthority(db, k.id)
  ])
  return c.json({ offers, authority, standing: standing(offers as any[], authority?.position ?? null), currency: k.currency })
})

// The client's instructions: the least they will take, or the most they will pay.
settlementRoutes.put('/case/:id/authority', jsonBody(z.object({
  position: z.enum(['receive', 'pay']),
  amount: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).max(1e13).nullable()),
  currency: z.enum(CURRENCIES).optional(),
  given_on: optDay,
  note: optText(2000)
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  const currency = b.currency ?? k.currency
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO settlement_authority (case_id, org_id, position, amount, currency, given_on, note, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (case_id) DO UPDATE SET position = $3, amount = $4, currency = $5, given_on = $6, note = $7, updated_by = $8, updated_at = now()`,
      [k.id, org.id, b.position, b.amount, currency, b.given_on, b.note, user.id])
    // Re-check the open offers against the new instructions.
    const offers = await q.query(`SELECT id, amount::float8 AS amount, currency FROM settlement_offers WHERE case_id = $1`, [k.id])
    for (const o of offers) {
      await q.query('UPDATE settlement_offers SET outside_authority = $2 WHERE id = $1', [o.id, outsideAuthority({ position: b.position, amount: b.amount, currency }, o as any)])
    }
  })
  await audit(c, 'settlement.authority_set', 'case', k.id, { position: b.position, amount: b.amount, currency })
  return c.json({ authority: await loadAuthority(db, k.id) })
})

settlementRoutes.post('/case/:id', jsonBody(z.object(offerShape)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  if (b.document_id && !(await db.query('SELECT 1 FROM documents WHERE id = $1 AND case_id = $2', [b.document_id, k.id])).length) throw badRequest('Choose a document from this matter.')
  const o: any = { ...b, currency: b.currency ?? k.currency, case_id: k.id }
  const outside = check(o, await loadAuthority(db, k.id), b.confirm_outside_authority)
  const id = await db.tx(async (q) => {
    const [row] = await q.query(
      `INSERT INTO settlement_offers (org_id, case_id, direction, amount, currency, terms, made_on, expires_on, without_prejudice, status, responded_on, outside_authority, document_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [org.id, k.id, o.direction, o.amount, o.currency, o.terms, o.made_on, o.expires_on, o.without_prejudice, o.status, o.responded_on, outside, o.document_id, o.notes, user.id])
    await syncExpiry(q, org.id, user.id, k.reference, { ...o, id: row.id, event_id: null })
    await caseActivity(q, org.id, k.id, user.id, 'settlement',
      `${o.direction === 'ours' ? 'Settlement offer made' : 'Settlement offer received'}: ${o.amount} ${o.currency}${outside ? ' (outside client instructions)' : ''}`)
    return row.id as string
  })
  await audit(c, 'settlement.offer_recorded', 'case', k.id, { offer: id, direction: o.direction, amount: o.amount, currency: o.currency, outside_authority: outside })
  return c.json({ offer: await loadOffer(db, org.id, id) }, 201)
})

settlementRoutes.patch('/:id', jsonBody(updateBody(offerShape)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json') as Record<string, any>
  const { db } = c.get('deps')
  const cur = await loadOffer(db, org.id, uuidParam(c.req.param('id'), 'Offer'))
  if (b.document_id && !(await db.query('SELECT 1 FROM documents WHERE id = $1 AND case_id = $2', [b.document_id, cur.case_id])).length) throw badRequest('Choose a document from this matter.')
  const o: any = { ...cur }
  for (const [key, v] of Object.entries(b)) if (v !== undefined && key !== 'confirm_outside_authority') o[key] = v
  // A response closes the offer; record when unless given.
  if (o.status !== 'open' && cur.status === 'open' && !o.responded_on) {
    o.responded_on = (await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`))[0].d
  }
  const outside = check(o, await loadAuthority(db, cur.case_id), !!b.confirm_outside_authority)
  await db.tx(async (q) => {
    await q.query(
      `UPDATE settlement_offers SET direction = $3, amount = $4, currency = $5, terms = $6, made_on = $7, expires_on = $8, without_prejudice = $9, status = $10,
              responded_on = $11, outside_authority = $12, document_id = $13, notes = $14, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [cur.id, org.id, o.direction, o.amount, o.currency, o.terms, o.made_on, o.expires_on, o.without_prejudice, o.status, o.responded_on, outside, o.document_id, o.notes])
    await syncExpiry(q, org.id, user.id, cur.reference, o)
    if (o.status !== cur.status) {
      await caseActivity(q, org.id, cur.case_id, user.id, 'settlement', `Settlement offer of ${o.amount} ${o.currency} (${o.direction}): ${cur.status} → ${o.status}`)
    }
  })
  await audit(c, o.status === 'accepted' && cur.status !== 'accepted' ? 'settlement.offer_accepted' : 'settlement.offer_updated', 'case', cur.case_id,
    { offer: cur.id, status: o.status, outside_authority: outside })
  return c.json({ offer: await loadOffer(db, org.id, cur.id) })
})

settlementRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const cur = await loadOffer(db, org.id, uuidParam(c.req.param('id'), 'Offer'))
  await db.tx(async (q) => {
    if (cur.event_id) await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [cur.event_id, org.id])
    await q.query('DELETE FROM settlement_offers WHERE id = $1', [cur.id])
  })
  await audit(c, 'settlement.offer_deleted', 'case', cur.case_id, { offer: cur.id, amount: cur.amount, currency: cur.currency })
  return c.json({ ok: true })
})

// Open offers across the firm, by expiry.
settlementRoutes.get('/register', queryParams(z.object({ show: z.enum(['open', 'all']).default('open'), format: z.enum(['json', 'csv']).default('json') })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = await db.query(
    `SELECT ${COLS}, k.reference, k.title AS case_title, cl.name AS client_name, lu.name AS lawyer_name
       FROM ${FROM} JOIN cases k ON k.id = o.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users lu ON lu.id = k.assigned_to
      WHERE o.org_id = $1 AND ($2 = 'all' OR o.status = 'open')
      ORDER BY (o.status = 'open') DESC, o.expires_on NULLS LAST, o.made_on DESC LIMIT 5000`, [org.id, q.show])
  if (q.format === 'csv') {
    await audit(c, 'settlement.register_exported', 'organization', org.id, { rows: rows.length })
    return new Response(toCsv([
      ['Reference', 'Matter', 'Client', 'Direction', 'Amount', 'Currency', 'Made on', 'Expires', 'Status', 'Responded', 'Outside instructions', 'Without prejudice', 'Lawyer'],
      ...rows.map((r: any) => [r.reference, r.case_title, r.client_name ?? '', r.direction, r.amount, r.currency, r.made_on, r.expires_on ?? '', r.status, r.responded_on ?? '',
        r.outside_authority ? 'yes' : '', r.without_prejudice ? 'yes' : '', r.lawyer_name ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="settlement-offers.csv"', 'cache-control': 'private, no-store' } })
  }
  const open = rows.filter((r: any) => r.status === 'open')
  return c.json({
    items: rows,
    counts: {
      open: open.length,
      expiring: open.filter((r: any) => r.expires_on && r.days_left >= 0 && r.days_left <= 3).length,
      lapsed: open.filter((r: any) => r.expires_on && r.days_left < 0).length
    }
  })
})

export default settlementRoutes
