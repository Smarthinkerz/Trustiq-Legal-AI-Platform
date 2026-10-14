import type { Queryable } from '../db'

// ---------------------------------------------------------------------------
// Team workload (توزيع العمل): who carries what over the next two weeks —
// matters, hearings, deadlines and tasks, overdue items and recent hours —
// and where one person is due in two different courts on the same day.
// ---------------------------------------------------------------------------

const TZ = 'Asia/Muscat'
export const HORIZON_DAYS = 14
// Who is responsible for an event: the named attendee, else the matter's lawyer, else whoever created it.
const OWNER = 'COALESCE(e.attendee_id, k.assigned_to, e.created_by)'

export async function teamWorkload(db: Queryable, orgId: string, opts: { userId?: string } = {}) {
  const [{ today }] = await db.query(`SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS today`)
  const members = await db.query(
    `SELECT u.id, u.name, u.role FROM users u WHERE u.org_id = $1 AND u.role <> 'client' AND u.deactivated_at IS NULL AND ($2::uuid IS NULL OR u.id = $2)
      ORDER BY u.name`, [orgId, opts.userId ?? null])
  const window = `e.starts_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND e.starts_at < (($2::date + ${HORIZON_DAYS})::timestamp AT TIME ZONE '${TZ}')`
  const [matters, hearings, deadlines, overdueDeadlines, tasks, hours, unassigned] = await Promise.all([
    db.query(`SELECT assigned_to AS uid, count(*)::int AS n FROM cases WHERE org_id = $1 AND status <> 'closed' AND assigned_to IS NOT NULL GROUP BY assigned_to`, [orgId]),
    db.query(
      `SELECT e.id, ${OWNER} AS uid, to_char(e.starts_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS day,
              CASE WHEN e.all_day THEN NULL ELSE to_char(e.starts_at AT TIME ZONE '${TZ}', 'HH24:MI') END AS time,
              COALESCE(NULLIF(e.location, ''), k.court) AS place, k.reference, k.id AS case_id
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind = 'hearing' AND e.completed_at IS NULL AND ${window} ORDER BY e.starts_at`, [orgId, today]),
    db.query(
      `SELECT ${OWNER} AS uid, count(*)::int AS n FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind IN ('deadline', 'filing') AND e.completed_at IS NULL AND ${window} GROUP BY 1`, [orgId, today]),
    db.query(
      `SELECT ${OWNER} AS uid, count(*)::int AS n FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind IN ('deadline', 'filing') AND e.completed_at IS NULL AND e.starts_at < ($2::date::timestamp AT TIME ZONE '${TZ}') GROUP BY 1`, [orgId, today]),
    db.query(
      `SELECT assigned_to AS uid, count(*)::int AS open, count(*) FILTER (WHERE due_date < $2::date)::int AS overdue,
              count(*) FILTER (WHERE due_date >= $2::date AND due_date < $2::date + 7)::int AS due_week
         FROM tasks WHERE org_id = $1 AND status <> 'done' AND assigned_to IS NOT NULL GROUP BY assigned_to`, [orgId, today]),
    db.query(`SELECT user_id AS uid, COALESCE(sum(minutes), 0)::int AS minutes FROM time_entries WHERE org_id = $1 AND work_date >= $2::date - 30 GROUP BY user_id`, [orgId, today]),
    db.query(
      `SELECT count(*)::int AS n FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind = 'hearing' AND e.completed_at IS NULL AND ${window} AND e.attendee_id IS NULL AND k.assigned_to IS NULL`, [orgId, today])
  ])
  const by = (rows: any[], key = 'n') => new Map(rows.map((r) => [r.uid, r[key] ?? r]))
  const m = by(matters), d = by(deadlines), od = by(overdueDeadlines), h = by(hours, 'minutes')
  const t = new Map(tasks.map((r: any) => [r.uid, r]))
  const days = Array.from({ length: HORIZON_DAYS }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
  const out = members.map((u: any) => {
    const mine = hearings.filter((x: any) => x.uid === u.id)
    const perDay = days.map((day) => mine.filter((x: any) => x.day === day).length)
    // Two or more hearings on one day in different places: one person cannot be in both courts.
    const clashes = days.map((day) => {
      const list = mine.filter((x: any) => x.day === day)
      const places = new Set(list.map((x: any) => (x.place ?? '').trim().toLowerCase()).filter(Boolean))
      return list.length >= 2 && places.size >= 2 ? { day, hearings: list.map((x: any) => ({ id: x.id, time: x.time, reference: x.reference, case_id: x.case_id, place: x.place })) } : null
    }).filter(Boolean)
    const tk: any = t.get(u.id) ?? { open: 0, overdue: 0, due_week: 0 }
    const counts = {
      open_matters: Number(m.get(u.id) ?? 0), hearings: mine.length, deadlines: Number(d.get(u.id) ?? 0), overdue_deadlines: Number(od.get(u.id) ?? 0),
      open_tasks: tk.open, overdue_tasks: tk.overdue, tasks_due_week: tk.due_week, hours_30d: Math.round(Number(h.get(u.id) ?? 0) / 6) / 10
    }
    // A simple weighting: court days and deadlines weigh most, overdue items add pressure.
    const score = counts.hearings * 3 + counts.deadlines * 2 + (counts.overdue_deadlines + counts.overdue_tasks) * 2 + counts.tasks_due_week + counts.open_matters * 0.5
    return { id: u.id, name: u.name, role: u.role, ...counts, score, per_day: perDay, clashes }
  })
  const scores = out.filter((x) => x.role !== 'staff').map((x) => x.score).sort((a, b) => a - b)
  const median = scores.length ? scores[Math.floor(scores.length / 2)]! : 0
  for (const x of out as any[]) x.level = x.score >= Math.max(10, median * 1.5) ? 'high' : x.score === 0 ? 'free' : 'normal'
  return { today, days, members: out, unassigned_hearings: unassigned[0].n as number, clashes: out.reduce((n: number, x: any) => n + x.clashes.length, 0) }
}

// The items behind one person's numbers, so they can be handed to someone else.
export async function memberItems(db: Queryable, orgId: string, userId: string) {
  const [{ today }] = await db.query(`SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS today`)
  const [hearings, deadlines, tasks, matters] = await Promise.all([
    db.query(
      `SELECT e.id, e.title, e.starts_at, e.all_day, COALESCE(NULLIF(e.location, ''), k.court) AS place, k.id AS case_id, k.reference, k.title AS case_title, e.attendee_id
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind = 'hearing' AND e.completed_at IS NULL AND ${OWNER} = $2
          AND e.starts_at >= ($3::date::timestamp AT TIME ZONE '${TZ}') AND e.starts_at < (($3::date + ${HORIZON_DAYS})::timestamp AT TIME ZONE '${TZ}')
        ORDER BY e.starts_at`, [orgId, userId, today]),
    db.query(
      `SELECT e.id, e.title, e.kind, e.starts_at, k.id AS case_id, k.reference, (e.starts_at < ($3::date::timestamp AT TIME ZONE '${TZ}')) AS overdue
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.kind IN ('deadline', 'filing') AND e.completed_at IS NULL AND ${OWNER} = $2
          AND e.starts_at < (($3::date + ${HORIZON_DAYS})::timestamp AT TIME ZONE '${TZ}') ORDER BY e.starts_at LIMIT 100`, [orgId, userId, today]),
    db.query(
      `SELECT t.id, t.title, to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.status, k.id AS case_id, k.reference, (t.due_date < $3::date) AS overdue
         FROM tasks t LEFT JOIN cases k ON k.id = t.case_id
        WHERE t.org_id = $1 AND t.assigned_to = $2 AND t.status <> 'done' ORDER BY t.due_date NULLS LAST LIMIT 100`, [orgId, userId, today]),
    db.query(`SELECT id, reference, title, status FROM cases WHERE org_id = $1 AND assigned_to = $2 AND status <> 'closed' ORDER BY updated_at DESC LIMIT 100`, [orgId, userId])
  ])
  return { hearings, deadlines, tasks, matters }
}
