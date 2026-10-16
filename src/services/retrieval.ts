import type { Config } from '../config'
import type { Db, Queryable } from '../db'
import type { Logger } from '../lib/logger'
import { type Passage, type SearchOpts, PASSAGE_COLUMNS, outOfForce, scopeFilter, searchLibrary } from './library'

// ---------------------------------------------------------------------------
// Hybrid retrieval tuned for Arabic legal text:
//   1. BM25 over normalised, lightly stemmed Arabic and English (Postgres GIN index);
//   2. dense vectors from a multilingual embedder (BGE-M3 or multilingual-e5), which also
//      lets an English question find an Arabic article and the reverse;
//   3. reciprocal rank fusion of both lists, then an optional cross-encoder reranker
//      (bge-reranker-v2-m3) over the top passages.
// Embeddings and reranking are optional services; without them retrieval is BM25 only.
// ---------------------------------------------------------------------------

export interface EmbeddingService {
  configured: boolean
  model: string
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>
}

export interface RerankService {
  configured: boolean
  model: string
  // Relevance score per document, in input order.
  rerank(query: string, documents: string[]): Promise<number[]>
}

// Any OpenAI-compatible /embeddings endpoint (TEI, Infinity, vLLM, DeepInfra, Together, Azure, OpenAI).
export function createEmbeddingService(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): EmbeddingService {
  const { url, apiKey, model } = config.embeddings
  // multilingual-e5 models expect "query: " and "passage: " prefixes; BGE-M3 needs none.
  const e5 = /e5/i.test(model)
  return {
    configured: !!url,
    model,
    async embed(texts, kind) {
      if (!url) throw new Error('embeddings not configured')
      const input = texts.map((t) => (e5 ? `${kind}: ${t}` : t).slice(0, 8000))
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, input })
      })
      const data: any = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.data)) {
        log.error('embedding provider error', { status: res.status, error: data?.error?.message ?? data?.error })
        throw new Error(`embedding request failed (${res.status})`)
      }
      return [...data.data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0)).map((d: any) => d.embedding as number[])
    }
  }
}

// Cohere-compatible /rerank endpoint (Jina, Infinity, TEI with Cohere routes, Cohere, Together, Voyage).
export function createRerankService(config: Config, log: Logger, fetchImpl: typeof fetch = fetch): RerankService {
  const { url, apiKey, model } = config.rerank
  return {
    configured: !!url,
    model,
    async rerank(query, documents) {
      if (!url) throw new Error('reranker not configured')
      const endpoint = /\/rerank\/?$/.test(url) ? url : `${url.replace(/\/$/, '')}/rerank`
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, query, documents: documents.map((d) => d.slice(0, 4000)), top_n: documents.length, return_documents: false })
      })
      const data: any = await res.json().catch(() => null)
      const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : null
      if (!res.ok || !results) {
        log.error('rerank provider error', { status: res.status, error: data?.error?.message ?? data?.error })
        throw new Error(`rerank request failed (${res.status})`)
      }
      const scores = new Array(documents.length).fill(-Infinity)
      for (const r of results) scores[r.index] = Number(r.relevance_score ?? r.score ?? -Infinity)
      return scores
    }
  }
}

// ---------------------------------------------------------------------------
// In-process vector index. Postgres stores the vectors (REAL[]); each app instance keeps
// a normalised int8 copy in memory for exact cosine search, refreshed incrementally.
// No database extension is needed, so it runs on any Postgres and on PGlite.
// ---------------------------------------------------------------------------

type Entry = { id: string; org: string | null; jurisdiction: string; vec: Int8Array }

export class VectorIndex {
  private entries = new Map<string, Entry>()
  private lastEmbeddedAt: string | null = null
  private loadedAt = 0
  private loading: Promise<void> | null = null
  model: string | null = null
  constructor(private maxChunks: number) {}

  get size() { return this.entries.size }

