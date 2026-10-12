import { beforeAll, describe, expect, it } from 'vitest'
import { embedUrl, sniffMedia } from '../src/services/blog-media'
import { renderArticle } from '../src/services/website'
import { registered, setup, TINY_PNG } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, ...new Array(200).fill(7)])
const upload = (c: any, bytes: Uint8Array, name: string, extra: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(bytes)], name))
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return c.post('/api/website/media', fd)
}

async function firmWithSite() {
  const owner = await registered(ctx.app)
  const slug = `firm-${crypto.randomUUID().slice(0, 8)}`
  expect((await owner.c.put('/api/website/site', { slug, published: true, practice_areas: ['employment'] })).status).toBe(200)
  return { ...owner, slug }
}

describe('blog media helpers', () => {
  it('recognises files by content and only embeds YouTube and Vimeo', () => {
    expect(sniffMedia(TINY_PNG)).toEqual({ kind: 'image', mime: 'image/png' })
    expect(sniffMedia(MP4)).toEqual({ kind: 'video', mime: 'video/mp4' })
    expect(sniffMedia(new TextEncoder().encode('MZ executable'))).toBeNull()
    expect(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(embedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(embedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
    expect(embedUrl('https://evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(embedUrl('javascript:alert(1)')).toBeNull()
  })

  it('places media where the line is, escapes captions and drops unknown media', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    const vid = '66666666-2222-3333-4444-555555555555'
    const html = renderArticle(`Intro\n![A "contract" <b>](media:${id})\nMiddle\n![](media:${vid})\n![Talk](https://youtu.be/dQw4w9WgXcQ)\n![x](media:99999999-2222-3333-4444-555555555555)\nEnd`,
      (m) => (m === id ? { url: `/m/${id}`, kind: 'image' } : m === vid ? { url: `/m/${vid}`, kind: 'video' } : undefined))
    expect(html.indexOf('<p>Intro</p>')).toBeLessThan(html.indexOf('<img'))
    expect(html).toContain(`<img src="/m/${id}" alt="A &quot;contract&quot; &lt;b&gt;"`)
    expect(html).toContain('<figcaption>A &quot;contract&quot; &lt;b&gt;</figcaption>')
    expect(html).toContain(`<video src="/m/${vid}" controls`)
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(html).not.toContain('99999999')
    expect(html.indexOf('<p>Middle</p>')).toBeLessThan(html.indexOf('<video'))
    // Without a resolver (e.g. the About text) nothing is embedded from the media library.
    expect(renderArticle(`![x](media:${id})`)).toBe('')
  })
})

describe('blog images and videos', () => {
  it('uploads images and videos, rejects other files and enforces size limits', async () => {
    const { c } = await registered(ctx.app)
    const img = await upload(c, TINY_PNG, 'cover.png', { alt: 'Office' })
    expect(img.status).toBe(201)
    expect(img.data.media).toMatchObject({ kind: 'image', mime: 'image/png', alt: 'Office', source: 'upload' })
    const vid = await upload(c, MP4, 'clip.mp4')
    expect(vid.data.media).toMatchObject({ kind: 'video', mime: 'video/mp4' })
    expect((await upload(c, new TextEncoder().encode('MZ...'), 'x.exe')).status).toBe(415)
    const list = await c.get('/api/website/media')
    expect(list.data.items.map((m: any) => m.kind)).toEqual(['video', 'image'])
    const file = await ctx.app.request(`/api/website/media/${img.data.media.id}`, { headers: { cookie: c.cookie } })
    expect(file.headers.get('content-type')).toBe('image/png')
    const other = await registered(ctx.app)
    expect((await ctx.app.request(`/api/website/media/${img.data.media.id}`, { headers: { cookie: other.c.cookie } })).status).toBe(404)

    const small = await setup({ MAX_UPLOAD_MB: '0.0001', MAX_VIDEO_MB: '0.0001' })
    const s = await registered(small.app)
    const big = new Uint8Array(500); big.set(TINY_PNG)
    const r = await upload(s.c, big, 'big.png')
    expect(r.status).toBe(413)
    expect(r.data.error.message).toMatch(/Images can be up to/)
  })

  it('generates a cover image with AI from the title and summary', async () => {
    const { c, me } = await registered(ctx.app)
    const r = await c.post('/api/website/media/generate', { title: 'Unpaid wages in Oman', excerpt: 'What employees can do', style: 'photo' })
    expect(r.status).toBe(201)
    expect(r.data.media).toMatchObject({ kind: 'image', source: 'ai', alt: 'Unpaid wages in Oman' })
    const prompt = ctx.ai.imagePrompts.at(-1)!
    expect(prompt).toContain('Unpaid wages in Oman')
    expect(prompt).toContain('What employees can do')
    expect(prompt).toContain('photograph')
    expect(prompt).toMatch(/no text/i)
    const usage = await ctx.db.query(`SELECT count(*)::int AS n FROM ai_usage WHERE org_id = $1 AND feature = 'cover_image'`, [me.org.id])
    expect(usage[0].n).toBe(1)
    expect((await c.post('/api/website/media/generate', {})).status).toBe(400)
  })

  it('publishes a post with a cover and media in place; media stays private until then', async () => {
    const { c, slug } = await firmWithSite()
    const cover = (await upload(c, TINY_PNG, 'cover.png')).data.media
    const pic = (await upload(c, TINY_PNG, 'inside.png')).data.media
    const vid = (await upload(c, MP4, 'clip.mp4')).data.media
    const body = `## Your rights\nFirst paragraph.\n\n![Signing the contract](media:${pic.id})\n\nSecond paragraph.\n\n![Our partner explains](media:${vid.id})\n\n![Webinar](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`
    const created = await c.post('/api/website/posts', { title: 'Wages guide', body, cover_media_id: cover.id, cover_alt: 'Gavel on a desk', status: 'draft' })
    expect(created.status).toBe(201)
    const postSlug = created.data.post.slug
    // Uploaded before the post existed: filed under it once used.
    expect((await c.get('/api/website/media')).data.items.every((m: any) => m.post_id === created.data.post.id)).toBe(true)

    const preview = await c.post('/api/website/preview', { body })
    expect(preview.data.html).toContain(`/api/website/media/${pic.id}`)
    expect(preview.data.html).toContain('<video')

    expect((await ctx.app.request(`/f/${slug}/media/${pic.id}`)).status).toBe(404)
    await c.patch(`/api/website/posts/${created.data.post.id}`, { status: 'published' })

    const page = await (await ctx.app.request(`/f/${slug}/blog/${postSlug}`)).text()
    expect(page).toContain(`<img src="/f/${slug}/media/${cover.id}" alt="Gavel on a desk"`)
    expect(page).toContain(`property="og:image" content="http://localhost:8080/f/${slug}/media/${cover.id}"`)
    const article = page.slice(page.indexOf('<div class="article'))
    expect(article.indexOf('First paragraph')).toBeLessThan(article.indexOf(`media/${pic.id}`))
    expect(article.indexOf(`media/${pic.id}`)).toBeLessThan(article.indexOf('Second paragraph'))
    // Media lines are not shown as text in summaries.
    expect(page).not.toContain('](media:')
    expect(page).toContain(`<video src="/f/${slug}/media/${vid.id}"`)
    expect(page).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    const list = await (await ctx.app.request(`/f/${slug}/blog`)).text()
    expect(list).toContain(`/f/${slug}/media/${cover.id}`)

    const img = await ctx.app.request(`/f/${slug}/media/${pic.id}`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(img.headers.get('content-security-policy')).toContain('frame-src \'self\' https://www.youtube-nocookie.com https://player.vimeo.com')
    const part = await ctx.app.request(`/f/${slug}/media/${vid.id}`, { headers: { range: 'bytes=4-11' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 4-11/${MP4.length}`)
    expect(new TextDecoder().decode(new Uint8Array(await part.arrayBuffer()))).toBe('ftypisom')
    expect((await ctx.app.request(`/f/${slug}/media/${vid.id}`, { headers: { range: 'bytes=9999-' } })).status).toBe(416)

    // Unused media are not public even when the site is.
    const unused = (await upload(c, TINY_PNG, 'unused.png')).data.media
    expect((await ctx.app.request(`/f/${slug}/media/${unused.id}`)).status).toBe(404)
  })

  it('only accepts the firm\'s own images as a cover', async () => {
    const { c } = await registered(ctx.app)
    const other = await registered(ctx.app)
    const theirs = (await upload(other.c, TINY_PNG, 'x.png')).data.media
    expect((await c.post('/api/website/posts', { title: 'T', cover_media_id: theirs.id })).status).toBe(400)
    const vid = (await upload(c, MP4, 'clip.mp4')).data.media
    expect((await c.post('/api/website/posts', { title: 'T', cover_media_id: vid.id })).status).toBe(400)
  })

  it('tells the AI writer to keep placed media in place', async () => {
    const { c } = await registered(ctx.app)
    ctx.ai.nextReply = JSON.stringify({ title: 'T', body: 'B' })
    await c.post('/api/website/writer', { action: 'translate', language: 'ar', title: 'T', body: 'Text\n![Cap](media:11111111-2222-3333-4444-555555555555)' })
    expect(ctx.ai.calls.at(-1)![0]!.content).toContain('Keep every one of them')
  })
})
