import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { LegalAIService } from '../services/ai-simple.js'

const aiRoutes = new Hono()

function getAIService(env?: any): LegalAIService | null {
  const apiKey = env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new LegalAIService(apiKey)
}

const chatSchema = z.object({
  message: z.string().min(1),
  language: z.enum(['en', 'ar']).default('en'),
  context: z.object({
    case_id: z.string().optional(),
    jurisdiction: z.string().optional(),
    practice_area: z.string().optional(),
    uploadedDocumentIds: z.array(z.string()).optional()
  }).optional()
})

const researchSchema = z.object({
  query: z.string().min(5),
  jurisdiction: z.string(),
  practice_area: z.string().optional(),
  language: z.enum(['en', 'ar']).default('en'),
  depth: z.enum(['basic', 'comprehensive']).default('basic')
})

const analyzeSchema = z.object({
  document_text: z.string().min(10),
  analysis_type: z.enum(['compliance', 'risk', 'summary', 'review']),
  jurisdiction: z.string(),
  language: z.enum(['en', 'ar']).default('en')
})

aiRoutes.post('/chat', zValidator('json', chatSchema), async (c) => {
  const { message, language, context } = c.req.valid('json')
  const service = getAIService(c.env)
  if (!service) return c.json({ success: false, error: 'AI service not configured. Please set OPENAI_API_KEY.' }, 500)
  const response = await service.processLegalChat(message, language, {
    jurisdiction: context?.jurisdiction,
    caseId: context?.case_id,
    practiceArea: context?.practice_area
  })
  return c.json({ success: true, response })
})

aiRoutes.post('/research', zValidator('json', researchSchema), async (c) => {
  const { query, jurisdiction, language, depth } = c.req.valid('json')
  const service = getAIService(c.env)
  if (!service) return c.json({ success: false, error: 'AI service not configured. Please set OPENAI_API_KEY.' }, 500)
  const response = await service.processLegalResearch(query, jurisdiction, language, depth)
  return c.json({ success: true, response })
})

aiRoutes.post('/analyze-document', zValidator('json', analyzeSchema), async (c) => {
  const { document_text, analysis_type, jurisdiction, language } = c.req.valid('json')
  const service = getAIService(c.env)
  if (!service) return c.json({ success: false, error: 'AI service not configured. Please set OPENAI_API_KEY.' }, 500)
  const response = await service.analyzeDocument(document_text, analysis_type, jurisdiction, language)
  return c.json({ success: true, response })
})

aiRoutes.get('/models', (c) => {
  return c.json({ models: [{ id: 'gpt-4', name: 'GPT-4', purpose: 'Legal assistant' }] })
})

export default aiRoutes
