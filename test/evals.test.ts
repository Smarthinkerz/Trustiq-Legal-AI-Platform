import { describe, expect, it } from 'vitest'
import { FEATURES, markdownReport, runFeatures } from '../evals/run'
import { countingAi, type Meter } from '../evals/lib'

describe('AI evaluation sets', () => {
  it('has at least 50 cases per AI feature, with trap cases and unique ids', () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(13)
    const ids = new Set<string>()
    for (const f of FEATURES) {
      expect(f.cases.length, f.feature).toBeGreaterThanOrEqual(50)
      expect(f.cases.filter((c) => c.trap).length, `${f.feature} traps`).toBeGreaterThanOrEqual(10)
      expect(new Set(f.cases.map((c) => c.lang)), `${f.feature} languages`).toEqual(new Set(['en', 'ar']))
      for (const c of f.cases) { expect(ids.has(c.id), c.id).toBe(false); ids.add(c.id) }
    }
  })

  it('runs every feature through the real pipeline and reports a pass rate', async () => {
    const meter: Meter = { calls: 0, inputTokens: 0, outputBudget: 0 }
    const rows = await runFeatures(countingAi(meter), FEATURES, { limit: 2 })
    // Every case reached its route and was graded; none crashed in the harness.
    for (const r of rows) for (const x of r.results) expect(x.error, `${r.feature}/${x.id}`).toBeUndefined()
    expect(meter.calls).toBeGreaterThanOrEqual(FEATURES.length)
    const md = markdownReport(rows, { model: 'cost-estimate', date: 'test' })
    expect(md).toContain('| Judgment reader | 2 |')
  }, 120_000)
})
