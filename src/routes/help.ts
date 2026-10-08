import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { clientIp, type AppEnv, type Deps } from '../context'
import { RateLimiter } from '../lib/rate-limit'
import { platformHelpFallback, platformHelpMessages, platformKnowledge } from '../services/platform-help'

// ---------------------------------------------------------------------------
// Assistant on the public homepage, answering questions about TrustiqLegal itself.
// No session; abuse is contained per IP and by a platform-wide daily cap.
// ---------------------------------------------------------------------------

const chatSchema = z.object({
  lang: z.enum(['en', 'ar']).default('en'),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) })).min(1).max(12)
}).refine((v) => v.messages.at(-1)?.role === 'user', { message: 'The last message must be from the visitor.' })

export function helpRoutes(deps: Deps) {
  const { config, log, ai } = deps
  const app = new Hono<AppEnv>()
  const perIp = new RateLimiter(20, 10 * 60_000)
  const daily = new RateLimiter(3000, 24 * 3600_000)
  const contact = { salesEmail: config.salesEmail, supportEmail: config.supportEmail, appUrl: config.appUrl }
  const knowledge = platformKnowledge(contact)

  app.post('/chat', bodyLimit({ maxSize: 32 * 1024 }), async (c) => {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(config.appUrl).origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: { code: 'forbidden', message: 'Cross-origin request blocked.' } }, 403)
    }
    const r = perIp.take(clientIp(c))
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfterSec))
      return c.json({ error: { code: 'rate_limited', message: 'Too many messages. Please wait a little.' } }, 429)
    }
    const parsed = chatSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: { code: 'bad_request', message: 'Invalid message.' } }, 400)
    const { lang, messages } = parsed.data
    const fallback = () => c.json({ reply: platformHelpFallback(lang, contact), fallback: true })
    if (!ai.configured || !daily.take('all').ok) return fallback()
    try {
      const result = await ai.complete({ messages: platformHelpMessages(knowledge, messages, lang), maxTokens: 500, temperature: 0.3 })
      log.info('platform help chat', { promptTokens: result.promptTokens, completionTokens: result.completionTokens })
      return c.json({ reply: result.text.trim().slice(0, 3000) })
    } catch (err) {
      log.warn('platform help chat failed', { err })
      return fallback()
    }
  })

  return app
}
