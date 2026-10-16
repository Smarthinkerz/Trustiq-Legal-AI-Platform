import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

async function firmWithPortalClient() {
  const firm = await registered(ctx.app)
  const c = firm.c
  const cl = await c.post('/api/clients', { name: 'Al Noor Trading', name_ar: 'النور للتجارة' })
  const k = await c.post('/api/cases', { title: 'Unpaid invoices claim', jurisdiction: 'uae', client_id: cl.data.client.id, court: 'Dubai Courts', assigned_to: firm.me.user.id })
  const email = `upd-${crypto.randomUUID().slice(0, 6)}@example.test`
  const inv = await c.post(`/api/clients/${cl.data.client.id}/portal-invite`, { email })
  const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
  const portal = client(ctx.app)
  expect((await portal.post('/api/auth/accept-invite', { token, name: 'Client Person', password: 'Str0ngPassw0rd' })).status).toBe(201)
  return { c, me: firm.me, portal, email, clientId: cl.data.client.id as string, caseId: k.data.case.id as string }
}

describe('client updates', () => {
  it('drafts an update from client-safe facts, lets the lawyer edit it, then publishes it to the portal', async () => {
    const { c, portal, email, caseId } = await firmWithPortalClient()
    // Something to report: an upcoming hearing and a document the client still has to send.
    await c.post('/api/events', { title: 'First hearing', kind: 'hearing', case_id: caseId, starts_at: new Date(Date.now() + 10 * 86_400e3).toISOString() })
    expect((await c.post(`/api/cases/${caseId}/notes`, { body: 'INTERNAL: weak on limitation, consider settling at 60%.' })).status).toBe(201)

    ctx.ai.nextReply = JSON.stringify({ title: 'Your claim: hearing date set', body: 'The court has set the first hearing.\n\n\n\nWe will attend on your behalf.' })
    const d = await c.post(`/api/client-updates/case/${caseId}/draft`, { language: 'en', points: 'Mention we filed the claim.' })
    expect(d.status).toBe(201)
    expect(d.data.update).toMatchObject({ status: 'draft', ai_drafted: true, language: 'en', title: 'Your claim: hearing date set', body: 'The court has set the first hearing.\n\nWe will attend on your behalf.' })
    expect(d.data.facts).toBeGreaterThan(0)
    const prompt = ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')
    expect(prompt).toContain('First hearing')
    expect(prompt).toContain('Mention we filed the claim.')
    expect(prompt).not.toContain('weak on limitation')

    // Drafts are invisible to the client.
    expect((await portal.get(`/api/portal/cases/${caseId}`)).data.updates).toEqual([])
    const id = d.data.update.id
    const edited = await c.patch(`/api/client-updates/${id}`, { body: 'The court has set the first hearing. We will attend for you.' })
    expect(edited.data.update).toMatchObject({ language: 'en', title: 'Your claim: hearing date set', body: 'The court has set the first hearing. We will attend for you.' })

    // An AI draft goes to the client only after the lawyer confirms they checked it.
    expect((await c.post(`/api/client-updates/${id}/publish`, {})).status).toBe(400)
    const pub = await c.post(`/api/client-updates/${id}/publish`, { reviewed: true })
    expect(pub.status).toBe(200)
    expect(pub.data).toMatchObject({ emailed: 1, has_portal: true, update: { status: 'published', emailed: 1 } })
    const mail = ctx.mails.find((m) => m.to === email && m.subject.startsWith('Your claim: hearing date set'))
    expect(mail?.text).toContain('We will attend for you.')
    expect((await c.post(`/api/client-updates/${id}/publish`, {})).status).toBe(409)
    expect((await c.patch(`/api/client-updates/${id}`, { title: 'Changed' })).status).toBe(409)
    expect((await c.del(`/api/client-updates/${id}`)).status).toBe(409)

    // The client sees it (and reading marks it read); the overview counts unread ones.
    expect((await portal.get('/api/portal/overview')).data.cases[0].unread_updates).toBe(1)
    const seen = await portal.get(`/api/portal/cases/${caseId}`)
    expect(seen.data.updates).toHaveLength(1)
    expect(seen.data.updates[0]).toMatchObject({ title: 'Your claim: hearing date set', ai_drafted: true })
    expect((await portal.get('/api/portal/overview')).data.cases[0].unread_updates).toBe(0)
    expect((await c.get(`/api/client-updates/case/${caseId}`)).data.items[0].read_at).toBeTruthy()
    expect((await portal.get(`/api/client-updates/case/${caseId}`)).status).toBe(403)

    // The next draft covers only what is new and is told what was already said.
    ctx.ai.nextReply = JSON.stringify({ title: 'تحديث', body: 'لا جديد منذ التحديث السابق، والجلسة الأولى قائمة في موعدها.' })
    const d2 = await c.post(`/api/client-updates/case/${caseId}/draft`, { language: 'ar' })
    expect(d2.data.update.language).toBe('ar')
    // Dates keep their order inside Arabic text.
    const ar = await c.patch(`/api/client-updates/${d2.data.update.id}`, { body: 'الجلسة القادمة في 2026-11-03 أمام المحكمة.' })
    expect(ar.data.update.body).toBe('الجلسة القادمة في \u20662026-11-03\u2069 أمام المحكمة.')
    expect((await c.patch(`/api/client-updates/${d2.data.update.id}`, { body: ar.data.update.body })).data.update.body).toBe(ar.data.update.body)
    expect(ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')).toContain('Previous update sent to the client')
    expect((await c.del(`/api/client-updates/${d2.data.update.id}`)).status).toBe(200)

    // A draft with a date that is not in the matter record is regenerated once, then refused.
    ctx.ai.nextReply = JSON.stringify({ title: 'Hearing moved', body: 'The court has moved your hearing to 14 February 2031. We will attend.' })
    const invented = await c.post(`/api/client-updates/case/${caseId}/draft`, { language: 'en', points: 'Tell the client the hearing is coming.' })
    expect(invented.status).toBe(422)
    expect(invented.data.error.code).toBe('unverified_dates')
    expect(invented.data.error.message).toContain('14 February 2031')
  })

  it('refuses to draft when nothing new is recorded', async () => {
    const { c, caseId } = await firmWithPortalClient()
    const r = await c.post(`/api/client-updates/case/${caseId}/draft`, { language: 'en' })
    expect(r.status).toBe(422)
    expect(r.data.error.code).toBe('nothing_to_report')
  })

  it('lists matters whose client is due an update and writes updates by hand', async () => {
    const { c, me, caseId } = await firmWithPortalClient()
    const other = await c.post('/api/cases', { title: 'No client matter', jurisdiction: 'oman' })
    expect((await c.post(`/api/client-updates/case/${other.data.case.id}`, { language: 'en', title: 'Hello', body: 'Nothing to say yet here.' })).status).toBe(400)
    // A fresh matter is not due; one opened 40 days ago is.
    expect((await c.get('/api/client-updates/due')).data.items).toEqual([])
    await ctx.db.query(`UPDATE cases SET created_at = now() - interval '40 days' WHERE id = $1`, [caseId])
    const due = await c.get('/api/client-updates/due?mine=1')
    expect(due.data.items).toHaveLength(1)
    expect(due.data.items[0]).toMatchObject({ id: caseId, has_portal: true, days: 40, drafts: 0 })
    expect((await c.get('/api/dashboard')).data.counts.client_updates_due).toBe(1)

    const manual = await c.post(`/api/client-updates/case/${caseId}`, { language: 'en', title: 'Quick update', body: 'We filed the reply memorandum today.' })
    expect(manual.data.update).toMatchObject({ ai_drafted: false, status: 'draft' })
    expect((await c.get('/api/client-updates/due')).data.items[0].drafts).toBe(1)
    await c.post(`/api/client-updates/${manual.data.update.id}/publish`, { email: false })
    expect((await c.get('/api/client-updates/due')).data.items).toEqual([])
    const list = await c.get(`/api/client-updates/case/${caseId}`)
    expect(list.data).toMatchObject({ has_client: true, has_portal: true, days_since: 0 })
    expect(list.data.items[0]).toMatchObject({ emailed: 0, published_by_name: me.user.name })
  })
})
