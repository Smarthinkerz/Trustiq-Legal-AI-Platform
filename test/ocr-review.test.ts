import { beforeAll, describe, expect, it } from 'vitest'
import { verifyAnswer } from '../src/services/verify'
import { ocrReviewItems, verifyFields } from '../src/services/ai-guard'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('Library text read by OCR', () => {
  it('warns on citations until a lawyer marks the text as checked', async () => {
    const { c, me } = await registered(ctx.app)
    const form = new FormData()
    for (const [k, v] of Object.entries({ title: 'Scanned Labour Law', jurisdiction: 'oman', kind: 'law', language: 'en',
      text: 'Article 1\nThe employer shall pay the wage within seven days of its due date.' })) form.set(k, v)
    const up = await c.post('/api/library/sources', form)
    expect(up.status).toBe(201)
    const id = up.data.source.id as string
    // Stands in for an upload that went through OCR.
    await ctx.db.query('UPDATE library_sources SET ocr = true WHERE id = $1', [id])

    const verify = async () => {
      const [src] = await ctx.db.query<any>(
        `SELECT c.id AS chunk_id, s.id AS source_id, s.title, s.number, s.jurisdiction, s.kind, s.status, c.article_no, c.status AS article_status, c.text
           FROM library_chunks c JOIN library_sources s ON s.id = c.source_id WHERE s.id = $1 LIMIT 1`, [id])
      return verifyAnswer(ctx.db, { orgId: me.org.id, asOf: '2026-10-16',
        sources: [{ ...src, ref: 'S1', citation: 'Scanned Labour Law', changed_on: null, effective_from: null, effective_to: null }],
        answer: 'The wage is due within seven days [S1].' })
    }
    expect((await verify()).checks.some((x) => x.code === 'ocr_unreviewed')).toBe(true)
    expect((await c.get(`/api/library/sources/${id}`)).data.source).toMatchObject({ ocr: true, ocr_reviewed_at: null })

    expect((await c.post(`/api/library/sources/${id}/ocr-reviewed`, {})).status).toBe(200)
    expect((await verify()).checks.some((x) => x.code === 'ocr_unreviewed')).toBe(false)
  })

  it('lists passages a scan reader was unsure of, and never takes a value from them', async () => {
    const text = 'صدر الحكم بتاريخ [[?١٢]] رمضان ١٤٤٦ هـ بمبلغ ١٢5٠ ريال.\n[Pages 9–16 could not be read]\nAmount 2,400 OMR'
    expect(ocrReviewItems(text).map((x) => x.kind)).toEqual(['unsure', 'mixed_digits', 'unreadable'])
    const r = verifyFields({ d: '2025-03-12', a: 2400 }, { d: '١٢ رمضان ١٤٤٦ هـ', a: '2,400 OMR' }, text, { d: 'date', a: 'number' })
    expect(r.unverified).toEqual(['d'])
    expect(r.fields).toEqual({ d: '', a: 2400 })

    const { c, me } = await registered(ctx.app)
    const [doc] = await ctx.db.query<{ id: string }>(
      `INSERT INTO documents (org_id, title, doc_type, language, status, source, content, ocr) VALUES ($1, 'Scanned judgment', 'other', 'ar', 'draft', 'upload', $2, true) RETURNING id`, [me.org.id, text])
    const got = await c.get(`/api/documents/${doc!.id}`)
    expect(got.data.document.ocr_review.map((x: any) => x.kind)).toEqual(['unsure', 'mixed_digits', 'unreadable'])
  })
})
