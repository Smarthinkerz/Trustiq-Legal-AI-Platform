import type { Queryable } from '../db'

// Fixed-window rate limiter. Windows are aligned to the clock (not to the first hit), so every
// instance agrees on when a window starts. With one instance the counts stay in memory. With
// several (RATE_LIMIT_STORE=db), each named limiter also adds its counts to PostgreSQL every few
// seconds and reads back the other instances' totals, so a limit holds across replicas. Decisions
// never wait for the database: they use the local count plus the last known total from the others,
// which can lag by one sync interval.

type Entry = { window: number; count: number; pending: number; others: number }

const named: RateLimiter[] = []

export class RateLimiter {
  readonly hits = new Map<string, Entry>()

  constructor(readonly limit: number, readonly windowMs: number, readonly name?: string) {
    // One limiter per name: a newer app instance in the same process (tests) replaces the older one.
    if (name) { const i = named.findIndex((l) => l.name === name); if (i >= 0) named.splice(i, 1); named.push(this) }
  }

  take(key: string): { ok: boolean; retryAfterSec: number } {
    const now = Date.now()
    const window = Math.floor(now / this.windowMs)
    let entry = this.hits.get(key)
    if (!entry || entry.window !== window) {
      entry = { window, count: 0, pending: 0, others: 0 }
      this.hits.set(key, entry)
    }
    entry.count++
    entry.pending++
    if (this.hits.size > 50_000) this.sweep(window)
    return { ok: entry.count + entry.others <= this.limit, retryAfterSec: Math.max(1, Math.ceil(((window + 1) * this.windowMs - now) / 1000)) }
  }

  // Whether `key` has used up the current window, without counting a hit (for limits on failures only).
  blocked(key: string): { blocked: boolean; retryAfterSec: number } {
    const now = Date.now()
    const window = Math.floor(now / this.windowMs)
    const entry = this.hits.get(key)
    const used = entry && entry.window === window ? entry.count + entry.others : 0
    return { blocked: used >= this.limit, retryAfterSec: Math.max(1, Math.ceil(((window + 1) * this.windowMs - now) / 1000)) }
  }

  private sweep(window: number) {
    for (const [k, v] of this.hits) if (v.window < window) this.hits.delete(k)
  }
}

// Shares the counts of named limiters through the rate_limit_hits table.
export class SharedRateLimits {
  constructor(private db: Queryable, private limiters: RateLimiter[] = named) {}

  async sync() {
    const names: string[] = [], keys: string[] = [], windows: number[] = [], adds: number[] = []
    const refs: { entry: Entry; flushed: number; countAtFlush: number }[] = []
    for (const l of this.limiters) {
      if (!l.name) continue
      const current = Math.floor(Date.now() / l.windowMs)
      for (const [key, entry] of l.hits) {
        if (entry.window !== current) continue
        names.push(l.name); keys.push(key); windows.push(entry.window * l.windowMs); adds.push(entry.pending)
        refs.push({ entry, flushed: entry.pending, countAtFlush: entry.count })
        entry.pending = 0
      }
    }
    if (!names.length) return 0
    try {
      const rows = await this.db.query<{ name: string; key: string; window_start: string; count: number }>(
        `INSERT INTO rate_limit_hits (name, key, window_start, count)
         SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[], $4::int[])
         ON CONFLICT (name, key, window_start) DO UPDATE SET count = rate_limit_hits.count + EXCLUDED.count
         RETURNING name, key, window_start, count`, [names, keys, windows, adds])
      const totals = new Map(rows.map((r) => [`${r.name}\u0000${r.key}\u0000${Number(r.window_start)}`, Number(r.count)]))
      refs.forEach((ref, i) => {
        const total = totals.get(`${names[i]}\u0000${keys[i]}\u0000${windows[i]}`)
        if (total !== undefined) ref.entry.others = Math.max(0, total - ref.countAtFlush)
      })
    } catch (err) {
      for (const r of refs) r.entry.pending += r.flushed
      throw err
    }
    return names.length
  }

  async prune(maxAgeMs = 24 * 3600_000) {
    await this.db.query('DELETE FROM rate_limit_hits WHERE window_start < $1', [Date.now() - maxAgeMs])
  }
}

// Starts sharing named limiters across instances; returns a stop function.
export function shareRateLimits(db: Queryable, onError: (err: unknown) => void, intervalMs = 2000) {
  const shared = new SharedRateLimits(db)
  let n = 0
  const timer = setInterval(() => {
    shared.sync().catch(onError)
    if (++n % 150 === 0) shared.prune().catch(onError)
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
