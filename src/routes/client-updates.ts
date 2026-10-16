import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import type { Queryable } from '../db'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors'
import { jsonBody, queryParams, updateBody, uuidParam } from '../lib/http'
import { parseJsonObject } from '../services/legal-prompts'
import { assertCanUseAi, recordAiUsage } from '../services/usage'
import { gatherClientFacts, isolateDates, normalizeUpdate, updateMessages, updatesDue, UPDATE_EVERY_DAYS } from '../services/client-updates'
import { throttle } from './ai'
import { datesIn } from '../services/ai-guard'
import { logAiUse } from '../services/ai-log'
import { caseActivity } from './cases'
import { caseUpdateWhatsApp, sendCaseUpdateWhatsApp, type CaseUpdateWa } from '../services/whatsapp'

// Client updates on a matter: drafts (AI or by hand), then published to the portal.
const clientUpdateRoutes = new Hono<AppEnv>()
const writers = ['owner', 'admin', 'lawyer'] as const
const COLUMNS = `u.id, u.case_id, u.language, u.title, u.body, u.status, u.ai_drafted, u.published_at, u.emailed, u.read_at, u.created_at, u.updated_at,
  (SELECT w.status FROM whatsapp_messages w WHERE w.kind = 'case_update' AND w.entity_id = u.id LIMIT 1) AS whatsapp_status,
  cu.name AS created_by_name, pu.name AS published_by_name`
const FROM = `case_updates u LEFT JOIN users cu ON cu.id = u.created_by LEFT JOIN users pu ON pu.id = u.published_by`

async function loadCase(db: Queryable, orgId: string, id: string) {
  const [k] = await db.query(
    `SELECT k.id, k.reference, k.title, k.client_id, cl.language AS client_language,
            EXISTS (SELECT 1 FROM users p WHERE p.client_id = k.client_id AND p.role = 'client' AND p.deactivated_at IS NULL) AS has_portal
       FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id WHERE k.id = $1 AND k.org_id = $2`, [id, orgId])
  if (!k) throw notFound('Case')
  return k
}

async function loadUpdate(db: Queryable, orgId: string, id: string) {
  const [u] = await db.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE u.id = $1 AND u.org_id = $2`, [id, orgId])
  if (!u) throw notFound('Update')
  return u
}

// Matters whose client has not had an update for a month (everyone's, or only mine).
clientUpdateRoutes.get('/due', queryParams(z.object({ mine: z.enum(['1', '0']).optional() })), async (c) => {
  const { user, org } = auth(c)
  const mine = c.req.valid('query').mine === '1' || user.role === 'staff' ? user.id : null
  const items = await updatesDue(c.get('deps').db, org.id, { userId: mine })
  return c.json({ items, every_days: UPDATE_EVERY_DAYS })
})

clientUpdateRoutes.get('/case/:id', async (c) => {
  const { org } = auth(c)
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  const items = await db.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE u.case_id = $1 AND u.org_id = $2 ORDER BY (u.status = 'draft') DESC, COALESCE(u.published_at, u.created_at) DESC`, [k.id, org.id])
  const last = items.find((u: any) => u.status === 'published')
  const days = last ? Math.floor((Date.now() - Date.parse(last.published_at)) / 86_400_000) : null
  // Whether publishing can also send a WhatsApp notice (portal clients only: the notice links to the portal).
  const wa = k.client_id && k.has_portal ? (await caseUpdateWhatsApp(db, c.get('deps').config, org.id, k.client_id)).status : null
  return c.json({ items, has_client: !!k.client_id, has_portal: k.has_portal, client_language: k.client_language, days_since: days, every_days: UPDATE_EVERY_DAYS,
    whatsapp: wa === 'ready' ? 'ready' : wa })
})

const draftShape = {
  language: z.enum(['en', 'ar']),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(10_000)
}

