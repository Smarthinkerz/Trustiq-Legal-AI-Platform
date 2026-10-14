import type { Queryable } from '../db'
import { caseBalances } from './funds'
import { matterFinancials } from './matter-finance'

// ---------------------------------------------------------------------------
// Matter closing (إغلاق الملف): before a file is closed, everything still open
// on it is listed (unbilled work, unpaid invoices, client money, originals,
// tasks, deadlines, notices, experts, signatures, document requests,
// collections), and the closing records the outcome and how long the file is
// kept.
// ---------------------------------------------------------------------------

export const OUTCOMES = ['won', 'partly_won', 'lost', 'settled', 'withdrawn', 'advice_given', 'transaction_completed', 'other'] as const

export type CheckItem = { key: string; ok: boolean; count: number; amounts?: Array<{ amount: number; currency: string }> }

export async function closingChecklist(db: Queryable, orgId: string, caseId: string): Promise<CheckItem[]> {
  const n = async (sql: string) => Number((await db.query(sql, [orgId, caseId]))[0]?.n ?? 0)
  const [[fin], funds, originals, tasks, events, notices, experts, signatures, requests, collections] = await Promise.all([
    matterFinancials(db, orgId, { caseIds: [caseId], includeClosed: true }),
    caseBalances(db, orgId, caseId),
    n(`SELECT count(*)::int AS n FROM client_originals WHERE org_id = $1 AND case_id = $2 AND status <> 'returned'`),
    n(`SELECT count(*)::int AS n FROM tasks WHERE org_id = $1 AND case_id = $2 AND status <> 'done'`),
    n(`SELECT count(*)::int AS n FROM events WHERE org_id = $1 AND case_id = $2 AND completed_at IS NULL AND kind IN ('hearing', 'deadline', 'filing')`),
    n(`SELECT count(*)::int AS n FROM legal_notices WHERE org_id = $1 AND case_id = $2 AND status IN ('sent', 'delivered')`),
    n(`SELECT count(*)::int AS n FROM expert_referrals WHERE org_id = $1 AND case_id = $2 AND NOT closed`),
    n(`SELECT count(*)::int AS n FROM signature_requests WHERE org_id = $1 AND case_id = $2 AND status = 'pending'`),
    n(`SELECT count(*)::int AS n FROM document_requests WHERE org_id = $1 AND case_id = $2 AND status = 'open'`),
    n(`SELECT count(*)::int AS n FROM case_judgments j WHERE j.org_id = $1 AND j.case_id = $2 AND j.result IN ('won', 'partial')
         AND j.enforcement_status IN ('not_started', 'filed', 'in_progress')
         AND j.amount_awarded + j.costs_awarded > coalesce((SELECT sum(amount) FROM judgment_collections x WHERE x.judgment_id = j.id), 0)`)
  ])
  const unbilled = fin ? Math.round((fin.unbilled_time + fin.unbilled_expenses) * 1000) / 1000 : 0
  const outstanding = fin ? fin.outstanding : 0
  const money = funds.filter((f) => Math.abs(f.balance) >= 0.0005)
  const count = (key: string, c: number): CheckItem => ({ key, ok: c === 0, count: c })
  return [
    { key: 'unbilled', ok: unbilled < 0.0005, count: unbilled < 0.0005 ? 0 : 1, amounts: unbilled ? [{ amount: unbilled, currency: fin!.currency }] : [] },
    { key: 'outstanding', ok: outstanding < 0.0005, count: outstanding < 0.0005 ? 0 : 1, amounts: outstanding ? [{ amount: outstanding, currency: fin!.currency }] : [] },
    { key: 'funds', ok: !money.length, count: money.length, amounts: money.map((f) => ({ amount: f.balance, currency: f.currency })) },
    count('originals', originals),
    count('tasks', tasks),
    count('deadlines', events),
    count('notices', notices),
    count('experts', experts),
    count('signatures', signatures),
    count('document_requests', requests),
    count('collections', collections)
  ]
}

const fmtDate = (iso: string, lang: 'en' | 'ar') =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// A short closing letter to the client, in their language; the lawyer edits it as a document before sending.
export function closingLetter(o: {
  lang: 'en' | 'ar'; clientName: string; reference: string; title: string; summary: string | null; originalsReturned: boolean
  retainUntil: string; years: number; lawyerName: string; firmName: string; date: string
}) {
  if (o.lang === 'ar') {
    return [
      fmtDate(o.date, 'ar'), '', `السادة/ ${o.clientName} المحترمين`, '', `الموضوع: ${o.title} (${o.reference})`, '',
      'تحية طيبة وبعد،', '',
      'نود إفادتكم بأننا أنجزنا أعمالنا في الموضوع المشار إليه أعلاه، وقد أغلقنا ملفه لدينا.',
      ...(o.summary ? ['', o.summary] : []),
      ...(o.originalsReturned ? ['', 'وقد سلّمناكم جميع أصول المستندات التي أودعتموها لدينا.'] : []),
      '', `وسنحتفظ بملف الموضوع لمدة ${o.years} سنوات حتى ${fmtDate(o.retainUntil, 'ar')}، ويجوز بعدها إتلافه وفق سياسة الاحتفاظ بالملفات لدينا، ما لم تطلبوا استرداد أي جزء منه قبل ذلك.`,
      '', 'نشكركم على ثقتكم بنا، ولا تترددوا في التواصل معنا متى احتجتم إلى أي مساعدة.', '',
      'وتفضلوا بقبول فائق الاحترام،', '', o.lawyerName, o.firmName
    ].join('\n')
  }
  return [
    fmtDate(o.date, 'en'), '', `Dear ${o.clientName},`, '', `Re: ${o.title} (${o.reference})`, '',
    'We write to confirm that our work on the above matter is complete and that we have now closed our file.',
    ...(o.summary ? ['', o.summary] : []),
    ...(o.originalsReturned ? ['', 'All original documents you entrusted to us have been returned to you.'] : []),
    '', `We will keep our file for ${o.years} years, until ${fmtDate(o.retainUntil, 'en')}. After that it may be destroyed in line with our file retention policy, unless you ask us before then to return any part of it.`,
    '', 'Thank you for instructing us. Please do not hesitate to contact us if we can be of any further assistance.', '',
    'Yours sincerely,', '', o.lawyerName, o.firmName
  ].join('\n')
}
