import { beforeAll, describe, expect, it } from 'vitest'
import { platformKnowledge } from '../src/services/platform-help'
import { client, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('homepage assistant', () => {
  it('is on the English and Arabic homepages', async () => {
    const en = await client(ctx.app).get('/')
    expect(en.data).toContain('data-endpoint="/help/chat"')
    expect(en.data).toContain('/static/site/chat.js')
    const ar = await client(ctx.app).get('/ar')
    expect(ar.data).toContain('data-lang="ar"')
    expect(ar.data).toContain('مساعد TrustiqLegal')
  })

  it('answers from the platform knowledge and forbids legal advice', async () => {
    ctx.ai.nextReply = 'Start a 14-day free trial from the homepage.'
    const before = ctx.ai.calls.length
    const r = await client(ctx.app).post('/help/chat', { lang: 'en', messages: [{ role: 'user', content: 'How do I start?' }] })
    expect(r.status).toBe(200)
    expect(r.data.reply).toBe('Start a 14-day free trial from the homepage.')
    const system = ctx.ai.calls[before]![0]!.content as string
    expect(system).toContain('do not give legal advice')
    expect(system).toContain('Hijri (Umm al-Qura)')
    expect(system).toContain('199 OMR per month')
    expect(ctx.ai.calls[before]!.at(-1)).toEqual({ role: 'user', content: 'How do I start?' })
  })

  it('validates input and refuses cross-site posts', async () => {
    const anon = client(ctx.app)
    expect((await anon.post('/help/chat', { messages: [] })).status).toBe(400)
    expect((await anon.post('/help/chat', { messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400)
    expect((await anon.post('/help/chat', { messages: [{ role: 'user', content: 'hi' }] }, { origin: 'https://evil.test' })).status).toBe(403)
  })

  it('falls back to contact details when AI is unavailable', async () => {
    const plain = await setup()
    ;(plain.ai as any).configured = false
    const r = await client(plain.app).post('/help/chat', { lang: 'ar', messages: [{ role: 'user', content: 'مرحبا' }] })
    expect(r.data.fallback).toBe(true)
    expect(r.data.reply).toContain('support@trustiqlegal.com')
  })

  it('describes plans from the live plan limits', () => {
    const k = platformKnowledge({ salesEmail: 's@x.test', supportEmail: 'h@x.test', appUrl: 'https://app.test' })
    expect(k).toContain('Professional: 499 OMR per month')
    expect(k).toContain('Statement of Claim')
    expect(k).toContain('Sultanate of Oman')
  })
})
