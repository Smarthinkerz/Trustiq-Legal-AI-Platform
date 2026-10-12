import type { Config } from '../config'
import type { Deps } from '../context'
import type { Queryable } from '../db'
import { open, seal } from '../lib/secret-box'
import { when, zoneFor } from './hearings'
import { paymentSecret, ensurePayToken, payUrl, outstanding, supportsOnline } from './invoice-payments'

// ---------------------------------------------------------------------------
// WhatsApp reminders to clients through the firm's own WhatsApp Business
// number (Meta WhatsApp Cloud API). Messages the firm starts must use templates
// approved by Meta, so each reminder is a fixed template with parameters, and
// only clients who agreed to WhatsApp reminders receive them.
// ---------------------------------------------------------------------------

export const GRAPH = 'https://graph.facebook.com/v21.0'
export const WA_KINDS = ['hearing', 'invoice', 'documents'] as const
export type WaKind = (typeof WA_KINDS)[number]
type Lang = 'en' | 'ar'

// The texts firms submit to Meta for approval (category: Utility). {{n}} are the parameters we fill in.
export const TEMPLATES: Record<WaKind, { name: string; params: number; en: string; ar: string }> = {
  hearing: {
    name: 'hearing_reminder', params: 5,
    en: 'Hello {{1}}, this is a reminder from {{2}} that the hearing in your matter {{3}} is on {{4}} at {{5}}. Please contact us if you have any questions.',
    ar: 'مرحباً {{1}}، نذكّركم من {{2}} بأن جلسة قضيتكم {{3}} موعدها {{4}} في {{5}}. يُرجى التواصل معنا لأي استفسار.'
  },
  invoice: {
    name: 'invoice_reminder', params: 6,
    en: 'Hello {{1}}, invoice {{2}} from {{3}} for {{4}} was due on {{5}}. You can view and pay it here: {{6}}',
    ar: 'مرحباً {{1}}، الفاتورة رقم {{2}} من {{3}} بمبلغ {{4}} كانت مستحقة بتاريخ {{5}}. يمكنكم الاطلاع عليها وسدادها من هنا: {{6}}'
  },
  documents: {
    name: 'documents_reminder', params: 5,
    en: 'Hello {{1}}, {{2}} is still waiting for these documents for "{{3}}": {{4}}. You can upload them securely here: {{5}}',
    ar: 'مرحباً {{1}}، ما زال {{2}} بانتظار المستندات التالية لطلب "{{3}}": {{4}}. يمكنكم رفعها بأمان من هنا: {{5}}'
  }
}

export type WaSettings = Record<WaKind, { enabled: boolean; template: string }>
export const waSettings = (raw: any): WaSettings =>
  Object.fromEntries(WA_KINDS.map((k) => [k, {
    enabled: raw?.[k]?.enabled !== false,
    template: typeof raw?.[k]?.template === 'string' && raw[k].template ? raw[k].template : TEMPLATES[k].name
  }])) as WaSettings

// Country calling codes for numbers written in local format.
const DIAL: Record<string, string> = {
  oman: '968', uae: '971', difc: '971', adgm: '971', ksa: '966', qatar: '974', kuwait: '965', bahrain: '973',
  egypt: '20', jordan: '962', lebanon: '961', iraq: '964', morocco: '212', tunisia: '216', algeria: '213', libya: '218'
}
const KNOWN = Object.values(DIAL)

// E.164 digits without "+", or null when the number cannot be a mobile number we can message.
export function normalizePhone(raw: string | null | undefined, jurisdiction: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  let d = s.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1).replace(/\+/g, '')
  else if (d.startsWith('00')) d = d.slice(2)
  else if (!KNOWN.some((cc) => d.startsWith(cc) && d.length >= cc.length + 7)) {
    const cc = DIAL[jurisdiction ?? '']
    if (!cc) return null
    d = cc + d.replace(/^0+/, '')
  }
  d = d.replace(/\D/g, '')
  return /^[1-9]\d{7,14}$/.test(d) ? d : null
}

