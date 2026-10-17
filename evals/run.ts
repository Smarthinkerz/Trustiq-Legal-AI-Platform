import { mkdirSync, writeFileSync } from 'node:fs'
import { loadConfig } from '../src/config'
import { createLogger } from '../src/lib/logger'
import { createAiService, type AiService } from '../src/services/ai'
import { DOCUMENTS } from './features/documents'
import { READERS } from './features/readers'
import { RESEARCH } from './features/research'
import { countingAi, evalContext, type Feature, type Meter, type Outcome } from './lib'

// ---------------------------------------------------------------------------
// AI evaluation runner.
//
//   npx tsx evals/run.ts                      cost estimate only (no network, no charges)
//   npx tsx evals/run.ts --live               full run against the configured model (costs money)
//   npx tsx evals/run.ts --live --feature judgment_read,research_chat --limit 10
//
// A live run needs OPENAI_API_KEY (and optionally OPENAI_MODEL, OPENAI_BASE_URL) in the
// environment. Each feature runs on its own in-memory database; nothing touches production.
// Results are written to reports/evals/ as JSON and Markdown.
// ---------------------------------------------------------------------------

export const FEATURES: Feature[] = [...READERS, ...DOCUMENTS, ...RESEARCH]

type CaseResult = Outcome & { id: string; lang: string; trap?: string; error?: string }
export type FeatureResult = { feature: string; title: string; total: number; passed: number; pass_rate: number; wrong_cases: number; trap_total: number; trap_passed: number; results: CaseResult[] }

export async function runFeatures(ai: AiService, features: Feature[], opts: { limit?: number; concurrency?: number; onCase?: (f: string, r: CaseResult) => void } = {}): Promise<FeatureResult[]> {
  const out: FeatureResult[] = []
  for (const f of features) {
    const ctx = await evalContext(ai)
    const cases = f.cases.slice(0, opts.limit ?? f.cases.length)
    const results: CaseResult[] = new Array(cases.length)
    let next = 0
    const worker = async () => {
      while (next < cases.length) {
        const k = next++
        const c = cases[k]!
        let r: CaseResult
        try { r = { id: c.id, lang: c.lang, trap: c.trap, ...(await c.run(ctx)) } } catch (err) {
          r = { id: c.id, lang: c.lang, trap: c.trap, pass: false, wrong: [], missed: [], notes: [], error: err instanceof Error ? err.message : String(err) }
        }
        results[k] = r
        opts.onCase?.(f.feature, r)
      }
    }
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, cases.length) }, worker))
    await ctx.db.close?.()
    const traps = results.filter((r) => r.trap)
    out.push({
      feature: f.feature, title: f.title, total: results.length, passed: results.filter((r) => r.pass).length,
      pass_rate: results.length ? Math.round((1000 * results.filter((r) => r.pass).length) / results.length) / 10 : 0,
      wrong_cases: results.filter((r) => r.wrong.length).length, trap_total: traps.length, trap_passed: traps.filter((r) => r.pass).length, results
    })
  }
  return out
}

export function markdownReport(rows: FeatureResult[], meta: { model: string; date: string }) {
  const lines = [
    `# AI evaluation run, ${meta.date}`, '', `Model: ${meta.model}`, '',
    'Pass: every expected value right and nothing invented. Wrong: the AI stated something false or invented (the serious failure). Missed: the AI left out something that was in the source.', '',
    '| Feature | Cases | Pass rate | Cases with a wrong value | Traps passed |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.title} | ${r.total} | ${r.pass_rate}% | ${r.wrong_cases} | ${r.trap_passed}/${r.trap_total} |`), ''
  ]
  for (const r of rows) {
    const failed = r.results.filter((x) => !x.pass)
    if (!failed.length) continue
    lines.push(`## ${r.title}: ${failed.length} failed`, '')
    for (const x of failed.slice(0, 40)) lines.push(`- ${x.id} (${x.lang}${x.trap ? `, trap: ${x.trap}` : ''}): ${[x.error, ...x.wrong, ...x.missed].filter(Boolean).join('; ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '') : undefined }
  const live = args.includes('--live')
  const only = flag('--feature')?.split(',').map((s) => s.trim()).filter(Boolean)
  const limit = flag('--limit') ? Number(flag('--limit')) : undefined
  const features = only?.length ? FEATURES.filter((f) => only.includes(f.feature)) : FEATURES
  if (!features.length) throw new Error(`Unknown feature. Choose from: ${FEATURES.map((f) => f.feature).join(', ')}`)
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' })

  if (!live) {
    // Runs every case through the real pipeline with a counting AI, so the prompts measured are
    // exactly the ones a live run sends. Retries and long answers make a live run cost more.
    const meter: Meter = { calls: 0, inputTokens: 0, outputBudget: 0 }
    await runFeatures(countingAi(meter), features, { limit })
    const inUsd = (meter.inputTokens / 1e6) * config.ai.priceInputPerMTok
    const outUsd = (meter.outputBudget / 1e6) * config.ai.priceOutputPerMTok
    const cases = features.reduce((n, f) => n + Math.min(limit ?? f.cases.length, f.cases.length), 0)
    console.log(`Cost estimate for one run of ${cases} cases (${features.length} features), model ${config.ai.model}:`)
    console.log(`  AI requests: about ${meter.calls} (up to ${Math.round(meter.calls * 1.3)} with retries)`)
    console.log(`  Input: about ${(meter.inputTokens / 1e6).toFixed(2)}M tokens, USD ${inUsd.toFixed(2)} at USD ${config.ai.priceInputPerMTok}/M`)
    console.log(`  Output: about ${(meter.outputBudget / 1e6).toFixed(2)}M tokens, USD ${outUsd.toFixed(2)} at USD ${config.ai.priceOutputPerMTok}/M`)
    console.log(`  Total: about USD ${(inUsd + outUsd).toFixed(2)} (range USD ${((inUsd + outUsd) * 0.8).toFixed(2)} to ${((inUsd + outUsd) * 1.5).toFixed(2)})`)
    return
  }

  if (!config.ai.apiKey) throw new Error('Set OPENAI_API_KEY for a live run.')
  const ai = createAiService(config, createLogger('error', true))
  const rows = await runFeatures(ai, features, { limit, onCase: (f, r) => process.stdout.write(r.pass ? '.' : 'x') })
  const date = new Date().toISOString().slice(0, 16).replace(':', '')
  mkdirSync('reports/evals', { recursive: true })
  writeFileSync(`reports/evals/${date}.json`, JSON.stringify({ model: config.ai.model, date, rows }, null, 2))
  writeFileSync(`reports/evals/${date}.md`, markdownReport(rows, { model: config.ai.model, date }))
  console.log(`\n${rows.map((r) => `${r.title}: ${r.pass_rate}% (${r.passed}/${r.total})`).join('\n')}\nReport: reports/evals/${date}.md`)
}

if (process.argv[1]?.endsWith('run.ts')) main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
