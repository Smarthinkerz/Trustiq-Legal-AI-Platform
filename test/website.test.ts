import { beforeAll, describe, expect, it } from 'vitest'
import { renderArticle, siteChatMessages, slugify } from '../src/services/website'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const slugFor = () => `firm-${crypto.randomUUID().slice(0, 8)}`

async function firmWithSite(overrides: Record<string, unknown> = {}) {
  const owner = await registered(ctx.app)
  const slug = slugFor()
  const r = await owner.c.put('/api/website/site', {
    slug, published: true, tagline: 'Commercial lawyers in Muscat', tagline_ar: 'محامون تجاريون في مسقط',
    about: '## Who we are\nA **boutique** firm.\n- Contracts\n- Disputes', practice_areas: ['commercial', 'employment'],
    phone: '+968 2400 0000', whatsapp: '+968 9123 4567', contact_email: 'hello@firm.test',
    chatbot_enabled: true, chat_knowledge: 'First consultation costs 30 OMR and lasts 45 minutes.', ...overrides
  })
  expect(r.status).toBe(200)
  return { ...owner, slug }
}

const form = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields)
  return { body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
}

describe('article rendering', () => {
  it('escapes everything and only produces the supported tags', () => {
    const out = renderArticle('## Title <script>alert(1)</script>\nLine with **bold** and *it*\n\n- one\n- <img src=x onerror=alert(1)>\n1. first')
    expect(out).toContain('<h2>Title &lt;script&gt;alert(1)&lt;/script&gt;</h2>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>it</em>')
    expect(out).toContain('<li>&lt;img src=x onerror=alert(1)&gt;</li>')
    expect(out).toContain('<ol><li>first</li></ol>')
    expect(out).not.toMatch(/<(script|img)/)
  })

  it('makes URL slugs from titles', () => {
    expect(slugify('End-of-Service Benefits in Oman: 2026 Guide!')).toBe('end-of-service-benefits-in-oman-2026-guide')
    expect(slugify('مكافأة نهاية الخدمة')).toBe('')
  })

  it('grounds the chatbot on firm information and forbids legal advice', () => {
    const msgs = siteChatMessages({ firm_name: 'Al Noor Law', practice_areas: ['family'], chat_knowledge: 'We speak Urdu.' }, [{ title: 'Divorce basics', excerpt: 'How it works' }], [{ role: 'user', content: 'Hi' }], 'ar')
    const system = msgs[0]!.content as string
    expect(system).toContain('Never give legal advice')
    expect(system).toContain('We speak Urdu.')
    expect(system).toContain('Divorce basics')
    expect(system).toContain('الأحوال الشخصية')
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'Hi' })
  })
})

