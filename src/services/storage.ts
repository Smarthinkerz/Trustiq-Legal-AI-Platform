import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Queryable } from '../db'

// ---------------------------------------------------------------------------
// Where uploaded files live. By default they stay in PostgreSQL (BYTEA columns), which is simple
// but makes the database and its backups grow with every scan. With STORAGE_DRIVER=s3 new files go
// to any S3-compatible object store (Oracle Cloud Object Storage, MinIO, Ceph, AWS) instead, for
// example in an Oman data center, and the row keeps only the object key. Rows written before the
// switch keep working: a row with a key is read from the store, a row without one from the database.
// `scripts/move-files.ts` moves existing files across.
// ---------------------------------------------------------------------------

export interface FileStore {
  driver: 's3'
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  del(key: string): Promise<void>
}

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix?: string }

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()
// RFC 3986 encoding as SigV4 requires; "/" stays as is in object keys.
const encodeKey = (key: string) => key.split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')

// AWS Signature Version 4 for one request. `headers` must include host; returns the headers to send.
export function signV4(o: { method: string; path: string; query?: string; headers: Record<string, string>; payloadHash: string; region: string; service?: string; accessKeyId: string; secretAccessKey: string; date: Date }) {
  const amzDate = o.date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [k.toLowerCase(), v.trim()])), 'x-amz-date': amzDate, 'x-amz-content-sha256': o.payloadHash }
  const names = Object.keys(headers).sort()
  const canonical = [o.method, o.path, o.query ?? '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), o.payloadHash].join('\n')
  const scope = `${day}/${o.region}/${o.service ?? 's3'}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretAccessKey}`, day), o.region), o.service ?? 's3'), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }
}

export function createS3Store(c: S3Config, fetchImpl: typeof fetch = fetch): FileStore {
  const base = new URL(c.endpoint.replace(/\/$/, ''))
  // Path-style URLs (https://host/bucket/key) work with MinIO, Oracle and AWS alike.
  const request = async (method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Uint8Array, mime?: string) => {
    const path = `${base.pathname.replace(/\/$/, '')}/${encodeURIComponent(c.bucket)}/${encodeKey(`${c.prefix ?? ''}${key}`)}`
    const headers = signV4({
      method, path, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, date: new Date(),
      headers: { host: base.host, ...(mime ? { 'content-type': mime } : {}) }, payloadHash: sha256(body ?? '')
    })
    delete (headers as Record<string, string>).host
    return fetchImpl(`${base.origin}${path}`, { method, headers, body: body ? Buffer.from(body) : undefined })
  }
  return {
    driver: 's3',
    async put(key, bytes, mime) {
      const res = await request('PUT', key, bytes, mime)
      if (!res.ok) throw new Error(`object store PUT failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    },
    async get(key) {
      const res = await request('GET', key)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`object store GET failed: ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    async del(key) {
      const res = await request('DELETE', key)
      if (!res.ok && res.status !== 404) throw new Error(`object store DELETE failed: ${res.status}`)
    }
  }
}

// The store for this process, set when the app is created (null: files stay in the database).
let current: FileStore | null = null
export const fileStore = () => current
export function useFileStore(store: FileStore | null) { current = store }

// ---------- Rows that hold a file ----------

// Tables with a file column, the column, and its key column.
export const FILE_TABLES = {
  documents: { data: 'file_data', key: 'file_key', mime: 'mime_type' },
  library_sources: { data: 'file_data', key: 'file_key', mime: 'mime_type' },
  signature_requests: { data: 'file_data', key: 'file_key', mime: 'file_mime' },
  blog_media: { data: 'data', key: 'file_key', mime: 'mime' }
} as const
export type FileTable = keyof typeof FILE_TABLES

// Values for the data and key columns of a new row: bytes in the database, or a key in the store.
export async function storeFile(store: FileStore | null, table: FileTable, orgId: string | null, bytes: Uint8Array | null, mime: string): Promise<{ data: Buffer | null; key: string | null }> {
  if (!bytes) return { data: null, key: null }
  if (!store) return { data: Buffer.from(bytes), key: null }
  const key = `${table}/${orgId ?? 'shared'}/${randomUUID()}`
  await store.put(key, bytes, mime)
  return { data: null, key }
}

// The bytes of a row read with both columns.
export async function readFile(store: FileStore | null, row: { data?: unknown; key?: string | null }): Promise<Uint8Array | null> {
  if (row.key) {
    if (!store) throw new Error('This file is in the object store, but STORAGE_DRIVER is not set to s3.')
    return store.get(row.key)
  }
  return row.data ? new Uint8Array(row.data as Buffer) : null
}

// Objects of deleted rows are queued by a database trigger and removed here.
export async function sweepDeletedFiles(db: Queryable, store: FileStore | null, limit = 200) {
  if (!store) return 0
  const rows = await db.query<{ id: string; file_key: string }>('SELECT id, file_key FROM file_deletions ORDER BY created_at LIMIT $1', [limit])
  let done = 0
  for (const r of rows) {
    try { await store.del(r.file_key); await db.query('DELETE FROM file_deletions WHERE id = $1', [r.id]); done++ } catch { /* retried on the next sweep */ }
  }
  return done
}

// Moves existing files between the database and the store, in batches, safe to stop and rerun.
// "to-store" uploads rows that still hold bytes; "to-db" brings stored files back (for leaving the store).
export async function moveFiles(db: Queryable, store: FileStore, direction: 'to-store' | 'to-db', opts: { batch?: number; log?: (msg: string) => void } = {}) {
  let moved = 0
  for (const [table, col] of Object.entries(FILE_TABLES) as [FileTable, (typeof FILE_TABLES)[FileTable]][]) {
    const orgCol = 'org_id'
    for (;;) {
      const rows = direction === 'to-store'
        ? await db.query<{ id: string; org_id: string | null; bytes: Buffer; mime: string | null }>(
          `SELECT id, ${orgCol} AS org_id, ${col.data} AS bytes, ${col.mime} AS mime FROM ${table} WHERE ${col.data} IS NOT NULL AND ${col.key} IS NULL LIMIT $1`, [opts.batch ?? 20])
        : await db.query<{ id: string; key: string }>(`SELECT id, ${col.key} AS key FROM ${table} WHERE ${col.key} IS NOT NULL LIMIT $1`, [opts.batch ?? 20])
      if (!rows.length) break
      for (const r of rows as any[]) {
        if (direction === 'to-store') {
          const { key } = await storeFile(store, table, r.org_id, new Uint8Array(r.bytes), r.mime ?? 'application/octet-stream')
          await db.query(`UPDATE ${table} SET ${col.key} = $2, ${col.data} = NULL WHERE id = $1`, [r.id, key])
        } else {
          const bytes = await store.get(r.key)
          if (!bytes) throw new Error(`${table} ${r.id}: object ${r.key} is missing from the store`)
          // Clearing the key queues the object for deletion by the sweeper.
          await db.query(`UPDATE ${table} SET ${col.data} = $2, ${col.key} = NULL WHERE id = $1`, [r.id, Buffer.from(bytes)])
        }
        moved++
      }
      opts.log?.(`${table}: ${moved} moved so far`)
    }
  }
  return moved
}
