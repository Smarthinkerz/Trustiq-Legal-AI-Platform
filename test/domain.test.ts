import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('clients and cases', () => {
  it('creates, lists, searches, updates and deletes', async () => {
    const { c } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { kind: 'company', name: 'ABC Trading LLC', name_ar: 'شركة أ ب ج للتجارة', email: 'legal@abc.test' })
    expect(cl.status).toBe(201)
    const k = await c.post('/api/cases', { title: 'ABC v XYZ – supply dispute', jurisdiction: 'oman', client_id: cl.data.client.id, priority: 'high', estimated_value: 150000 })
    expect(k.status).toBe(201)
    expect(k.data.case.reference).toMatch(/^\d{4}-0001$/)
    expect(k.data.case.currency).toBe('OMR')
    const k2 = await c.post('/api/cases', { title: 'Second matter', jurisdiction: 'uae' })
    expect(k2.data.case.reference).toMatch(/-0002$/)

    const search = await c.get('/api/cases?q=supply')
    expect(search.data.total).toBe(1)
    const byClient = await c.get(`/api/cases?q=${encodeURIComponent('ABC Trading')}`)
    expect(byClient.data.items[0].client_name).toBe('ABC Trading LLC')

    const upd = await c.patch(`/api/cases/${k.data.case.id}`, { status: 'closed' })
    expect(upd.data.case.status).toBe('closed')
    expect(upd.data.case.closed_on).toBeTruthy()
    await c.post(`/api/cases/${k.data.case.id}/notes`, { body: 'Client called about settlement.' })
    const detail = await c.get(`/api/cases/${k.data.case.id}`)
    expect(detail.data.activity.map((a: any) => a.kind)).toEqual(expect.arrayContaining(['created', 'status_change', 'note']))

    const clDetail = await c.get(`/api/clients/${cl.data.client.id}`)
    expect(clDetail.data.cases).toHaveLength(1)
    expect((await c.del(`/api/cases/${k2.data.case.id}`)).status).toBe(200)
    expect((await c.get(`/api/cases/${k2.data.case.id}`)).status).toBe(404)
  })

  it('validates input and rejects unknown ids', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.post('/api/cases', { title: 'x', jurisdiction: 'oman' })).status).toBe(400)
    expect((await c.post('/api/cases', { title: 'Valid title', jurisdiction: 'mars' })).status).toBe(400)
    expect((await c.get('/api/cases/not-a-uuid')).status).toBe(400)
    expect((await c.post('/api/cases', { title: 'Valid title', jurisdiction: 'oman', client_id: crypto.randomUUID() })).status).toBe(400)
  })
})

describe('tenant isolation', () => {
  it('one firm can never read or modify another firm\'s records', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    const cl = await a.c.post('/api/clients', { name: 'Secret Client' })
    const k = await a.c.post('/api/cases', { title: 'Confidential matter', jurisdiction: 'oman' })
    const d = await a.c.post('/api/documents', { title: 'Privileged memo', content: 'Attorney-client privileged content.' })
    const e = await a.c.post('/api/events', { title: 'Hearing', kind: 'hearing', starts_at: new Date(Date.now() + 86400_000).toISOString() })

    expect((await b.c.get('/api/clients')).data.total).toBe(0)
    expect((await b.c.get('/api/cases')).data.total).toBe(0)
    expect((await b.c.get('/api/documents')).data.total).toBe(0)
    expect((await b.c.get('/api/events')).data.items).toHaveLength(0)
    for (const path of [`/api/clients/${cl.data.client.id}`, `/api/cases/${k.data.case.id}`, `/api/documents/${d.data.document.id}`, `/api/documents/${d.data.document.id}/export`]) {
      expect((await b.c.get(path)).status).toBe(404)
    }
    expect((await b.c.patch(`/api/cases/${k.data.case.id}`, { title: 'Hijacked title' })).status).toBe(404)
    expect((await b.c.del(`/api/documents/${d.data.document.id}`)).status).toBe(404)
    expect((await b.c.del(`/api/events/${e.data.event.id}`)).status).toBe(404)
    // Cross-tenant references are rejected too.
    expect((await b.c.post('/api/cases', { title: 'Link attempt', jurisdiction: 'oman', client_id: cl.data.client.id })).status).toBe(400)
    expect((await b.c.post('/api/ai/documents/' + d.data.document.id + '/analyze', { type: 'summary' })).status).toBe(404)
    expect((await a.c.get(`/api/cases/${k.data.case.id}`)).data.case.title).toBe('Confidential matter')
  })

  it('unauthenticated requests are rejected', async () => {
    const anon = client(ctx.app)
    for (const p of ['/api/cases', '/api/clients', '/api/documents', '/api/dashboard', '/api/org', '/api/ai/conversations']) {
      expect((await anon.get(p)).status).toBe(401)
    }
  })
})

