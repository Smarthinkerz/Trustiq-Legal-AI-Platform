import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Db, Queryable } from '../db'
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors'
import { jsonBody, uuidParam } from '../lib/http'
import { defaultLaw, letterStatus, renderEngagementLetter, scopeMessages, termsSchema } from '../services/engagement'
import { parseJsonObject } from '../services/legal-prompts'
import { jurisdictionName } from '../services/reference'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { insertDocument } from './documents'

// Engagement letters for a matter: generated from its fee terms, signed through e-signatures.
const engagementRoutes = new Hono<AppEnv>()
const editors = ['owner', 'admin', 'lawyer'] as const

async function loadCase(db: Db, orgId: string, id: string) {
  const k = await db.one(
    `SELECT k.id, k.reference, k.title, k.title_ar, k.client_id, k.jurisdiction, k.currency, k.fee_arrangement, k.fee_amount::float8 AS fee_amount,
            k.description, k.practice_area, k.opposing_party, k.court,
            cl.name AS client_name, cl.name_ar AS client_name_ar, cl.address AS client_address, cl.language AS client_language,
            u.name AS lawyer_name, u.hourly_rate::float8 AS lawyer_rate
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id LEFT JOIN users u ON u.id = k.assigned_to
      WHERE k.id = $1 AND k.org_id = $2`, [id, orgId])
  if (!k) throw notFound('Case')
  return k
}

export async function caseLetters(db: Queryable, orgId: string, caseId: string) {
  const rows = await db.query(
    `SELECT e.id, e.document_id, e.language, e.terms, e.created_at, u.name AS created_by_name, d.title AS document_title,
            s.id AS signature_id, s.status AS signature_status, s.expires_at, s.completed_at
       FROM engagement_letters e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN documents d ON d.id = e.document_id
       LEFT JOIN LATERAL (SELECT id, status, expires_at, completed_at FROM signature_requests r
                           WHERE r.document_id = e.document_id AND r.org_id = e.org_id ORDER BY r.created_at DESC LIMIT 1) s ON true
      WHERE e.case_id = $1 AND e.org_id = $2 ORDER BY e.created_at DESC LIMIT 20`, [caseId, orgId])
  return rows.map((r: any) => ({
    id: r.id, document_id: r.document_id, document_title: r.document_title, language: r.language, terms: r.terms,
    created_at: r.created_at, created_by_name: r.created_by_name, signature_id: r.signature_id, completed_at: r.completed_at,
    status: r.document_id ? letterStatus(r.signature_id ? { status: r.signature_status, expires_at: r.expires_at } : null) : 'deleted'
  }))
}

engagementRoutes.get('/case/:id', async (c) => {
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, id)
  const o = await db.one('SELECT vat_rate::float8 AS vat_rate, payment_terms_days, default_hourly_rate::float8 AS default_hourly_rate, default_jurisdiction FROM organizations WHERE id = $1', [org.id])
  const letters = await caseLetters(db, org.id, id)
  const last = letters[0]?.terms
  const defaults = last ?? {
    scope: '', exclusions: '', fee_arrangement: k.fee_arrangement, currency: k.currency,
    hourly_rate: k.lawyer_rate ?? o?.default_hourly_rate ?? null,
    fixed_fee: k.fee_arrangement === 'fixed' ? k.fee_amount : null,
    cap_amount: k.fee_arrangement === 'capped' ? k.fee_amount : null,
    contingency_percent: null, retainer_amount: null,
    payment_terms_days: o?.payment_terms_days ?? 30, vat_rate: o?.vat_rate ?? 0,
    law: defaultLaw(k.jurisdiction, o?.default_jurisdiction ?? null),
    signatory_name: k.lawyer_name ?? user.name, notes: ''
  }
  return c.json({
    case: { id: k.id, reference: k.reference, title: k.title, client_id: k.client_id, client_name: k.client_name },
    language: letters[0]?.language ?? k.client_language ?? 'en',
    defaults, letters,
    status: letters.find((l: any) => l.status === 'signed') ? 'signed' : letters[0]?.status ?? 'none'
  })
})

