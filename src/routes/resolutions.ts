import { datesIn, numbersIn, parseDateText, unsupportedNumbers } from '../services/ai-guard'
import { logAiUse } from '../services/ai-log'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, uuidParam } from '../lib/http'
import { isCurrent, ownership, type Person } from '../services/corporate'
import { GULF_TODAY } from '../services/credentials'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { parseJsonObject } from '../services/legal-prompts'
import {
  APPLICABLE, BODIES, buildItems, itemsMessages, missingParams, normalizeItems, preamble, PURPOSES, renderResolutionDocx, type Body, type Item, type Params, type Signer
} from '../services/resolutions'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day.nullish().or(z.literal('')).transform((v) => v || null)
const optId = z.string().uuid().nullish().or(z.literal('')).transform((v) => v || null)
const editors = ['owner', 'admin', 'lawyer'] as const
const readers = ['owner', 'admin', 'lawyer', 'staff'] as const

const paramsShape = z.object({
  person_name: optText(300), person_name_ar: optText(300), nationality: optText(100), id_number: optText(100),
  authority: optText(1000), bank: optText(300), scope: optText(1000), address: optText(1000),
  period_end: optDay, effective_on: optDay, remove_person_id: optId, implementer_id: optId
}).partial().default({})
const itemShape = z.object({ en: z.string().trim().max(3000).default(''), ar: z.string().trim().max(3000).default('') })
const items = z.array(itemShape).max(20)

const COLS = `r.id, r.client_id, r.number, r.body, r.purpose, to_char(r.resolved_on, 'YYYY-MM-DD') AS resolved_on, r.place, r.params, r.items, r.signer_ids,
  r.status, to_char(r.signed_on, 'YYYY-MM-DD') AS signed_on, r.applied_at, r.notes, r.created_at, r.updated_at`
const PEOPLE_COLS = `id, name, name_ar, role, is_entity, nationality, id_number, shares::float8 AS shares, position, signing_authority,
  to_char(appointed_on, 'YYYY-MM-DD') AS appointed_on, to_char(ceased_on, 'YYYY-MM-DD') AS ceased_on`

