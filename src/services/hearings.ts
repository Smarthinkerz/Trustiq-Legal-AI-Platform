// ---------------------------------------------------------------------------
// Hearing records: what happened at a hearing, and the bilingual update the
// client receives in the portal.
// ---------------------------------------------------------------------------

export const OUTCOMES = ['adjourned', 'reserved', 'judgment', 'settled', 'dismissed', 'other'] as const
export type Outcome = (typeof OUTCOMES)[number]

const LABELS: Record<Outcome, [string, string]> = {
  adjourned: ['The hearing was adjourned', 'تم تأجيل الجلسة'],
  reserved: ['The case was reserved for judgment', 'حُجزت الدعوى للحكم'],
  judgment: ['Judgment was issued', 'صدر الحكم'],
  settled: ['The matter was settled', 'تمت التسوية'],
  dismissed: ['The case was dismissed', 'رُفضت الدعوى أو شُطبت'],
  other: ['Hearing update', 'مستجدات الجلسة']
}

// Court times are local to the case's country.
const ZONES: Record<string, string> = {
  oman: 'Asia/Muscat', uae: 'Asia/Dubai', difc: 'Asia/Dubai', adgm: 'Asia/Dubai', ksa: 'Asia/Riyadh', bahrain: 'Asia/Bahrain',
  qatar: 'Asia/Qatar', kuwait: 'Asia/Kuwait', egypt: 'Africa/Cairo', jordan: 'Asia/Amman', lebanon: 'Asia/Beirut', iraq: 'Asia/Baghdad',
  morocco: 'Africa/Casablanca', tunisia: 'Africa/Tunis', algeria: 'Africa/Algiers', libya: 'Africa/Tripoli'
}
export const zoneFor = (jurisdiction: string | null | undefined) => ZONES[jurisdiction ?? ''] ?? 'Asia/Dubai'

const when = (d: Date, lang: 'en' | 'ar', zone: string, allDay: boolean) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: allDay ? 'UTC' : zone,
    ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' })
  }).format(d)

export function clientUpdateText(o: {
  outcome: Outcome; caseRef: string; caseTitle: string; hearingAt: Date; hearingAllDay: boolean; jurisdiction: string | null
  next?: { at: Date; allDay: boolean; location: string | null } | null
}) {
  const zone = zoneFor(o.jurisdiction)
  const part = (lang: 'en' | 'ar') => {
    const ar = lang === 'ar'
    const lines = [
      ar ? `مستجدات القضية ${o.caseRef} – ${o.caseTitle}` : `Update on your case ${o.caseRef} – ${o.caseTitle}`,
      `${ar ? 'جلسة' : 'Hearing of'} ${when(o.hearingAt, lang, zone, o.hearingAllDay)}: ${LABELS[o.outcome][ar ? 1 : 0]}.`
    ]
    if (o.next) lines.push(`${ar ? 'الجلسة القادمة' : 'Next hearing'}: ${when(o.next.at, lang, zone, o.next.allDay)}${o.next.location ? ` – ${o.next.location}` : ''}.`)
    lines.push(ar ? 'لأي استفسار، راسلنا عبر البوابة.' : 'If you have any questions, message us here in the portal.')
    return lines.join('\n')
  }
  return `${part('en')}\n\n—\n\n${part('ar')}`
}
