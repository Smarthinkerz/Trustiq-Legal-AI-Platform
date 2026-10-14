import { beforeAll, describe, expect, it } from 'vitest'
import { align, bilingualPairs, leadNumber, paragraphs } from '../src/services/bilingual'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const EN = `LEASE AGREEMENT

1. The Landlord leases the flat to the Tenant for twelve (12) months.

2. The rent is OMR 450 per month, payable in advance on the first day of each month.

3. The Tenant shall not sublet the flat without the Landlord's written consent.

4. This Agreement is governed by the laws of the Sultanate of Oman.`

const AR = `عقد إيجار

١. يؤجر المؤجر الشقة للمستأجر لمدة اثني عشر (12) شهراً.

٢. الأجرة 450 ريالاً عُمانياً شهرياً.

تُدفع الأجرة مقدماً في اليوم الأول من كل شهر.

٣. لا يجوز للمستأجر تأجير الشقة من الباطن دون موافقة كتابية من المؤجر.

٤. يخضع هذا العقد لقوانين سلطنة عُمان.`

describe('bilingual alignment', () => {
  it('reads clause numbers in English and Arabic forms', () => {
    expect(leadNumber('12.3 Termination')).toBe('12.3')
    expect(leadNumber('Article 5 – Payment')).toBe('5')
    expect(leadNumber('المادة (٧): الإنهاء')).toBe('7')
    expect(leadNumber('ثانياً: الأجرة')).toBe('2')
    expect(leadNumber('The parties agree')).toBeNull()
    expect(paragraphs('a\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(paragraphs('a\nb\n\nc')).toEqual(['a\nb', 'c'])
  })

  it('pairs paragraphs one to one, and keeps numbering together when one side splits a clause', () => {
    const pairs = bilingualPairs(EN, AR)
    expect(pairs).toHaveLength(5)
    expect(pairs[0]).toMatchObject({ en: 'LEASE AGREEMENT', ar: 'عقد إيجار', flagged: false })
    expect(pairs[2]!.en).toMatch(/^2\. The rent/)
    expect(pairs[2]!.ar).toMatch(/^٢\. الأجرة[\s\S]*تُدفع الأجرة مقدماً/)
    expect(pairs[4]!.ar).toMatch(/^٤\./)
    expect(pairs.every((p) => !p.flagged)).toBe(true)
  })

  it('leaves a gap and flags it when a paragraph has no counterpart', () => {
    const en = ['1. First clause about the term of the lease.', '2. Second clause about rent and payment.', '3. Third clause on subletting.']
    const ar = ['١. البند الأول بشأن مدة الإيجار.', '٣. البند الثالث بشأن التأجير من الباطن.']
    const rows = align(en, ar)
    expect(rows.map((r) => [r.a.length, r.b.length])).toEqual([[1, 1], [1, 0], [1, 1]])
    const pairs = bilingualPairs(en.join('\n\n'), ar.join('\n\n'))
    expect(pairs.map((p) => p.flagged)).toEqual([false, true, false])
  })
})

describe('bilingual alignment with a split and a missing clause', () => {
  it('attaches the continuation to its clause and leaves a gap for the missing one', () => {
    const en = ['LEASE', '1. Term of twelve months from 1 November 2026.', '2. Rent of OMR 450 per month, payable in advance by bank transfer.',
      '3. A security deposit of OMR 900, refundable at the end of the lease.', '4. No subletting without written consent.']
    const ar = ['عقد إيجار', '١. مدة اثني عشر شهراً من 1 نوفمبر 2026.', '٢. أجرة 450 ريالاً شهرياً.', 'تُدفع مقدماً بتحويل بنكي.', '٤. لا يجوز التأجير من الباطن دون موافقة كتابية.']
    expect(align(en, ar).map((r) => [r.a.length, r.b.length])).toEqual([[1, 1], [1, 1], [1, 2], [1, 0], [1, 1]])
  })
})

describe('bilingual alignment invariants', () => {
  it('keeps every paragraph exactly once and in order, and stays fast on long contracts', () => {
    const words = ['party', 'shall', 'pay', 'الطرف', 'يلتزم', 'rent', 'الأجرة', 'term']
    const para = (i: number) => `${i % 3 ? `${i}. ` : ''}${Array.from({ length: 3 + ((i * 7) % 25) }, (_, k) => words[(i + k) % words.length]).join(' ')}`
    for (let t = 0; t < 50; t++) {
      const a = Array.from({ length: 1 + ((t * 5) % 23) }, (_, i) => para(i + t))
      const b = Array.from({ length: 1 + ((t * 3) % 19) }, (_, i) => para(i * 2 + t))
      const rows = align(a, b)
      expect(rows.flatMap((r) => r.a)).toEqual(a)
      expect(rows.flatMap((r) => r.b)).toEqual(b)
    }
    const big = Array.from({ length: 600 }, (_, i) => `${i + 1}. ${'The Contractor shall perform the works diligently. '.repeat(1 + (i % 4))}`)
    const bigAr = big.map((p, i) => `${i + 1}. ${'يلتزم المقاول بتنفيذ الأعمال بعناية. '.repeat(1 + (i % 4))}`)
    bigAr.splice(300, 1)
    const t0 = Date.now()
    const rows = align(big, bigAr)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(rows.flatMap((r) => r.b)).toEqual(bigAr)
    expect(rows.find((r) => r.b.length === 0)?.a[0]).toMatch(/^301\./)
  })
})

describe('bilingual export', () => {
  it('pairs a document with its translation and exports a side-by-side Word file', async () => {
    const { c, me } = await registered(ctx.app)
    const { data: { document: en } } = await c.post('/api/documents', { title: 'Lease agreement', content: EN, language: 'en' })
    expect((await c.get(`/api/documents/${en.id}/bilingual?format=json`)).status).toBe(400)
    const { data: { document: ar } } = await c.post('/api/documents', { title: 'عقد إيجار', content: AR, language: 'ar' })
    await ctx.db.query(`UPDATE documents SET translated_from = $1, translation_status = 'done' WHERE id = $2 AND org_id = $3`, [en.id, ar.id, me.org.id])

    const fromOriginal = await c.get(`/api/documents/${en.id}/bilingual?format=json`)
    expect(fromOriginal.data).toMatchObject({ english: { id: en.id }, arabic: { id: ar.id }, flagged: 0 })
    expect(fromOriginal.data.pairs).toHaveLength(5)
    const fromTranslation = await c.get(`/api/documents/${ar.id}/bilingual?format=json`)
    expect(fromTranslation.data.english.id).toBe(en.id)

    const docx = await c.get(`/api/documents/${ar.id}/bilingual?prevailing=ar`)
    expect(docx.status).toBe(200)
    expect(docx.res.headers.get('content-type')).toContain('wordprocessingml')

    await ctx.db.query(`UPDATE documents SET translation_status = 'running' WHERE id = $1`, [ar.id])
    expect((await c.get(`/api/documents/${en.id}/bilingual?partner=${ar.id}&format=json`)).status).toBe(400)

    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/documents/${en.id}/bilingual`)).status).toBe(404)
  })
})