async function gulfToday(db: Queryable) {
  const [{ d }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS d`)
  return d as string
}

// The company, its record and the people who can sign for each body.
async function company(db: Queryable, orgId: string, clientId: string) {
  const [cl] = await db.query('SELECT id, name, name_ar, kind FROM clients WHERE id = $1 AND org_id = $2', [clientId, orgId])
  if (!cl) throw notFound('Client')
  const [profile] = await db.query(`SELECT legal_form, jurisdiction, cr_number, total_shares::float8 AS total_shares, registered_address FROM corporate_profiles WHERE client_id = $1`, [cl.id])
  const people = await db.query(`SELECT ${PEOPLE_COLS} FROM corporate_people WHERE client_id = $1 AND org_id = $2 ORDER BY shares DESC NULLS LAST, name`, [cl.id, orgId]) as Person[]
  const today = await gulfToday(db)
  const current = people.filter((p) => isCurrent(p, today))
  const own = ownership(people, profile?.total_shares ?? null, today)
  const pct = new Map(own.holders.map((h) => [h.id, h.percent]))
  const eligible = (body: Body): Signer[] => current
    .filter((p) => (body === 'board' ? p.role === 'director' : p.role === 'shareholder'))
    .map((p) => ({ id: p.id, name: p.name, name_ar: p.name_ar, role: body === 'board' ? 'Director / عضو مجلس الإدارة' : 'Shareholder / شريك', percent: body === 'board' ? null : pct.get(p.id) ?? null }))
  return { client: cl, profile: profile ?? null, people, current, eligible, today }
}

function signersFor(co: Awaited<ReturnType<typeof company>>, body: Body, ids: string[] | null) {
  const all = co.eligible(body)
  const chosen = ids ? all.filter((s) => ids.includes(s.id)) : all
  const percent = body === 'board' ? null : Math.round(chosen.reduce((n, s) => n + (s.percent ?? 0), 0) * 100) / 100
  return { all, chosen, percent }
}

async function loadResolution(db: Queryable, orgId: string, id: string): Promise<any> {
  const [r] = await db.query(`SELECT ${COLS} FROM corporate_resolutions r WHERE r.id = $1 AND r.org_id = $2`, [id, orgId])
  if (!r) throw notFound('Resolution')
  return r
}

// Adds the preamble and the signers' share of the capital for display and printing.
function present(r: any, co: Awaited<ReturnType<typeof company>>) {
  const s = signersFor(co, r.body, r.signer_ids)
  const owner = r.body === 'sole_owner' ? s.chosen[0] ?? null : null
  return {
    ...r,
    signers: r.body === 'sole_owner' ? s.chosen.slice(0, 1) : s.chosen,
    percent_present: s.percent,
    preamble: preamble({ body: r.body, company: co.client.name, companyAr: co.client.name_ar || co.client.name, legalForm: co.profile?.legal_form ?? null,
      cr: co.profile?.cr_number ?? null, place: r.place, date: r.resolved_on, percent: s.percent, owner })
  }
}

const resolutionRoutes = new Hono<AppEnv>()

resolutionRoutes.get('/client/:id', async (c) => {
  requireRole(c, ...readers)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const co = await company(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  const rows = await db.query(`SELECT ${COLS} FROM corporate_resolutions r WHERE r.client_id = $1 AND r.org_id = $2 ORDER BY r.number DESC`, [co.client.id, org.id])
  return c.json({
    items: rows.map((r: any) => present(r, co)),
    eligible: { shareholders: co.eligible('shareholders'), board: co.eligible('board') },
    managers: co.current.filter((p) => p.role === 'manager' || p.role === 'director').map((p) => ({ id: p.id, name: p.name, role: p.role })),
    signatories: co.current.filter((p) => ['manager', 'director', 'signatory', 'shareholder'].includes(p.role)).map((p) => ({ id: p.id, name: p.name, role: p.role }))
  })
})

// Drafts a numbered resolution from a standard purpose (or the items given).
resolutionRoutes.post('/client/:id', jsonBody(z.object({
  body: z.enum(BODIES).default('shareholders'),
  purpose: z.enum(PURPOSES),
  resolved_on: day,
  place: optText(200),
  params: paramsShape,
  items: items.optional(),
  signer_ids: z.array(z.string().uuid()).max(100).nullish(),
  notes: optText(2000)
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const co = await company(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  const params = b.params as Params
  const missing = missingParams(b.purpose, params)
  if (missing.length) throw badRequest(`Fill in: ${missing.join(', ').replace(/_/g, ' ')}.`)
  const signers = signersFor(co, b.body, b.signer_ids ?? null)
  if (!signers.all.length) throw badRequest(b.body === 'board' ? 'Record the directors in the company record first.' : 'Record the shareholders in the company record first.')
  if (b.body === 'sole_owner' && signers.all.length !== 1) throw badRequest('A sole-owner resolution needs exactly one current shareholder.')
  if (!signers.chosen.length) throw badRequest('Choose at least one signer.')
  const find = (id: string | null | undefined) => (id ? co.current.find((p) => p.id === id) ?? null : null)
  const removed = find(params.remove_person_id)
  if (b.purpose === 'remove_manager' && (!removed || !['manager', 'director'].includes(removed.role))) throw badRequest('Choose a current manager or director of this company.')
  if (params.implementer_id && !find(params.implementer_id)) throw badRequest('Choose a current person of this company to implement the resolution.')
  let list: Item[] = buildItems(b.purpose, params, { removed, implementer: find(params.implementer_id) })
  if (b.items?.length) list = [...b.items.filter((x) => x.en || x.ar), ...list]
  if (!list.length) throw badRequest('Add at least one item to the resolution.')
  const id = await db.tx(async (q) => {
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('resolution:' || $1::text))`, [co.client.id])
    const [{ n }] = await q.query('SELECT COALESCE(max(number), 0) + 1 AS n FROM corporate_resolutions WHERE client_id = $1', [co.client.id])
    const [row] = await q.query(
      `INSERT INTO corporate_resolutions (org_id, client_id, number, body, purpose, resolved_on, place, params, items, signer_ids, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [org.id, co.client.id, n, b.body, b.purpose, b.resolved_on, b.place, JSON.stringify(params), JSON.stringify(list), JSON.stringify(b.signer_ids ?? null), b.notes, user.id])
    return row.id as string
  })
  await audit(c, 'resolution.created', 'client', co.client.id, { resolution: id, purpose: b.purpose })
  return c.json({ resolution: present(await loadResolution(db, org.id, id), co) }, 201)
})

// Edits a draft: date, place, wording or who signs.
resolutionRoutes.patch('/:id', jsonBody(z.object({
  resolved_on: day.optional(),
  place: optText(200).optional(),
  items: items.min(1).optional(),
  signer_ids: z.array(z.string().uuid()).max(100).nullish(),
  notes: optText(2000).optional()
})), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Resolution')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadResolution(db, org.id, id)
  const onlyNotes = Object.keys(b).every((k) => k === 'notes')
  if (cur.status === 'signed' && !onlyNotes) throw conflict('A signed resolution cannot be changed. Draft a new one instead.')
  const co = await company(db, org.id, cur.client_id)
  if (b.signer_ids !== undefined && b.signer_ids && !signersFor(co, cur.body, b.signer_ids).chosen.length) throw badRequest('Choose at least one signer.')
  const list = b.items ? b.items.filter((x) => x.en || x.ar) : cur.items
  if (!list.length) throw badRequest('Add at least one item to the resolution.')
  await db.query(
    `UPDATE corporate_resolutions SET resolved_on = $3, place = $4, items = $5, signer_ids = $6, notes = $7, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [id, org.id, b.resolved_on ?? cur.resolved_on, b.place !== undefined ? b.place : cur.place, JSON.stringify(list),
      JSON.stringify(b.signer_ids !== undefined ? b.signer_ids : cur.signer_ids), b.notes !== undefined ? b.notes : cur.notes])
  await audit(c, 'resolution.updated', 'client', cur.client_id, { resolution: id })
  return c.json({ resolution: present(await loadResolution(db, org.id, id), co) })
})

