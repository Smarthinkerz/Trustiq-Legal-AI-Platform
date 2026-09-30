// Fixed-window in-memory limiter. Adequate for a single instance; move to Redis before
// running multiple replicas.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(private limit: number, private windowMs: number) {}

  take(key: string): { ok: boolean; retryAfterSec: number } {
    const now = Date.now()
    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    entry.count++
    if (this.hits.size > 50_000) this.sweep(now)
    return { ok: entry.count <= this.limit, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
  }
}