  static quantize(v: number[]): Int8Array {
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    const out = new Int8Array(v.length)
    for (let i = 0; i < v.length; i++) out[i] = Math.round((v[i]! / norm) * 127)
    return out
  }

  async refresh(q: Queryable, model: string) {
    if (this.loading) return this.loading
    // A full reload every hour drops passages of deleted or re-indexed laws.
    if (this.model !== model || Date.now() - this.loadedAt > 60 * 60_000) {
      this.entries.clear()
      this.lastEmbeddedAt = null
      this.model = model
      this.loadedAt = Date.now()
    }
    this.loading = (async () => {
      for (;;) {
        const rows = await q.query<{ id: string; org_id: string | null; jurisdiction: string; embedding: number[]; at: string }>(
          `SELECT c.id, c.org_id, s.jurisdiction, c.embedding, to_char(c.embedded_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at
             FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
            WHERE c.embedding IS NOT NULL AND c.embedding_model = $1 AND ($2::timestamp IS NULL OR c.embedded_at > $2::timestamp)
            ORDER BY c.embedded_at LIMIT 2000`, [model, this.lastEmbeddedAt])
        for (const r of rows) {
          if (this.entries.size >= this.maxChunks && !this.entries.has(r.id)) break
          this.entries.set(r.id, { id: r.id, org: r.org_id, jurisdiction: r.jurisdiction, vec: VectorIndex.quantize(r.embedding.map(Number)) })
        }
        if (rows.length) this.lastEmbeddedAt = rows.at(-1)!.at
        if (rows.length < 2000 || this.entries.size >= this.maxChunks) break
      }
    })().finally(() => { this.loading = null })
    return this.loading
  }

  search(query: number[], orgId: string, jurisdictions: string[] | undefined, k: number): { id: string; score: number }[] {
    const qv = VectorIndex.quantize(query)
    const allowed = jurisdictions?.length ? new Set(jurisdictions) : null
    const top: { id: string; score: number }[] = []
    for (const e of this.entries.values()) {
      if (e.org !== null && e.org !== orgId) continue
      if (allowed && !allowed.has(e.jurisdiction)) continue
      if (e.vec.length !== qv.length) continue
      let dot = 0
      for (let i = 0; i < qv.length; i++) dot += qv[i]! * e.vec[i]!
      const score = dot / (127 * 127)
      if (top.length < k) { top.push({ id: e.id, score }); top.sort((a, b) => b.score - a.score) }
      else if (score > top[k - 1]!.score) { top[k - 1] = { id: e.id, score }; top.sort((a, b) => b.score - a.score) }
    }
    return top
  }
}

const indexes = new WeakMap<object, VectorIndex>()
export function vectorIndexFor(db: object, config: Config) {
  let ix = indexes.get(db)
  if (!ix) { ix = new VectorIndex(config.embeddings.maxIndexChunks); indexes.set(db, ix) }
  return ix
}

export type RetrievalDeps = { db: Db; config: Config; log: Logger; embeddings?: EmbeddingService; reranker?: RerankService }
export type RetrievalInfo = { mode: 'bm25' | 'hybrid'; bm25: number; dense: number; reranked: boolean; embedding_model?: string; rerank_model?: string }

const RRF_K = 60

