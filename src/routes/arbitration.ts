import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, updateBody, uuidParam } from '../lib/http'
import {
  DUE_SOON_DAYS, INSTITUTION_NAME, INSTITUTIONS, MEMBER_ROLES, NOMINATORS, normalizeTimetable, PARTIES, RESULTS, stage, STEP_KINDS, syncStepEvent, timetableMessages, type Step
} from '../services/arbitration'
import { GULF_TODAY } from '../services/credentials'
import { parseJsonObject } from '../services/legal-prompts'
import { toCsv } from '../services/practice-insights'
import { CURRENCIES } from '../services/reference'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { caseActivity } from './cases'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
// Empty form fields mean "not set", never zero.
const optNumber = <T extends z.ZodType<number>>(n: T) => z.preprocess((v) => (v === '' || v == null ? null : v), n.nullable())
const optCurrency = z.enum(CURRENCIES).nullish().or(z.literal('')).transform((v) => v || null)
const editors = ['owner', 'admin', 'lawyer'] as const
const readers = ['owner', 'admin', 'lawyer', 'staff'] as const

const arbShape = {
  institution: z.enum(INSTITUTIONS).default('ocac'),
  institution_ref: optText(100),
  rules: optText(300),
  seat: optText(200),
  language: optText(100),
  governing_law: optText(200),
  our_side: z.enum(['claimant', 'respondent']).default('claimant'),
  amount_claimed: optNumber(z.coerce.number().min(0).max(1e15)),
  counterclaim: optNumber(z.coerce.number().min(0).max(1e15)),
  currency: optCurrency,
  commenced_on: optDay,
  constituted_on: optDay,
  award_on: optDay,
  award_result: z.enum(RESULTS).nullish().or(z.literal('')).transform((v) => v || null),
  notes: optText(5000)
}

const memberShape = {
  name: z.string().trim().min(2).max(300),
  role: z.enum(MEMBER_ROLES),
  nominated_by: z.enum(NOMINATORS).nullish().or(z.literal('')).transform((v) => v || null),
  appointed_on: optDay,
  contact: optText(300),
  notes: optText(2000)
}

const stepShape = {
  kind: z.enum(STEP_KINDS).default('submission'),
  title: z.string().trim().min(2).max(300),
  party: z.enum(PARTIES).default('us'),
  due_on: day,
  done_on: optDay,
  amount: optNumber(z.coerce.number().min(0).max(1e15)),
  currency: optCurrency,
  notes: optText(1000)
}

const ARB_COLS = `a.case_id, a.institution, a.institution_ref, a.rules, a.seat, a.language, a.governing_law, a.our_side,
  a.amount_claimed::float8 AS amount_claimed, a.counterclaim::float8 AS counterclaim, a.currency,
  to_char(a.commenced_on, 'YYYY-MM-DD') AS commenced_on, to_char(a.constituted_on, 'YYYY-MM-DD') AS constituted_on,
  to_char(a.award_on, 'YYYY-MM-DD') AS award_on, a.award_result, a.notes, a.updated_at`
const MEMBER_COLS = `id, case_id, name, role, nominated_by, to_char(appointed_on, 'YYYY-MM-DD') AS appointed_on, contact, notes`
const STEP_COLS = (s = 's') => `${s}.id, ${s}.case_id, ${s}.kind, ${s}.title, ${s}.party, to_char(${s}.due_on, 'YYYY-MM-DD') AS due_on,
  to_char(${s}.done_on, 'YYYY-MM-DD') AS done_on, ${s}.amount::float8 AS amount, ${s}.currency, ${s}.event_id, ${s}.source, ${s}.notes,
  (${s}.due_on - ${GULF_TODAY})::int AS days_left`
// Our own open steps (alone or with the other side) drive warnings.
const OURS = `party IN ('us', 'both')`