clientUpdateRoutes.post('/case/:id', jsonBody(z.object(draftShape)), async (c) => {
  requireRole(c, ...writers)
  const { user, org } = auth(c)
  const { db } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  if (!k.client_id) throw badRequest('This matter has no client to update.')
  const b = c.req.valid('json')
  const fix = (v: string) => (b.language === 'ar' ? isolateDates(v) : v)
  const [row] = await db.query(
    `INSERT INTO case_updates (org_id, case_id, language, title, body, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [org.id, k.id, b.language, fix(b.title), fix(b.body), user.id])
  return c.json({ update: await loadUpdate(db, org.id, row.id) }, 201)
})

// AI draft from what happened since the last update; saved as a draft for the lawyer to edit.
clientUpdateRoutes.post('/case/:id/draft', jsonBody(z.object({
  language: z.enum(['en', 'ar']).optional(),
  points: z.string().trim().max(3000).optional()
})), async (c) => {
  requireRole(c, ...writers)
  const { user, org } = auth(c)
  const { db, ai } = c.get('deps')
  const k = await loadCase(db, org.id, uuidParam(c.req.param('id'), 'Case'))
  if (!k.client_id) throw badRequest('This matter has no client to update.')
  const b = c.req.valid('json')
  const language = b.language ?? (k.client_language === 'en' ? 'en' : 'ar')
  const facts = (await gatherClientFacts(db, org.id, k.id))!
  throttle(c)
  await assertCanUseAi(db, org)
  const [firm] = await db.query('SELECT firm_name, firm_name_ar FROM branding WHERE org_id = $1', [org.id])
  const firmName = (language === 'ar' && firm?.firm_name_ar) || firm?.firm_name || org.name
  // Nothing new on the matter and no points from the lawyer: there is nothing true to write.
  if (!facts.facts && !b.points) {
    throw new HttpError(422, 'nothing_to_report', language === 'ar'
      ? 'لا توجد مستجدات مسجلة على هذه القضية منذ آخر تحديث. أضف نقاطاً لتستند إليها المسودة، أو اكتب التحديث بنفسك.'
      : 'Nothing new is recorded on this matter since the last update. Add points for the draft to use, or write the update yourself.')
  }
  // Every date in the draft must be a date in the matter record or the lawyer's points.
  const allowed = new Set([...datesIn(facts.text), ...datesIn(b.points ?? '')].map((d) => d.date))
  const badDates = (d: { title: string; body: string }) => datesIn(`${d.title}\n${d.body}`).filter((x) => !allowed.has(x.date))
  const messages = updateMessages(language, facts.text, b.points || null, firmName)
  const completions = []
  let draft = { title: '', body: '' }
  let bad: { raw: string; date: string }[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ai.complete({ messages: attempt === 0 ? messages : [...messages, { role: 'assistant', content: completions.at(-1)!.text },
      { role: 'user', content: `These dates are not in the matter record or the points: ${bad.map((x) => x.raw).join(', ')}. Rewrite the update using only dates that appear in <matter> or <points>. Return the full JSON again.` }],
      json: true, maxTokens: 1500, temperature: 0.1 })
    completions.push(r)
    let next = { title: '', body: '' }
    try { next = normalizeUpdate(parseJsonObject(r.text), language) } catch { /* unreadable reply */ }
    // An empty retry does not replace a first draft; that draft's date problems still stand.
    if (next.body.length < 10 && attempt > 0) break
    draft = next
    bad = badDates(draft)
    if (draft.body.length >= 10 && !bad.length) break
  }
  for (const r of completions) await recordAiUsage(db, org.id, user.id, 'client_update', r)
  const result = completions.at(-1)!
  if (draft.body.length < 10) throw new HttpError(502, 'ai_bad_output', 'The AI returned an empty update. Please try again.')
  if (bad.length) {
    throw new HttpError(422, 'unverified_dates', language === 'ar'
      ? `لم يُحفظ التحديث لأن فيه تواريخ غير موجودة في سجل القضية: ${bad.map((x) => x.raw).join('، ')}. اكتب التحديث بنفسك أو أضف النقاط الصحيحة.`
      : `The draft was not saved because it contained dates that are not in the matter record: ${bad.map((x) => x.raw).join(', ')}. Write the update yourself or add the correct points.`)
  }
  const title = draft.title.length >= 2 ? draft.title : `${language === 'ar' ? 'مستجدات القضية' : 'Update on your matter'} ${k.reference}`
  const id = await db.tx(async (q) => {
    const [row] = await q.query(
      `INSERT INTO case_updates (org_id, case_id, language, title, body, ai_drafted, created_by) VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
      [org.id, k.id, language, title, draft.body, user.id])
    await logAiUse(q, { orgId: org.id, userId: user.id, feature: 'client_update', model: result.model, caseId: k.id, prompt: b.points ? `Client update. Points: ${b.points}` : 'Client update',
      output: `${title}\n\n${draft.body}`, verification: { status: 'passed', errors: 0, warnings: 0, citations: 0, as_of: new Date().toISOString().slice(0, 10), checked_at: new Date().toISOString(),
        checks: [{ kind: 'quote', severity: 'info', ok: true, code: 'dates_in_record', detail: 'Every date in the draft is in the matter record or the lawyer\'s points.' }] } })
    return row.id as string
  })
  await audit(c, 'ai.client_update_drafted', 'case', k.id, { language, model: result.model })
  return c.json({ update: await loadUpdate(db, org.id, id), since: facts.since, facts: facts.facts }, 201)
})

