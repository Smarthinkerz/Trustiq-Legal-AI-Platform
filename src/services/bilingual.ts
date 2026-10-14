import { AlignmentType, BorderStyle, Document, Footer, Header, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Bilingual side-by-side documents (English | العربية), as GCC contracts are
// signed. The original and its translation are aligned paragraph by paragraph:
// numbering acts as an anchor, and lengths decide where one side splits a
// paragraph that the other keeps whole (Gale–Church style dynamic programming).
// ---------------------------------------------------------------------------

export type Lang = 'en' | 'ar'
export type Pair = { en: string; ar: string; flagged: boolean }

// Paragraphs are separated by blank lines; single line breaks inside a paragraph are kept.
export function paragraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let cur: string[] = []
  const flush = () => { if (cur.length) out.push(cur.join('\n')); cur = [] }
  for (const l of lines) {
    if (l.trim()) cur.push(l.trimEnd())
    else flush()
  }
  flush()
  // A document written without blank lines: treat each line as a paragraph.
  return out.length === 1 && out[0]!.includes('\n') ? out[0]!.split('\n') : out
}

const ARABIC_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }
const ORDINALS: Record<string, string> = {
  'أولا': '1', 'ثانيا': '2', 'ثالثا': '3', 'رابعا': '4', 'خامسا': '5', 'سادسا': '6', 'سابعا': '7', 'ثامنا': '8', 'تاسعا': '9', 'عاشرا': '10'
}

// The clause number a paragraph starts with ("12.", "3.1", "(b)", "Article 5", "المادة (5)", "أولاً"), if any.
export function leadNumber(p: string): string | null {
  const s = p.trim().replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d]!).replace(/[ًٌٍَُِّْ]/g, '')
  const word = s.match(/^(أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا)/)
  if (word) return ORDINALS[word[1]!]!
  const m = s.match(/^(?:(?:article|clause|section|المادة|البند|مادة|بند)\s*\(?\s*)?(\d+(?:\.\d+)*)\s*[).:\-–]?/i)
  return m ? m[1]! : null
}

const digits = (s: string) => (s.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d]!).match(/\d+(?:[.,]\d+)*/g) ?? []).join(' ')

// Aligns two paragraph lists. Moves: 1-1, 1-2, 2-1, 1-0, 0-1.
export function align(a: string[], b: string[]): Array<{ a: string[]; b: string[] }> {
  if (a.length === b.length && a.every((p, i) => (leadNumber(p) ?? '') === (leadNumber(b[i]!) ?? ''))) return a.map((p, i) => ({ a: [p], b: [b[i]!] }))
  // Per-paragraph facts, computed once.
  const facts = (ps: string[]) => ps.map((p) => ({ len: p.length, num: leadNumber(p), digits: digits(p) }))
  const fa = facts(a)
  const fb = facts(b)
  const ratio = (fb.reduce((x, y) => x + y.len, 0) || 1) / (fa.reduce((x, y) => x + y.len, 0) || 1)
  const numsA = new Set(fa.map((f) => f.num).filter(Boolean))
  const numsB = new Set(fb.map((f) => f.num).filter(Boolean))
  // Cost of pairing a[i0, i1) with b[j0, j1).
  const pairCost = (i0: number, i1: number, j0: number, j1: number) => {
    let x = 0, y = 0, numA = 0, numB = 0
    for (let k = i0; k < i1; k++) { x += fa[k]!.len; if (fa[k]!.num) numA++ }
    for (let k = j0; k < j1; k++) { y += fb[k]!.len; if (fb[k]!.num) numB++ }
    x *= ratio
    const gap = i1 === i0 || j1 === j0
    // Lengths only compare text on both sides; a gap's fixed cost is in its move penalty.
    let c = gap ? 0 : Math.abs(x - y) / (x + y + 20)
    const na = i1 > i0 ? fa[i0]!.num : null
    const nb = j1 > j0 ? fb[j0]!.num : null
    if (na && nb) c += na === nb ? -0.6 : 0.8
    // A clause number found on one side only marks a clause missing on the other side:
    // a gap is expected there, and pairing it with an unnumbered paragraph is not.
    else if ((na && !numsB.has(na)) || (nb && !numsA.has(nb))) c += gap ? -0.5 : 1.6
    else if (na || nb) c += 0.15
    // Two separately numbered clauses never merge into one: that is a missing clause, not a split.
    if (numA > 1 || numB > 1) c += 1.5
    if (i1 - i0 === 1 && j1 - j0 === 1 && fa[i0]!.digits && fa[i0]!.digits === fb[j0]!.digits) c -= 0.2
    return c
  }
  const n = a.length
  const m = b.length
  // Translations stay near the diagonal; searching a band keeps long contracts fast.
  const band = Math.max(30, Math.abs(n - m) + 30)
  const inBand = (i: number, j: number) => Math.abs(j - Math.round((i * m) / Math.max(n, 1))) <= band
  const INF = 1e9
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF))
  const back: Array<Array<[number, number]>> = Array.from({ length: n + 1 }, () => Array<[number, number]>(m + 1).fill([0, 0]))
  cost[0]![0] = 0
  const moves: Array<[number, number, number]> = [[1, 1, 0], [1, 2, 0.35], [2, 1, 0.35], [1, 0, 1.2], [0, 1, 1.2]]
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if ((i === 0 && j === 0) || !inBand(i, j)) continue
      for (const [di, dj, pen] of moves) {
        if (i < di || j < dj || cost[i - di]![j - dj]! >= INF) continue
        const c = cost[i - di]![j - dj]! + pen + pairCost(i - di, i, j - dj, j)
        if (c < cost[i]![j]!) { cost[i]![j] = c; back[i]![j] = [di, dj] }
      }
    }
  }
  // Outside the band (unusual inputs), fall back to pairing in order.
  if (cost[n]![m]! >= INF) {
    const k = Math.max(n, m)
    return Array.from({ length: k }, (_, i) => ({ a: i < n ? [a[i]!] : [], b: i < m ? [b[i]!] : [] }))
  }
  const out: Array<{ a: string[]; b: string[] }> = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const [di, dj] = back[i]![j]!
    out.push({ a: a.slice(i - di, i), b: b.slice(j - dj, j) })
    i -= di
    j -= dj
  }
  return out.reverse()
}

