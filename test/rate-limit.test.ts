import { beforeAll, describe, expect, it } from 'vitest'
import { RateLimiter, SharedRateLimits } from '../src/lib/rate-limit'
import { setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('rate limits shared between app instances', () => {
  it('adds up the hits of two instances through the database', async () => {
    const name = `test-${crypto.randomUUID().slice(0, 8)}`
    // Two app instances, each with its own limiter of the same name and its own sync.
    const a = new RateLimiter(5, 60_000)
    const b = new RateLimiter(5, 60_000)
    Object.assign(a, { name }); Object.assign(b, { name })
    const syncA = new SharedRateLimits(ctx.db, [a])
    const syncB = new SharedRateLimits(ctx.db, [b])
    for (let i = 0; i < 3; i++) expect(a.take('ip-1').ok).toBe(true)
    for (let i = 0; i < 2; i++) expect(b.take('ip-1').ok).toBe(true)
    await syncA.sync()
    await syncB.sync()
    await syncA.sync()
    // 5 hits so far across both: the next one on either instance is over the limit.
    expect(a.take('ip-1').ok).toBe(false)
    expect(b.take('ip-1').ok).toBe(false)
    // Other keys are unaffected.
    expect(a.take('ip-2').ok).toBe(true)
    const [row] = await ctx.db.query<{ count: number }>('SELECT count FROM rate_limit_hits WHERE name = $1 AND key = $2', [name, 'ip-1'])
    expect(Number(row!.count)).toBe(5)
  })

  it('keeps working in memory without sharing, with clock-aligned windows', () => {
    const l = new RateLimiter(2, 60_000)
    expect(l.take('k').ok).toBe(true)
    expect(l.take('k').ok).toBe(true)
    const r = l.take('k')
    expect(r.ok).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(r.retryAfterSec).toBeLessThanOrEqual(60)
  })
})