// Records the signature; optionally writes the change into the company record.
resolutionRoutes.post('/:id/sign', jsonBody(z.object({ signed_on: day, apply: z.boolean().default(false) })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Resolution')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await loadResolution(db, org.id, id)
  if (cur.status === 'signed') throw conflict('This resolution is already signed.')
  if (b.signed_on > (await gulfToday(db))) throw badRequest('The signing date is in the future.')
  if (b.signed_on < cur.resolved_on) throw badRequest('The signing date is before the resolution date.')
  // An AI draft marks details it was not given with [●]; a resolution cannot be signed with gaps.
  if ((cur.items as Item[]).some((x) => /\[\s*(●|•|\.\.\.|…)\s*\]/.test(`${x.en} ${x.ar}`))) {
    throw new HttpError(422, 'placeholders_left', 'Fill in every [●] placeholder before the resolution is signed.')
  }
  const applies = b.apply && (APPLICABLE as readonly string[]).includes(cur.purpose)
  const p = cur.params as Params
  const effective = p.effective_on || cur.resolved_on
  await db.tx(async (q) => {
    await q.query(`UPDATE corporate_resolutions SET status = 'signed', signed_on = $3, applied_at = CASE WHEN $4::boolean THEN now() ELSE NULL END, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [id, org.id, b.signed_on, applies])
    if (!applies) return
    if (cur.purpose === 'appoint_manager' || cur.purpose === 'authorise_signatory') {
      await q.query(
        `INSERT INTO corporate_people (org_id, client_id, name, name_ar, role, nationality, id_number, signing_authority, appointed_on, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [org.id, cur.client_id, p.person_name, p.person_name_ar ?? null, cur.purpose === 'appoint_manager' ? 'manager' : 'signatory', p.nationality ?? null, p.id_number ?? null,
          p.authority ?? null, effective, `Resolution no. ${cur.number}`, user.id])
    } else if (cur.purpose === 'remove_manager') {
      await q.query('UPDATE corporate_people SET ceased_on = $3, updated_at = now() WHERE id = $1 AND org_id = $2', [p.remove_person_id, org.id, effective])
    } else if (cur.purpose === 'change_address') {
      await q.query(
        `INSERT INTO corporate_profiles (client_id, org_id, registered_address, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id) DO UPDATE SET registered_address = $3, updated_by = $4, updated_at = now()`, [cur.client_id, org.id, p.address, user.id])
    }
  })
  await audit(c, 'resolution.signed', 'client', cur.client_id, { resolution: id, applied: applies })
  const co = await company(db, org.id, cur.client_id)
  return c.json({ resolution: present(await loadResolution(db, org.id, id), co) })
})

