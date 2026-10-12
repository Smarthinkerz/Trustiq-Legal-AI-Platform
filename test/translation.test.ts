import { beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../src/lib/errors'
import {
  detectLanguage, parseGlossary, splitForTranslation, termsInText, translationMessages
} from '../src/services/translation'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const para = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${i + 1}. The ${word} shall pay the rent on time under clause ${i + 1}.`).join(' ')

// Makes the fake model "translate" by tagging each chunk, and records the prompts it was given.
function translatingAi(fail?: (n: number) => boolean) {
  const original = ctx.ai.complete
  const prompts: string[] = []
  let n = 0
  ctx.ai.complete = async ({ messages }) => {
    n++
    prompts.push(messages.map((m) => m.content).join('\n---\n'))
    if (fail?.(n)) throw new HttpError(503, 'ai_busy', 'The AI service is busy. Please retry in a moment.')
    const text = messages.at(-1)!.content as string
    return { text: `«AR:${text.length}» ${text.slice(0, 12)}`, model: 'test-model', promptTokens: 5, completionTokens: 7 }
  }
  return { prompts, restore: () => { ctx.ai.complete = original } }
}

describe('document translation helpers', () => {
  it('splits long text at paragraph breaks into pieces that join back exactly', () => {
    const text = [para(40, 'Lessee'), para(40, 'Lessor'), para(40, 'Guarantor')].join('\n\n')
    const chunks = splitForTranslation(text, 3000)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every((c) => c.length <= 3000)).toBe(true)
    expect(chunks.length).toBeGreaterThan(2)
    expect(splitForTranslation('short')).toEqual(['short'])
    const noBreaks = 'x'.repeat(12000)
    expect(splitForTranslation(noBreaks, 5000).join('')).toBe(noBreaks)
  })

  it('detects the language, finds glossary terms and parses pasted glossaries', () => {
    expect(detectLanguage('يلتزم الطرف الأول بدفع الإيجار. Clause 5')).toBe('ar')
    expect(detectLanguage('The Lessee shall pay. البند')).toBe('en')
    expect(detectLanguage('12345', 'ar')).toBe('ar')

    const terms = [{ term_en: 'Lessee', term_ar: 'المستأجر' }, { term_en: 'Force majeure', term_ar: 'القوة القاهرة' }]
    expect(termsInText(terms, 'the LESSEE must', 'en').map((t) => t.term_en)).toEqual(['Lessee'])
    // Arabic matching ignores diacritics and alef/ta marbuta variants.
    expect(termsInText(terms, 'بسبب القوه القاهره', 'ar').map((t) => t.term_en)).toEqual(['Force majeure'])

    expect(parseGlossary('Lessee = المستأجر\nالمؤجر, Lessor\nStatement of claim\tصحيفة الدعوى\tKSA usage\njunk line\n= \nOnly English = Still English'))
      .toEqual([
        { term_en: 'Lessee', term_ar: 'المستأجر', note: null },
        { term_en: 'Lessor', term_ar: 'المؤجر', note: null },
        { term_en: 'Statement of claim', term_ar: 'صحيفة الدعوى', note: 'KSA usage' }
      ])
  })

  it('tells the model to translate faithfully into legal Arabic with the glossary', () => {
    const msgs = translationMessages('The Lessee shall pay.', 'en', 'ar', [{ term_en: 'Lessee', term_ar: 'المستأجر' }], 'previous part')
    const system = msgs[0]!.content as string
    expect(system).toContain('from English into Arabic')
    expect(system).toContain('Modern Standard Arabic')
    expect(system).toContain('- Lessee => المستأجر')
    expect(msgs.at(-1)!.content).toBe('The Lessee shall pay.')
    expect(msgs[1]!.content).toContain('previous part')
  })
})

describe('translating a document', () => {
  it('creates a linked Arabic translation in the background, chunk by chunk, using the glossary', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.post('/api/glossary', { term_en: 'Guarantor', term_ar: 'الكفيل' })).status).toBe(201)
    const content = [para(40, 'Lessee'), para(40, 'Lessor'), para(40, 'Guarantor')].join('\n\n')
    const { data: { document: src } } = await c.post('/api/documents', { title: 'Lease', content, language: 'en' })

    const ai = translatingAi()
    try {
      const res = await c.post(`/api/documents/${src.id}/translate`, {})
      expect(res.status).toBe(202)
      const id = res.data.document.id
      expect(res.data.document).toMatchObject({ language: 'ar', title: 'Lease (ترجمة عربية)', translation_status: 'running', translated_from: src.id })

      // Not editable until finished, and listed on the original.
      expect((await c.patch(`/api/documents/${id}`, { content: 'x' })).status).toBe(409)
      expect((await c.get(`/api/documents/${src.id}`)).data.translations).toMatchObject([{ id, language: 'ar', translation_status: 'running' }])

      await ctx.runDeferred()
      const { document: d } = (await c.get(`/api/documents/${id}`)).data
      const chunks = splitForTranslation(content)
      expect(chunks.length).toBeGreaterThan(1)
      expect(d).toMatchObject({ translation_status: 'done', translation_done: chunks.length, translation_total: chunks.length, translated_from_title: 'Lease', translation_stalled: false })
      expect(d.content).toBe(chunks.map((ch) => `«AR:${ch.trim().length}» ${ch.trim().slice(0, 12)}${ch.match(/\s*$/)![0]}`).join(''))
      expect(ai.prompts.some((p) => p.includes('- Guarantor => الكفيل'))).toBe(true)
      expect(ai.prompts[0]).not.toContain('Guarantor =>')

      const usage = await ctx.db.query(`SELECT feature, prompt_tokens FROM ai_usage WHERE feature = 'translate' AND user_id = (SELECT created_by FROM documents WHERE id = $1)`, [id])
      expect(usage).toEqual([{ feature: 'translate', prompt_tokens: 5 * chunks.length }])
      expect((await c.patch(`/api/documents/${id}`, { content: 'Reviewed' })).status).toBe(200)
    } finally { ai.restore() }
  })

  it('detects the real language, refuses a translation into the same language and too-long documents', async () => {
    const { c } = await registered(ctx.app)
    const { data: { document: ar } } = await c.post('/api/documents', { title: 'عقد', content: 'يلتزم الطرف الأول بدفع الإيجار في موعده.', language: 'en' })
    expect((await c.post(`/api/documents/${ar.id}/translate`, { target: 'ar' })).status).toBe(400)
    const ai = translatingAi()
    try {
      const res = await c.post(`/api/documents/${ar.id}/translate`, {})
      expect(res.data.document).toMatchObject({ language: 'en', title: 'عقد (English translation)' })
      await ctx.runDeferred()
      expect(ai.prompts[0]).toContain('from Arabic into English')
    } finally { ai.restore() }

    const { data: { document: empty } } = await c.post('/api/documents', { title: 'Empty', content: '  12  ' })
    expect((await c.post(`/api/documents/${empty.id}/translate`, {})).status).toBe(400)
    const { data: { document: big } } = await c.post('/api/documents', { title: 'Big', content: 'word '.repeat(90_000) })
    expect((await c.post(`/api/documents/${big.id}/translate`, {})).data.error.code).toBe('document_too_long')
  })

  it('marks a failed translation and lets the user retry it', async () => {
    const { c } = await registered(ctx.app)
    const content = [para(40, 'Lessee'), para(40, 'Lessor'), para(40, 'Agent')].join('\n\n')
    const { data: { document: src } } = await c.post('/api/documents', { title: 'Lease', content })
    let ai = translatingAi((n) => n === 2)
    let id: string
    try {
      id = (await c.post(`/api/documents/${src.id}/translate`, {})).data.document.id
      expect((await c.post(`/api/documents/${id}/translation/retry`)).status).toBe(409) // still running
      await ctx.runDeferred()
    } finally { ai.restore() }
    const failed = (await c.get(`/api/documents/${id}`)).data.document
    expect(failed).toMatchObject({ translation_status: 'failed', translation_error: 'The AI service is busy. Please retry in a moment.', translation_done: 1 })

    ai = translatingAi()
    try {
      expect((await c.post(`/api/documents/${id}/translation/retry`)).status).toBe(202)
      await ctx.runDeferred()
    } finally { ai.restore() }
    const done = (await c.get(`/api/documents/${id}`)).data.document
    expect(done).toMatchObject({ translation_status: 'done', translation_error: null })
    expect(done.content.match(/«AR:/g)).toHaveLength(splitForTranslation(content).length)
  })

  it('keeps documents and glossaries private to each firm', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    const { data: { document: src } } = await a.c.post('/api/documents', { title: 'Private', content: 'The Lessee shall pay.' })
    expect((await b.c.post(`/api/documents/${src.id}/translate`, {})).status).toBe(404)
    await a.c.post('/api/glossary', { term_en: 'Lessee', term_ar: 'المستأجر' })
    expect((await b.c.get('/api/glossary')).data.items).toEqual([])
  })
})

describe('legal glossary', () => {
  it('adds, imports, edits and deletes terms', async () => {
    const { c } = await registered(ctx.app)
    const { data: { term } } = await c.post('/api/glossary', { term_en: 'Lessee', term_ar: 'المستأجر', note: 'Oman' })
    expect((await c.post('/api/glossary', { term_en: 'lessee', term_ar: 'المستأجر' })).status).toBe(409)

    const imp = await c.post('/api/glossary/import', { text: 'Lessee = المستأجر\nLessor = المؤجر\nحكم ابتدائي, Judgment of first instance\nnot a term' })
    expect(imp.data).toEqual({ added: 2, updated: 1, skipped: 0 })
    expect((await c.post('/api/glossary/import', { text: 'nothing here' })).status).toBe(400)

    const list = (await c.get('/api/glossary')).data.items
    expect(list.map((t: any) => t.term_en)).toEqual(['Judgment of first instance', 'Lessee', 'Lessor'])
    expect(list.find((t: any) => t.term_en === 'Lessee').note).toBe('Oman')
    expect((await c.get('/api/glossary?q=المؤجر')).data.items).toHaveLength(1)

    expect((await c.patch(`/api/glossary/${term.id}`, { term_ar: 'المستأجِر', note: '' })).data.term).toMatchObject({ term_ar: 'المستأجِر', note: null })
    expect((await c.patch(`/api/glossary/${term.id}`, { term_en: 'Lessor' })).status).toBe(409)
    expect((await c.del(`/api/glossary/${term.id}`)).status).toBe(200)
    expect((await c.get('/api/glossary')).data.items).toHaveLength(2)
  })
})