async function loadCase(db: Queryable, orgId: string, id: string) {
  const [k] = await db.query('SELECT id, reference, title, currency FROM cases WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!k) throw notFound('Case')
  return k
}

async function requireArbitration(db: Queryable, orgId: string, caseId: string) {
  const [a] = await db.query('SELECT our_side FROM arbitrations WHERE case_id = $1 AND org_id = $2', [caseId, orgId])
  if (!a) throw badRequest('Record the arbitration details first.')
  return a
}

function checkDates(a: { commenced_on: string | null; constituted_on: string | null; award_on: string | null }) {
  if (a.constituted_on && a.commenced_on && a.constituted_on < a.commenced_on) throw badRequest('The tribunal was constituted before the arbitration started.')
  if (a.award_on && a.commenced_on && a.award_on < a.commenced_on) throw badRequest('The award date is before the arbitration started.')
}

const arbitrationRoutes = new Hono<AppEnv>()

// The arbitration on a matter: details, tribunal, timetable and the next step for our side.
arbitrationRoutes.get('/case/:id', async (c) => {
  requireRole(c, ...readers)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  const [arb] = await db.query(`SELECT ${ARB_COLS} FROM arbitrations a WHERE a.case_id = $1 AND a.org_id = $2`, [k.id, org.id])
  if (!arb) return c.json({ arbitration: null, members: [], steps: [] })
  const [members, steps] = await Promise.all([
    db.query(`SELECT ${MEMBER_COLS} FROM arbitration_members WHERE case_id = $1 ORDER BY array_position(ARRAY['sole','chair','co_arbitrator','secretary','expert'], role), created_at`, [k.id]),
    db.query(`SELECT ${STEP_COLS()} FROM arbitration_steps s WHERE s.case_id = $1 ORDER BY s.due_on, s.created_at`, [k.id])
  ])
  const next = steps.find((s: any) => !s.done_on && (s.party === 'us' || s.party === 'both')) ?? null
  return c.json({ arbitration: { ...arb, stage: stage(arb as any, members as any[]) }, members, steps, next_step: next })
})

arbitrationRoutes.put('/case/:id', jsonBody(z.object(arbShape)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  checkDates(b)
  if (b.award_result && !['settled', 'withdrawn'].includes(b.award_result) && !b.award_on) throw badRequest('Enter the award date with the result.')
  const currency = b.amount_claimed != null || b.counterclaim != null ? b.currency ?? k.currency : null
  const [prev] = await db.query('SELECT award_on, award_result FROM arbitrations WHERE case_id = $1', [k.id])
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO arbitrations (case_id, org_id, institution, institution_ref, rules, seat, language, governing_law, our_side, amount_claimed, counterclaim, currency,
         commenced_on, constituted_on, award_on, award_result, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (case_id) DO UPDATE SET institution = $3, institution_ref = $4, rules = $5, seat = $6, language = $7, governing_law = $8, our_side = $9,
         amount_claimed = $10, counterclaim = $11, currency = $12, commenced_on = $13, constituted_on = $14, award_on = $15, award_result = $16, notes = $17,
         updated_by = $18, updated_at = now()`,
      [k.id, org.id, b.institution, b.institution_ref, b.rules, b.seat, b.language, b.governing_law, b.our_side, b.amount_claimed, b.counterclaim, currency,
        b.commenced_on, b.constituted_on, b.award_on, b.award_result, b.notes, user.id])
    if (!prev) await caseActivity(q, org.id, k.id, user.id, 'arbitration', `Arbitration recorded: ${INSTITUTION_NAME[b.institution]}${b.institution_ref ? ` (${b.institution_ref})` : ''}, acting for the ${b.our_side}`)
    else if (b.award_result && b.award_result !== prev.award_result) await caseActivity(q, org.id, k.id, user.id, 'arbitration', `Arbitration outcome recorded: ${b.award_result}${b.award_on ? ` on ${b.award_on}` : ''}`)
  })
  await audit(c, prev ? 'arbitration.updated' : 'arbitration.created', 'case', k.id)
  const [arb] = await db.query(`SELECT ${ARB_COLS} FROM arbitrations a WHERE a.case_id = $1`, [k.id])
  return c.json({ arbitration: arb }, prev ? 200 : 201)
})

arbitrationRoutes.delete('/case/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  await db.tx(async (q) => {
    await q.query(`DELETE FROM events WHERE org_id = $1 AND completed_at IS NULL AND id IN (SELECT event_id FROM arbitration_steps WHERE case_id = $2 AND event_id IS NOT NULL)`, [org.id, k.id])
    const gone = await q.query('DELETE FROM arbitrations WHERE case_id = $1 AND org_id = $2 RETURNING case_id', [k.id, org.id])
    if (!gone.length) throw notFound('Arbitration')
  })
  await audit(c, 'arbitration.deleted', 'case', k.id)
  return c.json({ ok: true })
})

// ----- Tribunal -----

arbitrationRoutes.post('/case/:id/members', jsonBody(z.object(memberShape)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  await requireArbitration(db, org.id, k.id)
  const [m] = await db.query(
    `INSERT INTO arbitration_members (org_id, case_id, name, role, nominated_by, appointed_on, contact, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${MEMBER_COLS}`,
    [org.id, k.id, b.name, b.role, b.nominated_by, b.appointed_on, b.contact, b.notes])
  if (b.role !== 'secretary' && b.role !== 'expert') await caseActivity(db, org.id, k.id, user.id, 'arbitration', `Arbitrator added: ${b.name} (${b.role.replace('_', '-')})`)
  await audit(c, 'arbitration.member_added', 'case', k.id, { member: m.id })
  return c.json({ member: m }, 201)
})

arbitrationRoutes.patch('/members/:id', jsonBody(updateBody(memberShape)), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Tribunal member')
  const b = c.req.valid('json') as Record<string, unknown>
  const { db } = c.get('deps')
  const [cur] = await db.query(`SELECT ${MEMBER_COLS} FROM arbitration_members WHERE id = $1 AND org_id = $2`, [id, org.id])
  if (!cur) throw notFound('Tribunal member')
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  const [m] = await db.query(
    `UPDATE arbitration_members SET name = $3, role = $4, nominated_by = $5, appointed_on = $6, contact = $7, notes = $8 WHERE id = $1 AND org_id = $2 RETURNING ${MEMBER_COLS}`,
    [id, org.id, r.name, r.role, r.nominated_by, r.appointed_on, r.contact, r.notes])
  await audit(c, 'arbitration.member_updated', 'case', cur.case_id, { member: id })
  return c.json({ member: m })
})

arbitrationRoutes.delete('/members/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Tribunal member')
  const { db } = c.get('deps')
  const [row] = await db.query('DELETE FROM arbitration_members WHERE id = $1 AND org_id = $2 RETURNING case_id', [id, org.id])
  if (!row) throw notFound('Tribunal member')
  await audit(c, 'arbitration.member_deleted', 'case', row.case_id, { member: id })
  return c.json({ ok: true })
})

// ----- Procedural timetable -----

async function loadStep(db: Queryable, orgId: string, id: string): Promise<any> {
  const [s] = await db.query(`SELECT ${STEP_COLS()}, k.reference FROM arbitration_steps s JOIN cases k ON k.id = s.case_id WHERE s.id = $1 AND s.org_id = $2`, [id, orgId])
  if (!s) throw notFound('Step')
  return s
}

// Adds one step or a whole timetable (e.g. confirmed from a procedural order).
arbitrationRoutes.post('/case/:id/steps', jsonBody(z.object({ steps: z.array(z.object(stepShape)).min(1).max(60), source: z.enum(['manual', 'ai']).default('manual') })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  await requireArbitration(db, org.id, k.id)
  const ids = await db.tx(async (q) => {
    const out: string[] = []
    for (const s of b.steps) {
      const [row] = await q.query(
        `INSERT INTO arbitration_steps (org_id, case_id, kind, title, party, due_on, done_on, amount, currency, source, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [org.id, k.id, s.kind, s.title, s.party, s.due_on, s.done_on, s.amount, s.amount != null ? s.currency ?? k.currency : null, b.source, s.notes, user.id])
      const eventId = await syncStepEvent(q, { orgId: org.id, userId: user.id, reference: k.reference, step: { ...s, id: row.id, case_id: k.id, event_id: null } as Step })
      await q.query('UPDATE arbitration_steps SET event_id = $2 WHERE id = $1', [row.id, eventId])
      out.push(row.id)
    }
    if (b.steps.length > 1) await caseActivity(q, org.id, k.id, user.id, 'arbitration', `Procedural timetable: ${b.steps.length} steps added to the calendar`)
    return out
  })
  await audit(c, 'arbitration.steps_added', 'case', k.id, { steps: ids.length, source: b.source })
  const steps = await db.query(`SELECT ${STEP_COLS()} FROM arbitration_steps s WHERE s.id = ANY($1::uuid[]) ORDER BY s.due_on`, [ids])
  return c.json({ steps }, 201)
})