// English and Arabic rows; a row is flagged when one side is empty or the numbering disagrees.
export function bilingualPairs(en: string, ar: string): Pair[] {
  return align(paragraphs(en), paragraphs(ar)).map(({ a, b }) => {
    const left = a.join('\n\n')
    const right = b.join('\n\n')
    const na = a.length ? leadNumber(a[0]!) : null
    const nb = b.length ? leadNumber(b[0]!) : null
    return { en: left, ar: right, flagged: !left || !right || (!!na && !!nb && na !== nb) }
  })
}

export const PREVAILING: Record<'en' | 'ar', { en: string; ar: string }> = {
  ar: {
    en: 'This document is made in Arabic and English. In case of any conflict or difference between the two texts, the Arabic text shall prevail.',
    ar: 'حُرر هذا المستند باللغتين العربية والإنجليزية، وفي حال وجود أي تعارض أو اختلاف بين النصين يُعتمد النص العربي.'
  },
  en: {
    en: 'This document is made in Arabic and English. In case of any conflict or difference between the two texts, the English text shall prevail.',
    ar: 'حُرر هذا المستند باللغتين العربية والإنجليزية، وفي حال وجود أي تعارض أو اختلاف بين النصين يُعتمد النص الإنجليزي.'
  }
}

export async function renderBilingualDocx(o: {
  titleEn: string; titleAr: string; pairs: Pair[]; prevailing: 'en' | 'ar' | null; letterhead?: Letterhead | null; firmName: string
}) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const cellBorders = { top: none, bottom: none, left: none, right: none }
  const paras = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number } = {}) =>
    (text ? text.split('\n') : ['']).map((line) => new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
      spacing: { after: 80, line: 290 },
      children: [new TextRun({ text: line, bold: opts.bold, size: opts.size ?? 21, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
    }))
  const row = (en: string, ar: string, opts: { bold?: boolean; size?: number; shade?: boolean } = {}) => new TableRow({
    cantSplit: false,
    children: [
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: { ...cellBorders, right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' } },
        shading: opts.shade ? { fill: 'F1F5F9' } : undefined, margins: { top: 60, bottom: 60, left: 80, right: 160 }, children: paras(en, false, opts) }),
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: cellBorders,
        shading: opts.shade ? { fill: 'F1F5F9' } : undefined, margins: { top: 60, bottom: 60, left: 160, right: 80 }, children: paras(ar, true, opts) })
    ]
  })
  const rows = [
    new TableRow({ tableHeader: true, children: [
      new TableCell({ borders: cellBorders, shading: { fill: 'E2E8F0' }, children: paras('English', false, { bold: true, size: 18 }) }),
      new TableCell({ borders: cellBorders, shading: { fill: 'E2E8F0' }, children: paras('العربية', true, { bold: true, size: 18 }) })
    ] }),
    row(o.titleEn, o.titleAr, { bold: true, size: 26 }),
    ...o.pairs.map((p) => row(p.en, p.ar)),
    ...(o.prevailing ? [row(PREVAILING[o.prevailing].en, PREVAILING[o.prevailing].ar, { shade: true })] : [])
  ]
  const headerChildren = letterheadParagraphs(o.letterhead, false, 'Calibri', color)
  const doc = new Document({
    creator: o.firmName,
    title: `${o.titleEn} / ${o.titleAr}`,
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 900, right: 900 } } },
      headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 14, color: '777777', font: 'Calibri' })] })] }) },
      children: [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })]
    }]
  })
  return Packer.toBuffer(doc)
}
