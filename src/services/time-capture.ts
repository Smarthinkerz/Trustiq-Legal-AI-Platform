import type { Queryable } from '../db'

// ---------------------------------------------------------------------------
// Time capture: turns what a lawyer actually did in the app on a day (hearings
// attended, documents drafted or revised, reviews, client correspondence …)
// into suggested time entries. Estimates are starting points the lawyer edits;
// nothing is logged until they accept it. Each suggestion has a stable key, so
// an accepted or dismissed one never comes back.
// ---------------------------------------------------------------------------

export type Suggestion = {
  key: string; kind: string; case_id: string; case_reference: string; case_title: string; currency: string
  work_date: string; minutes: number; description: string; detail: string | null
}

const TZ = 'Asia/Muscat'
const dayOf = (col: string) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`
const inRange = (col: string) => `${col} >= ($3::date::timestamp AT TIME ZONE '${TZ}') AND ${col} < (($4::date + 1)::timestamp AT TIME ZONE '${TZ}')`
const roundTo6 = (m: number) => Math.max(6, Math.round(m / 6) * 6)

const T = {
  hearing: ['Attendance at hearing', 'حضور جلسة'],
  meeting: ['Meeting', 'اجتماع'],
  draft: ['Drafting', 'صياغة'],
  draft_ai: ['Drafting (AI-assisted) and review', 'صياغة بمساعدة الذكاء الاصطناعي ومراجعتها'],
  revise: ['Revising', 'مراجعة وتعديل'],
  analysis: ['Legal review of', 'مراجعة قانونية لـ'],
  playbook: ['Review against the firm playbook of', 'مراجعة وفق دليل التفاوض لـ'],
  outcome: ['Recording hearing outcome and reporting to client', 'تسجيل نتيجة الجلسة وإبلاغ الموكل'],
  signature: ['Preparing and sending for signature', 'إعداد وإرسال للتوقيع'],
  engagement: ['Preparing engagement letter', 'إعداد خطاب التكليف'],
  judgment: ['Reviewing judgment and advising on appeal', 'دراسة الحكم وإبداء الرأي بشأن الطعن'],
  messages: ['Correspondence with client', 'مراسلات مع الموكل']
} as const

export async function suggestTime(db: Queryable, o: { orgId: string; userId: string; from: string; to: string; lang: 'en' | 'ar' }): Promise<Suggestion[]> {
  const i = o.lang === 'ar' ? 1 : 0
  const p = [o.orgId, o.userId, o.from, o.to]
  const caseCols = 'k.id AS case_id, k.reference AS case_reference, k.title AS case_title, k.currency'
  const [hearings, meetings, created, revised, analyses, playbook, outcomes, signatures, engagements, judgments, messages] = await Promise.all([
    // Hearings this lawyer attended (or, with nobody else assigned, on their own matters), once they have started.
    db.query(`SELECT e.id, ${dayOf('e.starts_at')} AS day, e.all_day, e.ends_at, e.starts_at, coalesce(k.court, e.location) AS place, ${caseCols}
                FROM events e JOIN cases k ON k.id = e.case_id
               WHERE e.org_id = $1 AND e.kind = 'hearing' AND coalesce(e.attendee_id, k.assigned_to) = $2 AND e.starts_at <= now() AND ${inRange('e.starts_at')}`, p),
    db.query(`SELECT e.id, ${dayOf('e.starts_at')} AS day, e.title, e.all_day, e.ends_at, e.starts_at, ${caseCols}
                FROM events e JOIN cases k ON k.id = e.case_id
               WHERE e.org_id = $1 AND e.kind = 'meeting' AND e.created_by = $2 AND e.starts_at <= now() AND ${inRange('e.starts_at')}`, p),
    db.query(`SELECT d.id, ${dayOf('d.created_at')} AS day, d.title, d.source, length(d.content) AS chars, ${caseCols}
                FROM documents d JOIN cases k ON k.id = d.case_id
               WHERE d.org_id = $1 AND d.created_by = $2 AND d.source IN ('manual', 'ai') AND d.translated_from IS NULL AND NOT d.uploaded_by_client AND ${inRange('d.created_at')}`, p),
    db.query(`SELECT v.document_id AS id, ${dayOf('v.created_at')} AS day, d.title, count(*)::int AS edits, ${caseCols}
                FROM document_versions v JOIN documents d ON d.id = v.document_id JOIN cases k ON k.id = d.case_id
               WHERE v.org_id = $1 AND v.created_by = $2 AND ${inRange('v.created_at')}
               GROUP BY v.document_id, ${dayOf('v.created_at')}, d.title, k.id`, p),
    db.query(`SELECT a.id, ${dayOf('a.created_at')} AS day, a.analysis_type, d.title, ${caseCols}
                FROM document_analyses a JOIN documents d ON d.id = a.document_id JOIN cases k ON k.id = d.case_id
               WHERE a.org_id = $1 AND a.created_by = $2 AND ${inRange('a.created_at')}`, p),
    db.query(`SELECT r.id, ${dayOf('r.created_at')} AS day, d.title, ${caseCols}
                FROM playbook_reviews r JOIN documents d ON d.id = r.document_id JOIN cases k ON k.id = d.case_id
               WHERE r.org_id = $1 AND r.created_by = $2 AND ${inRange('r.created_at')}`, p),
    db.query(`SELECT h.id, ${dayOf('h.created_at')} AS day, h.shared_with_client, ${caseCols}
                FROM hearing_records h JOIN cases k ON k.id = h.case_id
               WHERE h.org_id = $1 AND h.created_by = $2 AND ${inRange('h.created_at')}`, p),
    db.query(`SELECT s.id, ${dayOf('s.created_at')} AS day, s.title, ${caseCols}
                FROM signature_requests s JOIN cases k ON k.id = s.case_id
               WHERE s.org_id = $1 AND s.created_by = $2 AND ${inRange('s.created_at')}`, p),
    db.query(`SELECT e.id, ${dayOf('e.created_at')} AS day, ${caseCols}
                FROM engagement_letters e JOIN cases k ON k.id = e.case_id
               WHERE e.org_id = $1 AND e.created_by = $2 AND ${inRange('e.created_at')}`, p),
    db.query(`SELECT j.id, ${dayOf('j.created_at')} AS day, j.result, ${caseCols}
                FROM case_judgments j JOIN cases k ON k.id = j.case_id
               WHERE j.org_id = $1 AND j.created_by = $2 AND ${inRange('j.created_at')}`, p),
    db.query(`SELECT ${dayOf('m.created_at')} AS day, count(*)::int AS n, sum(length(m.body))::int AS chars, ${caseCols}
                FROM client_messages m JOIN cases k ON k.id = m.case_id
               WHERE m.org_id = $1 AND m.sender_id = $2 AND NOT m.from_client AND ${inRange('m.created_at')}
               GROUP BY ${dayOf('m.created_at')}, k.id`, p)
  ])

  const out: Suggestion[] = []
  const add = (r: any, key: string, kind: string, minutes: number, description: string, detail: string | null = null) =>
    out.push({ key, kind, case_id: r.case_id, case_reference: r.case_reference, case_title: r.case_title, currency: r.currency, work_date: r.day, minutes: roundTo6(minutes), description, detail })
  const span = (r: any, fallback: number) => (r.all_day || !r.ends_at ? fallback : Math.min(480, Math.max(6, (Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60_000)))

  for (const r of hearings) add(r, `hearing:${r.id}`, 'hearing', span(r, 120), `${T.hearing[i]}${r.place ? ` – ${r.place}` : ''}`)
  for (const r of meetings) add(r, `meeting:${r.id}`, 'meeting', span(r, 60), `${T.meeting[i]} – ${r.title}`)
  // Drafting time grows with length: about 15 minutes per 1,500 characters written by hand, a third of that with AI.
  for (const r of created) {
    const ai = r.source === 'ai'
    add(r, `draft:${r.id}`, 'draft', Math.min(240, (ai ? 20 : 30) + (Number(r.chars) / 1500) * (ai ? 5 : 15)), `${ai ? T.draft_ai[i] : T.draft[i]}: ${r.title}`)
  }
  for (const r of revised) add(r, `revise:${r.id}:${r.day}`, 'revise', Math.min(180, 18 + r.edits * 12), `${T.revise[i]}: ${r.title}`, r.edits > 1 ? `${r.edits}×` : null)
  for (const r of analyses) add(r, `analysis:${r.id}`, 'analysis', r.analysis_type === 'summary' ? 18 : 36, `${T.analysis[i]} ${r.title}`)
  for (const r of playbook) add(r, `playbook:${r.id}`, 'playbook', 42, `${T.playbook[i]} ${r.title}`)
  for (const r of outcomes) add(r, `outcome:${r.id}`, 'outcome', r.shared_with_client ? 24 : 12, T.outcome[i])
  for (const r of signatures) add(r, `signature:${r.id}`, 'signature', 12, `${T.signature[i]}: ${r.title}`)
  for (const r of engagements) add(r, `engagement:${r.id}`, 'engagement', 36, T.engagement[i])
  for (const r of judgments) add(r, `judgment:${r.id}`, 'judgment', r.result === 'lost' || r.result === 'partial' ? 60 : 36, T.judgment[i])
  for (const r of messages) add(r, `messages:${r.case_id}:${r.day}`, 'messages', Math.min(120, r.n * 6 + Number(r.chars) / 400), T.messages[i], r.n > 1 ? `${r.n}×` : null)

  if (!out.length) return out
  // Drop what this lawyer already logged from a suggestion or dismissed.
  const keys = out.map((s) => s.key)
  const [logged, dismissed] = await Promise.all([
    db.query('SELECT source_key AS key FROM time_entries WHERE user_id = $1 AND source_key = ANY($2::text[])', [o.userId, keys]),
    db.query('SELECT key FROM time_suggestion_dismissals WHERE user_id = $1 AND key = ANY($2::text[])', [o.userId, keys])
  ])
  const done = new Set([...logged, ...dismissed].map((r: any) => r.key))
  return out.filter((s) => !done.has(s.key)).sort((a, b) => b.work_date.localeCompare(a.work_date) || a.case_reference.localeCompare(b.case_reference) || b.minutes - a.minutes)
}