clientUpdateRoutes.patch('/:id', jsonBody(updateBody(draftShape)), async (c) => {
  requireRole(c, ...writers)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const u = await loadUpdate(db, org.id, uuidParam(c.req.param('id'), 'Update'))
  if (u.status !== 'draft') throw conflict('A published update cannot be changed. Send a new update instead.')
  const b = c.req.valid('json') as Partial<{ language: string; title: string; body: string }>
  const fix = (v: string | undefined) => (v != null && (b.language ?? u.language) === 'ar' ? isolateDates(v) : v ?? null)
  await db.query(
    `UPDATE case_updates SET language = COALESCE($2, language), title = COALESCE($3, title), body = COALESCE($4, body), updated_at = now() WHERE id = $1`,
    [u.id, b.language ?? null, fix(b.title), fix(b.body)])
  return c.json({ update: await loadUpdate(db, org.id, u.id) })
})

clientUpdateRoutes.delete('/:id', async (c) => {
  requireRole(c, ...writers)
  const { org } = auth(c)
  const { db } = c.get('deps')
  const u = await loadUpdate(db, org.id, uuidParam(c.req.param('id'), 'Update'))
  if (u.status !== 'draft') throw conflict('A published update cannot be deleted.')
  await db.query('DELETE FROM case_updates WHERE id = $1', [u.id])
  return c.json({ ok: true })
})

// Publishes to the client portal and, optionally, emails the client's portal users.
clientUpdateRoutes.post('/:id/publish', jsonBody(z.object({ email: z.boolean().default(true), whatsapp: z.boolean().default(true), reviewed: z.boolean().default(false) })), async (c) => {
  requireRole(c, ...writers)
  const { user, org } = auth(c)
  const { db, mailer, config, log } = c.get('deps')
  const u = await loadUpdate(db, org.id, uuidParam(c.req.param('id'), 'Update'))
  if (u.status !== 'draft') throw conflict('This update has already been sent.')
  // An AI draft reaches the client only after the lawyer confirms they have checked it.
  if (u.ai_drafted && !c.req.valid('json').reviewed) throw badRequest('Confirm that you have checked this AI draft before sending it to the client.')
  const k = await loadCase(db, org.id, u.case_id)
  if (!k.client_id) throw badRequest('This matter has no client to update.')
  const claimed = await db.query(
    `UPDATE case_updates SET status = 'published', published_at = now(), published_by = $2, updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [u.id, user.id])
  if (!claimed.length) throw conflict('This update has already been sent.')
  await caseActivity(db, org.id, k.id, user.id, 'note', `Client update sent: ${u.title}`)
  let emailed = 0
  if (c.req.valid('json').email && mailer.configured) {
    // Portal users get a link to read it there; a client without portal access gets it at the email on file.
    const portalUsers = await db.query(`SELECT email, locale FROM users WHERE org_id = $1 AND client_id = $2 AND role = 'client' AND deactivated_at IS NULL AND notify_email`, [org.id, k.client_id])
    const recipients = portalUsers.length || k.has_portal ? portalUsers.map((r: any) => ({ ...r, portal: true }))
      : (await db.query(`SELECT email FROM clients WHERE id = $1 AND email IS NOT NULL AND email <> ''`, [k.client_id])).map((r: any) => ({ email: r.email, locale: u.language, portal: false }))
    const [firm] = await db.query('SELECT firm_name, firm_name_ar FROM branding WHERE org_id = $1', [org.id])
    for (const r of recipients.slice(0, 20)) {
      const ar = (r.locale ?? u.language) === 'ar'
      const firmName = (ar && firm?.firm_name_ar) || firm?.firm_name || org.name
      try {
        await mailer.send({
          to: r.email,
          subject: `${u.title} – ${firmName}`,
          text: `${u.title}\n${k.reference}\n\n${u.body}\n\n` + (r.portal
            ? `${ar ? 'يمكنكم الاطلاع على ملفكم والرد عبر بوابة الموكلين:' : 'View your matter and reply in your client portal:'}\n${config.appUrl}/app#/portal/cases/${k.id}`
            : `${firmName}`)
        })
        emailed++
      } catch (err) { log.warn('client update email failed', { err }) }
    }
    if (emailed) await db.query('UPDATE case_updates SET emailed = $2 WHERE id = $1', [u.id, emailed])
  }
  await audit(c, 'case.client_update_published', 'case', k.id, { update: u.id, emailed })
  let whatsapp: CaseUpdateWa | null = null
  if (c.req.valid('json').whatsapp && k.has_portal) {
    whatsapp = await sendCaseUpdateWhatsApp(c.get('deps'), { orgId: org.id, clientId: k.client_id, updateId: u.id, caseId: k.id, reference: k.reference, title: u.title })
  }
  if (whatsapp === 'sent' || whatsapp === 'failed') await audit(c, 'case.client_update_whatsapp', 'case', k.id, { update: u.id, status: whatsapp })
  return c.json({ update: await loadUpdate(db, org.id, u.id), emailed, whatsapp, has_portal: k.has_portal })
})

export default clientUpdateRoutes
