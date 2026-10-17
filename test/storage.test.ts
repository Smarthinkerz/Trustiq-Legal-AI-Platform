import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createS3Store, moveFiles, signV4, sweepDeletedFiles } from '../src/services/storage'
import { registered, setup } from './helpers'

// An in-memory S3: checks every request is signed and keeps objects by path.
function fakeS3() {
  const objects = new Map<string, Uint8Array>()
  const requests: { method: string; path: string }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const h = new Headers(init.headers)
    const body = init.body ? new Uint8Array(init.body as Buffer) : new Uint8Array()
    requests.push({ method: init.method!, path: u.pathname })
    if (!h.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=KEY/')) return new Response('unsigned', { status: 403 })
    if (h.get('x-amz-content-sha256') !== createHash('sha256').update(body).digest('hex')) return new Response('bad hash', { status: 400 })
    if (init.method === 'PUT') { objects.set(u.pathname, body); return new Response(null, { status: 200 }) }
    if (init.method === 'DELETE') { objects.delete(u.pathname); return new Response(null, { status: 204 }) }
    const o = objects.get(u.pathname)
    return o ? new Response(Buffer.from(o)) : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return { objects, requests, store: createS3Store({ endpoint: 'https://objects.example.om', bucket: 'trustiq', region: 'me-muscat-1', accessKeyId: 'KEY', secretAccessKey: 'SECRET' }, fetchImpl) }
}

describe('object storage for uploaded files', () => {
  it('signs requests exactly as AWS documents (Signature Version 4)', () => {
    const h = signV4({ method: 'GET', path: '/test.txt', headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') })
    expect(h.authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })

  let ctx: Awaited<ReturnType<typeof setup>>
  const s3 = fakeS3()
  beforeAll(async () => { ctx = await setup({}, { files: s3.store }) })

  it('keeps new uploads in the store, serves them, and removes them when the document is deleted', async () => {
    const { c } = await registered(ctx.app)
    const form = new FormData()
    form.set('file', new File(['Article 1\nThe parties agree to the terms set out below in full.'], 'terms.txt', { type: 'text/plain' }))
    const up = await c.raw('POST', '/api/documents/upload', form)
    expect(up.status).toBe(201)
    const id = up.data.document.id
    const [row] = await ctx.db.query<any>('SELECT file_data, file_key FROM documents WHERE id = $1', [id])
    expect(row.file_data).toBeNull()
    expect(row.file_key).toMatch(/^documents\/[0-9a-f-]+\/[0-9a-f-]+$/)
    expect(s3.objects.has(`/trustiq/${row.file_key}`)).toBe(true)

    const file = await c.get(`/api/documents/${id}/file`)
    expect(file.status).toBe(200)
    expect(file.data).toContain('The parties agree')

    expect((await c.del(`/api/documents/${id}`)).status).toBeLessThan(300)
    expect(await sweepDeletedFiles(ctx.db, s3.store)).toBeGreaterThanOrEqual(1)
    expect(s3.objects.has(`/trustiq/${row.file_key}`)).toBe(false)
  })

  it('moves files written before the switch into the store and back', async () => {
    const { me } = await registered(ctx.app)
    const [doc] = await ctx.db.query<{ id: string }>(
      `INSERT INTO documents (org_id, title, doc_type, language, status, source, content, file_name, mime_type, file_size, file_data)
       VALUES ($1, 'Old scan', 'other', 'en', 'draft', 'upload', 'x', 'old.pdf', 'application/pdf', 3, $2) RETURNING id`, [me.org.id, Buffer.from('PDF')])
    expect(await moveFiles(ctx.db, s3.store, 'to-store')).toBeGreaterThanOrEqual(1)
    const [moved] = await ctx.db.query<any>('SELECT file_data, file_key FROM documents WHERE id = $1', [doc!.id])
    expect(moved.file_data).toBeNull()
    expect(Buffer.from(s3.objects.get(`/trustiq/${moved.file_key}`)!).toString()).toBe('PDF')

    await moveFiles(ctx.db, s3.store, 'to-db')
    const [back] = await ctx.db.query<any>('SELECT file_data, file_key FROM documents WHERE id = $1', [doc!.id])
    expect(back.file_key).toBeNull()
    expect(Buffer.from(back.file_data).toString()).toBe('PDF')
  })
})
