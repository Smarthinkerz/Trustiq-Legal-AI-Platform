import type { Deps } from '../context'
import type { Queryable } from '../db'
import { HttpError } from '../lib/errors'
import type { ChatMessage } from './ai'
import { recordAiUsage } from './usage'

// ---------------------------------------------------------------------------
// Legal document translation, Arabic <-> English. A translation is a new
// document linked to its source; long documents are translated in chunks in
// the background, with the firm's glossary applied to every chunk.
// ---------------------------------------------------------------------------

export type Lang = 'en' | 'ar'
export const MAX_TRANSLATION_CHARS = 400_000
export const CHUNK_CHARS = 5000
export const MAX_RUNNING_PER_ORG = 3
// A running translation that has not written progress for this long is treated as stalled.
export const STALL_MS = 10 * 60_000

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g
const LATIN = /[A-Za-z]/g

// The language most of the text is written in (uploads are not always labelled correctly).
export function detectLanguage(text: string, fallback: Lang = 'en'): Lang {
  const ar = text.match(ARABIC)?.length ?? 0
  const en = text.match(LATIN)?.length ?? 0
  if (!ar && !en) return fallback
  return ar >= en ? 'ar' : 'en'
}

// Slices that concatenate back to exactly `text`, cut at paragraph breaks where possible.
export function splitForTranslation(text: string, max = CHUNK_CHARS): string[] {
  const out: string[] = []
  let pos = 0
  while (pos < text.length) {
    if (text.length - pos <= max) { out.push(text.slice(pos)); break }
    const window = text.slice(pos, pos + max)
    const min = Math.floor(max * 0.3)
    let cut = -1
    for (const re of [/\n[ \t]*\n\s*/g, /\n/g, /[.!?؟;؛:][)"'»”]?\s+/g, /\s+/g]) {
      let m: RegExpExecArray | null
      let last = -1
      re.lastIndex = 0
      while ((m = re.exec(window))) { if (m.index + m[0].length <= window.length) last = m.index + m[0].length; if (!m[0].length) re.lastIndex++ }
      if (last > min) { cut = last; break }
    }
    if (cut <= 0) cut = max
    out.push(text.slice(pos, pos + cut))
    pos += cut
  }
  return out
}

const normalizeAr = (s: string) => s.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')

export type GlossaryTerm = { term_en: string; term_ar: string; note?: string | null }

// Only the terms that occur in this chunk, so long glossaries don't crowd the prompt.
export function termsInText(terms: GlossaryTerm[], text: string, from: Lang, limit = 80): GlossaryTerm[] {
  const hay = from === 'ar' ? normalizeAr(text) : text.toLowerCase()
  return terms.filter((g) => {
    const needle = from === 'ar' ? normalizeAr(g.term_ar.trim()) : g.term_en.trim().toLowerCase()
    return needle.length > 0 && hay.includes(needle)
  }).slice(0, limit)
}

const LANG_NAME: Record<Lang, string> = { en: 'English', ar: 'Arabic' }

export function translationMessages(chunk: string, from: Lang, to: Lang, terms: GlossaryTerm[], previous = ''): ChatMessage[] {
  const glossary = terms.length
    ? `\nRequired terminology. Always translate these terms exactly as given:\n${terms.map((g) => from === 'en'
      ? `- ${g.term_en} => ${g.term_ar}${g.note ? ` (${g.note})` : ''}`
      : `- ${g.term_ar} => ${g.term_en}${g.note ? ` (${g.note})` : ''}`).join('\n')}\n`
    : ''
  const system = `You are an expert legal translator working for a law firm in the GCC. Translate the user's text from ${LANG_NAME[from]} into ${LANG_NAME[to]}.
Rules:
- Translate completely and faithfully: every sentence, clause, number, date and amount. Do not summarise, omit, add, explain or comment.
- ${to === 'ar'
    ? 'Write formal Modern Standard Arabic in the legal register used in GCC contracts and court filings (for example الطرف الأول، يلتزم، بموجب، مع مراعاة).'
    : 'Write formal legal English as used in GCC contracts and court filings.'}
- Keep the structure exactly: headings, numbering (1., 1.1, (a), أولاً), article and clause references, line breaks, blank lines, lists and table rows with their separators.
- Transliterate names of people, companies and places consistently instead of translating their meaning. Keep ID, registration and case numbers, e-mail addresses, URLs and codes unchanged.
- Keep numbers in the digits used in the source and keep currency codes (OMR, AED, SAR, QAR, KWD, BHD).
- If part of the source is illegible or garbled, translate what is there and mark the gap [unclear].
- The text may be one part of a longer document; translate only this part.${glossary}
Output only the translation.`
  const msgs: ChatMessage[] = [{ role: 'system', content: system }]
  if (previous.trim()) {
    msgs.push({ role: 'user', content: `For consistency of names and terms only, this is how the preceding part was translated (do not repeat it):\n<<<\n${previous.slice(-800)}\n>>>` })
    msgs.push({ role: 'assistant', content: 'Understood.' })
  }
  msgs.push({ role: 'user', content: chunk })
  return msgs
}

// Strips wrappers models sometimes add around the translation.
export function cleanTranslation(text: string): string {
  return text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').replace(/^<<<\n?/, '').replace(/\n?>>>\s*$/, '').trim()
}

export const translationTitle = (title: string, to: Lang) =>
  (to === 'ar' ? `${title} (ترجمة عربية)` : `${title} (English translation)`).slice(0, 300)

// Translates the source of document `id` into it, chunk by chunk. Safe to call again after a failure:
// it starts over from an empty document.
export async function runTranslation(deps: Pick<Deps, 'db' | 'ai' | 'log'>, id: string) {
  const { db, ai, log } = deps
  const doc = await db.one(
    `SELECT d.id, d.org_id, d.created_by, d.language, d.translated_from, s.content AS source, s.language AS source_language
       FROM documents d LEFT JOIN documents s ON s.id = d.translated_from
      WHERE d.id = $1 AND d.translation_status = 'running'`, [id])
  if (!doc) return
  const usage = { model: ai.model, promptTokens: 0, completionTokens: 0 }
  try {
    if (doc.source == null) throw new HttpError(409, 'source_missing', 'The original document was deleted.')
    const to: Lang = doc.language
    const from: Lang = detectLanguage(doc.source, doc.source_language === to ? (to === 'en' ? 'ar' : 'en') : doc.source_language)
    const chunks = splitForTranslation(doc.source)
    const terms = await db.query<GlossaryTerm>('SELECT term_en, term_ar, note FROM glossary_terms WHERE org_id = $1', [doc.org_id])
    await db.query(`UPDATE documents SET content = '', translation_done = 0, translation_total = $2, translation_error = NULL, translation_heartbeat = now() WHERE id = $1`,
      [id, chunks.length])
    let previous = ''
    for (let i = 0; i < chunks.length; i++) {
      const [, lead, core, trail] = chunks[i].match(/^(\s*)([\s\S]*?)(\s*)$/)!
      let piece = chunks[i]
      if (/[\p{L}\p{N}]/u.test(core)) {
        const r = await ai.complete({ messages: translationMessages(core, from, to, termsInText(terms, core, from), previous), maxTokens: 8000, temperature: 0 })
        usage.model = r.model
        usage.promptTokens += r.promptTokens
        usage.completionTokens += r.completionTokens
        const translated = cleanTranslation(r.text)
        piece = lead + translated + trail
        previous = translated
      }
      const still = await db.query(
        `UPDATE documents SET content = content || $2, translation_done = $3, translation_heartbeat = now()
          WHERE id = $1 AND translation_status = 'running' RETURNING id`, [id, piece, i + 1])
      if (!still.length) return // deleted or restarted meanwhile
    }
    await db.query(`UPDATE documents SET translation_status = 'done', translation_heartbeat = now(), updated_at = now() WHERE id = $1 AND translation_status = 'running'`, [id])
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'The translation stopped unexpectedly. Please try again.'
    log.warn('document translation failed', { id, err })
    await db.query(`UPDATE documents SET translation_status = 'failed', translation_error = $2, updated_at = now() WHERE id = $1`, [id, message])
  } finally {
    if (usage.promptTokens || usage.completionTokens) await recordAiUsage(db, doc.org_id, doc.created_by, 'translate', usage).catch(() => {})
  }
}

export const isStalled = (d: { translation_status: string | null; translation_heartbeat: string | Date | null }, now = Date.now()) =>
  d.translation_status === 'running' && (!d.translation_heartbeat || now - new Date(d.translation_heartbeat).getTime() > STALL_MS)

export async function runningTranslations(db: Queryable, orgId: string) {
  const [{ n }] = await db.query(
    `SELECT count(*)::int AS n FROM documents WHERE org_id = $1 AND translation_status = 'running' AND translation_heartbeat > now() - interval '10 minutes'`, [orgId])
  return n as number
}

// "term = مصطلح" / "term,مصطلح" / tab separated, one per line; the Arabic side may come first.
export function parseGlossary(text: string): { term_en: string; term_ar: string; note: string | null }[] {
  const out: { term_en: string; term_ar: string; note: string | null }[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/\s*(?:\t|=|,|،|\|)\s*/).map((p) => p.trim().replace(/^"|"$/g, '')).filter(Boolean)
    if (parts.length < 2) continue
    const [a, b, ...rest] = parts
    const aAr = detectLanguage(a) === 'ar' && (a.match(ARABIC)?.length ?? 0) > 0
    const [en, ar] = aAr ? [b, a] : [a, b]
    if (!(ar.match(ARABIC)?.length) || !(en.match(LATIN)?.length)) continue
    out.push({ term_en: en.slice(0, 200), term_ar: ar.slice(0, 200), note: rest.join(', ').slice(0, 300) || null })
  }
  return out
}
