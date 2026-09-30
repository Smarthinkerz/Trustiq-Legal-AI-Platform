import { HttpError } from '../lib/errors'

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
