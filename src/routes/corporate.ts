import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { DUE_SOON_DAYS, KIND_LABEL, LEGAL_FORMS, nextYear, OBLIGATION_KINDS, ownership, PERSON_ROLES, renderRegisterDocx, syncObligationEvent, warnings, type Person } from '../services/corporate'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
// Empty form fields mean "not set", never zero.
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())
const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

const profileShape = {
  legal_form: z.enum(LEGAL_FORMS).default('llc'),
  jurisdiction: optText(40),
  cr_number: optText(100),
  registered_on: optDay,
  capital: optNumber(z.coerce.number().min(0).max(1e15)),
  currency: z.enum(CURRENCIES).nullish().or(z.literal('')).transform((v) => v || null),
  total_shares: optNumber(z.coerce.number().positive().max(1e15)),
  fiscal_year_end: z.coerce.number().int().min(1).max(12).default(12),
  registered_address: optText(1000),
  activities: optText(3000),
  notes: optText(5000)
}

const personShape = {
  name: z.string().trim().min(2).max(300),
  name_ar: optText(300),
  role: z.enum(PERSON_ROLES),
  is_entity: z.boolean().default(false),
  nationality: optText(100),
  id_number: optText(100),
  shares: optNumber(z.coerce.number().min(0).max(1e15)),
  position: optText(200),
  signing_authority: optText(1000),
  appointed_on: optDay,
  ceased_on: optDay,
  notes: optText(2000)
}
type PersonFields = z.infer<z.ZodObject<typeof personShape>>

const obligationShape = {
  kind: z.enum(OBLIGATION_KINDS),
  title: optText(300),
  due_on: day,
  recurs_yearly: z.boolean().default(true),
  notes: optText(2000)
}

const PEOPLE_COLS = `id, client_id, name, name_ar, role, is_entity, nationality, id_number, shares::float8 AS shares, position, signing_authority,
  to_char(appointed_on, 'YYYY-MM-DD') AS appointed_on, to_char(ceased_on, 'YYYY-MM-DD') AS ceased_on, notes, created_at, updated_at`
const OB_COLS = (a = 'o') => `${a}.id, ${a}.client_id, ${a}.kind, ${a}.title, to_char(${a}.due_on, 'YYYY-MM-DD') AS due_on, ${a}.recurs_yearly,
  to_char(${a}.done_on, 'YYYY-MM-DD') AS done_on, ${a}.next_id, ${a}.event_id, ${a}.notes, (${a}.due_on - ${GULF_TODAY})::int AS days_left, ${a}.created_at`
const PROFILE_COLS = `legal_form, jurisdiction, cr_number, to_char(registered_on, 'YYYY-MM-DD') AS registered_on, capital::float8 AS capital, currency,
  total_shares::float8 AS total_shares, fiscal_year_end, registered_address, activities, notes, updated_at`

