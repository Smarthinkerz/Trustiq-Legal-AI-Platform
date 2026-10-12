import { Hono } from 'hono'
import { clientIp, type AppEnv, type Deps } from '../context'
import { tooMany } from '../lib/errors'
import { RateLimiter } from '../lib/rate-limit'
import { blogIndexPage, blogPostPage, mediaPath, type BlogPost } from '../pages/platform-blog'
import { mediaResolver, serveMedia } from '../services/blog-media'

// ---------------------------------------------------------------------------
// TrustiqLegal's own blog (/blog, /ar/blog). Articles are written in the
// normal blog editor of one firm account: the firm website named by
// PLATFORM_BLOG_SLUG, or else the firm of the platform admins.
// ---------------------------------------------------------------------------

const COLUMNS = 'slug, title, title_ar, excerpt, excerpt_ar, body, body_ar, published_at, cover_media_id, cover_alt'

export function platformBlogRoutes(deps: Deps, assetVersion: string) {
  const { db, config } = deps
  const app = new Hono<AppEnv>()
  const views = new RateLimiter(300, 60_000)

  app.use('*', async (c, next) => {
    if (!views.take(clientIp(c)).ok) throw tooMany()
    await next()
  })

  const blogOrg = async (): Promise<string | null> => {
    if (config.platformBlogSlug) {
      const [s] = await db.query('SELECT org_id FROM firm_sites WHERE slug = $1', [config.platformBlogSlug])
      return s?.org_id ?? null
    }
    if (!config.platformAdminEmails.length) return null
    const [o] = await db.query(
      `SELECT u.org_id FROM users u
        WHERE lower(u.email) = ANY($1::text[]) AND u.deactivated_at IS NULL
        ORDER BY (SELECT max(published_at) FROM blog_posts p WHERE p.org_id = u.org_id AND p.status = 'published') DESC NULLS LAST, u.created_at
        LIMIT 1`, [config.platformAdminEmails])
    return o?.org_id ?? null
  }

  const common = (lang: 'en' | 'ar') => ({ lang, assetVersion, appUrl: config.appUrl, salesEmail: config.salesEmail, supportEmail: config.supportEmail })
  const published = async (orgId: string | null, limit: number, except?: string) => (orgId
    ? db.query(`SELECT ${COLUMNS} FROM blog_posts WHERE org_id = $1 AND status = 'published' AND ($3::text IS NULL OR slug <> $3)
                ORDER BY published_at DESC LIMIT $2`, [orgId, limit, except ?? null])
    : []) as Promise<BlogPost[]>

  for (const [prefix, lang] of [['/blog', 'en'], ['/ar/blog', 'ar']] as const) {
    app.get(prefix, async (c) => {
      c.header('cache-control', 'public, max-age=60')
      return c.html(blogIndexPage({ ...common(lang), posts: await published(await blogOrg(), 60) }))
    })
    app.get(`${prefix}/:slug`, async (c) => {
      const orgId = await blogOrg()
      const [post] = orgId ? await db.query<BlogPost>(`SELECT ${COLUMNS} FROM blog_posts WHERE org_id = $1 AND slug = $2 AND status = 'published'`, [orgId, c.req.param('slug')]) : []
      if (!post) return c.redirect(prefix, 302)
      const media = await mediaResolver(db, orgId!, [post.body, post.body_ar], mediaPath)
      c.header('cache-control', 'public, max-age=60')
      return c.html(blogPostPage({ ...common(lang), post, media, more: await published(orgId, 3, post.slug) }))
    })
  }

  // Covers and article media, public only while a published article uses them.
  app.get('/blog-media/:id', async (c) => {
    const id = c.req.param('id').toLowerCase()
    const orgId = await blogOrg()
    if (!orgId || !/^[0-9a-f-]{36}$/.test(id)) return c.body(null, 404)
    const used = await db.one(
      `SELECT 1 FROM blog_posts WHERE org_id = $1 AND status = 'published'
          AND (cover_media_id = $2::uuid OR strpos(coalesce(body, ''), $3) > 0 OR strpos(coalesce(body_ar, ''), $3) > 0) LIMIT 1`,
      [orgId, id, `](media:${id})`])
    if (!used) return c.body(null, 404)
    return serveMedia(c, db, { id, orgId }, 'public, max-age=86400')
  })

  return app
}
