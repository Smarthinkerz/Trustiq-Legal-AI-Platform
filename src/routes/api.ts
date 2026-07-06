import { Hono } from 'hono'

const apiRoutes = new Hono()

apiRoutes.get('/status', (c) => {
  return c.json({
    status: 'operational',
    service: 'TrustiqLegal Platform API',
    version: '1.0.0',
    features: {
      ai_legal_assistant: 'active',
      document_generation: 'active',
      case_management: 'active',
      multilingual_support: 'active'
    },
    supported_jurisdictions: ['UAE', 'Oman', 'KSA', 'GCC'],
    languages: ['English', 'Arabic'],
    timestamp: new Date().toISOString()
  })
})

apiRoutes.get('/jurisdictions', (c) => {
  return c.json({
    jurisdictions: [
      { code: 'uae', name: 'United Arab Emirates', name_ar: 'دولة الإمارات العربية المتحدة', legal_system: 'Civil Law with Islamic Law influences' },
      { code: 'oman', name: 'Sultanate of Oman', name_ar: 'سلطنة عُمان', legal_system: 'Mixed Civil and Islamic Law' },
      { code: 'ksa', name: 'Kingdom of Saudi Arabia', name_ar: 'المملكة العربية السعودية', legal_system: 'Islamic Law (Sharia)' },
      { code: 'gcc', name: 'Gulf Cooperation Council', name_ar: 'مجلس التعاون الخليجي', legal_system: 'Harmonized GCC Laws' }
    ]
  })
})

apiRoutes.get('/practice-areas', (c) => {
  return c.json({
    practice_areas: [
      { id: 'commercial', name: 'Commercial Law', name_ar: 'القانون التجاري' },
      { id: 'litigation', name: 'Litigation & Dispute Resolution', name_ar: 'التقاضي وحل النزاعات' },
      { id: 'islamic_finance', name: 'Islamic Finance & Banking', name_ar: 'التمويل والمصرفية الإسلامية' },
      { id: 'family', name: 'Family Law', name_ar: 'قانون الأسرة' },
      { id: 'real_estate', name: 'Real Estate Law', name_ar: 'قانون العقارات' },
      { id: 'labor', name: 'Labor & Employment', name_ar: 'قانون العمل والتوظيف' }
    ]
  })
})

apiRoutes.get('/templates', (c) => {
  return c.json({
    templates: [
      { id: 'commercial_contract', name: 'Commercial Contract', type: 'contract', jurisdiction: 'uae' },
      { id: 'employment_contract', name: 'Employment Contract', type: 'contract', jurisdiction: 'gcc' },
      { id: 'power_of_attorney', name: 'Power of Attorney', type: 'legal_document', jurisdiction: 'multi' },
      { id: 'company_formation', name: 'Company Formation Documents', type: 'corporate', jurisdiction: 'uae' }
    ]
  })
})

apiRoutes.get('/ai/models', (c) => {
  return c.json({
    models: [
      { id: 'lexmind_legal_reasoning', name: 'LexMind Legal Reasoning Engine', capabilities: ['legal_research', 'case_analysis'] },
      { id: 'document_genesis', name: 'Document Genesis AI', capabilities: ['contract_drafting', 'legal_memo_writing'] },
      { id: 'compliance_checker', name: 'RegTech Compliance Engine', capabilities: ['regulatory_compliance', 'risk_assessment'] }
    ]
  })
})

export default apiRoutes
