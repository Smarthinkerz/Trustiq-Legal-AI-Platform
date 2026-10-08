import { beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { isSignatureLine } from '../src/services/export'
import { parseSignatureImage } from '../src/services/signatures'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

// A tiny valid PNG (1x1) as a data URL, padded past the minimum size check.
const PNG = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex'),
  Buffer.alloc(120)
]).toString('base64')

const form = (fields: Record<string, string>) => ({ body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
const tokenOf = (url: string) => url.split('/sign/')[1]!

async function firmWithDocument(content = 'ENGAGEMENT LETTER\n1. Scope\nThe firm will represent the client.') {
  const owner = await registered(ctx.app)
  const cl = await owner.c.post('/api/clients', { name: 'Salim Al Harthy', email: 'salim@example.com' })
  const doc = await owner.c.post('/api/documents', { title: 'Engagement letter', content, client_id: cl.data.client.id, doc_type: 'other', language: 'en' })
  expect(doc.status).toBe(201)
  return { ...owner, clientId: cl.data.client.id as string, docId: doc.data.document.id as string }
}

describe('drawn signatures', () => {
  it('accepts only PNG data URLs within size', () => {
    expect(parseSignatureImage(PNG)).toBeInstanceOf(Buffer)
    expect(parseSignatureImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(parseSignatureImage('data:image/png;base64,' + Buffer.alloc(300).toString('base64'))).toBeNull()
    expect(parseSignatureImage(undefined)).toBeNull()
  })
})

describe('e-signature requests', () => {
  it('sends, signs by every signer, completes and produces a signed copy', async () => {
    const { c, docId, clientId, email } = await firmWithDocument()
    const before = ctx.mails.length
    const sent = await c.post('/api/signatures', {
      document_id: docId, message: 'Please sign <today>',
      signers: [{ name: 'Salim Al Harthy', email: 'salim@example.com', client_id: clientId }, { name: 'Partner Two', email: '' }]
    })
    expect(sent.status).toBe(201)
    expect(sent.data.links).toHaveLength(2)
    expect(sent.data.links[0]).toMatchObject({ emailed: true })
    expect(sent.data.links[1]).toMatchObject({ emailed: false })
    const mail = ctx.mails.slice(before).find((m) => m.to === 'salim@example.com')!
    expect(mail.text).toContain(sent.data.links[0].url)

    // Editing the document afterwards does not change what is signed.
    await c.patch(`/api/documents/${docId}`, { content: 'CHANGED TEXT' })

    const t1 = tokenOf(sent.data.links[0].url)
    const page = await client(ctx.app).get(`/sign/${t1}`)
    expect(page.status).toBe(200)
    expect(page.data).toContain('The firm will represent the client.')
    expect(page.data).not.toContain('CHANGED TEXT')
    expect(page.data).toContain('Please sign &lt;today&gt;')
    expect(page.data).toContain('/static/site/sign.js')

    // Missing consent is refused.
    const noConsent = await ctx.app.request(`/sign/${t1}`, { method: 'POST', ...form({ action: 'sign', signed_name: 'Salim Al Harthy' }) })
    expect(noConsent.status).toBe(400)

    // The page keeps the Origin header on its own form posts; cross-site posts are refused.
    expect(page.data).toContain('content="same-origin"')
    const cross = await ctx.app.request(`/sign/${t1}`, { method: 'POST', body: form({ action: 'sign', signed_name: 'X', consent: 'on' }).body, headers: { ...form({}).headers, origin: 'null' } })
    expect(cross.status).toBe(403)
    const s1 = await ctx.app.request(`/sign/${t1}`, { method: 'POST', body: form({ action: 'sign', signed_name: 'Salim Al Harthy', consent: 'on', signature: PNG }).body, headers: { ...form({}).headers, origin: 'http://localhost:8080' } })
    expect(s1.status).toBe(303)
    expect((await client(ctx.app).get(`/sign/${t1}`)).data).toContain('your signature has been recorded')
    expect((await client(ctx.app).get(`/sign/${t1}/signed-copy`)).status).toBe(404)
    // Signing twice changes nothing.
    await ctx.app.request(`/sign/${t1}`, { method: 'POST', ...form({ action: 'sign', signed_name: 'Someone Else', consent: 'on' }) })

    const t2 = tokenOf(sent.data.links[1].url)
    await ctx.app.request(`/sign/${t2}`, { method: 'POST', ...form({ action: 'sign', signed_name: 'Partner Two', consent: 'on' }) })

    const detail = await c.get(`/api/signatures/${sent.data.id}`)
    expect(detail.data.request.status).toBe('completed')
    expect(detail.data.signers.map((s: any) => [s.status, s.signed_name])).toEqual([['signed', 'Salim Al Harthy'], ['signed', 'Partner Two']])
    expect(detail.data.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(['created', 'sent', 'viewed', 'signed', 'completed']))
    expect(ctx.mails.some((m) => m.to === email && m.subject.startsWith('Signed by everyone'))).toBe(true)

    for (const res of [
      await ctx.app.request(`/api/signatures/${sent.data.id}/signed-copy`, { headers: { cookie: c.cookie } }),
      await ctx.app.request(`/sign/${t2}/signed-copy`)
    ]) {
      expect(res.status).toBe(200)
      const xml = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))['word/document.xml']!)
      expect(xml).toContain('The firm will represent the client.')
      expect(xml).toContain('Signature page')
      expect(xml).toContain('Salim Al Harthy')
      expect(xml).not.toContain('CHANGED TEXT')
    }
  })

  it('records a decline and stops the request', async () => {
    const { c, docId } = await firmWithDocument()
    const sent = await c.post('/api/signatures', { document_id: docId, signers: [{ name: 'Client One', email: 'one@example.com' }] })
    const token = tokenOf(sent.data.links[0].url)
    await ctx.app.request(`/sign/${token}`, { method: 'POST', ...form({ action: 'decline', reason: 'Fee too high' }) })
    expect((await client(ctx.app).get(`/sign/${token}`)).data).toContain('You declined')
    const d = await c.get(`/api/signatures/${sent.data.id}`)
    expect(d.data.request.status).toBe('declined')
    expect(d.data.signers[0]).toMatchObject({ status: 'declined', decline_reason: 'Fee too high' })
    expect((await c.post(`/api/signatures/${sent.data.id}/remind`)).status).toBe(409)
  })

  it('cancels, expires, rejects bad links and keeps firms apart', async () => {
    const { c, docId } = await firmWithDocument()
    const sent = await c.post('/api/signatures', { document_id: docId, signers: [{ name: 'Client One', email: '' }], expires_in_days: 7 })
    const token = tokenOf(sent.data.links[0].url)

    const remind = await c.post(`/api/signatures/${sent.data.id}/remind`)
    const token2 = tokenOf(remind.data.links[0].url)
    expect(token2).not.toBe(token)
    expect((await client(ctx.app).get(`/sign/${token}`)).status).toBe(200)

    expect((await client(ctx.app).get('/sign/not-a-real-token-but-long-enough-xxxxxxxx')).status).toBe(404)
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/signatures/${sent.data.id}`)).status).toBe(404)
    expect((await other.c.post('/api/signatures', { document_id: docId, signers: [{ name: 'X Y' }] })).status).toBe(404)

    await ctx.db.query(`UPDATE signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [sent.data.id])
    expect((await client(ctx.app).get(`/sign/${token2}`)).data).toContain('expired')
    const late = await ctx.app.request(`/sign/${token2}`, { method: 'POST', ...form({ action: 'sign', signed_name: 'Client One', consent: 'on' }) })
    expect(late.status).toBe(200)
    expect((await c.get(`/api/signatures/${sent.data.id}`)).data.signers[0].status).toBe('viewed')

    await ctx.db.query(`UPDATE signature_requests SET expires_at = now() + interval '1 day' WHERE id = $1`, [sent.data.id])
    expect((await c.post(`/api/signatures/${sent.data.id}/cancel`)).status).toBe(200)
    expect((await client(ctx.app).get(`/sign/${token}`)).data).toContain('cancelled')
  })

  it('shows documents to sign in the client portal', async () => {
    const { c, docId, clientId } = await firmWithDocument()
    const invite = await c.post(`/api/clients/${clientId}/portal-invite`, { email: `portal-${crypto.randomUUID().slice(0, 6)}@example.com` })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const portal = client(ctx.app)
    expect((await portal.post('/api/auth/accept-invite', { token, name: 'Salim Al Harthy', password: 'Str0ngPassw0rd' })).status).toBe(201)
    await c.post('/api/signatures', { document_id: docId, signers: [{ name: 'Salim Al Harthy', email: '', client_id: clientId }] })
    const list = await portal.get('/api/portal/signatures')
    expect(list.data.items).toHaveLength(1)
    const open = await portal.post(`/api/portal/signatures/${list.data.items[0].id}/open`)
    expect(open.data.url).toMatch(/\/sign\/[A-Za-z0-9_-]+$/)
    expect((await client(ctx.app).get(new URL(open.data.url).pathname)).data).toContain('Engagement letter')
    // Portal users cannot reach the firm API.
    expect((await portal.get('/api/signatures')).status).toBe(403)
  })

  it('puts signatures on the signature lines and files the signed copy in Documents', async () => {
    expect(isSignatureLine('Client signature: ______________')).toBe(true)
    expect(isSignatureLine('التوقيع: ..........')).toBe(true)
    expect(isSignatureLine('Fees: ______')).toBe(false)
    const { c, docId } = await firmWithDocument('AGREEMENT\nThe parties agree.\n\nClient signature: ______________\nFirm signature: ______________')
    const sent = await c.post('/api/signatures', { document_id: docId, signers: [{ name: 'Client One', email: '' }, { name: 'Partner Two', email: '' }] })
    for (const [i, name] of ['Client One', 'Partner Two'].entries()) {
      await ctx.app.request(`/sign/${tokenOf(sent.data.links[i].url)}`, { method: 'POST', ...form({ action: 'sign', signed_name: name, consent: 'on', signature: PNG }) })
    }
    const detail = await c.get(`/api/signatures/${sent.data.id}`)
    expect(detail.data.request.signed_document_id).toBeTruthy()
    const signedDoc = await c.get(`/api/documents/${detail.data.request.signed_document_id}`)
    expect(signedDoc.data.document).toMatchObject({ title: 'Engagement letter (signed)', status: 'final', file_name: 'Engagement letter – signed.docx' })
    const file = await ctx.app.request(`/api/documents/${detail.data.request.signed_document_id}/file`, { headers: { cookie: c.cookie } })
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const xml = strFromU8(zip['word/document.xml']!)
    // Both signature lines now hold a signature image, before the signature page.
    const beforePage = xml.slice(0, xml.indexOf('Signature page'))
    expect(beforePage.match(/<w:drawing>/g)?.length).toBe(2)
    expect(beforePage).toContain('Client signature:')
    expect(beforePage).not.toContain('______________')
  })

  it('stamps an uploaded PDF and appends a signature page', async () => {
    const owner = await registered(ctx.app)
    const src = await PDFDocument.create()
    const f = await src.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 2; i++) src.addPage([595, 842]).drawText(`Lease agreement page ${i + 1}`, { x: 50, y: 780, size: 14, font: f })
    const upload = new FormData()
    upload.set('file', new File([new Uint8Array(await src.save())], 'lease.pdf', { type: 'application/pdf' }))
    upload.set('title', 'Lease agreement')
    const up = await owner.c.post('/api/documents/upload', upload)
    expect(up.status).toBe(201)
    const sent = await owner.c.post('/api/signatures', { document_id: up.data.document.id, signers: [{ name: 'Tenant Name', email: '' }] })
    const token = tokenOf(sent.data.links[0].url)
    expect((await client(ctx.app).get(`/sign/${token}`)).data).toContain('lease.pdf')
    await ctx.app.request(`/sign/${token}`, { method: 'POST', ...form({ action: 'sign', signed_name: 'Tenant Name', consent: 'on', signature: PNG }) })

    const res = await ctx.app.request(`/api/signatures/${sent.data.id}/signed-copy`, { headers: { cookie: owner.c.cookie } })
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const signed = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))
    expect(signed.getPageCount()).toBe(3)
    const word = await ctx.app.request(`/api/signatures/${sent.data.id}/signed-copy?format=docx`, { headers: { cookie: owner.c.cookie } })
    expect(word.headers.get('content-type')).toContain('wordprocessingml')
    const fromSigner = await ctx.app.request(`/sign/${token}/signed-copy`)
    expect(fromSigner.headers.get('content-type')).toBe('application/pdf')
    const d = (await owner.c.get(`/api/signatures/${sent.data.id}`)).data.request
    expect((await owner.c.get(`/api/documents/${d.signed_document_id}`)).data.document.file_name).toBe('Lease agreement – signed.pdf')
  })
})
