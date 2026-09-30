import pg from 'pg'
import type { Config } from '../config'
import { migrate } from './migrations'

export type Row = Record<string, any>

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Db extends Queryable {
  one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | undefined>
  tx<T>(fn: (q: Queryable & { one: Db['one'] }) => Promise<T>): Promise<T>
  exec(sql: string): Promise<void>
  ping(): Promise<boolean>
  close(): Promise<void>
  kind: 'postgres' | 'pglite'
}

function withOne<Q extends Queryable>(q: Q): Q & { one: Db['one'] } {
  return Object.assign(q, {
    async one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | undefined> {
      const rows = await q.query<T>(sql, params)
      return rows[0]
    }
  })
}

async function createPostgres(url: string, ssl: boolean): Promise<Db> {
  // Return BIGINT/COUNT as JS numbers and NUMERIC as floats; values in this app stay well below 2^53.
  pg.types.setTypeParser(20, (v) => Number(v))
  pg.types.setTypeParser(1700, (v) => Number(v))
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  })
  const query = async <T extends Row>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[]
  const db = withOne({
    kind: 'postgres' as const,
    query,
    async tx<T>(fn: (q: any) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const q = withOne({ query: async <R extends Row>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] })
        const result = await fn(q)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    async exec(sql: string) { await pool.query(sql) },
    async ping() { try { await pool.query('SELECT 1'); return true } catch { return false } },
    async close() { await pool.end() }
  })
  return db
}

async function createPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const lite = dataDir ? new PGlite(dataDir) : new PGlite()
  await lite.waitReady
  const normalize = (rows: any[]) => rows.map((r) => {
    for (const k of Object.keys(r)) {
      if (typeof r[k] === 'bigint') r[k] = Number(r[k])
    }
    return r
  })
  // PGlite runs a single connection, so transactions are serialised through a queue.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  const db = withOne({
    kind: 'pglite' as const,
    query: <T extends Row>(sql: string, params: unknown[] = []) => serial(async () => normalize((await lite.query(sql, params)).rows as any[]) as T[]),
    tx<T>(fn: (q: any) => Promise<T>) {
      return serial(() => lite.transaction(async (t) => {
        const q = withOne({ query: async <R extends Row>(sql: string, params: unknown[] = []) => normalize((await t.query(sql, params)).rows as any[]) as R[] })
        return fn(q)
      }))
    },
    exec: (sql: string) => serial(async () => { await lite.exec(sql) }),
    async ping() { try { await lite.query('SELECT 1'); return true } catch { return false } },
    async close() { await lite.close() }
  })
  return db
}

export async function createDb(config: Pick<Config, 'databaseUrl' | 'databaseSsl' | 'pgliteDataDir'>): Promise<Db> {
  const db = config.databaseUrl
    ? await createPostgres(config.databaseUrl, config.databaseSsl)
    : await createPglite(config.pgliteDataDir)
  await migrate(db)
  return db
}
