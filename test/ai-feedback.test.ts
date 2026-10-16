import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

const ADMIN = 'ops-feedback@trustiq.test'
let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ PLATFORM_ADMIN_EMAILS: ADMIN }) })

describe('Report a problem with AI output', () => {
  it('stores a report, links it to the AI log, and lets the platform team review it', async () => {
    const { c, me } = await registered(ctx.app)
    const org = me.org, user = me.user
    const [log] = await ctx.db.query<{ id: string }>(
      `INSERT INTO ai_use_log (org_id, user_id, feature, output_sha256, sources, output) VALUES ($1, $2, 'chat', 'x', '[]', 'Article 99 says so.') RETURNING id`, [org.id, user.id])
    const r = await c.post('/api/ai/feedback', { feature: 'chat', log_id: log!.id, reason: 'wrong_citation', excerpt: 'Article 99', note: 'There is no Article 99.' })
    expect(r.status).toBe(201)

    // Another firm cannot attach a report to this firm's log entry.
    const other = await registered(ctx.app)
    expect((await other.c.post('/api/ai/feedback', { feature: 'chat', log_id: log!.id, reason: 'other' })).status).toBe(404)
    expect((await c.post('/api/ai/feedback', { feature: 'chat', reason: 'made_up' })).status).toBe(400)

    // Only platform admins see the list.
    expect((await c.get('/api/admin/ai-feedback')).status).toBe(403)
    const admin = await registered(ctx.app, { email: ADMIN })
    const list = await admin.c.get('/api/admin/ai-feedback')
    expect(list.status).toBe(200)
    const item = list.data.items.find((i: any) => i.id === r.data.id)
    expect(item).toMatchObject({ feature: 'chat', reason: 'wrong_citation', status: 'open', log_output: 'Article 99 says so.' })

    expect((await admin.c.patch(`/api/admin/ai-feedback/${r.data.id}`, { status: 'fixed', resolution: 'Verifier now blocks it.' })).status).toBe(200)
    const open = await admin.c.get('/api/admin/ai-feedback')
    expect(open.data.items.some((i: any) => i.id === r.data.id)).toBe(false)
    const all = await admin.c.get('/api/admin/ai-feedback?status=all')
    expect(all.data.items.find((i: any) => i.id === r.data.id)).toMatchObject({ status: 'fixed', resolution: 'Verifier now blocks it.' })
  })
})
