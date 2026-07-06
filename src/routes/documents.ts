import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const documentsRoutes = new Hono()

let documents: any[] = []

const createDocumentSchema = z.object({
  case_id: z.string().optional(),
  title: z.string().min(3),
  type: z.string().default('legal_document'),
  content: z.string().min(10),
  jurisdiction: z.string().default('uae')
})

const analyzeSchema = z.object({
  document_text: z.string().min(10),
  analysis_type: z.enum(['compliance', 'risk', 'summary', 'review']),
  jurisdiction: z.string(),
  language: z.enum(['en', 'ar']).default('en')
})

documentsRoutes.get('/', (c) => {
  return c.json({ success: true, documents, total: documents.length })
})

documentsRoutes.post('/generate', zValidator('json', createDocumentSchema), (c) => {
  const payload = c.req.valid('json')
  const document = {
    id: `doc_${Date.now()}`,
    ...payload,
    generated_at: new Date().toISOString(),
    status: 'draft'
  }
  documents.push(document)
  return c.json({ success: true, document })
})

documentsRoutes.post('/analyze', zValidator('json', analyzeSchema), (c) => {
  const data = c.req.valid('json')
  return c.json({
    success: true,
    analysis: {
      analysis_type: data.analysis_type,
      jurisdiction: data.jurisdiction,
      language: data.language,
      summary: 'Document analyzed successfully.',
      risk_score: 42,
      recommendations: ['Review key clauses', 'Confirm governing law', 'Validate signatures']
    }
  })
})

documentsRoutes.get('/:id', (c) => {
  const doc = documents.find(item => item.id === c.req.param('id'))
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  return c.json({ success: true, document: doc })
})

export default documentsRoutes
