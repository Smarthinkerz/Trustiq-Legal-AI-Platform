import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain browser ESM without type declarations
import en from '../public/static/app/locales/en.js'
// @ts-expect-error plain browser ESM without type declarations
import ar from '../public/static/app/locales/ar.js'

const APP_DIR = join(__dirname, '../public/static/app')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'locales' ? [] : sources(p)
    return p.endsWith('.js') ? [readFileSync(p, 'utf8')] : []
  })
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  it('English and Arabic define exactly the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })

  it('placeholders match between languages', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]), k).toEqual(placeholders(en[k]))
  })

  it('every key referenced in the UI exists', () => {
    const code = sources(APP_DIR).join('\n')
    const literal = [...code.matchAll(/\bt\('([a-z_]+\.[a-z_0-9]+)'/g)].map((m) => m[1])
    const quoted = [...code.matchAll(/'((?:error|ai)\.[a-z_0-9]+)'/g)].map((m) => m[1])
    const missing = [...new Set([...literal, ...quoted])].filter((k) => !(k in en))
    expect(missing).toEqual([])
  })

  it('covers every enum value rendered dynamically', () => {
    const families: Record<string, string[]> = {
      status: ['active', 'pending', 'under_review', 'on_hold', 'closed', 'draft', 'review', 'final'],
      priority: ['low', 'medium', 'high', 'urgent'],
      severity: ['low', 'medium', 'high', 'critical'],
      role: ['owner', 'admin', 'lawyer', 'staff'],
      event: ['hearing', 'deadline', 'filing', 'meeting', 'reminder'],
      plan: ['trial', 'starter', 'professional', 'enterprise'],
      'analysis.type': ['summary', 'risk', 'compliance', 'review'],
      'docs.source': ['upload', 'ai', 'manual'],
      doctype: ['contract', 'correspondence', 'evidence', 'court_filing', 'other'],
      nav: ['dashboard', 'cases', 'clients', 'documents', 'assistant', 'calendar', 'settings', 'admin'],
      settings: ['profile', 'firm', 'team', 'branding', 'plan', 'audit']
    }
    const missing: string[] = []
    for (const [prefix, values] of Object.entries(families)) {
      for (const v of values) {
        const key = prefix.includes('.') ? `${prefix}_${v}` : `${prefix}.${v}`
        if (!(key in en)) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })
})
