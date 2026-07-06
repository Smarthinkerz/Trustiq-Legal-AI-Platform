import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const casesRoutes = new Hono()

let cases: any[] = [
  {
    id: '2024-001',
    title: 'ABC Corp vs XYZ Ltd - Commercial Dispute',
    title_ar: 'شركة ABC ضد شركة XYZ المحدودة - نزاع تجاري',
    client: 'ABC Corporation',
    type: 'commercial',
    status: 'active',
    jurisdiction: 'uae',
    created_date: '2024-01-15',
    last_updated: '2024-01-20',
    description: 'Contract breach dispute involving supply chain agreement',
    estimated_value: 150000,
    currency: 'AED',
    priority: 'high',
    assigned_lawyer: 'Fathi Al Riyami',
    documents: [],
    timeline: []
  },
  {
    id: '2024-002',
    title: 'Personal Injury Claim - Traffic Accident',
    title_ar: 'دعوى إصابة شخصية - حادث مروري',
    client: 'محمد أحمد علي',
    type: 'personal_injury',
    status: 'under_review',
    jurisdiction: 'uae',
    created_date: '2024-02-01',
    last_updated: '2024-02-05',
    description: 'Traffic accident compensation claim',
    estimated_value: 75000,
    currency: 'AED',
    priority: 'medium',
    assigned_lawyer: 'Fathi Al Riyami',
    documents: [],
    timeline: []
  }
]

const createCaseSchema = z.object({
  title: z.string().min(5),
  title_ar: z.string().optional(),
  client: z.string().min(2),
  type: z.string(),
  jurisdiction: z.string(),
  description: z.string().min(10),
  estimated_value: z.number().optional(),
  currency: z.string().default('AED'),
  priority: z.enum(['low', 'medium', 'high']).default('medium')
})

const updateCaseSchema = z.object({
  title: z.string().min(5).optional(),
  title_ar: z.string().optional(),
  status: z.enum(['active', 'under_review', 'pending', 'resolved', 'closed']).optional(),
  description: z.string().min(10).optional(),
  estimated_value: z.number().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional()
})

casesRoutes.get('/', (c) => {
  const status = c.req.query('status')
  const type = c.req.query('type')
  const client = c.req.query('client')

  let filteredCases = cases
  if (status) filteredCases = filteredCases.filter(case_ => case_.status === status)
  if (type) filteredCases = filteredCases.filter(case_ => case_.type === type)
  if (client) filteredCases = filteredCases.filter(case_ => case_.client.toLowerCase().includes(client.toLowerCase()))

  return c.json({ success: true, cases: filteredCases, total: filteredCases.length, filters: { status, type, client } })
})

casesRoutes.get('/:id', (c) => {
  const caseId = c.req.param('id')
  const case_ = cases.find(item => item.id === caseId)
  if (!case_) return c.json({ error: 'Case not found' }, 404)
  return c.json({ success: true, case: case_ })
})

casesRoutes.post('/', zValidator('json', createCaseSchema), (c) => {
  const caseData = c.req.valid('json')
  const newCase = {
    id: `2024-${String(cases.length + 1).padStart(3, '0')}`,
    ...caseData,
    status: 'active',
    created_date: new Date().toISOString().split('T')[0],
    last_updated: new Date().toISOString().split('T')[0],
    assigned_lawyer: 'Fathi Al Riyami',
    documents: [],
    timeline: [{ date: new Date().toISOString().split('T')[0], event: 'Case opened', description: 'New case created in the system' }]
  }
  cases.push(newCase)
  return c.json({ success: true, message: 'Case created successfully', case: newCase }, 201)
})

casesRoutes.put('/:id', zValidator('json', updateCaseSchema), (c) => {
  const caseId = c.req.param('id')
  const updateData = c.req.valid('json')
  const caseIndex = cases.findIndex(item => item.id === caseId)
  if (caseIndex === -1) return c.json({ error: 'Case not found' }, 404)
  cases[caseIndex] = { ...cases[caseIndex], ...updateData, last_updated: new Date().toISOString().split('T')[0] }
  return c.json({ success: true, message: 'Case updated successfully', case: cases[caseIndex] })
})

casesRoutes.delete('/:id', (c) => {
  const caseId = c.req.param('id')
  const caseIndex = cases.findIndex(item => item.id === caseId)
  if (caseIndex === -1) return c.json({ error: 'Case not found' }, 404)
  const deletedCase = cases.splice(caseIndex, 1)[0]
  return c.json({ success: true, message: 'Case deleted successfully', case: deletedCase })
})

casesRoutes.get('/stats/overview', (c) => {
  return c.json({
    success: true,
    stats: {
      total_cases: cases.length,
      active_cases: cases.filter(item => item.status === 'active').length,
      under_review: cases.filter(item => item.status === 'under_review').length,
      high_priority_cases: cases.filter(item => item.priority === 'high').length
    }
  })
})

export default casesRoutes
