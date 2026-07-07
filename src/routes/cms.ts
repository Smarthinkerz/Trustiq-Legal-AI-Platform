import { Hono } from 'hono'
import type { CMSContent, CMSUser, CMSMedia, CMSTheme, CMSForm, CMSAnalytics, CMSSEOSettings } from '../cms-schema'

type Bindings = {
  OPENAI_API_KEY?: string
  JWT_SECRET?: string
}

const cmsRoutes = new Hono<{ Bindings: Bindings }>()

// In-memory storage (replace with database in production)
const cmsStorage = {
  users: new Map<string, CMSUser>(),
  content: new Map<string, CMSContent>(),
  media: new Map<string, CMSMedia>(),
  themes: new Map<string, CMSTheme>(),
  forms: new Map<string, CMSForm>(),
  analytics: new Map<string, CMSAnalytics>(),
  seoSettings: new Map<string, CMSSEOSettings>(),
}

// Initialize default admin user
const initializeDefaultUser = () => {
  if (cmsStorage.users.size === 0) {
    cmsStorage.users.set('admin-1', {
      id: 'admin-1',
      email: 'admin@trustiqlegal.com',
      password: 'admin123', // In production, use hashed passwords
      name: 'Admin User',
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
}

initializeDefaultUser()

// ============ AUTHENTICATION ============

cmsRoutes.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json()

  const user = Array.from(cmsStorage.users.values()).find(
    (u) => u.email === email && u.password === password
  )

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    token: `token-${user.id}-${Date.now()}`,
  })
})

cmsRoutes.post('/auth/logout', (c) => {
  return c.json({ success: true })
})

// ============ CONTENT MANAGEMENT ============

// Get all content
cmsRoutes.get('/content', (c) => {
  const type = c.req.query('type')
  const section = c.req.query('section')

  let content = Array.from(cmsStorage.content.values())

  if (type) {
    content = content.filter((c) => c.type === type)
  }

  if (section) {
    content = content.filter((c) => c.section === section)
  }

  return c.json(content)
})

// Get content by ID
cmsRoutes.get('/content/:id', (c) => {
  const id = c.req.param('id')
  const content = cmsStorage.content.get(id)

  if (!content) {
    return c.json({ error: 'Content not found' }, 404)
  }

  return c.json(content)
})

// Create content
cmsRoutes.post('/content', async (c) => {
  const data = await c.req.json()
  const id = `content-${Date.now()}`

  const content: CMSContent = {
    id,
    type: data.type,
    section: data.section,
    title: data.title,
    content: data.content,
    metadata: data.metadata || {},
    published: data.published || false,
    createdBy: data.createdBy || 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  cmsStorage.content.set(id, content)
  return c.json(content, 201)
})

// Update content
cmsRoutes.put('/content/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()

  const content = cmsStorage.content.get(id)
  if (!content) {
    return c.json({ error: 'Content not found' }, 404)
  }

  const updated: CMSContent = {
    ...content,
    ...data,
    updatedAt: new Date(),
  }

  cmsStorage.content.set(id, updated)
  return c.json(updated)
})

// Delete content
cmsRoutes.delete('/content/:id', (c) => {
  const id = c.req.param('id')

  if (!cmsStorage.content.has(id)) {
    return c.json({ error: 'Content not found' }, 404)
  }

  cmsStorage.content.delete(id)
  return c.json({ success: true })
})

// ============ MEDIA MANAGEMENT ============

// Get all media
cmsRoutes.get('/media', (c) => {
  const media = Array.from(cmsStorage.media.values())
  return c.json(media)
})

// Upload media (simplified)
cmsRoutes.post('/media/upload', async (c) => {
  const data = await c.req.json()
  const id = `media-${Date.now()}`

  const media: CMSMedia = {
    id,
    filename: data.filename,
    url: data.url,
    type: data.type,
    size: data.size,
    uploadedBy: data.uploadedBy || 'system',
    createdAt: new Date(),
    tags: data.tags || [],
  }

  cmsStorage.media.set(id, media)
  return c.json(media, 201)
})

// Delete media
cmsRoutes.delete('/media/:id', (c) => {
  const id = c.req.param('id')

  if (!cmsStorage.media.has(id)) {
    return c.json({ error: 'Media not found' }, 404)
  }

  cmsStorage.media.delete(id)
  return c.json({ success: true })
})

// ============ THEME MANAGEMENT ============

// Get active theme
cmsRoutes.get('/theme', (c) => {
  const theme = Array.from(cmsStorage.themes.values()).find((t) => t.active)

  if (!theme) {
    return c.json({
      colors: {
        primary: '#1a365d',
        secondary: '#2d3748',
        accent: '#3182ce',
        background: '#ffffff',
        text: '#000000',
      },
      fonts: {
        heading: 'system-ui',
        body: 'system-ui',
      },
    })
  }

  return c.json(theme)
})

