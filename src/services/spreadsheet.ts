import { unzipSync, strFromU8 } from 'fflate'

// ---------------------------------------------------------------------------
// Minimal spreadsheet reader for bulk imports: CSV/TSV and Excel .xlsx (first
// worksheet). Returns rows of trimmed strings; Excel date cells come back as
// their serial number, which the importer converts where a date is expected.
// ---------------------------------------------------------------------------

export class SpreadsheetError extends Error {}

const MAX_ROWS = 5000
const MAX_COLS = 60

export function parseSpreadsheet(bytes: Uint8Array, fileName: string): string[][] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) return trimRows(readXlsx(bytes))
  if (/\.xls$/i.test(fileName) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new SpreadsheetError('Old Excel (.xls) files are not supported. Save the sheet as .xlsx or CSV and try again.')
  }
  return trimRows(readCsv(decodeText(bytes)))
}

function trimRows(rows: string[][]): string[][] {
  const out = rows
    .map((r) => r.slice(0, MAX_COLS).map((v) => (v ?? '').replace(/ /g, ' ').trim()))
    .filter((r) => r.some((v) => v !== ''))
  if (out.length > MAX_ROWS + 1) throw new SpreadsheetError(`The sheet has more than ${MAX_ROWS} rows. Split it into smaller files.`)
  return out
}

// ---------------- CSV ----------------

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    // Arabic CSVs saved by older Excel versions use the Windows Arabic code page.
    return new TextDecoder('windows-1256').decode(bytes)
  }
}

export function readCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const)
  const delim = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// ---------------- XLSX ----------------

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&')

// Text of a shared string or inline string: the concatenation of its <t> runs.
const runsText = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('')

const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') && f.originalSize < 50 * 1024 * 1024 })
  } catch {
    throw new SpreadsheetError('The file could not be opened as an Excel workbook.')
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]!) : '')
  // The first sheet in workbook order, resolved through the workbook relationships.
  const workbook = text('xl/workbook.xml')
  const rels = text('xl/_rels/workbook.xml.rels')
  const firstRid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  let target = firstRid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`))?.[1] : undefined
  if (target) target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheetName = target && files[target] ? target : Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]
  if (!sheetName) throw new SpreadsheetError('The workbook has no worksheet.')
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]!))
  const rows: string[][] = []
  for (const r of text(sheetName).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!
      const inner = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1]
      const idx = ref ? colIndex(ref) : row.length
      if (idx >= MAX_COLS) continue
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = runsText(inner)
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else value = v != null ? decodeXml(v) : ''
      while (row.length < idx) row.push('')
      row[idx] = value
    }
    rows.push(row)
  }
  return rows
}
