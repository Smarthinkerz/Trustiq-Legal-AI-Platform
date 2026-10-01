import type { Db } from '../db'
import type { Config } from '../config'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// iCalendar feed (RFC 5545) so users can subscribe from Outlook, Google or Apple Calendar.
// ---------------------------------------------------------------------------

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDateTime = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

// Lines longer than 75 octets must be folded.
function fold(line: string) {
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' ' + ch } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n')
}

export async function buildIcs(db: Db, token: string, appUrl: string): Promise<string | null> {
  const user = await db.one(
    `SELECT u.id, u.org_id, o.name AS org_name FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.calendar_token = $1 AND u.deactivated_at IS NULL AND u.role <> 'client'`, [token])
  if (!user) return null
  const [events, tasks] = await Promise.all([
    db.query(
      `SELECT e.id, e.title, e.kind, e.starts_at, e.ends_at, e.all_day, e.location, e.notes, e.updated_at, k.reference
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.starts_at > now() - interval '90 days' ORDER BY e.starts_at LIMIT 2000`, [user.org_id]),
    db.query(
      `SELECT t.id, t.title, t.due_date, t.updated_at, k.reference FROM tasks t LEFT JOIN cases k ON k.id = t.case_id
        WHERE t.org_id = $1 AND t.assigned_to = $2 AND t.status <> 'done' AND t.due_date IS NOT NULL`, [user.org_id, user.id])
  ])
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TrustiqLegal//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`TrustiqLegal – ${user.org_name}`)}`, 'X-PUBLISHED-TTL:PT1H']
  const now = icsDateTime(new Date())
  for (const e of events) {
    const start = new Date(e.starts_at)
    const summary = `${e.kind === 'hearing' ? '⚖ ' : e.kind === 'deadline' || e.kind === 'filing' ? '⏰ ' : ''}${e.title}${e.reference ? ` (${e.reference})` : ''}`
    lines.push('BEGIN:VEVENT', `UID:event-${e.id}@trustiqlegal`, `DTSTAMP:${now}`, `LAST-MODIFIED:${icsDateTime(new Date(e.updated_at))}`)
    if (e.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(new Date(start.getTime() + 86400_000))}`)
    } else {
      lines.push(`DTSTART:${icsDateTime(start)}`, `DTEND:${icsDateTime(e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 3600_000))}`)
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`, `CATEGORIES:${e.kind.toUpperCase()}`, `URL:${appUrl}/app#/calendar`)
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`)
    if (e.notes) lines.push(`DESCRIPTION:${icsEscape(e.notes)}`)
    if (['hearing', 'deadline', 'filing'].includes(e.kind)) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.title)}`, 'TRIGGER:-P1D', 'END:VALARM')
    lines.push('END:VEVENT')
  }
  for (const t of tasks) {
    const d = new Date(t.due_date)
    lines.push('BEGIN:VEVENT', `UID:task-${t.id}@trustiqlegal`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${icsDate(d)}`,
      `DTEND;VALUE=DATE:${icsDate(new Date(d.getTime() + 86400_000))}`, `SUMMARY:${icsEscape(`☑ ${t.title}${t.reference ? ` (${t.reference})` : ''}`)}`,
      `URL:${appUrl}/app#/tasks`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Daily digest: upcoming hearings/deadlines (next 2 days) and overdue tasks.
// Each user is claimed atomically so several app instances never send duplicates.
// ---------------------------------------------------------------------------

const DIGEST_HOUR_UTC = 4 // 08:00 in Oman / UAE, 07:00 in KSA / Qatar / Kuwait / Bahrain

export async function runDailyDigest(db: Db, mailer: Mailer, config: Config, log: Logger, now = new Date()) {
  if (!mailer.configured || now.getUTCHours() < DIGEST_HOUR_UTC) return 0
  const today = now.toISOString().slice(0, 10)
  let sent = 0
  for (;;) {
    const [user] = await db.query(
      `UPDATE users SET last_digest_on = $1
        WHERE id = (SELECT id FROM users WHERE notify_email AND role <> 'client' AND deactivated_at IS NULL
                      AND (last_digest_on IS NULL OR last_digest_on < $1) LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, org_id, name, email, locale`, [today])
    if (!user) break
    const [events, tasks] = await Promise.all([
      db.query(
        `SELECT e.title, e.kind, e.starts_at, e.all_day, e.location, k.reference FROM events e LEFT JOIN cases k ON k.id = e.case_id
          WHERE e.org_id = $1 AND e.completed_at IS NULL AND e.starts_at >= $2::date AND e.starts_at < $2::date + 2
            AND (k.assigned_to = $3 OR e.created_by = $3 OR e.case_id IS NULL)
          ORDER BY e.starts_at LIMIT 30`, [user.org_id, today, user.id]),
      db.query(
        `SELECT t.title, t.due_date, k.reference FROM tasks t LEFT JOIN cases k ON k.id = t.case_id
          WHERE t.org_id = $1 AND t.assigned_to = $2 AND t.status <> 'done' AND t.due_date <= $3::date + 1
          ORDER BY t.due_date LIMIT 30`, [user.org_id, user.id, today])
    ])
    if (!events.length && !tasks.length) continue
    const ar = user.locale === 'ar'
    const fmt = (d: Date, allDay: boolean) => new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB',
      allDay ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Muscat' }).format(d)
    const lines: string[] = [ar ? `مرحباً ${user.name}،` : `Hello ${user.name},`, '']
    if (events.length) {
      lines.push(ar ? 'المواعيد القادمة (خلال يومين):' : 'Coming up in the next two days:')
      for (const e of events) lines.push(`• ${fmt(new Date(e.starts_at), e.all_day)} – ${e.title}${e.reference ? ` (${e.reference})` : ''}${e.location ? ` @ ${e.location}` : ''}`)
      lines.push('')
    }
    if (tasks.length) {
      lines.push(ar ? 'المهام المستحقة أو المتأخرة:' : 'Tasks due or overdue:')
      for (const t of tasks) lines.push(`• ${new Date(t.due_date).toISOString().slice(0, 10)} – ${t.title}${t.reference ? ` (${t.reference})` : ''}`)
      lines.push('')
    }
    lines.push(`${config.appUrl}/app#/dashboard`, '', ar ? 'يمكنك إيقاف هذه الرسائل من الإعدادات > الملف الشخصي.' : 'You can turn these emails off in Settings > Profile.')
    try {
      await mailer.send({
        to: user.email,
        subject: ar ? `TrustiqLegal: ${events.length} موعد و${tasks.length} مهمة` : `TrustiqLegal: ${events.length} upcoming, ${tasks.length} tasks due`,
        text: lines.join('\n')
      })
      sent++
    } catch (err) {
      log.warn('digest email failed', { err, user: user.id })
    }
  }
  if (sent) log.info('daily digest sent', { sent })
  return sent
}

// ---------------------------------------------------------------------------
// Renewal reminders: one email to owners/admins when a paid plan ends within 5 days
// (or has just ended). renewal_reminded_for stores the end date that was announced.
// ---------------------------------------------------------------------------

export async function runRenewalReminders(db: Db, mailer: Mailer, config: Config, log: Logger) {
  if (!mailer.configured) return 0
  let sent = 0
  for (;;) {
    const [org] = await db.query(
      `UPDATE organizations SET renewal_reminded_for = plan_expires_at::date
        WHERE id = (SELECT id FROM organizations WHERE plan <> 'trial' AND plan_expires_at IS NOT NULL
                      AND plan_expires_at < now() + interval '5 days' AND plan_expires_at > now() - interval '3 days'
                      AND renewal_reminded_for IS DISTINCT FROM plan_expires_at::date LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, name, plan, plan_expires_at`)
    if (!org) break
    const admins = await db.query(`SELECT email, name, locale FROM users WHERE org_id = $1 AND role IN ('owner', 'admin') AND deactivated_at IS NULL`, [org.id])
    const until = new Date(org.plan_expires_at).toISOString().slice(0, 10)
    const ended = new Date(org.plan_expires_at).getTime() < Date.now()
    const link = `${config.appUrl}/app#/settings?tab=plan`
    for (const a of admins) {
      const ar = a.locale === 'ar'
      await mailer.send({
        to: a.email,
        subject: ar
          ? (ended ? 'انتهى اشتراكك في TrustiqLegal' : `اشتراكك في TrustiqLegal ينتهي في ${until}`)
          : (ended ? 'Your TrustiqLegal subscription has ended' : `Your TrustiqLegal subscription ends on ${until}`),
        text: ar
          ? `مرحباً ${a.name}،\n\n${ended ? 'انتهى' : 'سينتهي'} اشتراك ${org.name} (${org.plan}) بتاريخ ${until}. ${ended ? 'بياناتك محفوظة ويمكنك عرضها، لكن التعديل متوقف حتى التجديد.' : 'جدّد الآن لتجنب انقطاع الخدمة.'}\n\n${link}`
          : `Hello ${a.name},\n\nThe ${org.plan} plan for ${org.name} ${ended ? 'ended' : 'ends'} on ${until}. ${ended ? 'Your data is safe and still viewable, but changes are paused until you renew.' : 'Renew now to avoid any interruption.'}\n\n${link}`
      }).then(() => { sent++ }).catch((err) => log.warn('renewal reminder failed', { err, org: org.id }))
    }
  }
  return sent
}
