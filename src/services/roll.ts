import { AlignmentType, Document, Footer, Header, Packer, PageNumber, PageOrientation, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { Queryable } from '../db'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Court roll (جدول الجلسات): the firm's hearings for a period, grouped by day
// and court, with who attends and where each matter stood after its last
// hearing. Printed every evening by GCC litigation teams.
// ---------------------------------------------------------------------------

export type RollItem = {
  id: string; starts_at: string; all_day: boolean; day: string; time: string | null; title: string; location: string | null; notes: string | null
  completed: boolean; recorded: boolean
  case_id: string | null; reference: string | null; case_title: string | null; court: string | null; opposing_party: string | null
  client_name: string | null; lawyer_id: string | null; lawyer_name: string | null; attendee_id: string | null; attendee_name: string | null
  last_outcome: string | null; last_summary: string | null; last_next_steps: string | null; last_date: string | null
}

const TZ = 'Asia/Muscat'

export async function rollItems(db: Queryable, orgId: string, o: { from: string; to: string; who?: string | null }): Promise<RollItem[]> {
  const rows = await db.query(
    `SELECT e.id, e.starts_at, e.all_day, e.title, e.location, e.notes, e.completed_at IS NOT NULL AS completed,
            to_char(e.starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
            CASE WHEN e.all_day THEN NULL ELSE to_char(e.starts_at AT TIME ZONE '${TZ}', 'HH24:MI') END AS time,
            EXISTS (SELECT 1 FROM hearing_records h WHERE h.event_id = e.id) AS recorded,
            k.id AS case_id, k.reference, k.title AS case_title, k.court, k.opposing_party,
            cl.name AS client_name, k.assigned_to AS lawyer_id, lu.name AS lawyer_name, e.attendee_id, au.name AS attendee_name,
            prev.outcome AS last_outcome, prev.summary AS last_summary, prev.next_steps AS last_next_steps, prev.last_date
       FROM events e
       LEFT JOIN cases k ON k.id = e.case_id
       LEFT JOIN clients cl ON cl.id = k.client_id
       LEFT JOIN users lu ON lu.id = k.assigned_to
       LEFT JOIN users au ON au.id = e.attendee_id
       LEFT JOIN LATERAL (
         SELECT h.outcome, h.summary, h.next_steps, to_char(pe.starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS last_date
           FROM hearing_records h JOIN events pe ON pe.id = h.event_id
          WHERE h.case_id = e.case_id AND pe.starts_at < e.starts_at ORDER BY pe.starts_at DESC LIMIT 1) prev ON true
      WHERE e.org_id = $1 AND e.kind = 'hearing'
        AND e.starts_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND e.starts_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
        AND ($4::uuid IS NULL OR coalesce(e.attendee_id, k.assigned_to) = $4)
      ORDER BY e.starts_at, coalesce(k.court, e.location, ''), k.reference
      LIMIT 2000`, [orgId, o.from, o.to, o.who ?? null])
  return rows as RollItem[]
}

// Days in order, each with its hearings grouped by court (or location when no court is set).
export function groupRoll(items: RollItem[]) {
  const days = new Map<string, Map<string, RollItem[]>>()
  for (const it of items) {
    const court = it.court || it.location || ''
    if (!days.has(it.day)) days.set(it.day, new Map())
    const courts = days.get(it.day)!
    if (!courts.has(court)) courts.set(court, [])
    courts.get(court)!.push(it)
  }
  return [...days].map(([day, courts]) => ({ day, courts: [...courts].map(([court, hearings]) => ({ court, hearings })) }))
}

const OUTCOME: Record<string, [string, string]> = {
  adjourned: ['Adjourned', 'تأجيل'], reserved: ['Reserved for judgment', 'حجز للحكم'], judgment: ['Judgment issued', 'صدر الحكم'],
  settled: ['Settled', 'تسوية'], dismissed: ['Dismissed', 'رفض'], other: ['Other', 'أخرى']
}

const L = {
  title: ['Court roll', 'جدول الجلسات'], time: ['Time', 'الوقت'], matter: ['Matter', 'القضية'], parties: ['Client v. opposing party', 'الموكل ضد الخصم'],
  attends: ['Attends', 'الحضور'], last: ['Last hearing', 'آخر جلسة'], todo: ['To do at this hearing', 'المطلوب في الجلسة'], allday: ['All day', 'طوال اليوم'],
  nocourt: ['Court not set', 'المحكمة غير محددة'], period: ['Period', 'الفترة'], printed: ['Printed', 'تاريخ الطباعة'], count: ['hearings', 'جلسة']
} as const

const fmtDay = (iso: string, lang: 'en' | 'ar') =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const hijri = (iso: string) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

export async function renderRollDocx(o: { lang: 'en' | 'ar'; from: string; to: string; items: RollItem[]; firmName: string; letterhead?: Letterhead | null; filterLabel?: string | null }) {
  const rtl = o.lang === 'ar'
  const i = rtl ? 1 : 0
  const font = rtl ? 'Arial' : 'Calibri'
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT
  const para = (text: string, opts: { bold?: boolean; size?: number; color?: string; after?: number } = {}) => new Paragraph({
    bidirectional: rtl, alignment: align, spacing: { after: opts.after ?? 40 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 18, font, color: opts.color, rightToLeft: rtl || /[؀-ۿ]/.test(text) })]
  })
  const cell = (lines: string[], opts: { bold?: boolean; shade?: string; width: number }) => new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    shading: opts.shade ? { fill: opts.shade } : undefined,
    children: (lines.length ? lines : ['']).map((t, n) => para(t, { bold: opts.bold && n === 0, size: n === 0 ? 18 : 16, color: n === 0 ? undefined : '555555' }))
  })
  const widths = [8, 20, 22, 12, 20, 18]
  const head = new TableRow({ tableHeader: true, children: [L.time, L.matter, L.parties, L.attends, L.last, L.todo].map((h, n) => cell([h[i]], { bold: true, shade: 'E2E8F0', width: widths[n]! })) })

  const body: (Paragraph | Table)[] = [
    para(`${L.title[i]} – ${o.firmName}`, { bold: true, size: 30, color, after: 60 }),
    para(`${L.period[i]}: ${o.from === o.to ? fmtDay(o.from, o.lang) : `${fmtDay(o.from, o.lang)} – ${fmtDay(o.to, o.lang)}`}${o.filterLabel ? `  ·  ${o.filterLabel}` : ''}  ·  ${o.items.length} ${L.count[i]}`, { size: 18, color: '555555', after: 200 })
  ]
  for (const d of groupRoll(o.items)) {
    body.push(para(`${fmtDay(d.day, o.lang)}  ·  ${hijri(d.day)}`, { bold: true, size: 24, color, after: 80 }))
    for (const c of d.courts) {
      body.push(para(c.court || L.nocourt[i], { bold: true, size: 20, after: 60 }))
      body.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        visuallyRightToLeft: rtl,
        rows: [head, ...c.hearings.map((h) => new TableRow({ children: [
          cell([h.time ?? L.allday[i]], { bold: true, width: widths[0]! }),
          cell([h.reference ?? '', h.case_title ?? h.title], { bold: true, width: widths[1]! }),
          cell([h.client_name ?? '', h.opposing_party ? (rtl ? `ضد ${h.opposing_party}` : `v. ${h.opposing_party}`) : ''].filter(Boolean), { width: widths[2]! }),
          cell([h.attendee_name ?? h.lawyer_name ?? '—'], { width: widths[3]! }),
          cell(h.last_outcome ? [`${h.last_date ?? ''} · ${OUTCOME[h.last_outcome]?.[i] ?? h.last_outcome}`, (h.last_summary ?? '').slice(0, 300)] : ['—'], { width: widths[4]! }),
          cell([h.last_next_steps ?? h.notes ?? ''].map((x) => x.slice(0, 400)), { width: widths[5]! })
        ] }))]
      }))
      body.push(para('', { after: 160 }))
    }
  }
  if (!o.items.length) body.push(para(rtl ? 'لا توجد جلسات في هذه الفترة.' : 'No hearings in this period.'))
  const headerChildren = letterheadParagraphs(o.letterhead, rtl, font, color)
  const doc = new Document({
    creator: o.firmName,
    title: L.title[i],
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 1000, bottom: 900, left: 800, right: 800 } } },
      headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 14, color: '777777', font })] })] }) },
      children: body
    }]
  })
  return Packer.toBuffer(doc)
}
