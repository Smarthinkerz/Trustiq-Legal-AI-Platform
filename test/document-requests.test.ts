import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

async function firmWithPortalClient() {
  const firm = await registered(ctx.app)
  const c = firm.c
  const cl = await c.post('/api/clients', { name: 'Requested Client' })
  const k = await c.post('/api/cases', { title: 'Visa matter', jurisdiction: 'oman', client_id: cl.data.client.id })
  const email = `req-${crypto.randomUUID().slice(0, 6)}@example.test`
  const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email })
  const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
  const portal = client(ctx.app)
  expect((await portal.post('/api/auth/accept-invite', { token, name: 'Client Person', password: 'Str0ngPassw0rd' })).status).toBe(201)
  return { c, portal, email, clientId: cl.data.client.id as string, caseId: k.data.case.id as string }
}

const upload = (portal: ReturnType<typeof client>, path: string, bytes: Uint8Array, name: string) => {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], name))
  return portal.post(path, form)
}

describe('document requests', () => {
  it('asks a client for documents, collects uploads in the portal and tracks review', async () => {
    const { c, portal, email, clientId, caseId } = await firmWithPortalClient()
    const created = await c.post('/api/document-requests', {
      client_id: clientId, case_id: caseId, title: 'Residency application', due_date: '2030-01-15', message: 'Clear scans please.',
      items: [{ label: 'Passport copy' }, { label: 'Signed power of attorney', note: 'Notarised' }]
    })
    expect(created.status).toBe(201)
    expect(created.data.portal_users).toBe(1)
    expect(created.data.items.map((i: any) => i.status)).toEqual(['pending', 'pending'])
    const mail = ctx.mails.find((m) => m.to === email && m.subject.startsWith('Documents requested'))
    expect(mail?.text).toContain('Passport copy')
    const id = created.data.request.id
    const [passport, poa] = created.data.items

    // The client sees the checklist and uploads a photo and a text file.
    const list = await portal.get('/api/portal/document-requests')
    expect(list.data.items[0].items.map((i: any) => i.label)).toEqual(['Passport copy', 'Signed power of attorney'])
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${passport.id}`, new Uint8Array([1, 2, 3]), 'x.exe')).status).toBe(415)
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${passport.id}`, PNG, 'passport.png')).status).toBe(201)
    // An unreadable PDF (e.g. a scan) is still accepted for a requested document.
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${passport.id}`, new TextEncoder().encode('%PDF-1.4 broken'), 'scan.pdf')).status).toBe(201)
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${passport.id}`, PNG, 'passport.png')).status).toBe(201)
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${poa.id}`, new TextEncoder().encode('I appoint my lawyer.'), 'poa.txt')).status).toBe(201)
    expect(ctx.mails.some((m) => m.subject.startsWith('Requested document received: Passport copy'))).toBe(true)

    let detail = await c.get(`/api/document-requests/${id}`)
    expect(detail.data.items.map((i: any) => i.status)).toEqual(['uploaded', 'uploaded'])
    const docId = detail.data.items[0].document_id
    const file = await ctx.app.request(`/api/documents/${docId}/file`, { headers: { cookie: c.cookie } })
    expect(file.headers.get('content-type')).toBe('image/png')
    const caseDocs = await c.get(`/api/documents?case_id=${caseId}`)
    expect(caseDocs.data.items.some((d: any) => d.title === 'Passport copy')).toBe(true)

    // Return one to the client, who uploads it again; then accept both.
    detail = await c.post(`/api/document-requests/${id}/items/${poa.id}/review`, { accepted: false, reason: 'Not signed' })
    expect(detail.data.items[1].status).toBe('rejected')
    expect(ctx.mails.some((m) => m.to === email && m.text.includes('Not signed'))).toBe(true)
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${poa.id}`, new TextEncoder().encode('Signed: client'), 'poa2.txt')).status).toBe(201)
    await c.post(`/api/document-requests/${id}/items/${passport.id}/review`, { accepted: true })
    expect((await c.get(`/api/document-requests/${id}`)).data.request.status).toBe('open')
    const done = await c.post(`/api/document-requests/${id}/items/${poa.id}/review`, { accepted: true })
    expect(done.data.request.status).toBe('completed')
    // Accepted items cannot be replaced.
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${poa.id}`, PNG, 'again.png')).status).toBe(409)
    const summary = await c.get(`/api/document-requests?client_id=${clientId}`)
    expect(summary.data.items[0]).toMatchObject({ items: 2, accepted: 2, status: 'completed' })
  })

  it('reminds, cancels and keeps requests private to the client and firm', async () => {
    const { c, portal, clientId } = await firmWithPortalClient()
    const r = await c.post('/api/document-requests', { client_id: clientId, title: 'KYC', items: [{ label: 'Trade licence' }] })
    const id = r.data.request.id
    const remind = await c.post(`/api/document-requests/${id}/remind`)
    expect(remind.status).toBe(200)
    expect(remind.data.emailed).toBe(1)
    expect((await c.post(`/api/document-requests/${id}/remind`)).status).toBe(429)

    // Another firm and another client cannot see or upload to it.
    const other = await firmWithPortalClient()
    expect((await other.c.get(`/api/document-requests/${id}`)).status).toBe(404)
    expect((await upload(other.portal, `/api/portal/document-requests/${id}/items/${r.data.items[0].id}`, PNG, 'a.png')).status).toBe(404)
    expect((await portal.get('/api/document-requests')).status).toBe(403)

    expect((await c.post(`/api/document-requests/${id}/cancel`)).status).toBe(200)
    expect((await upload(portal, `/api/portal/document-requests/${id}/items/${r.data.items[0].id}`, PNG, 'a.png')).status).toBe(409)
    expect((await c.post('/api/document-requests', { client_id: clientId, case_id: other.caseId, title: 'Bad', items: [{ label: 'x' }] })).status).toBe(400)
  })
})