resolutionRoutes.delete('/:id', async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Resolution')
  const { db } = c.get('deps')
  const cur = await loadResolution(db, org.id, id)
  // A signed resolution is part of the company's history; only partners may remove it.
  if (cur.status === 'signed' && user.role === 'lawyer') throw conflict('A signed resolution can only be deleted by an owner or admin.')
  await db.query('DELETE FROM corporate_resolutions WHERE id = $1 AND org_id = $2', [id, org.id])
  await audit(c, 'resolution.deleted', 'client', cur.client_id, { resolution: id, number: cur.number, status: cur.status })
  return c.json({ ok: true })
})

resolutionRoutes.get('/:id/docx', async (c) => {
  requireRole(c, ...readers)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Resolution')
  const { db } = c.get('deps')
  const cur = await loadResolution(db, org.id, id)
  const co = await company(db, org.id, cur.client_id)
  const r = present(cur, co)
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const buf = await renderResolutionDocx({
    firmName: lh?.firm_name || org.name, letterhead: c.req.query('letterhead') === 'false' ? null : lh, number: r.number, body: r.body,
    preamble: r.preamble, items: r.items, signers: r.signers, company: co.client.name
  })
  await audit(c, 'resolution.printed', 'client', cur.client_id, { resolution: id })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`resolution-${r.number}-${co.client.name}.docx`), 'cache-control': 'private, no-store' }
  })
})

// AI drafts the items of a resolution from a plain description. Nothing is saved.
resolutionRoutes.post('/client/:id/ai', jsonBody(z.object({ description: z.string().trim().min(10).max(4000), body: z.enum(BODIES).default('shareholders') })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db, ai } = c.get('deps')
  const co = await company(db, org.id, uuidParam(c.req.param('id'), 'Client'))
  await assertCanUseAi(db, org)
  const result = await ai.complete({
    messages: itemsMessages(b.description, { body: b.body, company: co.client.name, legalForm: co.profile?.legal_form ?? null, jurisdiction: co.profile?.jurisdiction ?? null }),
    json: true, maxTokens: 1500, temperature: 0.2
  })
  await recordAiUsage(db, org.id, user.id, 'resolution_draft', result)
  let list: Item[] = []
  try { list = normalizeItems(parseJsonObject(result.text)) } catch { /* handled below */ }
  if (!list.length) {
    throw new HttpError(502, 'ai_bad_output', 'The AI could not draft this resolution. Please write the items yourself.')
  }
  // Figures (shares, amounts, dates, ID numbers) must come from the request; any other figure is
  // replaced with [●] for the lawyer to fill in.
  const given = numbersIn(b.description)
  const givenDates = new Set(datesIn(b.description).map((d) => d.date))
  let replaced = 0
  const clean = (text: string) => text.replace(/[\d٠-٩۰-۹][\d٠-٩۰-۹,٬.٫\/-]*/g, (m) => {
    const asDate = /[\/-]/.test(m) ? parseDateText(m) : null
    if (asDate ? givenDates.has(asDate) : !unsupportedNumbers(m, given).length) return m
    replaced++
    return '[●]'
  })
  const items = list.map((x) => ({ en: clean(x.en), ar: clean(x.ar) }))
  await logAiUse(db, { orgId: org.id, userId: user.id, feature: 'resolution_draft', model: result.model, prompt: b.description, output: JSON.stringify(items),
    verification: { status: replaced ? 'passed_with_warnings' : 'passed', errors: 0, warnings: replaced,
      checks: replaced ? [{ kind: 'figure', severity: 'warning', ok: false, code: 'figure_not_in_request', detail: `${replaced} figure(s) not in the request were replaced with [●].` }] : [] } })
  return c.json({ items, replaced })
})

export default resolutionRoutes