// BM25 + dense candidates, fused with reciprocal rank fusion, then reranked.
export async function hybridSearch(deps: RetrievalDeps, orgId: string, question: string, opts: SearchOpts = {}): Promise<{ passages: Passage[]; info: RetrievalInfo }> {
  const limit = opts.limit ?? 8
  const pool = Math.max(limit * 4, 30)
  const bm25 = await searchLibrary(deps.db, orgId, question, { ...opts, limit: pool })
  const info: RetrievalInfo = { mode: 'bm25', bm25: bm25.length, dense: 0, reranked: false }

  let dense: { id: string; score: number }[] = []
  const emb = deps.embeddings
  if (emb?.configured) {
    try {
      const ix = vectorIndexFor(deps.db, deps.config)
      await ix.refresh(deps.db, emb.model)
      if (ix.size) {
        const [qv] = await emb.embed([question], 'query')
        dense = ix.search(qv!, orgId, opts.jurisdictions, pool)
        info.mode = 'hybrid'
        info.embedding_model = emb.model
      }
    } catch (err) {
      deps.log.warn('dense retrieval skipped', { err })
    }
  }

  // Reciprocal rank fusion.
  const fused = new Map<string, number>()
  bm25.forEach((p, i) => fused.set(p.id, (fused.get(p.id) ?? 0) + 1 / (RRF_K + i + 1)))
  dense.forEach((d, i) => fused.set(d.id, (fused.get(d.id) ?? 0) + 1 / (RRF_K + i + 1)))
  const byId = new Map(bm25.map((p) => [p.id, p]))
  const missing = dense.map((d) => d.id).filter((id) => !byId.has(id))
  if (missing.length) {
    // Dense hits are re-read through the same scope filter (firm, jurisdiction, date), so deleted
    // or out-of-scope passages never come back from the in-memory index.
    const params: unknown[] = []
    const scope = scopeFilter(params, orgId, opts)
    params.push(missing)
    for (const p of await deps.db.query<Passage>(`SELECT ${PASSAGE_COLUMNS}, 0 AS rank FROM library_chunks c JOIN library_sources s ON s.id = c.source_id WHERE ${scope} AND c.id = ANY($${params.length})`, params)) byId.set(p.id, p)
  }
  info.dense = dense.filter((d) => byId.has(d.id)).length
  const penalty = (p: Passage) => (outOfForce(p, opts.asOf) ? 0.3 : 1)
  let ranked = [...fused.entries()].filter(([id]) => byId.has(id))
    .map(([id, s]) => ({ ...byId.get(id)!, rank: s * penalty(byId.get(id)!) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, pool)

  const rr = deps.reranker
  if (rr?.configured && ranked.length > 1) {
    try {
      const head = ranked.slice(0, 30)
      const scores = await rr.rerank(question, head.map((p) => `${p.title}${p.label ? ` – ${p.label}` : ''}\n${p.text}`))
      // Repealed passages stay after passages in force, whatever the reranker says.
      const reranked = head.map((p, i) => ({ ...p, rank: scores[i]! }))
        .sort((a, b) => (penalty(b) - penalty(a)) || (b.rank - a.rank))
      ranked = [...reranked, ...ranked.slice(30)]
      info.reranked = true
      info.rerank_model = rr.model
    } catch (err) {
      deps.log.warn('rerank skipped', { err })
    }
  }
  return { passages: ranked.slice(0, limit), info }
}

// Background job: embeds passages that have no vector yet (or one from another model).
export async function runEmbeddingBackfill(deps: { db: Db; log: Logger; embeddings?: EmbeddingService }, opts: { max?: number; batch?: number } = {}) {
  const emb = deps.embeddings
  if (!emb?.configured) return 0
  const batch = opts.batch ?? 32
  let done = 0
  while (done < (opts.max ?? 512)) {
    const rows = await deps.db.query<{ id: string; label: string | null; text: string; title: string }>(
      `SELECT c.id, c.label, c.text, s.title FROM library_chunks c JOIN library_sources s ON s.id = c.source_id
        WHERE c.embedding IS NULL OR c.embedding_model IS DISTINCT FROM $1 ORDER BY c.id LIMIT $2`, [emb.model, batch])
    if (!rows.length) break
    const vectors = await emb.embed(rows.map((r) => `${r.title}${r.label ? ` – ${r.label}` : ''}\n${r.text}`), 'passage')
    for (let i = 0; i < rows.length; i++) {
      await deps.db.query(`UPDATE library_chunks SET embedding = $2, embedding_model = $3, embedded_at = clock_timestamp() WHERE id = $1`, [rows[i]!.id, vectors[i], emb.model])
    }
    done += rows.length
    if (rows.length < batch) break
  }
  if (done) deps.log.info('embedded library passages', { count: done, model: emb.model })
  return done
}