arbitrationRoutes.patch('/steps/:id', jsonBody(updateBody(stepShape)), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Step')
  const b = c.req.valid('json') as Record<string, unknown>
  const { db } = c.get('deps')
  const cur = await loadStep(db, org.id, id)
  const r: any = { ...cur }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) r[k] = v
  if (r.amount == null) r.currency = null
  await db.tx(async (q) => {
    const eventId = await syncStepEvent(q, { orgId: org.id, userId: user.id, reference: cur.reference, step: r })
    await q.query(
      `UPDATE arbitration_steps SET kind = $3, title = $4, party = $5, due_on = $6, done_on = $7, amount = $8, currency = $9, notes = $10, event_id = $11, updated_at = now()
        WHERE id = $1 AND org_id = $2`, [id, org.id, r.kind, r.title, r.party, r.due_on, r.done_on, r.amount, r.currency, r.notes, eventId])
    if (r.due_on !== cur.due_on && !r.done_on) await caseActivity(q, org.id, cur.case_id, user.id, 'arbitration', `Timetable changed: "${r.title}" moved from ${cur.due_on} to ${r.due_on}`)
  })
  await audit(c, 'arbitration.step_updated', 'case', cur.case_id, { step: id })
  return c.json({ step: await loadStep(db, org.id, id) })
})