// Update theme
cmsRoutes.put('/theme', async (c) => {
  const data = await c.req.json()
  const id = `theme-${Date.now()}`

  // Deactivate all other themes
  cmsStorage.themes.forEach((theme) => {
    theme.active = false
  })

  const theme: CMSTheme = {
    id,
    name: data.name || 'Custom Theme',
    colors: data.colors,
    fonts: data.fonts,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  cmsStorage.themes.set(id, theme)
  return c.json(theme)
})

// ============ FORM MANAGEMENT ============

// Get all forms
cmsRoutes.get('/forms', (c) => {
  const forms = Array.from(cmsStorage.forms.values())
  return c.json(forms)
})

// Create form
cmsRoutes.post('/forms', async (c) => {
  const data = await c.req.json()
  const id = `form-${Date.now()}`

  const form: CMSForm = {
    id,
    name: data.name,
    fields: data.fields || [],
    submissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  cmsStorage.forms.set(id, form)
  return c.json(form, 201)
})

// Submit form
cmsRoutes.post('/forms/:id/submit', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()

  const form = cmsStorage.forms.get(id)
  if (!form) {
    return c.json({ error: 'Form not found' }, 404)
  }

  const submission = {
    id: `submission-${Date.now()}`,
    formId: id,
    data,
    submittedAt: new Date(),
  }

  form.submissions.push(submission)
  return c.json(submission, 201)
})

// ============ ANALYTICS ============

// Get analytics
cmsRoutes.get('/analytics', (c) => {
  const pageUrl = c.req.query('pageUrl')
  let analytics = Array.from(cmsStorage.analytics.values())

  if (pageUrl) {
    analytics = analytics.filter((a) => a.pageUrl === pageUrl)
  }

  return c.json(analytics)
})

// Track page view
cmsRoutes.post('/analytics/track', async (c) => {
  const data = await c.req.json()
  const id = `analytics-${Date.now()}`

  const analytics: CMSAnalytics = {
    id,
    pageUrl: data.pageUrl,
    visitors: data.visitors || 1,
    pageViews: data.pageViews || 1,
    bounceRate: data.bounceRate || 0,
    avgSessionDuration: data.avgSessionDuration || 0,
    trafficSources: data.trafficSources || {},
    devices: data.devices || {},
    countries: data.countries || {},
    date: new Date(),
  }

  cmsStorage.analytics.set(id, analytics)
  return c.json(analytics, 201)
})

// ============ SEO SETTINGS ============

// Get SEO settings
cmsRoutes.get('/seo/:pageUrl', (c) => {
  const pageUrl = c.req.param('pageUrl')
  const seo = Array.from(cmsStorage.seoSettings.values()).find(
    (s) => s.pageUrl === pageUrl
  )

  if (!seo) {
    return c.json({ error: 'SEO settings not found' }, 404)
  }

  return c.json(seo)
})

// Update SEO settings
cmsRoutes.put('/seo/:pageUrl', async (c) => {
  const pageUrl = c.req.param('pageUrl')
  const data = await c.req.json()

  let seo = Array.from(cmsStorage.seoSettings.values()).find(
    (s) => s.pageUrl === pageUrl
  )

  if (!seo) {
    const id = `seo-${Date.now()}`
    seo = {
      id,
      pageUrl,
      metaTitle: data.metaTitle || '',
      metaDescription: data.metaDescription || '',
      keywords: data.keywords || [],
      ogImage: data.ogImage,
      ogTitle: data.ogTitle,
      ogDescription: data.ogDescription,
      canonicalUrl: data.canonicalUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    cmsStorage.seoSettings.set(id, seo)
  } else {
    seo = {
      ...seo,
      ...data,
      updatedAt: new Date(),
    }
    cmsStorage.seoSettings.set(seo.id, seo)
  }

  return c.json(seo)
})

// ============ LANDING PAGE CONTENT ============

cmsRoutes.get('/landing-page', (c) => {
  const content = Array.from(cmsStorage.content.values()).filter(
    (c) => c.type === 'landing'
  )

  return c.json({
    hero: content.find((c) => c.section === 'hero'),
    features: content.filter((c) => c.section === 'features'),
    pricing: content.filter((c) => c.section === 'pricing'),
    testimonials: content.filter((c) => c.section === 'testimonials'),
    cta: content.find((c) => c.section === 'cta'),
  })
})

// ============ APP DASHBOARD CONTENT ============

cmsRoutes.get('/app-dashboard', (c) => {
  const content = Array.from(cmsStorage.content.values()).filter(
    (c) => c.type === 'app'
  )

  return c.json({
    title: content.find((c) => c.section === 'title'),
    description: content.find((c) => c.section === 'description'),
    sections: content.filter((c) => c.section === 'section'),
    quickActions: content.filter((c) => c.section === 'quickAction'),
    metrics: content.filter((c) => c.section === 'metric'),
  })
})

export default cmsRoutes

