import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Config } from '../config'
import type { Db } from '../db'
import type { Logger } from '../lib/logger'
import type { AiService } from './ai'
import { ACCEPTED_TYPES, cleanText, detectKind, extractWithOcr, type FileKind } from './extract'
import { indexSource } from './library'
import { recordAiUsage } from './usage'

// ---------------------------------------------------------------------------
// Import laws into the library straight from official websites.
// Only government legislation sites are reachable (plus any extra domains the
// operator configures), every redirect is re-checked, private network addresses
// are refused, and downloads are size- and time-limited.
// ---------------------------------------------------------------------------

// Government domains across the GCC, plus official free-zone and legal portals.
export const DEFAULT_IMPORT_DOMAINS = [
  'gov.om', 'gov.ae', 'gov.sa', 'gov.qa', 'gov.bh', 'gov.kw',
  'almeezan.qa', 'difc.ae', 'adgm.com', 'qcb.gov.qa'
]

export type WebFetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>

export type ImportDeps = { db: Db; config: Config; ai: AiService; log: Logger; webFetch?: WebFetcher }

export class ImportError extends Error {}

const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 60_000
const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_TEXT = 3_000_000
const USER_AGENT = 'TrustiqLegal-LibraryImporter/1.0 (+legal research; contact via website)'

export function importDomains(config: Config): string[] {
  return [...DEFAULT_IMPORT_DOMAINS, ...config.libraryImportDomains]
}

// Returns the parsed URL when it may be fetched, otherwise null.
export function allowedUrl(raw: string, domains: string[]): URL | null {
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isIP(host)) return null
  if (url.port && url.port !== '443' && url.port !== '80') return null
  if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) return null
  url.hash = ''
  return url
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]!) : false
  }
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

// Default fetcher: refuses hosts that resolve to private or internal addresses.
export const safeWebFetch: WebFetcher = async (url, init) => {
  const host = new URL(url).hostname
  const addrs = await lookup(host, { all: true }).catch(() => { throw new ImportError(`The website ${host} could not be found.`) })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new ImportError(`The website ${host} is not reachable.`)
  return fetch(url, { ...init, redirect: 'manual' })
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > max) throw new ImportError(`The file is larger than ${Math.round(max / 1048576)} MB.`)
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) { await reader.cancel().catch(() => {}); throw new ImportError(`The file is larger than ${Math.round(max / 1048576)} MB.`) }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) { out.set(c, pos); pos += c.length }
  return out
}

export type Fetched = { url: string; contentType: string; bytes: Uint8Array }

