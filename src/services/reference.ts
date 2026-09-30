export const JURISDICTIONS = [
  { code: 'oman', name: 'Sultanate of Oman', name_ar: 'سلطنة عُمان', currency: 'OMR' },
  { code: 'uae', name: 'United Arab Emirates', name_ar: 'الإمارات العربية المتحدة', currency: 'AED' },
  { code: 'ksa', name: 'Kingdom of Saudi Arabia', name_ar: 'المملكة العربية السعودية', currency: 'SAR' },
  { code: 'qatar', name: 'State of Qatar', name_ar: 'دولة قطر', currency: 'QAR' },
  { code: 'kuwait', name: 'State of Kuwait', name_ar: 'دولة الكويت', currency: 'KWD' },
  { code: 'bahrain', name: 'Kingdom of Bahrain', name_ar: 'مملكة البحرين', currency: 'BHD' },
  { code: 'difc', name: 'DIFC (Dubai International Financial Centre)', name_ar: 'مركز دبي المالي العالمي', currency: 'USD' },
  { code: 'adgm', name: 'ADGM (Abu Dhabi Global Market)', name_ar: 'سوق أبوظبي العالمي', currency: 'USD' },
  { code: 'gcc', name: 'GCC (multi-jurisdiction)', name_ar: 'دول مجلس التعاون الخليجي', currency: 'USD' },
  { code: 'international', name: 'International', name_ar: 'دولي', currency: 'USD' }
] as const

export const JURISDICTION_CODES = JURISDICTIONS.map((j) => j.code) as unknown as [string, ...string[]]

export const jurisdictionName = (code?: string | null) =>
  JURISDICTIONS.find((j) => j.code === code)?.name ?? 'GCC (multi-jurisdiction)'

export const CURRENCIES = ['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'USD', 'EUR', 'GBP'] as const

export const PRACTICE_AREAS = [
  { id: 'commercial', name: 'Commercial', name_ar: 'تجاري' },
  { id: 'corporate', name: 'Corporate & M&A', name_ar: 'الشركات والاندماج والاستحواذ' },
  { id: 'litigation', name: 'Litigation & Disputes', name_ar: 'التقاضي وتسوية النزاعات' },
  { id: 'arbitration', name: 'Arbitration', name_ar: 'التحكيم' },
  { id: 'employment', name: 'Employment & Labour', name_ar: 'العمل والعمال' },
  { id: 'real_estate', name: 'Real Estate & Construction', name_ar: 'العقارات والإنشاءات' },
  { id: 'banking', name: 'Banking & Islamic Finance', name_ar: 'المصرفية والتمويل الإسلامي' },
  { id: 'family', name: 'Family & Personal Status', name_ar: 'الأحوال الشخصية' },
  { id: 'criminal', name: 'Criminal', name_ar: 'جزائي' },
  { id: 'ip', name: 'Intellectual Property', name_ar: 'الملكية الفكرية' },
  { id: 'regulatory', name: 'Regulatory & Compliance', name_ar: 'التنظيم والامتثال' },
  { id: 'other', name: 'Other', name_ar: 'أخرى' }
] as const

export const PRACTICE_AREA_IDS = PRACTICE_AREAS.map((p) => p.id) as unknown as [string, ...string[]]

// Document types the AI drafter supports. `id` is stored on documents.doc_type.
export const DOCUMENT_TEMPLATES = [
  { id: 'nda', name: 'Non-Disclosure Agreement', name_ar: 'اتفاقية عدم إفصاح' },
  { id: 'service_agreement', name: 'Service Agreement', name_ar: 'اتفاقية تقديم خدمات' },
  { id: 'employment_contract', name: 'Employment Contract', name_ar: 'عقد عمل' },
  { id: 'sale_purchase', name: 'Sale and Purchase Agreement', name_ar: 'اتفاقية بيع وشراء' },
  { id: 'lease', name: 'Lease Agreement', name_ar: 'عقد إيجار' },
  { id: 'shareholders', name: 'Shareholders\' Agreement', name_ar: 'اتفاقية مساهمين' },
  { id: 'mou', name: 'Memorandum of Understanding', name_ar: 'مذكرة تفاهم' },
  { id: 'poa', name: 'Power of Attorney', name_ar: 'وكالة قانونية' },
  { id: 'legal_notice', name: 'Legal Notice / Demand Letter', name_ar: 'إنذار قانوني / خطاب مطالبة' },
  { id: 'settlement', name: 'Settlement Agreement', name_ar: 'اتفاقية تسوية' },
  { id: 'legal_memo', name: 'Legal Memorandum', name_ar: 'مذكرة قانونية' },
  { id: 'statement_of_claim', name: 'Statement of Claim', name_ar: 'صحيفة دعوى' }
] as const

export const DOC_TYPE_IDS = [...DOCUMENT_TEMPLATES.map((t) => t.id), 'contract', 'correspondence', 'evidence', 'court_filing', 'other'] as unknown as [string, ...string[]]

export const templateName = (id: string) => DOCUMENT_TEMPLATES.find((t) => t.id === id)?.name ?? 'legal document'