async function gulfToday(db: Queryable) {
  const [{ d }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`)
  return d as string
}

async function loadClient(db: Queryable, orgId: string, id: string) {
  const [cl] = await db.query('SELECT id, name, name_ar, kind FROM clients WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!cl) throw notFound('Client')
  return cl
}

function checkDates(p: { appointed_on: string | null; ceased_on: string | null }) {
  if (p.appointed_on && p.ceased_on && p.ceased_on < p.appointed_on) throw badRequest('The end date is before the appointment date.')
}

const corporateRoutes = new Hono<AppEnv>()

// Everything recorded for one corporate client.
corporateRoutes.get('/client/:id', async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  const today = await gulfToday(db)
  const [profile, people, obligations, cr] = await Promise.all([
    db.one(`SELECT ${PROFILE_COLS} FROM corporate_profiles WHERE client_id = $1 AND org_id = $2`, [cl.id, org.id]),
    db.query(`SELECT ${PEOPLE_COLS} FROM corporate_people WHERE client_id = $1 AND org_id = $2 ORDER BY (ceased_on IS NOT NULL AND ceased_on <= ${GULF_TODAY}), role, shares DESC NULLS LAST, name`, [cl.id, org.id]),
    db.query(`SELECT ${OB_COLS()} FROM corporate_obligations o WHERE o.client_id = $1 AND o.org_id = $2 ORDER BY (o.done_on IS NOT NULL), o.due_on, o.created_at`, [cl.id, org.id]),
    // A commercial registration on file whose renewal is not yet tracked.
    db.query(
      `SELECT cc.number, to_char(cc.expires_on, 'YYYY-MM-DD') AS expires_on FROM client_credentials cc
        WHERE cc.client_id = $1 AND cc.org_id = $2 AND cc.kind = 'commercial_registration' AND cc.expires_on IS NOT NULL AND cc.revoked_at IS NULL AND cc.replaced_by IS NULL
        ORDER BY cc.expires_on DESC LIMIT 1`, [cl.id, org.id])
  ])
  const totalShares = profile?.total_shares ?? null
  const own = ownership(people as Person[], totalShares, today)
  const tracked = obligations.some((o: any) => o.kind === 'cr_renewal' && !o.done_on)
  return c.json({
    client: cl, profile: profile ?? null, people, obligations, today,
    ownership: own,
    warnings: warnings(people as Person[], totalShares, today),
    suggestion: cr[0] && !tracked ? { kind: 'cr_renewal', due_on: cr[0].expires_on, number: cr[0].number } : null
  })
})

corporateRoutes.put('/client/:id', jsonBody(z.object(profileShape)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  await db.query(
    `INSERT INTO corporate_profiles (client_id, org_id, legal_form, jurisdiction, cr_number, registered_on, capital, currency, total_shares, fiscal_year_end, registered_address, activities, notes, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (client_id) DO UPDATE SET legal_form = $3, jurisdiction = $4, cr_number = $5, registered_on = $6, capital = $7, currency = $8, total_shares = $9,
       fiscal_year_end = $10, registered_address = $11, activities = $12, notes = $13, updated_by = $14, updated_at = now()`,
    [cl.id, org.id, b.legal_form, b.jurisdiction, b.cr_number, b.registered_on, b.capital, b.capital != null ? b.currency : null, b.total_shares, b.fiscal_year_end,
      b.registered_address, b.activities, b.notes, user.id])
  await audit(c, 'corporate.profile_saved', 'client', cl.id)
  return c.json({ profile: await db.one(`SELECT ${PROFILE_COLS} FROM corporate_profiles WHERE client_id = $1`, [cl.id]) })
})

corporateRoutes.post('/client/:id/people', jsonBody(z.object(personShape)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  checkDates(b)
  if (b.role !== 'shareholder') b.shares = null
  const [row] = await db.query(
    `INSERT INTO corporate_people (org_id, client_id, name, name_ar, role, is_entity, nationality, id_number, shares, position, signing_authority, appointed_on, ceased_on, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING ${PEOPLE_COLS}`,
    [org.id, cl.id, b.name, b.name_ar, b.role, b.is_entity, b.nationality, b.id_number, b.shares, b.position, b.signing_authority, b.appointed_on, b.ceased_on, b.notes, user.id])
  await audit(c, 'corporate.person_added', 'client', cl.id, { person: row.id, role: b.role })
  return c.json({ person: row }, 201)
})

corporateRoutes.patch('/people/:id', jsonBody(updateBody(personShape)), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Person')
  const b = c.req.valid('json') as Partial<PersonFields>
  const { db } = c.get('deps')
  const cur = await db.one(`SELECT ${PEOPLE_COLS} FROM corporate_people WHERE id = $1 AND org_id = $2`, [id, org.id])
  if (!cur) throw notFound('Person')
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  checkDates(r)
  if (r.role !== 'shareholder') r.shares = null
  const [row] = await db.query(
    `UPDATE corporate_people SET name = $3, name_ar = $4, role = $5, is_entity = $6, nationality = $7, id_number = $8, shares = $9, position = $10, signing_authority = $11,
            appointed_on = $12, ceased_on = $13, notes = $14, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${PEOPLE_COLS}`,
    [id, org.id, r.name, r.name_ar, r.role, r.is_entity, r.nationality, r.id_number, r.shares, r.position, r.signing_authority, r.appointed_on, r.ceased_on, r.notes])
  await audit(c, 'corporate.person_updated', 'client', cur.client_id, { person: id })
  return c.json({ person: row })
})

corporateRoutes.delete('/people/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Person')
  const { db } = c.get('deps')
  const [row] = await db.query('DELETE FROM corporate_people WHERE id = $1 AND org_id = $2 RETURNING client_id', [id, org.id])
  if (!row) throw notFound('Person')
  await audit(c, 'corporate.person_deleted', 'client', row.client_id, { person: id })
  return c.json({ ok: true })
})

async function loadObligation(db: Queryable, orgId: string, id: string): Promise<any> {
  const [o] = await db.query(`SELECT ${OB_COLS()}, cl.name AS client_name FROM corporate_obligations o JOIN clients cl ON cl.id = o.client_id WHERE o.id = $1 AND o.org_id = $2`, [id, orgId])
  if (!o) throw notFound('Filing')
  return o
}

corporateRoutes.post('/client/:id/obligations', jsonBody(z.object(obligationShape)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  const title = b.title || KIND_LABEL[b.kind][0]
  const id = await db.tx(async (q) => {
    const [row] = await q.query(
      `INSERT INTO corporate_obligations (org_id, client_id, kind, title, due_on, recurs_yearly, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [org.id, cl.id, b.kind, title, b.due_on, b.recurs_yearly, b.notes, user.id])
    const eventId = await syncObligationEvent(q, { orgId: org.id, userId: user.id, clientName: cl.name, ob: { id: row.id, client_id: cl.id, kind: b.kind, title, due_on: b.due_on, done_on: null, event_id: null, notes: b.notes } })
    await q.query('UPDATE corporate_obligations SET event_id = $2 WHERE id = $1', [row.id, eventId])
    return row.id as string
  })
  await audit(c, 'corporate.filing_added', 'client', cl.id, { filing: id, kind: b.kind })
  return c.json({ obligation: await loadObligation(db, org.id, id) }, 201)
})