// Template parameters may not contain line breaks, tabs or long runs of spaces.
const param = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '-'

export type WaAccount = { phoneNumberId: string; token: string; displayPhone: string | null }

export function waAccount(config: Config, org: { wa_token_sealed?: string | null; wa_phone_number_id?: string | null; wa_display_phone?: string | null }): WaAccount | null {
  const secret = paymentSecret(config)
  if (!org.wa_token_sealed || !org.wa_phone_number_id || !secret) return null
  const token = open(org.wa_token_sealed, secret)
  return token ? { phoneNumberId: org.wa_phone_number_id, token, displayPhone: org.wa_display_phone ?? null } : null
}

export const sealWaToken = (config: Config, token: string) => seal(token, paymentSecret(config)!)

export class WaError extends Error {
  constructor(message: string, public status: number, public code?: number) { super(message) }
}

async function graph(fetchImpl: typeof fetch, token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  let res: Response
  try {
    res = await fetchImpl(`${GRAPH}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new WaError('WhatsApp could not be reached. Please try again.', 503)
  }
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new WaError(String(data?.error?.message ?? `WhatsApp returned HTTP ${res.status}`).slice(0, 300), res.status, data?.error?.code)
  return data
}

// Checks the token and phone number ID together and returns the number as WhatsApp shows it.
export async function verifyWaAccount(fetchImpl: typeof fetch, phoneNumberId: string, token: string) {
  const d = await graph(fetchImpl, token, `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`)
  return { display_phone: String(d.display_phone_number ?? ''), verified_name: String(d.verified_name ?? '') }
}

export async function sendTemplate(fetchImpl: typeof fetch, acct: WaAccount, to: string, template: string, language: Lang, params: unknown[]) {
  const d = await graph(fetchImpl, acct.token, `/${encodeURIComponent(acct.phoneNumberId)}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template, language: { code: language }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: param(p) })) }] }
    }
  })
  return String(d?.messages?.[0]?.id ?? '')
}

// Sample values for a test message, so firms can check each approved template.
export function sampleParams(kind: WaKind, lang: Lang, firm: string, appUrl: string): string[] {
  const ar = lang === 'ar'
  if (kind === 'hearing') return [ar ? 'أحمد' : 'Ahmed', firm, '2026-0001', ar ? 'الأحد 1 نوفمبر 2026، 09:00' : 'Sunday 1 November 2026, 09:00', ar ? 'المحكمة الابتدائية' : 'Primary Court']
  if (kind === 'invoice') return [ar ? 'أحمد' : 'Ahmed', 'INV-2026-0001', firm, '105.000 OMR', '2026-10-01', `${appUrl}/app`]
  return [ar ? 'أحمد' : 'Ahmed', firm, ar ? 'مستندات الإقامة' : 'Residency documents', ar ? 'نسخة جواز السفر' : 'Passport copy', `${appUrl}/app#/portal`]
}

// ---------------------------------------------------------------------------
// The reminder run (every 15 minutes). Each message is claimed in
// whatsapp_messages before it is sent, so several app instances never send twice.
// ---------------------------------------------------------------------------

type RunDeps = Pick<Deps, 'db' | 'config' | 'log' | 'waFetch'>
const MAX_PER_RUN = 200

async function clientLanguage(db: Queryable, c: { id: string; language: string | null }): Promise<Lang> {
  if (c.language === 'ar' || c.language === 'en') return c.language
  const [u] = await db.query(`SELECT locale FROM users WHERE client_id = $1 AND role = 'client' AND deactivated_at IS NULL ORDER BY created_at LIMIT 1`, [c.id])
  return u?.locale === 'en' ? 'en' : 'ar'
}

