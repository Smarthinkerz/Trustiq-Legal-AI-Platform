import { beforeAll, describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/services/ai'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('research across languages', () => {
  it('translates a question that finds nothing in its own language and searches again', async () => {
    const { c } = await registered(ctx.app)
    const form = new FormData()
    for (const [k, v] of Object.entries({ title: 'Test Agencies Law', number: '91/2030', year: '2030', jurisdiction: 'oman', kind: 'royal_decree', language: 'en',
      text: 'Article 3\nAn agency contract must be registered with the Ministry within sixty days of its signature.' })) form.set(k, v)
    expect((await c.post('/api/library/sources', form)).status).toBe(201)
    ctx.ai.complete = async ({ messages }: { messages: ChatMessage[] }) => {
      ctx.ai.calls.push(messages)
      const system = String(messages[0]!.content)
      // First call: the translation of the Arabic question; second: the answer, citing the source.
      const text = system.startsWith('Translate') ? 'Within what period must an agency contract be registered?'
        : 'The contract must be registered within sixty days [S1].'
      return { text, model: 'test-model', promptTokens: 5, completionTokens: 5 }
    }
    const r = await c.post('/api/ai/chat', { message: 'خلال أي مدة يجب تسجيل عقد الوكالة التجارية؟', jurisdiction: 'oman', language: 'ar' })
    expect(r.status).toBe(200)
    expect(r.data.abstained).toBeNull()
    expect(r.data.translated_query).toBe('Within what period must an agency contract be registered?')
    expect(r.data.sources[0].citation).toContain('91/2030')
  })
})
