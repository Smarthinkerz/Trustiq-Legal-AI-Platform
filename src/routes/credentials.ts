import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, HttpError, notFound } from '../lib/errors'
import { jsonBody, optText, optUuid, queryParams, uuidParam } from '../lib/http'
import {
  casePowerOfAttorney, CREDENTIAL_COLUMNS, CREDENTIAL_KINDS, extractMessages, GULF_TODAY, normalizeExtraction
} from '../services/credentials'
import { parseJsonObject } from '../services/legal-prompts'
import { assertCanUseAi, recordAiUsage } from '../services/usage'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null)
const fields = {
  kind: z.enum(CREDENTIAL_KINDS),
  label: optText(200),
  number: optText(100),
  issued_by: optText(200),
  issued_on: day,
  expires_on: day,
  scope: optText(1000),
  all_cases: z.boolean(),
  case_ids: z.array(z.string().uuid()).max(100),
  document_id: optUuid,
  notes: optText(2000)
}
const createSchema = z.object({
  ...fields, client_id: z.string().uuid(), all_cases: fields.all_cases.default(true), case_ids: fields.case_ids.default([]),
  replaces: z.string().uuid().optional()
})
const updateSchema = z.object(fields).partial()
const editors = ['owner', 'admin', 'lawyer', 'staff'] as const

async function checkRefs(db: Queryable, orgId: string, clientId: string, b: { case_ids?: string[]; document_id?: string | null; issued_on?: string | null; expires_on?: string | null }) {
  if (b.issued_on && b.expires_on && b.expires_on < b.issued_on) throw badRequest('The expiry date is before the issue date.')
  if (b.case_ids?.length) {
    const ok = await db.query('SELECT id FROM cases WHERE org_id = $1 AND client_id = $2 AND id = ANY($3::uuid[])', [orgId, clientId, b.case_ids])
    if (ok.length !== new Set(b.case_ids).size) throw badRequest('Each selected case must belong to this client.')
  }
  if (b.document_id && !(await db.query('SELECT 1 FROM documents WHERE id = $1 AND org_id = $2', [b.document_id, orgId])).length) {
    throw badRequest('Selected document does not exist.')
  }
}

const withCases = async (db: Queryable, rows: any[]) => {
  if (!rows.length) return rows
  const links = await db.query(
    `SELECT x.credential_id, k.id, k.reference FROM client_credential_cases x JOIN cases k ON k.id = x.case_id WHERE x.credential_id = ANY($1::uuid[])`,
    [rows.map((r) => r.id)])
  return rows.map((r) => ({ ...r, cases: links.filter((l) => l.credential_id === r.id).map((l) => ({ id: l.id, reference: l.reference })) }))
}

const credentialsRoutes = new Hono<AppEnv>()

// One client's credentials, or (without client_id) everything needing attention across the firm.
credentialsRoutes.get('/', queryParams(z.object({
  client_id: z.string().uuid().optional(),
  attention: z.enum(['true', 'false']).optional()
})), async (c) => {
  const { org } = auth(c)
  const { client_id, attention } = c.req.valid('query')
  const { db } = c.get('deps')
  const conds = ['cc.org_id = $1']
  const params: unknown[] = [org.id]
  if (client_id) { params.push(client_id); conds.push(`cc.client_id = $${params.length}`) }
  if (attention === 'true') conds.push(`cc.revoked_at IS NULL AND cc.replaced_by IS NULL AND cl.archived_at IS NULL AND cc.expires_on <= ${GULF_TODAY} + 30`)
  const rows = await db.query(
    `SELECT ${CREDENTIAL_COLUMNS()}, cl.name AS client_name, d.title AS document_title
       FROM client_credentials cc JOIN clients cl ON cl.id = cc.client_id LEFT JOIN documents d ON d.id = cc.document_id
      WHERE ${conds.join(' AND ')}
      ORDER BY (cc.revoked_at IS NOT NULL OR cc.replaced_by IS NOT NULL), cc.expires_on NULLS LAST, cc.created_at DESC LIMIT 500`, params)
  return c.json({ items: await withCases(db, rows) })
})

credentialsRoutes.get('/case/:caseId', async (c) => {
  const { org } = auth(c)
  const poa = await casePowerOfAttorney(c.get('deps').db, org.id, uuidParam(c.req.param('caseId'), 'Case'))
  if (!poa) throw notFound('Case')
  return c.json(poa)
})

