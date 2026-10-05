// ---------------------------------------------------------------------------
// Deadline calculator: counts a period from a trigger date in the Gregorian or
// Hijri (Umm al-Qura) calendar, skipping each jurisdiction's weekend and the
// firm's holidays. Dates are plain 'YYYY-MM-DD' strings handled in UTC.
// ---------------------------------------------------------------------------

export const DEADLINE_UNITS = ['days', 'working_days', 'weeks', 'months', 'years'] as const
export type DeadlineUnit = (typeof DEADLINE_UNITS)[number]
export type CalendarKind = 'gregorian' | 'hijri'

// Weekend days per jurisdiction (0 = Sunday … 6 = Saturday).
// Most Arab states rest Friday–Saturday; the UAE moved to Saturday–Sunday in 2022, as do Lebanon, Morocco and Tunisia.
export const WEEKENDS: Record<string, number[]> = {
  oman: [5, 6], ksa: [5, 6], qatar: [5, 6], kuwait: [5, 6], bahrain: [5, 6], gcc: [5, 6],
  egypt: [5, 6], jordan: [5, 6], iraq: [5, 6], algeria: [5, 6], libya: [5, 6],
  uae: [6, 0], difc: [6, 0], adgm: [6, 0], lebanon: [6, 0], morocco: [6, 0], tunisia: [6, 0], international: [6, 0]
}

export type Holiday = { date: string; name: string }
export type DeadlineStep =
  | { code: 'counted'; date: string }
  | { code: 'weekend'; date: string }
  | { code: 'holiday'; date: string; name: string }

export type DeadlineResult = {
  start: string
  start_hijri: HijriDate
  due: string
  due_hijri: HijriDate
  weekday: number
  unadjusted: string
  steps: DeadlineStep[]
  skipped_days: number
}

export type HijriDate = { year: number; month: number; day: number }

const DAY = 86_400_000
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`)
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromTime(toTime(d) + n * DAY)
const weekday = (d: string) => new Date(toTime(d)).getUTCDay()

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = toTime(d)
  return Number.isFinite(t) && fromTime(t) === d
}

// ---------------- Hijri (Umm al-Qura) ----------------

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' })

export function toHijri(d: string): HijriDate {
  const parts = hijriFmt.formatToParts(new Date(toTime(d)))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

const hijriKey = (h: HijriDate) => h.year * 400 + h.month * 32 + h.day

// Converts a Hijri date to Gregorian by searching around an arithmetic estimate.
// Returns null when the day does not exist (e.g. the 30th of a 29-day month).
export function fromHijri(h: HijriDate): string | null {
  // Days since the Hijri epoch (16 July 622) using the mean month length, then refine.
  const approx = Date.UTC(622, 6, 16) + Math.round(((h.year - 1) * 12 + (h.month - 1)) * 29.530588 + (h.day - 1)) * DAY
  let d = fromTime(approx)
  const target = hijriKey(h)
  for (let i = 0; i < 60; i++) {
    const cur = toHijri(d)
    const diff = target - hijriKey(cur)
    if (diff === 0) return d
    if (cur.year === h.year && cur.month === h.month) d = addDays(d, h.day - cur.day)
    else d = addDays(d, Math.sign(diff) * (Math.abs(diff) >= 32 ? 15 : 1))
  }
  return null
}

function addHijriMonths(start: string, months: number): string {
  const h = toHijri(start)
  const total = h.year * 12 + (h.month - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  // A month has 29 or 30 days; clamp to its last day.
  for (let day = h.day; day >= 28; day--) {
    const g = fromHijri({ year, month, day })
    if (g) return g
  }
  return fromHijri({ year, month, day: Math.min(h.day, 28) })!
}

function addGregorianMonths(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = total % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return fromTime(Date.UTC(year, month, Math.min(d, last)))
}

// ---------------- Calculation ----------------

export function calculateDeadline(opts: {
  start: string
  amount: number
  unit: DeadlineUnit
  calendar?: CalendarKind
  jurisdiction: string
  holidays?: Holiday[]
  rollForward?: boolean
}): DeadlineResult {
  const weekend = new Set(WEEKENDS[opts.jurisdiction] ?? WEEKENDS.gcc)
  const holidays = new Map((opts.holidays ?? []).map((h) => [h.date, h.name]))
  const isWorking = (d: string) => !weekend.has(weekday(d)) && !holidays.has(d)
  const steps: DeadlineStep[] = []
  const calendar = opts.calendar ?? 'gregorian'
  const n = opts.amount

  let due: string
  switch (opts.unit) {
    case 'days': due = addDays(opts.start, n); break
    case 'weeks': due = addDays(opts.start, n * 7); break
    case 'months': due = calendar === 'hijri' ? addHijriMonths(opts.start, n) : addGregorianMonths(opts.start, n); break
    case 'years': due = calendar === 'hijri' ? addHijriMonths(opts.start, n * 12) : addGregorianMonths(opts.start, n * 12); break
    case 'working_days': {
      // The trigger day itself is not counted; count n working days after it.
      let d = opts.start
      let counted = 0
      while (counted < n) {
        d = addDays(d, 1)
        if (isWorking(d)) counted++
      }
      due = d
      break
    }
  }
  const unadjusted = due
  steps.push({ code: 'counted', date: unadjusted })

  // A deadline that falls on a weekend or holiday moves to the next working day.
  let skipped = 0
  if (opts.rollForward !== false) {
    while (!isWorking(due) && skipped < 60) {
      const name = holidays.get(due)
      steps.push(name ? { code: 'holiday', date: due, name } : { code: 'weekend', date: due })
      due = addDays(due, 1)
      skipped++
    }
  }
  return {
    start: opts.start, start_hijri: toHijri(opts.start), due, due_hijri: toHijri(due),
    weekday: weekday(due), unadjusted, steps, skipped_days: skipped
  }
}