async function deliver(deps: RunDeps, acct: WaAccount, v: {
  orgId: string; clientId: string; kind: WaKind; entityId: string; ref: string; phone: string; template: string; lang: Lang; params: unknown[]
}) {
  const { db, log } = deps
  const claimed = await db.query(
    `INSERT INTO whatsapp_messages (org_id, client_id, kind, entity_id, ref, to_phone, template, language) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING RETURNING id`, [v.orgId, v.clientId, v.kind, v.entityId, v.ref, v.phone, v.template, v.lang])
  if (!claimed.length) return false
  try {
    const wamid = await sendTemplate(deps.waFetch ?? fetch, acct, v.phone, v.template, v.lang, v.params)
    await db.query(`UPDATE whatsapp_messages SET status = 'sent', wamid = $2 WHERE id = $1`, [claimed[0].id, wamid])
    return true
  } catch (err) {
    log.warn('whatsapp reminder failed', { kind: v.kind, err: (err as Error).message })
    await db.query(`UPDATE whatsapp_messages SET status = 'failed', error = $2 WHERE id = $1`, [claimed[0].id, (err as Error).message.slice(0, 500)])
    return false
  }
}

export async function runWhatsAppReminders(deps: RunDeps, now = new Date()) {
  const { db, config } = deps
  const orgs = await db.query(
    `SELECT o.id, o.name, o.default_jurisdiction, o.wa_token_sealed, o.wa_phone_number_id, o.wa_display_phone, o.wa_settings, o.tap_secret_sealed, b.firm_name, b.firm_name_ar
       FROM organizations o LEFT JOIN branding b ON b.org_id = o.id
      WHERE o.wa_token_sealed IS NOT NULL AND (o.plan_expires_at IS NULL OR o.plan_expires_at > now() OR o.plan = 'trial')`)
  let sent = 0
  for (const org of orgs) {
    const acct = waAccount(config, org)
    if (!acct) continue
    const s = waSettings(org.wa_settings)
    const firm = (lang: Lang) => (lang === 'ar' ? org.firm_name_ar || org.firm_name : org.firm_name) || org.name
    const target = async (c: any) => {
      const phone = normalizePhone(c.phone, org.default_jurisdiction)
      return phone ? { phone, lang: await clientLanguage(db, c), name: c.name } : null
    }
    const clientName = (c: Record<string, any>, lang: Lang) => (lang === 'ar' ? c.name_ar || c.name : c.name)

    if (s.hearing.enabled) {
      // A day ahead (between 2 and 26 hours before). A rescheduled hearing gets a new reminder.
      const rows = await db.query(
        `SELECT e.id, e.starts_at, e.all_day, e.location, k.reference, k.court, k.jurisdiction, cl.id AS client_id, cl.name, cl.name_ar, cl.phone, cl.language
           FROM events e JOIN cases k ON k.id = e.case_id JOIN clients cl ON cl.id = k.client_id
          WHERE e.org_id = $1 AND e.kind = 'hearing' AND e.completed_at IS NULL AND cl.whatsapp_opt_in_at IS NOT NULL AND cl.archived_at IS NULL
            AND e.starts_at BETWEEN $2::timestamptz + interval '2 hours' AND $2::timestamptz + interval '26 hours'
            AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.kind = 'hearing' AND m.entity_id = e.id AND m.ref = to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI'))
          LIMIT 100`, [org.id, now])
      for (const r of rows) {
        if (sent >= MAX_PER_RUN) return sent
        const to = await target({ ...r, id: r.client_id })
        if (!to) continue
        const at = when(new Date(r.starts_at), to.lang, zoneFor(r.jurisdiction), r.all_day)
        const place = r.location || r.court || (to.lang === 'ar' ? 'المحكمة' : 'the court')
        if (await deliver(deps, acct, {
          orgId: org.id, clientId: r.client_id, kind: 'hearing', entityId: r.id, ref: new Date(r.starts_at).toISOString().slice(0, 16),
          phone: to.phone, template: s.hearing.template, lang: to.lang, params: [clientName(r, to.lang), firm(to.lang), r.reference, at, place]
        })) sent++
      }
    }

    if (s.invoice.enabled) {
      // Overdue invoices: the day after the due date, then weekly, at most three times.
      const rows = await db.query(
        `SELECT i.id, i.number, i.total, i.amount_paid, i.currency, i.due_date, cl.id AS client_id, cl.name, cl.name_ar, cl.phone, cl.language,
                (SELECT count(*)::int FROM whatsapp_messages m WHERE m.kind = 'invoice' AND m.entity_id = i.id) AS reminders,
                (SELECT max(created_at) FROM whatsapp_messages m WHERE m.kind = 'invoice' AND m.entity_id = i.id) AS last_at
           FROM invoices i JOIN clients cl ON cl.id = i.client_id
          WHERE i.org_id = $1 AND i.status = 'issued' AND i.due_date < ($2::timestamptz)::date AND i.total > i.amount_paid
            AND cl.whatsapp_opt_in_at IS NOT NULL AND cl.archived_at IS NULL
          LIMIT 200`, [org.id, now])
      const online = !!org.tap_secret_sealed
      for (const r of rows) {
        if (sent >= MAX_PER_RUN) return sent
        if (r.reminders >= 3 || (r.last_at && now.getTime() - new Date(r.last_at).getTime() < 7 * 86400_000)) continue
        const to = await target({ ...r, id: r.client_id })
        if (!to) continue
        const link = online && supportsOnline(r.currency)
          ? payUrl(config, await ensurePayToken(db, org.id, r.id)) : `${config.appUrl}/app#/portal`
        if (await deliver(deps, acct, {
          orgId: org.id, clientId: r.client_id, kind: 'invoice', entityId: r.id, ref: `n${r.reminders + 1}`, phone: to.phone,
          template: s.invoice.template, lang: to.lang,
          params: [clientName(r, to.lang), r.number, firm(to.lang), `${outstanding(r)} ${r.currency}`, new Date(r.due_date).toISOString().slice(0, 10), link]
        })) sent++
      }
    }

    if (s.documents.enabled) {
      // Open document requests the client has not finished: after 3 days, then every 4 days, at most three times.
      const rows = await db.query(
        `SELECT r.id, r.title, cl.id AS client_id, cl.name, cl.name_ar, cl.phone, cl.language,
                (SELECT string_agg(i.label, ', ' ORDER BY i.position) FROM document_request_items i WHERE i.request_id = r.id AND i.status IN ('pending', 'rejected')) AS missing,
                (SELECT count(*)::int FROM whatsapp_messages m WHERE m.kind = 'documents' AND m.entity_id = r.id) AS reminders,
                (SELECT max(created_at) FROM whatsapp_messages m WHERE m.kind = 'documents' AND m.entity_id = r.id) AS last_at
           FROM document_requests r JOIN clients cl ON cl.id = r.client_id
          WHERE r.org_id = $1 AND r.status = 'open' AND r.created_at < $2::timestamptz - interval '3 days'
            AND cl.whatsapp_opt_in_at IS NOT NULL AND cl.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM users u WHERE u.client_id = cl.id AND u.role = 'client' AND u.deactivated_at IS NULL)
          LIMIT 200`, [org.id, now])
      for (const r of rows) {
        if (sent >= MAX_PER_RUN) return sent
        if (!r.missing || r.reminders >= 3 || (r.last_at && now.getTime() - new Date(r.last_at).getTime() < 4 * 86400_000)) continue
        const to = await target({ ...r, id: r.client_id })
        if (!to) continue
        if (await deliver(deps, acct, {
          orgId: org.id, clientId: r.client_id, kind: 'documents', entityId: r.id, ref: `n${r.reminders + 1}`, phone: to.phone,
          template: s.documents.template, lang: to.lang, params: [clientName(r, to.lang), firm(to.lang), r.title, r.missing, `${config.appUrl}/app#/portal`]
        })) sent++
      }
    }
  }
  return sent
}