corporateRoutes.patch('/obligations/:id', jsonBody(updateBody(obligationShape)), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Filing')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadObligation(db, org.id, id)
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  if (!r.title) r.title = KIND_LABEL[r.kind as keyof typeof KIND_LABEL][0]
  await db.tx(async (q) => {
    const eventId = await syncObligationEvent(q, { orgId: org.id, userId: user.id, clientName: cur.client_name, ob: r })
    await q.query(`UPDATE corporate_obligations SET kind = $3, title = $4, due_on = $5, recurs_yearly = $6, notes = $7, event_id = $8, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, r.kind, r.title, r.due_on, r.recurs_yearly, r.notes, eventId])
  })
  await audit(c, 'corporate.filing_updated', 'client', cur.client_id, { filing: id })
  return c.json({ obligation: await loadObligation(db, org.id, id) })
})

// Marks a filing done; a yearly one rolls forward to the same date next year.
corporateRoutes.post('/obligations/:id/done', jsonBody(z.object({ done_on: day })), async (c) => {
  requireRole(c, ...staff)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Filing')
  const { done_on } = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadObligation(db, org.id, id)
  if (cur.done_on) throw badRequest('This filing is already marked done.')
  if (done_on > (await gulfToday(db))) throw badRequest('The completion date is in the future.')
  const nextId = await db.tx(async (q) => {
    await syncObligationEvent(q, { orgId: org.id, userId: user.id, clientName: cur.client_name, ob: { ...cur, done_on } })
    let next: string | null = null
    if (cur.recurs_yearly) {
      const due = nextYear(cur.due_on)
      const [row] = await q.query(
        `INSERT INTO corporate_obligations (org_id, client_id, kind, title, due_on, recurs_yearly, notes, created_by) VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`,
        [org.id, cur.client_id, cur.kind, cur.title, due, cur.notes, user.id])
      const eventId = await syncObligationEvent(q, { orgId: org.id, userId: user.id, clientName: cur.client_name, ob: { ...cur, id: row.id, due_on: due, done_on: null, event_id: null } })
      await q.query('UPDATE corporate_obligations SET event_id = $2 WHERE id = $1', [row.id, eventId])
      next = row.id
    }
    await q.query('UPDATE corporate_obligations SET done_on = $3, next_id = $4, updated_at = now() WHERE id = $1 AND org_id = $2', [id, org.id, done_on, next])
    return next
  })
  await audit(c, 'corporate.filing_done', 'client', cur.client_id, { filing: id, next: nextId })
  return c.json({ obligation: await loadObligation(db, org.id, id), next: nextId ? await loadObligation(db, org.id, nextId) : null })
})

corporateRoutes.delete('/obligations/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Filing')
  const { db } = c.get('deps')
  const cur = await loadObligation(db, org.id, id)
  await db.tx(async (q) => {
    if (cur.event_id) await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [cur.event_id, org.id])
    await q.query('DELETE FROM corporate_obligations WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'corporate.filing_deleted', 'client', cur.client_id, { filing: id })
  return c.json({ ok: true })
})

// Bilingual register of shareholders and officers for one company.
corporateRoutes.get('/client/:id/register', queryParams(z.object({ letterhead: z.enum(['true', 'false']).default('true') })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  const today = await gulfToday(db)
  const profile: any = await db.one(`SELECT ${PROFILE_COLS} FROM corporate_profiles WHERE client_id = $1 AND org_id = $2`, [cl.id, org.id])
  const people = await db.query(`SELECT ${PEOPLE_COLS} FROM corporate_people WHERE client_id = $1 AND org_id = $2 ORDER BY role, shares DESC NULLS LAST, name`, [cl.id, org.id]) as Person[]
  const own = ownership(people, profile?.total_shares ?? null, today)
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const buf = await renderRegisterDocx({
    firmName: lh?.firm_name || org.name, letterhead: c.req.valid('query').letterhead === 'true' ? lh : null, date: today,
    company: cl as any, profile, people, percents: new Map(own.holders.map((h) => [h.id, h.percent])), today
  })
  await audit(c, 'corporate.register_printed', 'client', cl.id)
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`register-${cl.name}.docx`), 'cache-control': 'private, no-store' }
  })
})

// Firm-wide list of corporate filings: overdue and due soon first.
corporateRoutes.get('/register', queryParams(z.object({
  show: z.enum(['due', 'open', 'all']).default('open'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const filter = q.show === 'due' ? `o.done_on IS NULL AND o.due_on <= ${GULF_TODAY} + ${DUE_SOON_DAYS}` : q.show === 'open' ? 'o.done_on IS NULL' : 'true'
  const rows = await db.query(
    `SELECT ${OB_COLS()}, cl.name AS client_name, cl.name_ar AS client_name_ar, p.cr_number, p.legal_form
       FROM corporate_obligations o JOIN clients cl ON cl.id = o.client_id LEFT JOIN corporate_profiles p ON p.client_id = o.client_id
      WHERE o.org_id = $1 AND ${filter} ORDER BY (o.done_on IS NOT NULL), o.due_on, cl.name LIMIT 5000`, [org.id])
  if (q.format === 'csv') {
    await audit(c, 'corporate.register_exported', 'organization', org.id, { rows: rows.length })
    return new Response(toCsv([
      ['Company', 'CR no.', 'Filing', 'Type', 'Due', 'Days left', 'Yearly', 'Done', 'Notes'],
      ...rows.map((r: any) => [r.client_name, r.cr_number ?? '', r.title, r.kind, r.due_on, r.done_on ? '' : r.days_left, r.recurs_yearly ? 'yes' : 'no', r.done_on ?? '', r.notes ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="corporate-filings.csv"', 'cache-control': 'private, no-store' } })
  }
  const [counts] = await db.query(
    `SELECT count(*) FILTER (WHERE done_on IS NULL)::int AS open,
            count(*) FILTER (WHERE done_on IS NULL AND due_on < ${GULF_TODAY})::int AS overdue,
            count(*) FILTER (WHERE done_on IS NULL AND due_on >= ${GULF_TODAY} AND due_on <= ${GULF_TODAY} + ${DUE_SOON_DAYS})::int AS due_soon,
            (SELECT count(*)::int FROM corporate_profiles WHERE org_id = $1) AS companies
       FROM corporate_obligations WHERE org_id = $1`, [org.id])
  return c.json({ items: rows, counts })
})

// Open filings overdue or due within the month (for the dashboard).
export async function corporateFilingsDue(db: Queryable, orgId: string) {
  const [r] = await db.query(`SELECT count(*)::int AS n FROM corporate_obligations WHERE org_id = $1 AND done_on IS NULL AND due_on <= ${GULF_TODAY} + ${DUE_SOON_DAYS}`, [orgId])
  return r.n as number
}

export default corporateRoutes