credentialsRoutes.post('/', jsonBody(createSchema), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  if (!(await db.query('SELECT 1 FROM clients WHERE id = $1 AND org_id = $2', [b.client_id, org.id])).length) throw badRequest('Selected client does not exist.')
  if (!b.all_cases && !b.case_ids.length) throw badRequest('Choose the cases this power of attorney covers, or mark it as covering all cases.')
  await checkRefs(db, org.id, b.client_id, b)
  const id = await db.tx(async (q) => {
    const [row] = await q.query(
      `INSERT INTO client_credentials (org_id, client_id, kind, label, number, issued_by, issued_on, expires_on, scope, all_cases, document_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [org.id, b.client_id, b.kind, b.label, b.number, b.issued_by, b.issued_on, b.expires_on, b.scope, b.all_cases, b.document_id, b.notes, user.id])
    if (!b.all_cases) for (const k of new Set(b.case_ids)) await q.query('INSERT INTO client_credential_cases (credential_id, case_id) VALUES ($1, $2)', [row.id, k])
    // Renewal: the old one is kept for the record but no longer counts.
    if (b.replaces) {
      const old = await q.query(`UPDATE client_credentials SET replaced_by = $1, updated_at = now() WHERE id = $2 AND org_id = $3 AND client_id = $4 AND replaced_by IS NULL RETURNING id`,
        [row.id, b.replaces, org.id, b.client_id])
      if (!old.length) throw badRequest('The credential being renewed was not found.')
    }
    return row.id as string
  })
  await audit(c, b.replaces ? 'credential.renewed' : 'credential.created', 'client_credential', id, { kind: b.kind, client_id: b.client_id })
  const [credential] = await withCases(db, await db.query(`SELECT ${CREDENTIAL_COLUMNS()} FROM client_credentials cc WHERE cc.id = $1`, [id]))
  return c.json({ credential }, 201)
})

credentialsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  requireRole(c, ...editors)
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Credential')
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const cur = await db.one(`SELECT client_id, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, to_char(expires_on, 'YYYY-MM-DD') AS expires_on FROM client_credentials WHERE id = $1 AND org_id = $2`, [id, org.id])
  if (!cur) throw notFound('Credential')
  await checkRefs(db, org.id, cur.client_id, { ...b, issued_on: b.issued_on !== undefined ? b.issued_on : cur.issued_on, expires_on: b.expires_on !== undefined ? b.expires_on : cur.expires_on })
  let links: { all: boolean; ids: string[] } | null = null
  if (b.all_cases !== undefined || b.case_ids !== undefined) {
    const ids = b.case_ids ?? (await db.query('SELECT case_id FROM client_credential_cases WHERE credential_id = $1', [id])).map((r) => r.case_id as string)
    const all = b.all_cases ?? !ids.length
    if (!all && !ids.length) throw badRequest('Choose the cases this power of attorney covers, or mark it as covering all cases.')
    links = { all, ids: all ? [] : [...new Set(ids)] }
  }
  await db.tx(async (q) => {
    const cols = ['kind', 'label', 'number', 'issued_by', 'issued_on', 'expires_on', 'scope', 'document_id', 'notes'] as const
    const sets: string[] = []
    const vals: unknown[] = [id]
    for (const col of cols) if (b[col] !== undefined) { vals.push(b[col]); sets.push(`${col} = $${vals.length}`) }
    if (links) { vals.push(links.all); sets.push(`all_cases = $${vals.length}`) }
    await q.query(`UPDATE client_credentials SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1`, vals)
    if (links) {
      await q.query('DELETE FROM client_credential_cases WHERE credential_id = $1', [id])
      for (const k of links.ids) await q.query('INSERT INTO client_credential_cases (credential_id, case_id) VALUES ($1, $2)', [id, k])
    }
  })
  await audit(c, 'credential.updated', 'client_credential', id, { fields: Object.keys(b) })
  const [credential] = await withCases(db, await db.query(`SELECT ${CREDENTIAL_COLUMNS()} FROM client_credentials cc WHERE cc.id = $1`, [id]))
  return c.json({ credential })
})

credentialsRoutes.post('/:id/revoke', jsonBody(z.object({ revoked: z.boolean().default(true) })), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Credential')
  const { revoked } = c.req.valid('json')
  const rows = await c.get('deps').db.query(
    `UPDATE client_credentials SET revoked_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING id`, [id, org.id, revoked])
  if (!rows.length) throw notFound('Credential')
  await audit(c, revoked ? 'credential.revoked' : 'credential.restored', 'client_credential', id)
  return c.json({ ok: true })
})

credentialsRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Credential')
  const rows = await c.get('deps').db.query('DELETE FROM client_credentials WHERE id = $1 AND org_id = $2 RETURNING kind', [id, org.id])
  if (!rows.length) throw notFound('Credential')
  await audit(c, 'credential.deleted', 'client_credential', id, { kind: rows[0].kind })
  return c.json({ ok: true })
})

// Pre-fills the form from an uploaded power of attorney or ID (its extracted / OCR text). Nothing is saved.
credentialsRoutes.post('/extract', jsonBody(z.object({ document_id: z.string().uuid() })), async (c) => {
  const { user, org } = auth(c)
  const { db, ai } = c.get('deps')
  const doc = await db.one('SELECT content FROM documents WHERE id = $1 AND org_id = $2', [c.req.valid('json').document_id, org.id])
  if (!doc) throw notFound('Document')
  if ((doc.content ?? '').trim().length < 20) throw badRequest('This document has no readable text. Upload a clearer copy or type the details.')
  await assertCanUseAi(db, org)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())
  const result = await ai.complete({ messages: extractMessages(doc.content, today), json: true, maxTokens: 800, temperature: 0 })
  await recordAiUsage(db, org.id, user.id, 'credential_extract', result)
  try {
    return c.json({ fields: normalizeExtraction(parseJsonObject(result.text)) })
  } catch {
    throw new HttpError(502, 'ai_bad_output', 'The AI could not read this document. Please type the details.')
  }
})

export default credentialsRoutes
