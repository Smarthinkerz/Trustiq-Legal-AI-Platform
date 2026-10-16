import { describe, expect, it } from 'vitest'
import { numbersIn, unsupportedNumbers } from '../src/services/ai-guard'
import { checkTranslation } from '../src/services/translation'
import { checkSummaryFigures } from '../src/services/practice-insights'

describe('code checks on AI figures', () => {
  it('reads Arabic and Latin figures', () => {
    expect(numbersIn('OMR 12,500.50 and ٣٠ days, 2026')).toEqual([12500.5, 30, 2026])
    expect(unsupportedNumbers('Fees of 1,200 and 1,250', [1200])).toEqual([1250])
    expect(unsupportedNumbers('3 lawyers', [], 12)).toEqual([])
  })

  it('flags translations that drop or change figures, skip glossary terms, or stop early', () => {
    const terms = [{ term_en: 'gratuity', term_ar: 'مكافأة نهاية الخدمة', note: null }]
    const ok = checkTranslation('The gratuity of OMR 2,400 is due within 30 days.', 'تستحق مكافأة نهاية الخدمة البالغة ٢٤٠٠ ريال خلال ٣٠ يوماً.', { from: 'en', to: 'ar', terms, part: 1 })
    expect(ok).toEqual([])
    const bad = checkTranslation('The gratuity of OMR 2,400 is due within 30 days.', 'تستحق المكافأة البالغة ٢٥٠٠ ريال خلال ٣٠ يوماً.', { from: 'en', to: 'ar', terms, part: 2 })
    expect(bad.map((x) => x.kind)).toEqual(['figure', 'figure', 'glossary'])
    expect(checkTranslation('A long clause '.repeat(20), 'بند', { from: 'en', to: 'ar', terms: [], part: 3 }).map((x) => x.kind)).toEqual(['truncated'])
    expect(checkTranslation('Short text here.', 'نص قصير هنا.', { from: 'en', to: 'ar', terms: [], part: 4, finishReason: 'length' }).map((x) => x.kind)).toEqual(['truncated'])
  })

  it('removes partner summary lines with figures that are not in the data', () => {
    const data = { revenue: 12000, lawyers: [{ name: 'Ali', minutes: 600, utilisation_pct: 75 }] }
    const r = checkSummaryFigures({ headline: 'Revenue was OMR 12,000.', points: ['Ali logged 10 hours at 75% utilisation.', 'Revenue grew 18% on last period.'], actions: ['Bill the 40 open matters.'] }, data)
    expect(r.summary).toEqual({ headline: 'Revenue was OMR 12,000.', points: ['Ali logged 10 hours at 75% utilisation.'], actions: [] })
    expect(r.removed).toBe(2)
  })
})
