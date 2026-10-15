import { limitsFor } from '../../public/static/site/firm-pricing.js'
import type { Config } from '../config'
import type { Db } from '../db'
import type { Logger } from '../lib/logger'
import type { Mailer } from '../lib/mailer'

// ---------------------------------------------------------------------------
// Enterprise fair use: "unlimited" on the pricing page, with a fair use level in
// the terms (400 AI requests and 80 new documents per lawyer a month, at least
// 10,000 and 2,000). Crossing 80% and 100% alerts the TrustiqLegal team once a
// month per level. The firm is never blocked automatically.
// ---------------------------------------------------------------------------

export const FAIR_USE_LEVELS = [80, 100] as const

export async function enterpriseUsage(db: Db) {
  return db.query(
    `SELECT o.id, o.name, o.fair_use_alerts, to_char(date_trunc('month', now()), 'YYYY-MM') AS month,
       COALESCE(o.lawyer_seats, (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND u.deactivated_at IS NULL AND u.role IN ('owner', 'admin', 'lawyer'))) AS lawyers,
       (SELECT count(*)::int FROM ai_usage a WHERE a.org_id = o.id AND a.created_at >= date_trunc('month', now())) AS ai,
       (SELECT count(*)::int FROM documents d WHERE d.org_id = o.id AND d.created_at >= date_trunc('month', now())) AS documents
     FROM organizations o WHERE o.plan = 'enterprise'`)
}

export async function runFairUseAlerts(db: Db, mailer: Mailer, config: Config, log: Logger) {
  let sent = 0
  for (const o of await enterpriseUsage(db)) {
    const cap = limitsFor('enterprise', o.lawyers)!
    const pct = Math.max(o.ai / cap.ai_requests!, o.documents / cap.documents!) * 100
    const level = [...FAIR_USE_LEVELS].reverse().find((l) => pct >= l)
    if (!level) continue
    const prev = o.fair_use_alerts ?? {}
    if (prev.month === o.month && Number(prev.level) >= level) continue
    // Claim the alert so several servers never send it twice.
    const claimed = await db.query(
      `UPDATE organizations SET fair_use_alerts = $2 WHERE id = $1 AND fair_use_alerts = $3::jsonb RETURNING id`,
      [o.id, JSON.stringify({ month: o.month, level }), JSON.stringify(prev)])
    if (!claimed.length) continue
    await mailer.send({
      to: config.firmRequestsEmail,
      subject: `Fair use ${level}%: ${o.name} (Enterprise)`,
      text: [
        `${o.name} has reached ${Math.floor(pct)}% of its Enterprise fair use level this month (${o.month}).`,
        `AI requests: ${o.ai} of ${cap.ai_requests}`, `New documents: ${o.documents} of ${cap.documents}`, `Lawyers counted: ${o.lawyers}`,
        'Nothing has been blocked. Contact the firm if a higher level should be agreed.', `Organization id: ${o.id}`
      ].join('\n')
    }).then(() => { sent++ }).catch((err) => log.warn('fair use alert failed', { err, org: o.id }))
  }
  return sent
}
