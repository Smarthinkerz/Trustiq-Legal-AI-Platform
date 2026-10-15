import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { jsonBody, optText, queryParams, uuidParam } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { ACCEPTED_TYPES } from '../services/extract'
import { contentDisposition } from '../services/export'
import { missingDetails, poaText, renderPoaDocx, SCOPES, SPECIAL, type Special } from '../services/poa'
import { caseActivity } from './cases'

const staff = ['owner', 'admin', 'lawyer', 'staff'] as const

async function loadClient(db: Queryable, orgId: string, id: string) {
  const [cl] = await db.query('SELECT id, kind, name, name_ar, id_number FROM clients WHERE id = $1 AND org_id = $2', [id, orgId])
  if (!cl) throw notFound('Client')
  return cl
}

// Who can sign for a company client: its current managers, directors and signatories.
async function representatives(db: Queryable, orgId: string, clientId: string) {
  return db.query(
    `SELECT id, name, name_ar, role, id_number FROM corporate_people
      WHERE client_id = $1 AND org_id = $2 AND role IN ('manager', 'director', 'signatory') AND (ceased_on IS NULL OR ceased_on > ${GULF_TODAY})
      ORDER BY array_position(ARRAY['manager','director','signatory'], role), name`, [clientId, orgId])
}

const poaRoutes = new Hono<AppEnv>()

// Everything the drafting form needs: the client, the matter, who can sign and the firm's advocates.
poaRoutes.get('/options', queryParams(z.object({ client_id: z.string().uuid(), case_id: z.string().uuid().optional() })), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, q.client_id)
  const [kase] = q.case_id ? await db.query('SELECT id, reference, title, court, opposing_party FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [q.case_id, org.id, cl.id]) : []
  if (q.case_id && !kase) throw notFound('Case')
  const [profile] = await db.query('SELECT cr_number FROM corporate_profiles WHERE client_id = $1', [cl.id])
  const lawyers = await db.query(`SELECT id, name, name_ar, bar_number FROM users WHERE org_id = $1 AND role IN ('owner', 'admin', 'lawyer') AND deactivated_at IS NULL ORDER BY name`, [org.id])
  return c.json({ client: { ...cl, cr_number: profile?.cr_number ?? null }, case: kase ?? null, representatives: cl.kind === 'company' ? await representatives(db, org.id, cl.id) : [], lawyers })
})

// Saves a lawyer's Arabic name and advocate registration number (theirs, or anyone's for partners).
poaRoutes.put('/lawyers/:id', jsonBody(z.object({ name_ar: optText(200), bar_number: optText(60) })), async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Lawyer')
  if (id !== user.id && !['owner', 'admin'].includes(user.role)) throw forbidden()
  const b = c.req.valid('json')
  const { db } = c.get('deps')
  const [row] = await db.query(
    `UPDATE users SET name_ar = $3, bar_number = $4, updated_at = now() WHERE id = $1 AND org_id = $2 AND role IN ('owner', 'admin', 'lawyer') RETURNING id, name, name_ar, bar_number`,
    [id, org.id, b.name_ar, b.bar_number])
  if (!row) throw notFound('Lawyer')
  await audit(c, 'user.bar_details_updated', 'user', id)
  return c.json({ lawyer: row })
})

const csv = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])

// The bilingual draft as a Word file.
poaRoutes.get('/draft', queryParams(z.object({
  client_id: z.string().uuid(),
  case_id: z.string().uuid().optional(),
  scope: z.enum(SCOPES),
  agents: z.string().min(36).max(2000),
  special: z.string().max(200).optional(),
  substitute: z.enum(['true', 'false']).default('false'),
  representative_id: z.string().uuid().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  case_ref: z.string().trim().max(200).optional(),
  court: z.string().trim().max(200).optional(),
  opponent: z.string().trim().max(300).optional(),
  property: z.string().trim().max(500).optional(),
  debtor: z.string().trim().max(300).optional(),
  letterhead: z.enum(['true', 'false']).default('false')
})), async (c) => {
  requireRole(c, ...staff)
  const { org } = auth(c)
  const q = c.req.valid('query')
  const { db } = c.get('deps')
  const cl = await loadClient(db, org.id, q.client_id)
  if (q.case_id && !(await db.one('SELECT 1 FROM cases WHERE id = $1 AND org_id = $2 AND client_id = $3', [q.case_id, org.id, cl.id]))) throw notFound('Case')
  const special = csv(q.special)
  if (special.some((s) => !(SPECIAL as readonly string[]).includes(s))) throw badRequest('Unknown special power.')
  const ids = csv(q.agents).map((id) => uuidParam(id, 'Lawyer'))
  const agents = await db.query(`SELECT id, name, name_ar, bar_number FROM users WHERE id = ANY($1::uuid[]) AND org_id = $2 AND role IN ('owner', 'admin', 'lawyer') AND deactivated_at IS NULL ORDER BY name`, [ids, org.id])
  if (!agents.length || agents.length !== new Set(ids).size) throw badRequest('Choose the advocates of your firm to appoint.')
  const detail = { case_ref: q.case_ref, court: q.court, opponent: q.opponent, property: q.property, debtor: q.debtor }
  const missing = missingDetails(q.scope, detail)
  if (missing.length) throw badRequest(`Fill in: ${missing.join(', ').replace(/_/g, ' ')}.`)
  let rep: any = null
  if (cl.kind === 'company') {
    if (q.representative_id) {
      rep = (await representatives(db, org.id, cl.id)).find((r: any) => r.id === q.representative_id)
      if (!rep) throw badRequest('Choose a current manager, director or signatory of this company.')
    }
  }
  const [profile] = await db.query('SELECT cr_number FROM corporate_profiles WHERE client_id = $1', [cl.id])
  const lh: any = await db.one('SELECT * FROM branding WHERE org_id = $1', [org.id])
  const firm = lh?.firm_name || org.name
  const paras = poaText({
    principal: { kind: cl.kind, name: cl.name, name_ar: cl.name_ar, id_number: cl.kind === 'company' ? profile?.cr_number ?? cl.id_number : cl.id_number, rep },
    agents: agents as any[], firm, firmAr: lh?.firm_name_ar || firm, scope: q.scope, detail, special: special as Special[], substitute: q.substitute === 'true', validUntil: q.valid_until ?? null
  })
  const buf = await renderPoaDocx({
    firmName: firm, letterhead: q.letterhead === 'true' ? lh : null, title: { en: 'Power of attorney (draft)', ar: 'وكالة (مسودة)' }, paras,
    signer: rep ? `${rep.name}${cl.kind === 'company' ? ` – ${cl.name}` : ''}` : cl.name
  })
  if (q.case_id) await caseActivity(db, org.id, q.case_id, auth(c).user.id, 'poa', `Power of attorney draft prepared (${q.scope.replace(/_/g, ' ')}) naming ${agents.map((a: any) => a.name).join(', ')}`)
  await audit(c, 'poa.drafted', 'client', cl.id, { scope: q.scope, agents: agents.length, special })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': ACCEPTED_TYPES.docx, 'content-disposition': contentDisposition(`poa-draft-${cl.name}.docx`), 'cache-control': 'private, no-store' }
  })
})

export default poaRoutes
