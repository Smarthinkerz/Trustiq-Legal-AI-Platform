import type { Config } from '../config'
import { HttpError, unavailable } from '../lib/errors'
import type { Logger } from '../lib/logger'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type Completion = { text: string; model: string; promptTokens: number; completionTokens: number }

export interface AiService {
  configured: boolean
  model: string
  complete(opts: { messages: ChatMessage[]; json?: boolean; maxTokens?: number; temperature?: number }): Promise<Completion>
}

// Talks to any OpenAI-compatible Chat Completions endpoint (OpenAI, Azure OpenAI proxy, etc.).
export function createAiService(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): AiService {
  const { apiKey, baseUrl, model, timeoutMs } = config.ai
  return {
    configured: !!apiKey,
    model,
    async complete({ messages, json, maxTokens = 2000, temperature = 0.2 }) {
      if (!apiKey) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(json ? { response_format: { type: 'json_object' } } : {})
          })
        })
      } catch (err) {
        const aborted = (err as Error).name === 'AbortError'
        log.error('ai request failed', { err, aborted })
        throw unavailable('ai_unavailable', aborted ? 'The AI service took too long to respond. Please try again.' : 'The AI service could not be reached. Please try again.')
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        log.error('ai provider error', { status: res.status, body: body.slice(0, 500) })
        if (res.status === 429) throw new HttpError(503, 'ai_busy', 'The AI service is busy. Please retry in a moment.')
        if (res.status === 400 && /context_length|maximum context/i.test(body)) {
          throw new HttpError(422, 'ai_input_too_long', 'The request is too long for the AI model. Shorten the text or split the document.')
        }
        throw unavailable('ai_unavailable', 'The AI service returned an error. Please try again.')
      }

      const data: any = await res.json()
      const text: string = data?.choices?.[0]?.message?.content ?? ''
      if (!text) throw unavailable('ai_empty', 'The AI service returned an empty response. Please try again.')
      return {
        text,
        model: data.model ?? model,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0
      }
    }
  }
}