arbitrationRoutes.delete('/steps/:id', async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Step')
  const { db } = c.get('deps')
  const cur = await loadStep(db, org.id, id)
  await db.tx(async (q) => {
    if (cur.event_id) await q.query('DELETE FROM events WHERE id = $1 AND org_id = $2 AND completed_at IS NULL', [cur.event_id, org.id])
    await q.query('DELETE FROM arbitration_steps WHERE id = $1 AND org_id = $2', [id, org.id])
  })
  await audit(c, 'arbitration.step_deleted', 'case', cur.case_id, { step: id })
  return c.json({ ok: true })
})

// Reads a pasted procedural order into proposed steps. Nothing is saved.
arbitrationRoutes.post('/case/:id/timetable/read', jsonBody(z.object({
  text: z.string().max(100_000).optional(),
  document_id: z.string().uuid().optional()
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  const arb = await requireArbitration(db, org.id, k.id)
  let text = (b.text ?? '').trim()
  if (b.document_id) {
    const [doc] = await db.query('SELECT content FROM documents WHERE id = $1 AND org_id = $2 AND case_id = $3', [b.document_id, org.id, k.id])
    if (!doc) throw badRequest('Choose a document from this matter.')
    text = (doc.content ?? '').trim()
  }
  if (text.length < 30) throw badRequest('Paste the procedural order or choose a document with readable text.')
  await assertCanUseAi(db, org)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
  const result = await ai.complete({ messages: timetableMessages(text, { today, ourSide: arb.our_side }), json: true, maxTokens: 2500, temperature: 0 })
  await recordAiUsage(db, org.id, user.id, 'arbitration_timetable', result)
  try {
    return c.json(normalizeTimetable(parseJsonObject(result.text)))
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI could not read this order. Please add the steps by hand.')
  }
})

// ----- Firm-wide register -----

arbitrationRoutes.get('/register', queryParams(z.object({
  show: z.enum(['active', 'all']).default('active'),
  format: z.enum(['json', 'csv']).default('json')
})), async (c) => {
  requireRole(c, ...readers)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const rows = await db.query(
    `SELECT ${ARB_COLS}, k.reference, k.title AS case_title, k.status AS case_status, cl.name AS client_name, u.name AS lawyer_name,
            (SELECT json_build_object('id', s.id, 'title', s.title, 'kind', s.kind, 'party', s.party, 'due_on', to_char(s.due_on, 'YYYY-MM-DD'), 'days_left', (s.due_on - ${GULF_TODAY})::int)
               FROM arbitration_steps s WHERE s.case_id = a.case_id AND s.done_on IS NULL AND s.${OURS} ORDER BY s.due_on LIMIT 1) AS next_step,
            (SELECT string_agg(m.name, ', ' ORDER BY array_position(ARRAY['sole','chair','co_arbitrator'], m.role)) FROM arbitration_members m
               WHERE m.case_id = a.case_id AND m.role IN ('sole', 'chair', 'co_arbitrator')) AS tribunal,
            EXISTS (SELECT 1 FROM arbitration_members m WHERE m.case_id = a.case_id AND m.role IN ('sole', 'chair')) AS presiding
       FROM arbitrations a JOIN cases k ON k.id = a.case_id LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE a.org_id = $1 AND ($2 = 'all' OR (a.award_on IS NULL AND a.award_result IS NULL AND k.status <> 'closed'))
      ORDER BY a.commenced_on DESC NULLS LAST LIMIT 2000`, [org.id, q.show])
  const items = rows.map(({ presiding, ...r }: any) => ({ ...r, stage: stage(r, presiding ? [{ role: 'chair' }] : []) }))
  items.sort((a: any, b: any) => (a.next_step?.due_on ?? '9999').localeCompare(b.next_step?.due_on ?? '9999'))
  if (q.format === 'csv') {
    await audit(c, 'arbitration.register_exported', 'organization', org.id, { rows: items.length })
    return new Response(toCsv([
      ['Reference', 'Matter', 'Client', 'Institution', 'Case no.', 'Seat', 'Acting for', 'Claimed', 'Counterclaim', 'Currency', 'Commenced', 'Tribunal', 'Next step', 'Due', 'Award', 'Result', 'Lawyer'],
      ...items.map((r: any) => [r.reference, r.case_title, r.client_name ?? '', INSTITUTION_NAME[r.institution as keyof typeof INSTITUTION_NAME], r.institution_ref ?? '', r.seat ?? '',
        r.our_side, r.amount_claimed ?? '', r.counterclaim ?? '', r.currency ?? '', r.commenced_on ?? '', r.tribunal ?? '', r.next_step?.title ?? '', r.next_step?.due_on ?? '',
        r.award_on ?? '', r.award_result ?? '', r.lawyer_name ?? ''])
    ]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="arbitrations.csv"', 'cache-control': 'private, no-store' } })
  }
  const [counts] = await db.query(
    `SELECT count(*) FILTER (WHERE s.due_on < ${GULF_TODAY})::int AS overdue,
            count(*) FILTER (WHERE s.due_on >= ${GULF_TODAY} AND s.due_on <= ${GULF_TODAY} + ${DUE_SOON_DAYS})::int AS due_soon
       FROM arbitration_steps s JOIN arbitrations a ON a.case_id = s.case_id
      WHERE s.org_id = $1 AND s.done_on IS NULL AND s.${OURS} AND a.award_on IS NULL AND a.award_result IS NULL`, [org.id])
  return c.json({ items, counts: { active: items.filter((r: any) => !r.award_on && !r.award_result && r.case_status !== 'closed').length, ...counts } })
})

// Our open timetable steps due within a week or overdue (for the dashboard).
export async function arbitrationStepsDue(db: Queryable, orgId: string) {
  const [r] = await db.query(
    `SELECT count(*)::int AS n FROM arbitration_steps s JOIN arbitrations a ON a.case_id = s.case_id
      WHERE s.org_id = $1 AND s.done_on IS NULL AND s.${OURS} AND a.award_on IS NULL AND a.award_result IS NULL AND s.due_on <= ${GULF_TODAY} + ${DUE_SOON_DAYS}`, [orgId])
  return r.n as number
}

export default arbitrationRoutes
