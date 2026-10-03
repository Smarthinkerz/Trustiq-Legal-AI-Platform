import { HttpError } from '../lib/errors'
import type { Logger } from '../lib/logger'
import { transcribePdf, type AiService, type Completion } from './ai'

export type FileKind = 'pdf' | 'docx' | 'txt'

export const ACCEPTED_TYPES: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8'
}

// Detects the real file type from its bytes; the browser-supplied MIME type is not trusted.
export function detectKind(bytes: Uint8Array, fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split('.').pop()
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf' // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ext === 'docx') return 'docx' // ZIP container
  if ((ext === 'txt' || ext === 'md') && isLikelyText(bytes)) return 'txt'
  return null
}

function isLikelyText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 4096)
  for (const b of sample) if (b === 0) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length < bytes.length ? bytes.subarray(0, 4000) : sample)
    return true
  } catch {
    // A multi-byte character cut at the sample boundary is fine; re-check the whole file.
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true } catch { return false }
  }
}

export async function extractText(bytes: Uint8Array, kind: FileKind): Promise<string> {
  try {
    if (kind === 'txt') return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
    if (kind === 'docx') {
      const mammoth = await import('mammoth')
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      return value
    }
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await pdfText(pdf, { mergePages: false })
    return text.join('\n\n')
  } catch {
    throw new HttpError(422, 'unreadable_file', 'The file could not be read. It may be corrupted or password-protected.')
  }
}

export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

// A PDF without a text layer is a scan: fall back to AI transcription when available.
const looksScanned = (text: string) => text.replace(/\s/g, '').length < 200

// Older Arabic PDFs (e.g. Official Gazette issues) use legacy font encodings: their text layer
// comes out as Latin-1 symbols or replacement characters instead of Arabic letters.
export function looksGarbled(text: string): boolean {
  const chars = text.replace(/\s/g, '')
  if (chars.length < 200) return false
  const odd = chars.match(/[\u0080-\u00ff\u0192\u02c6\u02dc\u2013-\u203a\u2122\ufffd]/g)?.length ?? 0
  return odd / chars.length > 0.08
}

const OCR_PAGES_PER_CALL = 8
const MAX_OCR_PAGES = 400

// Splits a PDF into small page batches so long laws are transcribed in full.
async function pdfBatches(bytes: Uint8Array): Promise<{ from: number; to: number; bytes: Uint8Array }[] | null> {
  try {
    const { PDFDocument } = await import('pdf-lib')
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const total = Math.min(src.getPageCount(), MAX_OCR_PAGES)
    if (total <= OCR_PAGES_PER_CALL) return null
    const out: { from: number; to: number; bytes: Uint8Array }[] = []
    for (let from = 0; from < total; from += OCR_PAGES_PER_CALL) {
      const to = Math.min(from + OCR_PAGES_PER_CALL, total)
      const part = await PDFDocument.create()
      const pages = await part.copyPages(src, Array.from({ length: to - from }, (_, i) => from + i))
      for (const pg of pages) part.addPage(pg)
      out.push({ from: from + 1, to, bytes: await part.save() })
    }
    return out
  } catch {
    return null
  }
}

export async function extractWithOcr(
  opts: { ai: AiService; log: Logger; onAiUsage?: (c: Completion) => Promise<void>; onProgress?: () => Promise<void> },
  bytes: Uint8Array, kind: FileKind, fileName: string
): Promise<{ text: string; ocr: boolean }> {
  const text = cleanText(await extractText(bytes, kind))
  const garbled = kind === 'pdf' && looksGarbled(text)
  if (kind !== 'pdf' || !(looksScanned(text) || garbled) || !opts.ai.configured) return { text, ocr: false }
  try {
    const batches = await pdfBatches(bytes)
    const parts: string[] = []
    if (!batches) {
      const result = await transcribePdf(opts.ai, bytes, fileName)
      await opts.onAiUsage?.(result)
      parts.push(result.text)
    } else {
      for (const b of batches) {
        try {
          const result = await transcribePdf(opts.ai, b.bytes, `${fileName} (pages ${b.from}-${b.to})`)
          await opts.onAiUsage?.(result)
          parts.push(result.text)
        } catch (err) {
          opts.log.warn('ocr batch failed', { err, fileName, from: b.from, to: b.to })
          parts.push(`[Pages ${b.from}–${b.to} could not be read]`)
        }
        await opts.onProgress?.()
      }
    }
    const ocrText = cleanText(parts.join('\n\n'))
    const useful = ocrText.replace(/\s/g, '').length >= 200
    return (garbled ? useful : ocrText.length > text.length) ? { text: ocrText, ocr: true } : { text, ocr: false }
  } catch (err) {
    // OCR is best-effort; the upload still succeeds with whatever text was found.
    opts.log.warn('ocr failed', { err, fileName })
    return { text, ocr: false }
  }
}
