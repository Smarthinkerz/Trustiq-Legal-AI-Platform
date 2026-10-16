import { createHash } from 'node:crypto'
import type { Queryable } from '../db'
import type { Verification } from './verify'

// ---------------------------------------------------------------------------
// AI use and verification log, exportable per document. It records what an AI feature produced,
// from which library sources, what the automatic citation check found, and which lawyer then
// checked the output against primary sources: the disclosure and verification record that
// QICDRC Practice Direction No. 1 of 2026 (paragraph 26) contemplates for AI-assisted submissions.
// ---------------------------------------------------------------------------

export type LogSource = { ref?: string; citation: string; source_id?: string; chunk_id?: string; status?: string }

export async function logAiUse(q: Queryable, e: {
  orgId: string
  userId: string
  feature: string
  model?: string | null
  documentId?: string | null
  caseId?: string | null
  conversationId?: string | null
  messageId?: string | null
  jurisdiction?: string | null
  asOf?: string | null
  prompt?: string | null
  output: string
  sources?: LogSource[]
  verification?: Pick<Verification, 'status'> & Partial<Verification> | null
}): Promise<string> {
  const [row] = await q.query<{ id: string }>(
    `INSERT INTO ai_use_log (org_id, user_id, feature, model, document_id, case_id, conversation_id, message_id, jurisdiction, as_of, prompt_excerpt, output_sha256, sources, verification, output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [e.orgId, e.userId, e.feature, e.model ?? null, e.documentId ?? null, e.caseId ?? null, e.conversationId ?? null, e.messageId ?? null,
     e.jurisdiction ?? null, e.asOf ?? null, e.prompt ? e.prompt.slice(0, 1000) : null,
     createHash('sha256').update(e.output).digest('hex'), JSON.stringify(e.sources ?? []), e.verification ? JSON.stringify(e.verification) : null, e.output.slice(0, 100_000)])
  return row!.id
}

export const LOG_COLUMNS = `l.id, l.feature, l.model, l.document_id, d.title AS document_title, l.case_id, k.reference AS case_reference,
  l.conversation_id, l.message_id, l.jurisdiction, to_char(l.as_of, 'YYYY-MM-DD') AS as_of, l.prompt_excerpt, l.output_sha256, l.sources, l.verification,
  l.created_at, u.name AS user_name, l.reviewed_at, r.name AS reviewed_by_name, l.review_note`

export const LOG_FROM = `ai_use_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users r ON r.id = l.reviewed_by
  LEFT JOIN documents d ON d.id = l.document_id LEFT JOIN cases k ON k.id = l.case_id`

const FEATURE_NAMES: Record<string, { en: string; ar: string }> = {
  chat: { en: 'Legal research assistant', ar: 'مساعد البحث القانوني' },
  draft: { en: 'Document drafting', ar: 'صياغة المستند' },
  brief: { en: 'Case brief', ar: 'ملخص القضية' }
}
const featureName = (f: string, lang: 'en' | 'ar') => FEATURE_NAMES[f]?.[lang] ?? (f.startsWith('analysis:') ? (lang === 'ar' ? `تحليل المستند (${f.slice(9)})` : `Document analysis (${f.slice(9)})`) : f)

const STATUS_NAMES: Record<string, { en: string; ar: string }> = {
  passed: { en: 'Passed', ar: 'ناجح' },
  passed_with_warnings: { en: 'Passed with warnings', ar: 'ناجح مع تنبيهات' },
  failed: { en: 'Failed', ar: 'غير ناجح' },
  unverified: { en: 'No citations to check', ar: 'لا توجد استشهادات للتحقق' }
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v)
  // Neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function logCsv(rows: any[]): string {
  const head = ['created_at', 'feature', 'model', 'user', 'document', 'case', 'jurisdiction', 'as_of', 'prompt_excerpt', 'sources', 'check_status', 'check_errors', 'check_warnings', 'check_findings', 'reviewed_by', 'reviewed_at', 'review_note', 'output_sha256']
  const lines = [head.join(',')]
  for (const r of rows) {
    const v = r.verification as Verification | null
    lines.push([
      r.created_at, r.feature, r.model, r.user_name, r.document_title, r.case_reference, r.jurisdiction, r.as_of, r.prompt_excerpt,
      (r.sources ?? []).map((s: LogSource) => `${s.ref ? `[${s.ref}] ` : ''}${s.citation}`).join(' | '),
      v?.status ?? 'not_checked', v?.errors ?? '', v?.warnings ?? '',
      (v?.checks ?? []).filter((c) => c.severity !== 'info').map((c) => `${c.severity}: ${c.detail}`).join(' | '),
      r.reviewed_by_name, r.reviewed_at, r.review_note, r.output_sha256
    ].map(csvCell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// Plain-text disclosure statement for filing with a submission, in English or Arabic.
export function logDisclosure(rows: any[], opts: { lang: 'en' | 'ar'; firm: string; document?: { title: string } | null; generatedAt?: Date }): string {
  const ar = opts.lang === 'ar'
  const at = (d: any) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '')
  const out: string[] = []
  out.push(ar ? 'سجل استخدام الذكاء الاصطناعي والتحقق' : 'AI use and verification record')
  out.push(ar ? `المكتب: ${opts.firm}` : `Firm: ${opts.firm}`)
  if (opts.document) out.push(ar ? `المستند: ${opts.document.title}` : `Document: ${opts.document.title}`)
  out.push(ar ? `تاريخ الإصدار: ${at(opts.generatedAt ?? new Date())}` : `Generated: ${at(opts.generatedAt ?? new Date())}`)
  out.push('')
  out.push(ar
    ? 'استُخدمت أدوات الذكاء الاصطناعي في TrustiqLegal في إعداد هذا المستند على النحو المبين أدناه. فُحصت كل إجابة آلياً بعد إنشائها: مطابقة النصوص المقتبسة حرفياً مع المصدر، ووجود المادة المذكورة، وسريانها في التاريخ المعني، واختصاص الدولة. ولا يغني ذلك عن مراجعة المحامي للمصادر الأصلية.'
    : 'TrustiqLegal AI tools were used in preparing this document as set out below. Each output was checked automatically after it was generated: quoted words against the source, that each cited article exists, that it was in force on the relevant date, and that it belongs to the right jurisdiction. This does not replace a lawyer\'s review of the primary sources.')
  if (!rows.length) {
    out.push('')
    out.push(ar ? 'لا يوجد استخدام مسجل للذكاء الاصطناعي.' : 'No AI use is recorded.')
  }
  rows.forEach((r, i) => {
    const v = r.verification as Verification | null
    out.push('')
    out.push(`${i + 1}. ${featureName(r.feature, opts.lang)} – ${at(r.created_at)}${r.user_name ? ` – ${r.user_name}` : ''}`)
    if (r.model) out.push(`   ${ar ? 'النموذج' : 'Model'}: ${r.model}`)
    if (r.jurisdiction || r.as_of) out.push(`   ${ar ? 'الاختصاص والتاريخ المعني' : 'Jurisdiction and relevant date'}: ${[r.jurisdiction, r.as_of].filter(Boolean).join(', ')}`)
    if (r.prompt_excerpt) out.push(`   ${ar ? 'الطلب' : 'Request'}: ${String(r.prompt_excerpt).replace(/\s+/g, ' ').slice(0, 300)}`)
    const srcs = (r.sources ?? []) as LogSource[]
    out.push(`   ${ar ? 'المصادر المستشهد بها' : 'Sources cited'}: ${srcs.length ? '' : (ar ? 'لا يوجد' : 'none')}`)
    for (const s of srcs) out.push(`     - ${s.ref ? `[${s.ref}] ` : ''}${s.citation}${s.status && s.status !== 'in_force' ? ` (${s.status})` : ''}`)
    const counts = v ? (ar ? ` (أخطاء ${v.errors}، تنبيهات ${v.warnings})` : ` (errors ${v.errors}, warnings ${v.warnings})`) : ''
    out.push(`   ${ar ? 'نتيجة الفحص الآلي' : 'Automatic check'}: ${v ? STATUS_NAMES[v.status]?.[opts.lang] ?? v.status : (ar ? 'لم يُفحص' : 'not checked')}${counts}`)
    for (const c of (v?.checks ?? []).filter((x) => x.severity !== 'info')) out.push(`     - ${c.severity.toUpperCase()}: ${c.detail}`)
    out.push(r.reviewed_at
      ? `   ${ar ? 'تحقق المحامي' : 'Lawyer verification'}: ${r.reviewed_by_name ?? ''}, ${at(r.reviewed_at)}${r.review_note ? ` – ${r.review_note}` : ''}`
      : `   ${ar ? 'تحقق المحامي' : 'Lawyer verification'}: ${ar ? 'لم يُسجل بعد' : 'not yet recorded'}`)
    out.push(`   SHA-256: ${r.output_sha256}`)
  })
  return out.join('\n') + '\n'
}