describe('documents', () => {
  it('uploads a text file, extracts content, versions edits and exports DOCX', async () => {
    const { c } = await registered(ctx.app)
    const form = new FormData()
    const text = readFileSync(new URL('./fixtures/service_agreement.txt', import.meta.url))
    form.set('file', new File([text], 'service_agreement.txt', { type: 'text/plain' }))
    form.set('doc_type', 'service_agreement')
    const up = await c.raw('POST', '/api/documents/upload', form)
    expect(up.status).toBe(201)
    const id = up.data.document.id
    expect(up.data.document.title).toBe('service_agreement')
    const doc = await c.get(`/api/documents/${id}`)
    expect(doc.data.document.content).toContain('GOVERNING LAW')

    await c.patch(`/api/documents/${id}`, { content: doc.data.document.content + '\n\n8. NOTICES\nIn writing.' })
    const v2 = await c.get(`/api/documents/${id}`)
    expect(v2.data.document.version).toBe(2)
    expect(v2.data.versions).toHaveLength(1)
    const v1 = await c.get(`/api/documents/${id}/versions/1`)
    expect(v1.data.version.content).not.toContain('8. NOTICES')

    const file = await c.get(`/api/documents/${id}/file`)
    expect(file.status).toBe(200)
    const exp = await ctx.app.request(`/api/documents/${id}/export?format=docx`, { headers: { cookie: c.cookie } })
    expect(exp.status).toBe(200)
    expect(exp.headers.get('content-type')).toContain('wordprocessingml')
    const bytes = new Uint8Array(await exp.arrayBuffer())
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')
  })

  it('exports Arabic documents with a UTF-8 file name', async () => {
    const { c } = await registered(ctx.app)
    const d = await c.post('/api/documents', { title: 'مذكرة قانونية', language: 'ar', content: 'البند الأول: التعريفات' })
    const exp = await ctx.app.request(`/api/documents/${d.data.document.id}/export`, { headers: { cookie: c.cookie } })
    expect(exp.status).toBe(200)
    expect(exp.headers.get('content-disposition')).toContain("filename*=UTF-8''")
  })

  it('rejects unsupported or spoofed files', async () => {
    const { c } = await registered(ctx.app)
    const form = new FormData()
    form.set('file', new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])], 'contract.pdf', { type: 'application/pdf' }))
    expect((await c.raw('POST', '/api/documents/upload', form)).status).toBe(415)
    const html = new FormData()
    html.set('file', new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }))
    expect((await c.raw('POST', '/api/documents/upload', html)).status).toBe(415)
  })

  it('staff cannot delete documents but lawyers can', async () => {
    const { c } = await registered(ctx.app)
    const d = await c.post('/api/documents', { title: 'Doc', content: 'x' })
    const inv = await c.post('/api/org/invites', { email: `st-${Date.now()}@f.test`, role: 'staff' })
    const token = new URL(inv.data.invite_url.replace('#/', '')).searchParams.get('token')!
    const staff = client(ctx.app)
    await staff.post('/api/auth/accept-invite', { token, name: 'Staff', password: 'Str0ngPassw0rd' })
    expect((await staff.del(`/api/documents/${d.data.document.id}`)).status).toBe(403)
    expect((await c.del(`/api/documents/${d.data.document.id}`)).status).toBe(200)
  })
})

describe('events and dashboard', () => {
  it('tracks upcoming and overdue deadlines', async () => {
    const { c } = await registered(ctx.app)
    const k = await c.post('/api/cases', { title: 'Deadline matter', jurisdiction: 'oman' })
    await c.post('/api/events', { title: 'File defence', kind: 'deadline', starts_at: new Date(Date.now() - 86400_000).toISOString(), case_id: k.data.case.id })
    await c.post('/api/events', { title: 'Hearing', kind: 'hearing', starts_at: new Date(Date.now() + 2 * 86400_000).toISOString() })
    expect((await c.post('/api/events', { title: 'Bad', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() - 3600_000).toISOString() })).status).toBe(400)
    const dash = await c.get('/api/dashboard')
    expect(dash.data.counts.overdue_deadlines).toBe(1)
    expect(dash.data.counts.open_cases).toBe(1)
    expect(dash.data.upcoming.map((e: any) => e.title)).toContain('Hearing')
  })
})

describe('organization settings', () => {
  it('saves branding, uploads a logo, lists the audit log and exports data', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.put('/api/org/branding', { firm_name: 'Al Riyami & Partners', primary_color: '#112233', accent_color: '#aa8800', email: '' })).status).toBe(200)
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
    const form = new FormData()
    form.set('logo', new File([png], 'logo.png', { type: 'image/png' }))
    expect((await c.raw('POST', '/api/org/branding/logo', form)).status).toBe(200)
    const b = await c.get('/api/org/branding')
    expect(b.data.branding.has_logo).toBe(true)
    const svg = new FormData()
    svg.set('logo', new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }))
    expect((await c.raw('POST', '/api/org/branding/logo', svg)).status).toBe(400)

    const audit = await c.get('/api/org/audit')
    expect(audit.data.items.map((i: any) => i.action)).toEqual(expect.arrayContaining(['auth.register', 'branding.updated', 'branding.logo_uploaded']))
    const exp = await c.get('/api/org/export')
    expect(exp.status).toBe(200)
    expect(exp.data.organization.name).toBeTruthy()
    expect(JSON.stringify(exp.data)).not.toContain('password_hash')
  })
})

describe('text extraction', () => {
  it('extracts text from real PDF and DOCX files', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const { renderDocx } = await import('../src/services/export')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage()
    page.drawText('CONFIDENTIALITY AGREEMENT between Alpha and Beta', { x: 50, y: 700, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) })
    const pdfBytes = await pdf.save()
    const docxBytes = await renderDocx({ title: 'Lease', content: '1. RENT\nThe tenant shall pay OMR 500 monthly.', language: 'en' })

    const { c } = await registered(ctx.app)
    for (const [bytes, name, expected] of [[pdfBytes, 'nda.pdf', 'CONFIDENTIALITY AGREEMENT'], [docxBytes, 'lease.docx', 'OMR 500 monthly']] as const) {
      const form = new FormData()
      form.set('file', new File([bytes as Uint8Array<ArrayBuffer>], name))
      const up = await c.raw('POST', '/api/documents/upload', form)
      expect(up.status).toBe(201)
      const doc = await c.get(`/api/documents/${up.data.document.id}`)
      expect(doc.data.document.content).toContain(expected)
    }
  })
})
