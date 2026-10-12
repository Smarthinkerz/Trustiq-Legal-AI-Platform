import type { Config } from '../config'
import { HttpError, unavailable } from '../lib/errors'
import type { Logger } from '../lib/logger'

type ContentPart = { type: 'text'; text: string } | { type: 'file'; file: { filename: string; file_data: string } }
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }
export type Completion = { text: string; model: string; promptTokens: number; completionTokens: number }

export interface AiService {
  configured: boolean
  model: string
  complete(opts: { messages: ChatMessage[]; json?: boolean; maxTokens?: number; temperature?: number }): Promise<Completion>
  // One landscape image as PNG/JPEG bytes (OpenAI Images API).
  generateImage(opts: { prompt: string }): Promise<{ bytes: Uint8Array; mime: string; model: string }>
  // Speech to text (OpenAI Audio API). `language` is an ISO-639-1 hint; omit to auto-detect.
  transcribe(opts: { bytes: Uint8Array; fileName: string; mime: string; language?: string; prompt?: string }): Promise<{ text: string; model: string; promptTokens: number; completionTokens: number }>
}

const OCR_PROMPT = `Transcribe all text in this document exactly as written, in its original language (Arabic and/or English).
Preserve article numbers, headings and paragraph breaks. Do not translate, summarise or add commentary.
Output plain text only.`

// Transcribes a scanned PDF using the model's document understanding (used when a PDF has no text layer).
export async function transcribePdf(ai: AiService, bytes: Uint8Array, fileName: string): Promise<Completion> {
  return ai.complete({
    messages: [{
      role: 'user',
      content: [
        { type: 'file', file: { filename: fileName, file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}` } },
        { type: 'text', text: OCR_PROMPT }
      ]
    }],
    maxTokens: 16000,
    temperature: 0
  })
}

// Talks to any OpenAI-compatible Chat Completions endpoint (OpenAI, Azure OpenAI proxy, etc.).
export function createAiService(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): AiService {
  const { apiKey, baseUrl, model, timeoutMs, imageModel, transcribeModel } = config.ai
  return {
    configured: !!apiKey,
    model,
    async transcribe({ bytes, fileName, mime, language, prompt }) {
      if (!apiKey) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
      const form = new FormData()
      form.set('file', new File([new Uint8Array(bytes)], fileName, { type: mime }))
      form.set('model', transcribeModel)
      form.set('response_format', 'json')
      if (language) form.set('language', language)
      if (prompt) form.set('prompt', prompt)
      let res: Response
      try {
        res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
          method: 'POST', signal: AbortSignal.timeout(Math.max(timeoutMs, 180_000)), headers: { authorization: `Bearer ${apiKey}` }, body: form
        })
      } catch (err) {
        log.error('transcription request failed', { err })
        throw unavailable('ai_unavailable', 'The speech service could not be reached. Please try again.')
      }
      const data: any = await res.json().catch(() => null)
      if (!res.ok) {
        log.error('transcription provider error', { status: res.status, error: data?.error?.message })
        if (res.status === 429) throw new HttpError(503, 'ai_busy', 'The speech service is busy. Please retry in a moment.')
        if (res.status === 400 && /format|decode|audio|duration|long/i.test(data?.error?.message ?? '')) {
          throw new HttpError(422, 'audio_unreadable', 'This recording could not be read. Try a shorter recording, or an MP3, M4A, OGG or WAV file.')
        }
        throw unavailable('ai_unavailable', 'The speech service returned an error. Please try again.')
      }
      const text = typeof data?.text === 'string' ? data.text.trim() : ''
      return { text, model: transcribeModel, promptTokens: data?.usage?.input_tokens ?? 0, completionTokens: data?.usage?.output_tokens ?? 0 }
    },
    async generateImage({ prompt }) {
      if (!apiKey) throw unavailable('ai_not_configured', 'The AI assistant is not configured for this deployment.')
      const dalle = imageModel.startsWith('dall-e')
      let res: Response
      try {
        res = await fetchImpl(`${baseUrl}/images/generations`, {
          method: 'POST',
          signal: AbortSignal.timeout(Math.max(timeoutMs, 120_000)),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: imageModel, prompt, n: 1, size: dalle ? '1792x1024' : '1536x1024', ...(dalle ? { response_format: 'b64_json' } : {}) })
        })
      } catch (err) {
        log.error('image request failed', { err })
        throw unavailable('ai_unavailable', 'The image service could not be reached. Please try again.')
      }
      const data: any = await res.json().catch(() => null)
      if (!res.ok) {
        log.error('image provider error', { status: res.status, error: data?.error?.message })
        if (res.status === 400 && /safety|policy|moderation/i.test(data?.error?.message ?? '')) {
          throw new HttpError(422, 'ai_image_refused', 'The image service declined this request. Try a different description.')
        }
        if (res.status === 429) throw new HttpError(503, 'ai_busy', 'The image service is busy. Please retry in a moment.')
        throw unavailable('ai_unavailable', 'The image service returned an error. Please try again.')
      }
      const b64 = data?.data?.[0]?.b64_json
      if (!b64) throw unavailable('ai_empty', 'The image service returned no image. Please try again.')
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
      return { bytes, mime: bytes[0] === 0xff ? 'image/jpeg' : 'image/png', model: imageModel }
    },
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
