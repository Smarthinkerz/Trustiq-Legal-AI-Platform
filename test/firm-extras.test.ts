import { beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../src/lib/logger'
import { runFairUseAlerts } from '../src/services/fair-use'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ TAP_SECRET_KEY: 'sk_test_x', TAP_WEBHOOK_SECRET: 'whsec_test_secret', PLATFORM_ADMIN_EMAILS: 'ops-extras@trustiq.test' }) })

const addAiUsage = (orgId: string, n: number) =>
  ctx.db.query(`INSERT INTO ai_usage (org_id, feature, model, prompt_tokens, completion_tokens) SELECT $1, 'chat', 'gpt-4.1', 3000, 600 FROM generate_series(1, $2)`, [orgId, n])

describe('extra AI requests', () => {
  it('sells a 500 request pack for this month without changing the plan', async () => {
    const { c, me } = await registered(ctx.app)
    expect((await c.post('/api/subscription/ai-pack', {})).status).toBe(400) // trial
    await ctx.db.query(`UPDATE organizations SET plan = 'starter', plan_expires_at = now() + interval '20 days' WHERE id = $1`, [me.org.id])
    const before = await ctx.db.one('SELECT plan_expires_at FROM organizations WHERE id = $1', [me.org.id])
    const sub = await c.get('/api/subscription')
    expect(sub.data.ai_pack).toMatchObject({ requests: 500, amount: 25, currency: 'OMR', available: true, bought_this_month: 0 })

    const r = await c.post('/api/subscription/ai-pack', {})
    expect(r.status).toBe(200)
    const body = ctx.tap.created.at(-1)!
    expect(body).toMatchObject({ amount: 25, currency: 'OMR' })
    expect(body.metadata.kind).toBe('ai_pack')
    const charge = [...ctx.tap.charges.values()].at(-1)!
    charge.status = 'CAPTURED'
    expect((await ctx.app.request(`/billing/tap/return?tap_id=${charge.id}`)).headers.get('location')).toContain('payment=success')
    await ctx.app.request(`/billing/tap/return?tap_id=${charge.id}`)

    expect((await c.get('/api/subscription')).data.ai_pack.bought_this_month).toBe(500)
    const after = await ctx.db.one('SELECT plan, plan_expires_at FROM organizations WHERE id = $1', [me.org.id])
    expect(after!.plan).toBe('starter')
    expect(new Date(after!.plan_expires_at).getTime()).toBe(new Date(before!.plan_expires_at).getTime())
    expect(ctx.mails.at(-1)!.text).toContain('500 extra AI requests for this month')

    // The pack raises this month's AI limit.
    await addAiUsage(me.org.id, 300)
    ctx.ai.nextReply = 'ok'
    expect((await c.post('/api/ai/chat', { message: 'Hello' })).status).toBe(200)
  })
})

describe('Enterprise fair use', () => {
  it('alerts the team at 80% and 100% once a month and never blocks', async () => {
    const { c, me } = await registered(ctx.app)
    await ctx.db.query(`UPDATE organizations SET plan = 'enterprise', lawyer_seats = 30, plan_expires_at = now() + interval '1 year' WHERE id = $1`, [me.org.id])
    const log = createLogger('error', true)
    const run = () => runFairUseAlerts(ctx.db, { configured: true, send: async (m) => { ctx.mails.push(m) } }, ctx.config, log)
    // 30 lawyers: 12,000 AI requests a month.
    await addAiUsage(me.org.id, 9700)
    const before = ctx.mails.length
    await run()
    const alert = ctx.mails.slice(before).find((m) => m.subject.includes(`Fair use 80%: Firm`))
    expect(alert).toBeTruthy()
    expect(alert!.to).toBe('reply@smarthinkerz.com')
    expect(alert!.text).toContain('AI requests: 9700 of 12000')
    const count = ctx.mails.length
    await run()
    expect(ctx.mails.length).toBe(count)
    await addAiUsage(me.org.id, 2400)
    await run()
    expect(ctx.mails.at(-1)!.subject).toContain('Fair use 100%')
    ctx.ai.nextReply = 'still fine'
    expect((await c.post('/api/ai/chat', { message: 'Hello' })).status).toBe(200)
  })
})

describe('data deletion requests', () => {
  it('lets the owner ask, emails the team and records the decision', async () => {
    const { c } = await registered(ctx.app)
    const cl = (await c.post('/api/clients', { kind: 'individual', name: 'Ahmed Client' })).data.client
    expect((await c.post('/api/org/deletion-requests', { scope: 'client' })).status).toBe(400)
    const r = await c.post('/api/org/deletion-requests', { scope: 'client', client_id: cl.id, reason: 'Client asked' })
    expect(r.status).toBe(201)
    expect(ctx.mails.at(-1)!.subject).toContain('client Ahmed Client')
    expect((await c.post('/api/org/deletion-requests', { scope: 'client', client_id: cl.id })).status).toBe(409)
    expect((await c.get('/api/org/deletion-requests')).data.items[0]).toMatchObject({ scope: 'client', client_name: 'Ahmed Client', status: 'requested' })

    const ops = await registered(ctx.app)
    expect((await ops.c.get('/api/admin/deletion-requests')).status).toBe(403)
    await ctx.db.query(`UPDATE deletion_requests SET status = 'requested' WHERE id = $1`, [r.data.id])
    const admin = await registered(ctx.app, { email: 'ops-extras@trustiq.test' })
    const list = await admin.c.get('/api/admin/deletion-requests')
    expect(list.data.items.some((x: any) => x.id === r.data.id)).toBe(true)
    expect((await admin.c.patch(`/api/admin/deletion-requests/${r.data.id}`, { status: 'completed', decision_note: 'Deleted on 15/10/2026' })).status).toBe(200)
    expect((await c.get('/api/org/deletion-requests')).data.items[0]).toMatchObject({ status: 'completed', decision_note: 'Deleted on 15/10/2026' })
    expect((await c.del(`/api/org/deletion-requests/${r.data.id}`)).status).toBe(404)

    // AI cost per request and the pack margin come from recorded token usage.
    const cost = await admin.c.get('/api/admin/ai-cost?days=30')
    expect(cost.status).toBe(200)
    expect(cost.data.cost_per_request_usd).toBeGreaterThan(0)
    expect(cost.data.ai_pack.omr).toMatchObject({ price: 25 })
    expect(cost.data.ai_pack.omr.margin_percent).toBeGreaterThan(0)
  })
})