// Fetches an allowed URL, following redirects only to other allowed URLs.
export async function fetchAllowed(deps: ImportDeps, raw: string, maxBytes: number): Promise<Fetched> {
  const domains = importDomains(deps.config)
  const fetcher = deps.webFetch ?? safeWebFetch
  const start = allowedUrl(raw, domains)
  if (!start) throw new ImportError('Only links to official government legislation websites can be imported.')
  let current: URL = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response
    try {
      res = await fetcher(current.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/pdf,*/*;q=0.8' } })
    } catch (err) {
      if (err instanceof ImportError) throw err
      throw new ImportError(`The website did not respond (${(err as Error).name === 'TimeoutError' ? 'timed out' : 'connection failed'}).`)
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      const next: URL | null = location ? allowedUrl(new URL(location, current).toString(), domains) : null
      if (!next) throw new ImportError('The website redirected to a location that cannot be imported.')
      current = next
      continue
    }
    if (!res.ok) throw new ImportError(`The website returned an error (HTTP ${res.status}).`)
    return { url: current.toString(), contentType: (res.headers.get('content-type') ?? '').toLowerCase(), bytes: await readCapped(res, maxBytes) }
  }
  throw new ImportError('Too many redirects.')
}

// ---------------- HTML helpers ----------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' }
const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
  }
  return ENTITIES[e.toLowerCase()] ?? m
})

export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
  const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase()
  try { return new TextDecoder(charset).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

const stripTags = (html: string) => decodeEntities(html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|blockquote)>/gi, '\n')
  .replace(/<(td|th)[^>]*>/gi, ' ')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()

export function htmlTitle(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const pick = (h1 && stripTags(h1)) || (title && stripTags(title))
  return pick ? pick.replace(/\s+/g, ' ').slice(0, 400) : null
}

// Main readable text: prefers <main>/<article>/content containers and drops navigation.
export function htmlToText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|form|select)[\s\S]*?<\/\1>/gi, '')
  const containers = [
    ...body.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi),
    ...body.matchAll(/<div\b[^>]*(?:id|class)=["'][^"']*\b(content|law-body|law-text|article-body|page-content)\b[^"']*["'][^>]*>([\s\S]*)/gi)
  ].map((m) => m[2]!)
  if (containers.length) body = containers.sort((a, b) => stripTags(b).length - stripTags(a).length)[0]!
  body = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '')
  return stripTags(body)
}

export type FoundLink = { url: string; text: string; pdf: boolean }

export function extractLinks(html: string, base: string, domains: string[]): FoundLink[] {
  const out = new Map<string, FoundLink>()
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1]!.trim())
    if (/^(mailto|tel|javascript|data):/i.test(href)) continue
    let abs: string
    try { abs = new URL(href, base).toString() } catch { continue }
    const url = allowedUrl(abs, domains)
    if (!url) continue
    const key = url.toString()
    const text = stripTags(m[2]!).replace(/\s+/g, ' ').trim()
    // A link to a document file (official PDFs, Word files or plain text).
    const pdf = /\.(pdf|docx|txt)(\?|$)/i.test(url.pathname + url.search)
    const prev = out.get(key)
    if (!prev || text.length > prev.text.length) out.set(key, { url: key, text: text.slice(0, 300), pdf })
  }
  return [...out.values()]
}

// ---------------- Metadata guessing ----------------

const arabicShare = (s: string) => {
  const letters = s.replace(/[^\p{L}]/gu, '')
  return letters ? (letters.match(/[؀-ۿ]/g)?.length ?? 0) / letters.length : 0
}

export function guessMeta(title: string, text: string) {
  const sample = `${title} ${text.slice(0, 1500)}`
  const nm = title.match(/(?:رقم|No\.?|Number)?\s*\(?\s*(\d{1,4})\s*\)?\s*[/\\]\s*(\d{4})/i) ?? sample.match(/(\d{1,4})\s*[/\\]\s*((?:19|20)\d{2})/)
  const year = nm ? Number(nm[2]) : Number(sample.match(/\b(19[5-9]\d|20[0-4]\d)\b/)?.[1] ?? 0) || null
  const t = title.toLowerCase()
  const kind = /مرسوم|royal decree|sultani decree/.test(t) ? 'royal_decree'
    : /قرار وزاري|ministerial (decision|resolution)/.test(t) ? 'ministerial_decision'
      : /لائحة|اللائحة|regulation/.test(t) ? 'regulation'
        : /تعميم|circular/.test(t) ? 'circular'
          : /حكم|judgment|ruling/.test(t) ? 'judgment'
            : /اتفاقية|treaty|convention/.test(t) ? 'treaty' : 'law'
  return { number: nm ? `${nm[1]}/${nm[2]}` : null, year: year && year >= 1800 && year <= 2100 ? year : null, kind, language: arabicShare(sample) >= 0.3 ? 'ar' : 'en' }
}

// ---------------- Discovering law links on a listing page ----------------

const NAV_WORDS = /^(home|login|log in|sign in|register|contact|about|search|privacy|terms|sitemap|faq|english|arabic|عربي|english version|الرئيسية|تسجيل|دخول|اتصل|اتصل بنا|تواصل معنا|من نحن|بحث|الخصوصية|الشروط|خريطة الموقع|next|previous|التالي|السابق|more|المزيد)$/i
const PAGINATION = /([/?&](?:page|p)[/=])(\d{1,4})/i

export function pageUrls(start: string, pages: number): string[] {
  const m = start.match(PAGINATION)
  if (!m || pages <= 1) return [start]
  const first = Number(m[2])
  return Array.from({ length: pages }, (_, i) => start.replace(PAGINATION, `${m[1]}${first + i}`))
}

export async function discoverLinks(deps: ImportDeps, startUrl: string, pages: number) {
  const domains = importDomains(deps.config)
  const urls = pageUrls(startUrl, Math.min(Math.max(pages, 1), 50))
  const scanned = new Set(urls.map((u) => allowedUrl(u, domains)?.toString()).filter(Boolean) as string[])
  const found = new Map<string, FoundLink>()
  let pagesRead = 0
  for (const u of urls) {
    let page: Fetched
    try { page = await fetchAllowed(deps, u, MAX_HTML_BYTES) } catch (err) {
      if (pagesRead === 0) throw err
      break // Ran past the last page.
    }
    pagesRead++
    if (!page.contentType.includes('html')) continue
    // Menus, headers and footers hold site navigation, not laws.
    const html = decodeHtml(page.bytes, page.contentType).replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, '')
    let added = 0
    for (const link of extractLinks(html, page.url, domains)) {
      if (scanned.has(link.url) || PAGINATION.test(new URL(link.url).pathname + new URL(link.url).search) && sameListing(link.url, startUrl)) continue
      if (!link.pdf && (link.text.length < 6 || NAV_WORDS.test(link.text))) continue
      if (!found.has(link.url)) { found.set(link.url, link); added++ }
    }
    // A page with nothing new means we have passed the end of the list.
    if (pagesRead > 1 && added === 0) break
  }
  return { pages_scanned: pagesRead, links: [...found.values()].slice(0, 3000) }
}

const sameListing = (a: string, b: string) => a.replace(PAGINATION, '$1') === b.replace(PAGINATION, '$1')

// ---------------- Processing one queued import ----------------

type ImportRow = {
  id: string; org_id: string; scope: 'org' | 'platform'; created_by: string | null; url: string; title: string | null
  jurisdiction: string; kind: string | null; language: string | null; status_hint: string | null
}

async function processImport(deps: ImportDeps, row: ImportRow): Promise<{ status: 'done' | 'skipped'; sourceId: string | null; detail: string | null }> {
  const { db, config, ai, log } = deps
  const ownerOrg = row.scope === 'platform' ? null : row.org_id
  const dup = await db.one(
    `SELECT id FROM library_sources WHERE source_url = $1 AND ${ownerOrg ? 'org_id = $2' : 'org_id IS NULL'} LIMIT 1`,
    ownerOrg ? [row.url, ownerOrg] : [row.url])
  if (dup) return { status: 'skipped', sourceId: dup.id, detail: 'Already in the library' }

  const maxFile = Math.max(config.maxUploadBytes, 25 * 1024 * 1024)
  let page = await fetchAllowed(deps, row.url, maxFile)
  let title = row.title?.trim() || null
  let text = ''
  let file: { name: string; mime: string; bytes: Uint8Array } | null = null
  let ocr = false
  const onAiUsage = row.created_by ? (r: any) => recordAiUsage(db, row.org_id, row.created_by!, 'ocr', r) : undefined

  const asFile = async (p: Fetched): Promise<boolean> => {
    const name = decodeURIComponent(new URL(p.url).pathname.split('/').pop() || 'law') || 'law'
    const guessName = /\.(pdf|docx|txt)$/i.test(name) ? name : `${name}.${p.contentType.includes('pdf') ? 'pdf' : p.contentType.includes('word') ? 'docx' : 'txt'}`
    const kind: FileKind | null = detectKind(p.bytes, guessName)
    if (!kind || (kind === 'txt' && p.contentType.includes('html'))) return false
    const extracted = await extractWithOcr({ ai, log, onAiUsage }, p.bytes, kind, guessName)
    text = extracted.text
    ocr = extracted.ocr
    file = { name: guessName.slice(0, 255), mime: ACCEPTED_TYPES[kind], bytes: p.bytes }
    return true
  }

  if (!(await asFile(page))) {
    if (!page.contentType.includes('html') && !page.contentType.includes('text/plain')) throw new ImportError('This link is not a web page, PDF or Word file.')
    const html = decodeHtml(page.bytes, page.contentType)
    title = title || htmlTitle(html)
    text = page.contentType.includes('html') ? htmlToText(html) : cleanText(html)
    // Many legislation pages show a summary and link to the official PDF or Word file; prefer that file.
    const pdfs = extractLinks(html, page.url, importDomains(config)).filter((l) => l.pdf)
    if (pdfs.length && text.replace(/\s/g, '').length < 3000) {
      try {
        page = await fetchAllowed(deps, pdfs[0]!.url, maxFile)
        const htmlText = text
        if (!(await asFile(page))) text = htmlText
      } catch (err) {
        log.warn('linked pdf download failed', { err, url: pdfs[0]!.url })
      }
    }
  }
  text = cleanText(text).slice(0, MAX_TEXT)
  if (text.replace(/\s/g, '').length < 100) throw new ImportError('No law text was found at this link. Try the link to the law itself or its PDF.')
  title = (title || new URL(row.url).pathname.split('/').filter(Boolean).pop() || 'Imported law').replace(/\s+/g, ' ').trim().slice(0, 400)
  const meta = guessMeta(title, text)
  const sourceId = await db.tx(async (q) => {
    const src = await q.one(
      `INSERT INTO library_sources (org_id, jurisdiction, kind, title, number, year, status, language, source_url, notes, file_name, mime_type, file_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [ownerOrg, row.jurisdiction, row.kind || meta.kind, title, meta.number, meta.year, row.status_hint || 'in_force', row.language || meta.language,
       row.url, ocr ? 'Imported automatically; text read from a scan (OCR) – please spot-check.' : 'Imported automatically from the official source.',
       file?.name ?? null, file?.mime ?? null, file ? Buffer.from(file.bytes) : null, row.created_by])
    await indexSource(q, src!.id, ownerOrg, text)
    return src!.id as string
  })
  return { status: 'done', sourceId, detail: ocr ? 'Read with OCR' : null }
}

// Processes queued imports one at a time; safe with several app instances.
export async function runLibraryImports(deps: ImportDeps, opts: { max?: number } = {}) {
  const { db, log } = deps
  // Recover items left running by a crashed or restarted instance.
  await db.query(`UPDATE library_imports SET status = 'queued' WHERE status = 'running' AND started_at < now() - interval '15 minutes' AND attempts < 3`)
  await db.query(`UPDATE library_imports SET status = 'failed', detail = 'Stopped repeatedly while importing.', finished_at = now() WHERE status = 'running' AND started_at < now() - interval '15 minutes'`)
  let processed = 0
  while (processed < (opts.max ?? 10)) {
    const [row] = await db.query<ImportRow>(
      `UPDATE library_imports SET status = 'running', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM library_imports WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, org_id, scope, created_by, url, title, jurisdiction, kind, language, status_hint`)
    if (!row) break
    processed++
    try {
      const r = await processImport(deps, row)
      await db.query(`UPDATE library_imports SET status = $2, source_id = $3, detail = $4, finished_at = now() WHERE id = $1`, [row.id, r.status, r.sourceId, r.detail])
    } catch (err) {
      const message = err instanceof ImportError ? err.message : 'The import failed unexpectedly. Try again later.'
      if (!(err instanceof ImportError)) log.error('library import failed', { err, url: row.url })
      await db.query(`UPDATE library_imports SET status = 'failed', detail = $2, finished_at = now() WHERE id = $1`, [row.id, message.slice(0, 500)])
    }
  }
  return processed
}