describe('firm website settings', () => {
  it('suggests an address, validates and keeps addresses unique', async () => {
    const { c } = await registered(ctx.app)
    const initial = await c.get('/api/website/site')
    expect(initial.data.exists).toBe(false)
    expect(initial.data.site.slug).toMatch(/^[a-z0-9-]+$/)
    expect((await c.put('/api/website/site', { slug: 'Bad Slug!' })).status).toBe(400)
    expect((await c.put('/api/website/site', { slug: 'admin' })).status).toBe(400)
    const { slug } = await firmWithSite()
    expect((await c.put('/api/website/site', { slug })).status).toBe(409)
  })

  it('only owners and admins change the website', async () => {
    const { c } = await registered(ctx.app)
    const invite = await c.post('/api/org/invites', { email: `lawyer-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const token = new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token')!
    const lawyer = client(ctx.app)
    expect((await lawyer.post('/api/auth/accept-invite', { token, name: 'Lawyer Person', password: 'Str0ngPassw0rd' })).status).toBe(201)
    expect((await lawyer.put('/api/website/site', { slug: slugFor() })).status).toBe(403)
    // Lawyers can still write articles.
    expect((await lawyer.post('/api/website/posts', { title: 'Lawyer article' })).status).toBe(201)
  })
})

describe('public firm website', () => {
  it('renders bilingual pages with escaped firm content and hides unpublished sites', async () => {
    const { c, slug } = await firmWithSite({ tagline: '<script>alert("x")</script> Trusted advisers' })
    const page = await client(ctx.app).get(`/f/${slug}`)
    expect(page.status).toBe(200)
    expect(page.data).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Trusted advisers')
    expect(page.data).not.toContain('<script>alert')
    expect(page.data).toContain('<strong>boutique</strong>')
    expect(page.data).toContain('Employment &amp; Labour')
    expect(page.data).toContain('https://wa.me/96891234567')
    expect(page.data).toContain('/static/site/chat.js')
    const ar = await client(ctx.app).get(`/f/${slug}?lang=ar`)
    expect(ar.data).toContain('dir="rtl"')
    expect(ar.data).toContain('محامون تجاريون في مسقط')
    expect(ar.data).toContain('طلب استشارة')

    await c.put('/api/website/site', { slug, published: false })
    expect((await client(ctx.app).get(`/f/${slug}`)).status).toBe(404)
    expect((await client(ctx.app).get('/f/no-such-firm')).status).toBe(404)
  })

  it('publishes blog posts in English and Arabic', async () => {
    const { c, slug } = await firmWithSite()
    const draft = await c.post('/api/website/posts', { title: 'End of service in Oman', title_ar: 'مكافأة نهاية الخدمة', body: 'English body', body_ar: '## مقدمة\nنص عربي' })
    expect(draft.status).toBe(201)
    expect(draft.data.post.slug).toBe('end-of-service-in-oman')
    expect(draft.data.post.published_at).toBeNull()
    expect((await client(ctx.app).get(`/f/${slug}/blog/end-of-service-in-oman`)).status).toBe(404)

    const pub = await c.patch(`/api/website/posts/${draft.data.post.id}`, { status: 'published' })
    expect(pub.data.post.published_at).toBeTruthy()
    const en = await client(ctx.app).get(`/f/${slug}/blog/end-of-service-in-oman`)
    expect(en.status).toBe(200)
    expect(en.data).toContain('English body')
    const ar = await client(ctx.app).get(`/f/${slug}/blog/end-of-service-in-oman?lang=ar`)
    expect(ar.data).toContain('<h2>مقدمة</h2>')
    expect((await client(ctx.app).get(`/f/${slug}/blog`)).data).toContain('End of service in Oman')
    expect((await client(ctx.app).get(`/f/${slug}`)).data).toContain('End of service in Oman')
    expect((await client(ctx.app).get(`/f/${slug}/sitemap.xml`)).data).toContain(`/f/${slug}/blog/end-of-service-in-oman`)

    // A second post with the same title gets its own address.
    const again = await c.post('/api/website/posts', { title: 'End of service in Oman' })
    expect(again.data.post.slug).toBe('end-of-service-in-oman-2')
    expect((await c.post('/api/website/posts', { body: 'no title' })).status).toBe(400)
  })
})

describe('consultation requests and the leads inbox', () => {
  it('turns a form submission into a lead, emails the firm, and ignores bots', async () => {
    const { c, slug, email } = await firmWithSite()
    const before = ctx.mails.length
    const res = await ctx.app.request(`/f/${slug}/contact`, {
      method: 'POST',
      ...form({ name: 'Salim Al <b>Harthy</b>', email: 'salim@example.com', phone: '+968 9999 0000', practice_area: 'employment', message: 'My employer has not paid my gratuity.', lang: 'ar' })
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/f/${slug}?lang=ar&sent=1#contact`)
    const mail = ctx.mails.slice(before).find((m) => m.to === email)
    expect(mail?.subject).toContain('New website enquiry')
    expect(mail?.html).toBeUndefined()

    // Honeypot: looks successful but stores nothing.
    const bot = await ctx.app.request(`/f/${slug}/contact`, { method: 'POST', ...form({ name: 'Spam Bot', email: 'x@spam.test', website: 'http://spam.test' }) })
    expect(bot.headers.get('location')).toContain('sent=1')
    // Missing contact details.
    const bad = await ctx.app.request(`/f/${slug}/contact`, { method: 'POST', ...form({ name: 'No Contact' }) })
    expect(bad.headers.get('location')).toContain('error=error')
    // Cross-site posts are refused.
    const cross = await ctx.app.request(`/f/${slug}/contact`, { method: 'POST', body: form({ name: 'X Y', email: 'a@b.test' }).body, headers: { ...form({}).headers, origin: 'https://evil.test' } })
    expect(cross.headers.get('location')).toContain('error=error')

    const leads = await c.get('/api/website/leads')
    expect(leads.data.items).toHaveLength(1)
    expect(leads.data.items[0]).toMatchObject({ name: 'Salim Al <b>Harthy</b>', status: 'new', source: 'form', language: 'ar', practice_area: 'employment' })
    expect(leads.data.counts.new).toBe(1)

    // Another firm cannot see it.
    const other = await registered(ctx.app)
    expect((await other.c.get('/api/website/leads')).data.items).toHaveLength(0)
    expect((await other.c.patch(`/api/website/leads/${leads.data.items[0].id}`, { status: 'contacted' })).status).toBe(404)
  })

  it('converts an enquiry into a client and case, once', async () => {
    const { c, slug } = await firmWithSite()
    await ctx.app.request(`/f/${slug}/contact`, { method: 'POST', ...form({ name: 'Mariam Al Balushi', phone: '+968 9000 1111', message: 'Tenancy dispute with my landlord.' }) })
    const lead = (await c.get('/api/website/leads')).data.items[0]
    expect((await c.patch(`/api/website/leads/${lead.id}`, { status: 'contacted', notes: 'Called, wants a meeting' })).data.lead.status).toBe('contacted')
    expect((await c.post(`/api/website/leads/${lead.id}/convert`, {})).status).toBe(400)

    const conv = await c.post(`/api/website/leads/${lead.id}/convert`, {
      client: { name: 'Mariam Al Balushi', phone: '+968 9000 1111' },
      case: { title: 'Tenancy dispute', practice_area: 'real_estate', jurisdiction: 'oman' }
    })
    expect(conv.status).toBe(200)
    expect(conv.data.client_created).toBe(true)
    expect(conv.data.case.reference).toMatch(/^\d{4}-\d{4}$/)
    const client = await c.get(`/api/clients/${conv.data.client_id}`)
    expect(client.data.client.notes).toContain('Tenancy dispute with my landlord.')
    expect(client.data.cases[0]).toMatchObject({ id: conv.data.case.id, status: 'pending' })
    const after = (await c.get('/api/website/leads?status=converted')).data.items[0]
    expect(after).toMatchObject({ status: 'converted', client_id: conv.data.client_id, case_id: conv.data.case.id })
    expect((await c.post(`/api/website/leads/${lead.id}/convert`, { client_id: conv.data.client_id })).status).toBe(409)

    // Linking to an existing client without a case.
    const manual = await c.post('/api/website/leads', { name: 'Walk-in Visitor', email: 'walkin@example.com' })
    expect(manual.data.lead.source).toBe('manual')
    const linked = await c.post(`/api/website/leads/${manual.data.lead.id}/convert`, { client_id: conv.data.client_id })
    expect(linked.data).toMatchObject({ client_id: conv.data.client_id, client_created: false, case: null })
    const audit = await ctx.db.query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [lead.id])
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['lead.received', 'lead.updated', 'lead.converted']))
  })
})