engagementRoutes.post('/case/:id', jsonBody(z.object({
  language: z.enum(['en', 'ar']).default('en'),
  terms: termsSchema,
  update_case: z.boolean().default(true)
})), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { language, terms, update_case } = c.req.valid('json')
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, id)
  if (!k.client_id) throw badRequest('Link this matter to a client before preparing an engagement letter.')
  const brand = await db.one('SELECT firm_name, firm_name_ar, address FROM branding WHERE org_id = $1', [org.id])
  const ar = language === 'ar'
  const letter = renderEngagementLetter(language, {
    firm: (ar ? brand?.firm_name_ar : null) || brand?.firm_name || org.name,
    firmAddress: brand?.address,
    client: (ar ? k.client_name_ar : null) || k.client_name,
    clientAddress: k.client_address,
    caseRef: k.reference,
    caseTitle: (ar ? k.title_ar : null) || k.title,
    lawyer: k.lawyer_name ?? user.name
  }, terms)
  const result = await db.tx(async (q) => {
    const doc = await insertDocument(q, {
      orgId: org.id, userId: user.id, title: letter.title.slice(0, 300), docType: 'contract', language, jurisdiction: k.jurisdiction,
      source: 'manual', content: letter.content, caseId: k.id, clientId: k.client_id
    })
    const row = await q.one(
      `INSERT INTO engagement_letters (org_id, case_id, client_id, document_id, language, terms, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [org.id, k.id, k.client_id, doc.id, language, JSON.stringify(terms), user.id])
    if (update_case) {
      const fee = terms.fee_arrangement === 'fixed' ? terms.fixed_fee : terms.fee_arrangement === 'capped' ? terms.cap_amount : null
      await q.query(`UPDATE cases SET fee_arrangement = $3, fee_amount = CASE WHEN $4::boolean THEN $5::numeric ELSE fee_amount END, updated_at = now() WHERE id = $1 AND org_id = $2`,
        [k.id, org.id, terms.fee_arrangement, fee != null, fee])
    }
    return { id: row!.id as string, document: doc }
  })
  await audit(c, 'engagement.created', 'case', k.id, { letter: result.id, fee_arrangement: terms.fee_arrangement })
  return c.json({ id: result.id, document: result.document }, 201)
})

// AI drafts the scope and exclusions from the matter details; the lawyer edits before generating.
engagementRoutes.post('/case/:id/scope', jsonBody(z.object({ language: z.enum(['en', 'ar']).default('en') })), async (c) => {
  requireRole(c, ...editors)
  const { user, org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Case')
  const { language } = c.req.valid('json')
  const deps = c.get('deps')
  const { db, ai } = deps
  const k = await loadCase(db, org.id, id)
  if (!deps.limiters.ai.take(user.id).ok) throw tooMany('You are sending AI requests too quickly. Please wait a moment.')
  await assertCanUseAi(db, org)
  const out = await ai.complete({
    messages: scopeMessages({ lang: language, caseTitle: (language === 'ar' ? k.title_ar : null) || k.title, description: k.description, practiceArea: k.practice_area, opposingParty: k.opposing_party, court: k.court, jurisdiction: jurisdictionName(k.jurisdiction) }),
    json: true, maxTokens: 1500, temperature: 0.2
  })
  await recordAiUsage(db, org.id, user.id, 'engagement_scope', out)
  let r: any
  try { r = parseJsonObject(out.text) } catch { throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable answer. Please try again.') }
  const scope = typeof r?.scope === 'string' ? r.scope.trim().slice(0, 8000) : ''
  if (!scope) throw new HttpError(502, 'ai_bad_output', 'The AI returned an unreadable answer. Please try again.')
  return c.json({ scope, exclusions: typeof r?.exclusions === 'string' ? r.exclusions.trim().slice(0, 4000) : '' })
})

export default engagementRoutes
