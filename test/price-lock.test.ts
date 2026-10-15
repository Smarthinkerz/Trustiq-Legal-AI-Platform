import { beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../src/lib/logger'
import { runPriceNotices } from '../src/services/price-lock'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup({ TAP_SECRET_KEY: 'sk_test_x', TAP_WEBHOOK_SECRET: 'whsec_test_secret' }) })

// The same columns the v48 migration sets for firms on Professional at the price change.
const lock = (orgId: string, until: string) => ctx.db.query(
  `UPDATE organizations SET plan = 'professional', plan_expires_at = now() + interval '10 days', locked_plan = 'professional', locked_amount = 499, locked_currency = 'OMR', locked_until = $2 WHERE id = $1`, [orgId, until])

describe('grandfathered Professional price', () => {
  it('charges OMR 499 while the lock lasts and OMR 649 after it', async () => {
    const { c, me } = await registered(ctx.app)
    await lock(me.org.id, '2027-10-16T00:00:00+04:00')
    expect((await c.get('/api/auth/me')).data.prices.professional).toMatchObject({ amount: 499, currency: 'OMR', list_amount: 649 })
    expect((await c.get('/api/subscription')).data.prices.professional.amount).toBe(499)
    expect((await c.post('/api/subscription/checkout', { plan: 'professional' })).status).toBe(200)
    expect(ctx.tap.created.at(-1)!.amount).toBe(499)
    // Starter is not affected by a Professional lock.
    await c.post('/api/subscription/checkout', { plan: 'starter' })
    expect(ctx.tap.created.at(-1)!.amount).toBe(199)

    await ctx.db.query(`UPDATE organizations SET locked_until = now() - interval '1 minute' WHERE id = $1`, [me.org.id])
    await c.post('/api/subscription/checkout', { plan: 'professional' })
    expect(ctx.tap.created.at(-1)!.amount).toBe(649)

    // A firm without a lock pays the list price.
    const other = await registered(ctx.app)
    await other.c.post('/api/subscription/checkout', { plan: 'professional' })
    expect(ctx.tap.created.at(-1)!.amount).toBe(649)
  })

  it('emails the price notice 30 days ahead only when switched on', async () => {
    const { me, email } = await registered(ctx.app)
    await lock(me.org.id, new Date(Date.now() + 20 * 86400_000).toISOString())
    const log = createLogger('error', true)
    const mails: any[] = []
    const mailer = { configured: true, send: async (m: any) => { mails.push(m) } }
    expect(await runPriceNotices(ctx.db, mailer, ctx.config, log)).toBe(0) // off by default
    const on = { ...ctx.config, priceNoticeEmails: true }
    await runPriceNotices(ctx.db, mailer, on, log)
    const mine = mails.filter((m) => m.to === email)
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toBe('A change to your TrustiqLegal Professional price')
    expect(mine[0].text).toContain('OMR 649 a month')
    await runPriceNotices(ctx.db, mailer, on, log)
    expect(mails.filter((m) => m.to === email)).toHaveLength(1)
  })
})
