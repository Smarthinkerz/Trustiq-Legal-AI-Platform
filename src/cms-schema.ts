// CMS Database Schema and Types

export interface CMSUser {
  id: string
  email: string
  password: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  createdAt: Date
  updatedAt: Date
}

export interface CMSContent {
  id: string
  type: 'landing' | 'app' | 'page'
  section: string // 'hero', 'features', 'pricing', 'dashboard', etc.
  title: string
  content: string
  metadata: Record<string, any>
  published: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
  publishedAt?: Date
}

export interface CMSMedia {
  id: string
  filename: string
  url: string
  type: 'image' | 'video' | 'document'
  size: number
  uploadedBy: string
  createdAt: Date
  tags: string[]
}

export interface CMSTheme {
  id: string
  name: string
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
  }
  fonts: {
    heading: string
    body: string
  }
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CMSForm {
  id: string
  name: string
  fields: FormField[]
  submissions: FormSubmission[]
  createdAt: Date
  updatedAt: Date
}

export interface FormField {
  id: string
  name: string
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox'
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface FormSubmission {
  id: string
  formId: string
  data: Record<string, any>
  submittedAt: Date
}

export interface CMSAnalytics {
  id: string
  pageUrl: string
  visitors: number
  pageViews: number
  bounceRate: number
  avgSessionDuration: number
  trafficSources: Record<string, number>
  devices: Record<string, number>
  countries: Record<string, number>
  date: Date
}

export interface CMSVersion {
  id: string
  contentId: string
  version: number
  content: string
  createdBy: string
  createdAt: Date
  changeDescription: string
}

export interface CMSSEOSettings {
  id: string
  pageUrl: string
  metaTitle: string
  metaDescription: string
  keywords: string[]
  ogImage?: string
  ogTitle?: string
  ogDescription?: string
  canonicalUrl?: string
  createdAt: Date
  updatedAt: Date
}

// Landing Page Specific Content
export interface LandingPageContent {
  hero: {
    title: string
    subtitle: string
    ctaText: string
    ctaLink: string
    backgroundImage?: string
  }
  features: Array<{
    id: string
    icon: string
    title: string
    description: string
  }>
  pricing: Array<{
    id: string
    name: string
    price: number
    currency: string
    description: string
    features: string[]
    highlighted: boolean
  }>
  testimonials: Array<{
    id: string
    name: string
    role: string
    content: string
    image?: string
  }>
  cta: {
    title: string
    description: string
    buttonText: string
    buttonLink: string
  }
}

// App Dashboard Specific Content
export interface AppDashboardContent {
  title: string
  description: string
  sections: Array<{
    id: string
    name: string
    title: string
    description: string
    icon: string
    content: string
  }>
  quickActions: Array<{
    id: string
    label: string
    icon: string
    action: string
  }>
  metrics: Array<{
    id: string
    label: string
    value: string | number
    icon: string
    trend?: number
  }>
}

