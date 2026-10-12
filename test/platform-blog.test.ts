import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup, TINY_PNG } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
const ADMIN = `admin-${crypto.randomUUID().slice(0, 6)}@trustiq.test`
beforeAll(async () => { ctx = await setup({ PLATFORM_ADMIN_EMAILS: ADMIN }) })

const upload = (c: any, bytes: Uint8Array) => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(bytes)], 'cover.png'))
  return c.post('/api/website/media', fd)
}

describe('TrustiqLegal blog', () => {
  it('links the blog before pricing on the homepage, in English and Arabic', async () => {
    for (const [path, blog, pricing] of [['/', '/blog', '#pricing'], ['/ar', '/ar/blog', '#pricing']]) {
      const html = await (await ctx.app.request(path)).text()
      const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
      expect(nav).toContain(`href="${blog}"`)
      expect(nav.indexOf(`href="${blog}"`)).toBeLessThan(nav.indexOf(`href="${pricing}"`))
    }
  })

  it('shows the platform admins\' published articles as cards and opens each article', async () => {
    const empty = await (await ctx.app.request('/blog')).text()
    expect(empty).toContain('No articles have been published yet')

    const { c } = await registered(ctx.app, { email: ADMIN })
    const other = await registered(ctx.app)
    await other.c.post('/api/website/posts', { title: 'Another firm\'s post', body: 'x', status: 'published' })
    const cover = (await upload(c, TINY_PNG)).data.media
    const inside = (await upload(c, TINY_PNG)).data.media
    await c.post('/api/website/posts', { title: 'Draft only', body: 'secret', status: 'draft' })
    const p1 = await c.post('/api/website/posts', {
      title: 'AI for GCC law firms', title_ar: 'الذكاء الاصطناعي لمكاتب المحاماة', excerpt: 'How firms in the Gulf use AI.',
      body: `## Why now\nFirst part.\n\n![Dashboard](media:${inside.id})\n\nMore text.`, body_ar: 'نص عربي', cover_media_id: cover.id, cover_alt: 'Lawyer at a laptop', status: 'published'
    })
    expect(p1.status).toBe(201)
    await c.post('/api/website/posts', { title: 'Second post', body: 'Body two', status: 'published' })

    const list = await ctx.app.request('/blog')
    const html = await list.text()
    expect(html).toContain('AI for GCC law firms')
    expect(html).toContain('How firms in the Gulf use AI.')
    expect(html).toContain(`href="/blog/${p1.data.post.slug}"`)
    expect(html).toContain('Read more')
    expect(html).toContain(`src="/blog-media/${cover.id}"`)
    expect(html).not.toContain('Draft only')
    expect(html).not.toContain('Another firm')
    // The nav marks the blog as the current page and section links go back to the homepage.
    expect(html).toContain('href="/#pricing"')

    const ar = await (await ctx.app.request('/ar/blog')).text()
    expect(ar).toContain('الذكاء الاصطناعي لمكاتب المحاماة')
    expect(ar).toContain('اقرأ المزيد')
    expect(ar).toContain('dir="rtl"')

    const page = await (await ctx.app.request(`/blog/${p1.data.post.slug}`)).text()
    expect(page).toContain('<h1 class="mt-5 text-3xl md:text-5xl font-bold leading-tight">AI for GCC law firms</h1>')
    expect(page).toContain('Back to blog')
    expect(page).toContain(`alt="Lawyer at a laptop"`)
    expect(page).toContain(`<img src="/blog-media/${inside.id}"`)
    expect(page).toContain(`property="og:image" content="http://localhost:8080/blog-media/${cover.id}"`)
    expect(page).toContain('wa.me/?text=')
    expect(page).toContain('More articles')
    expect(page).toContain('Second post')

    const img = await ctx.app.request(`/blog-media/${cover.id}`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    const unused = (await upload(c, TINY_PNG)).data.media
    expect((await ctx.app.request(`/blog-media/${unused.id}`)).status).toBe(404)
    expect((await ctx.app.request('/blog/does-not-exist')).headers.get('location')).toBe('/blog')
  })

  it('can be pointed at a specific firm website instead', async () => {
    const custom = await setup({ PLATFORM_BLOG_SLUG: 'trustiq-news' })
    const { c } = await registered(custom.app)
    await c.put('/api/website/site', { slug: 'trustiq-news', published: false })
    await c.post('/api/website/posts', { title: 'Release notes October', body: 'New features', status: 'published' })
    expect(await (await custom.app.request('/blog')).text()).toContain('Release notes October')
  })
})