describe('website chatbot', () => {
  it('answers from the firm information and counts against the AI allowance', async () => {
    const { slug } = await firmWithSite()
    ctx.ai.nextReply = 'A first consultation costs 30 OMR.'
    const before = ctx.ai.calls.length
    const r = await client(ctx.app).post(`/f/${slug}/chat`, { lang: 'en', messages: [{ role: 'user', content: 'How much is a consultation?' }] })
    expect(r.status).toBe(200)
    expect(r.data.reply).toBe('A first consultation costs 30 OMR.')
    const sent = ctx.ai.calls[before]!
    expect(sent[0]!.content).toContain('First consultation costs 30 OMR')
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'How much is a consultation?' })
    const usage = await ctx.db.query(`SELECT u.feature, u.user_id FROM ai_usage u JOIN firm_sites s ON s.org_id = u.org_id WHERE s.slug = $1`, [slug])
    expect(usage).toEqual([{ feature: 'site_chat', user_id: null }])
  })

  it('validates input, is off unless enabled, and falls back when the firm is out of AI requests', async () => {
    const { slug } = await firmWithSite()
    const anon = client(ctx.app)
    expect((await anon.post(`/f/${slug}/chat`, { messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400)
    expect((await anon.post(`/f/${slug}/chat`, { messages: [] })).status).toBe(400)

    const orgId = (await ctx.db.one('SELECT org_id FROM firm_sites WHERE slug = $1', [slug]))!.org_id
    await ctx.db.query(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, [orgId])
    const before = ctx.ai.calls.length
    const r = await anon.post(`/f/${slug}/chat`, { lang: 'ar', messages: [{ role: 'user', content: 'مرحبا' }] })
    expect(r.data.fallback).toBe(true)
    expect(r.data.reply).toContain('طلب استشارة')
    expect(ctx.ai.calls.length).toBe(before)

    const off = await firmWithSite({ chatbot_enabled: false })
    expect((await anon.post(`/f/${off.slug}/chat`, { messages: [{ role: 'user', content: 'hi' }] })).status).toBe(404)
    expect((await client(ctx.app).get(`/f/${off.slug}`)).data).not.toContain('chat.js')
  })

  it('attaches the chat transcript when a chat visitor asks for a consultation', async () => {
    const { c, slug } = await firmWithSite()
    const r = await client(ctx.app).post(`/f/${slug}/contact`, {
      name: 'Chat Visitor', email: 'chat@example.com', message: 'Please call me',
      transcript: [{ role: 'user', content: 'Do you handle labour cases?' }, { role: 'assistant', content: 'Yes, we do.' }]
    })
    expect(r.data).toEqual({ ok: true })
    const lead = (await c.get('/api/website/leads')).data.items[0]
    expect(lead.source).toBe('chat')
    expect(lead.message).toContain('Visitor: Do you handle labour cases?')
  })
})

describe('AI blog writer', () => {
  it('drafts and translates articles and records usage', async () => {
    const { c } = await registered(ctx.app)
    ctx.ai.nextReply = JSON.stringify({ title: 'Gratuity in Oman', excerpt: 'What employees receive.', body: '## Overview\nText.' })
    const r = await c.post('/api/website/writer', { action: 'draft', language: 'en', topic: 'End of service gratuity', practice_area: 'employment', jurisdiction: 'oman' })
    expect(r.status).toBe(200)
    expect(r.data.result).toEqual({ title: 'Gratuity in Oman', excerpt: 'What employees receive.', body: '## Overview\nText.' })
    const prompt = ctx.ai.calls.at(-1)!
    expect(prompt[0]!.content).toContain('Never invent statutes')
    expect(prompt[1]!.content).toContain('Sultanate of Oman')

    ctx.ai.nextReply = JSON.stringify({ titles: ['A', 'B', ''] })
    expect((await c.post('/api/website/writer', { action: 'titles', language: 'ar', topic: 'x' })).data.result).toEqual({ titles: ['A', 'B'] })
    expect((await c.post('/api/website/writer', { action: 'translate', language: 'ar' })).status).toBe(400)
    expect((await c.post('/api/website/writer', { action: 'draft', language: 'en' })).status).toBe(400)
  })
})

describe('contact form rate limit', () => {
  it('limits repeated submissions from one visitor', async () => {
    const own = await setup()
    const owner = await registered(own.app)
    const slug = slugFor()
    await owner.c.put('/api/website/site', { slug, published: true })
    const statuses: (string | null)[] = []
    for (let i = 0; i < 7; i++) {
      const res = await own.app.request(`/f/${slug}/contact`, { method: 'POST', ...form({ name: `Visitor ${i}`, email: `v${i}@example.com` }) })
      statuses.push(res.headers.get('location'))
    }
    expect(statuses.slice(0, 5).every((l) => l?.includes('sent=1'))).toBe(true)
    expect(statuses[6]).toContain('error=limited')
  })
})
