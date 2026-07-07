import { Hono } from 'hono'

type Bindings = {
  OPENAI_API_KEY?: string
  JWT_SECRET?: string
}

const cmsApi = new Hono<{ Bindings: Bindings }>()

// In-memory database (replace with real DB)
const db = {
  pages: new Map(),
  posts: new Map(),
  media: new Map(),
  users: new Map(),
  settings: new Map(),
  forms: new Map(),
  submissions: new Map(),
}

// Initialize default data
db.users.set('admin', {
  id: 'admin',
  email: 'admin@trustiqlegal.com',
  password: 'admin123',
  name: 'Admin',
  role: 'admin',
})

// ============ PAGES ============
cmsApi.get('/pages', (c) => {
  const pages = Array.from(db.pages.values())
  return c.json(pages)
})

cmsApi.post('/pages', async (c) => {
  const data = await c.req.json()
  const id = `page-${Date.now()}`
  const page = {
    id,
    title: data.title,
    slug: data.slug,
    content: data.content,
    status: data.status || 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  db.pages.set(id, page)
  return c.json(page, 201)
})

cmsApi.put('/pages/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  const page = db.pages.get(id)
  if (!page) return c.json({ error: 'Not found' }, 404)
  
  const updated = { ...page, ...data, updatedAt: new Date() }
  db.pages.set(id, updated)
  return c.json(updated)
})

cmsApi.delete('/pages/:id', (c) => {
  const id = c.req.param('id')
  if (!db.pages.has(id)) return c.json({ error: 'Not found' }, 404)
  db.pages.delete(id)
  return c.json({ success: true })
})

// ============ POSTS ============
cmsApi.get('/posts', (c) => {
  const posts = Array.from(db.posts.values())
  return c.json(posts)
})

cmsApi.post('/posts', async (c) => {
  const data = await c.req.json()
  const id = `post-${Date.now()}`
  const post = {
    id,
    title: data.title,
    slug: data.slug,
    content: data.content,
    excerpt: data.excerpt,
    category: data.category,
    tags: data.tags || [],
    status: data.status || 'draft',
    featured: data.featured || false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  db.posts.set(id, post)
  return c.json(post, 201)
})

cmsApi.put('/posts/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  const post = db.posts.get(id)
  if (!post) return c.json({ error: 'Not found' }, 404)
  
  const updated = { ...post, ...data, updatedAt: new Date() }
  db.posts.set(id, updated)
  return c.json(updated)
})

cmsApi.delete('/posts/:id', (c) => {
  const id = c.req.param('id')
  if (!db.posts.has(id)) return c.json({ error: 'Not found' }, 404)
  db.posts.delete(id)
  return c.json({ success: true })
})

// ============ MEDIA ============
cmsApi.get('/media', (c) => {
  const media = Array.from(db.media.values())
  return c.json(media)
})

cmsApi.post('/media', async (c) => {
  const data = await c.req.json()
  const id = `media-${Date.now()}`
  const media = {
    id,
    filename: data.filename,
    url: data.url,
    type: data.type,
    size: data.size,
    uploadedAt: new Date(),
  }
  db.media.set(id, media)
  return c.json(media, 201)
})

cmsApi.delete('/media/:id', (c) => {
  const id = c.req.param('id')
  if (!db.media.has(id)) return c.json({ error: 'Not found' }, 404)
  db.media.delete(id)
  return c.json({ success: true })
})

// ============ FORMS ============
cmsApi.get('/forms', (c) => {
  const forms = Array.from(db.forms.values())
  return c.json(forms)
})

cmsApi.post('/forms', async (c) => {
  const data = await c.req.json()
  const id = `form-${Date.now()}`
  const form = {
    id,
    name: data.name,
    fields: data.fields || [],
    createdAt: new Date(),
  }
  db.forms.set(id, form)
  return c.json(form, 201)
})

cmsApi.post('/forms/:id/submit', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  
  const submission = {
    id: `submission-${Date.now()}`,
    formId: id,
    data,
    submittedAt: new Date(),
  }
  
  db.submissions.set(submission.id, submission)
  return c.json(submission, 201)
})

// ============ SETTINGS ============
cmsApi.get('/settings', (c) => {
  const settings = Object.fromEntries(db.settings)
  return c.json(settings)
})

cmsApi.put('/settings', async (c) => {
  const data = await c.req.json()
  Object.entries(data).forEach(([key, value]) => {
    db.settings.set(key, value)
  })
  return c.json(Object.fromEntries(db.settings))
})

// ============ AUTH ============
cmsApi.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  const user = Array.from(db.users.values()).find(
    (u) => u.email === email && u.password === password
  )
  
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token: `token-${user.id}-${Date.now()}`,
  })
})

export default cmsApi

