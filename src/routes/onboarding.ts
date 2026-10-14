import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { jsonBody, queryParams } from '../lib/http'
import { GULF_TODAY } from '../services/credentials'
import { gaps, ONBOARDING_CHECKS, onboardingRows, summarize } from '../services/onboarding'
import { toCsv } from '../services/practice-insights'

// Matter onboarding register: conflict, KYC, power of attorney and engagement letter for every open matter.
const onboardingRoutes = new Hono<AppEnv>()

async function requiredChecks(db: any, orgId: string): Promise<string[]> {
  const o = await db.one('SELECT onboarding_checks FROM organizations WHERE id = $1', [orgId])
  return o?.onboarding_checks ?? [...ONBOARDING_CHECKS]
}

onboardingRoutes.get('/', queryParams(z.object({
  format: z.enum(['json', 'csv']).default('json'),
  show: z.enum(['all', 'not_ready']).default('all')
})), async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const { format, show } = c.req.valid('query')
  const { db } = c.get('deps')
  const required = await requiredChecks(db, org.id)
  const rows = (await onboardingRows(db, org.id)).map((r) => ({ ...r, gaps: gaps(r, required) }))
  const items = show === 'not_ready' ? rows.filter((r) => r.gaps.length) : rows
  if (format === 'csv') {
    const [{ today }] = await db.query(`SELECT to_char(${GULF_TODAY}, 'YYYY-MM-DD') AS today`)
    await audit(c, 'onboarding.register_exported', 'organization', org.id, { rows: items.length })
    const csv = toCsv([
      ['Reference', 'Matter', 'Client', 'Lawyer', 'Opened', 'Conflict check', 'KYC', 'Power of attorney', 'POA expires', 'Engagement letter', 'Ready', 'Missing'],
      ...items.map((r) => [r.reference, r.title, r.client_name ?? '', r.lawyer_name ?? '', r.opened_on ? new Date(r.opened_on).toISOString().slice(0, 10) : '',
        r.checks.conflict, r.checks.kyc, r.checks.poa, r.poa_expires_on ?? '', r.checks.engagement, r.gaps.length ? 'no' : 'yes', r.gaps.join(' ')])
    ])
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="matter-onboarding-${today}.csv"`, 'cache-control': 'private, no-store' } })
  }
  return c.json({ items, required, summary: summarize(rows, required) })
})

onboardingRoutes.put('/settings', jsonBody(z.object({ required: z.array(z.enum(ONBOARDING_CHECKS)).max(4) })), async (c) => {
  requireRole(c, 'owner', 'admin')
  const { org } = auth(c)
  const required = [...new Set(c.req.valid('json').required)]
  await c.get('deps').db.query('UPDATE organizations SET onboarding_checks = $2 WHERE id = $1', [org.id, required])
  await audit(c, 'onboarding.settings_updated', 'organization', org.id, { required })
  return c.json({ required })
})

export default onboardingRoutes
