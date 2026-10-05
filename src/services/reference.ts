// region: 'gcc' members share GCC-wide instruments (retrieved alongside local law); 'mena' are the wider Arab jurisdictions.
export const JURISDICTIONS = [
  { code: 'oman', name: 'Sultanate of Oman', name_ar: 'سلطنة عُمان', currency: 'OMR', region: 'gcc' },
  { code: 'uae', name: 'United Arab Emirates', name_ar: 'الإمارات العربية المتحدة', currency: 'AED', region: 'gcc' },
  { code: 'ksa', name: 'Kingdom of Saudi Arabia', name_ar: 'المملكة العربية السعودية', currency: 'SAR', region: 'gcc' },
  { code: 'qatar', name: 'State of Qatar', name_ar: 'دولة قطر', currency: 'QAR', region: 'gcc' },
  { code: 'kuwait', name: 'State of Kuwait', name_ar: 'دولة الكويت', currency: 'KWD', region: 'gcc' },
  { code: 'bahrain', name: 'Kingdom of Bahrain', name_ar: 'مملكة البحرين', currency: 'BHD', region: 'gcc' },
  { code: 'difc', name: 'DIFC (Dubai International Financial Centre)', name_ar: 'مركز دبي المالي العالمي', currency: 'USD', region: 'gcc' },
  { code: 'adgm', name: 'ADGM (Abu Dhabi Global Market)', name_ar: 'سوق أبوظبي العالمي', currency: 'USD', region: 'gcc' },
  { code: 'gcc', name: 'GCC (multi-jurisdiction)', name_ar: 'دول مجلس التعاون الخليجي', currency: 'USD', region: 'gcc' },
  { code: 'egypt', name: 'Arab Republic of Egypt', name_ar: 'جمهورية مصر العربية', currency: 'EGP', region: 'mena' },
  { code: 'jordan', name: 'Hashemite Kingdom of Jordan', name_ar: 'المملكة الأردنية الهاشمية', currency: 'JOD', region: 'mena' },
  { code: 'lebanon', name: 'Lebanese Republic', name_ar: 'الجمهورية اللبنانية', currency: 'USD', region: 'mena' },
  { code: 'iraq', name: 'Republic of Iraq', name_ar: 'جمهورية العراق', currency: 'IQD', region: 'mena' },
  { code: 'morocco', name: 'Kingdom of Morocco', name_ar: 'المملكة المغربية', currency: 'MAD', region: 'mena' },
  { code: 'tunisia', name: 'Republic of Tunisia', name_ar: 'الجمهورية التونسية', currency: 'TND', region: 'mena' },
  { code: 'algeria', name: 'People\'s Democratic Republic of Algeria', name_ar: 'الجمهورية الجزائرية الديمقراطية الشعبية', currency: 'DZD', region: 'mena' },
  { code: 'libya', name: 'State of Libya', name_ar: 'دولة ليبيا', currency: 'LYD', region: 'mena' },
  { code: 'international', name: 'International', name_ar: 'دولي', currency: 'USD', region: 'international' }
] as const

export const JURISDICTION_CODES = JURISDICTIONS.map((j) => j.code) as unknown as [string, ...string[]]

export const jurisdictionName = (code?: string | null) =>
  JURISDICTIONS.find((j) => j.code === code)?.name ?? 'GCC (multi-jurisdiction)'

export const CURRENCIES = ['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'EGP', 'JOD', 'LBP', 'IQD', 'MAD', 'TND', 'DZD', 'LYD', 'USD', 'EUR', 'GBP'] as const

// Jurisdictions whose search also draws on GCC-wide instruments.
export const isGcc = (code?: string | null) => JURISDICTIONS.some((j) => j.code === code && j.region === 'gcc')

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

// Starter checklists per practice area. Applying one creates tasks on a case; firms can edit them after.
export const CHECKLISTS: Record<string, { en: string; ar: string }[]> = {
  litigation: [
    { en: 'Conflict check and engagement letter signed', ar: 'فحص تعارض المصالح وتوقيع خطاب التكليف' },
    { en: 'Obtain power of attorney', ar: 'الحصول على الوكالة القانونية' },
    { en: 'Collect and review evidence and correspondence', ar: 'جمع ومراجعة الأدلة والمراسلات' },
    { en: 'Assess limitation periods and jurisdiction', ar: 'تقييم مدد التقادم والاختصاص' },
    { en: 'Draft and file statement of claim / defence', ar: 'صياغة وإيداع صحيفة الدعوى / مذكرة الدفاع' },
    { en: 'Calendar all hearing dates and filing deadlines', ar: 'قيد جميع مواعيد الجلسات ومهل الإيداع في التقويم' },
    { en: 'Prepare witness statements and expert reports', ar: 'إعداد إفادات الشهود وتقارير الخبراء' },
    { en: 'Report judgment to client and assess appeal deadline', ar: 'إبلاغ الموكل بالحكم وتقييم مهلة الاستئناف' }
  ],
  arbitration: [
    { en: 'Review arbitration clause and applicable rules', ar: 'مراجعة شرط التحكيم والقواعد المطبقة' },
    { en: 'Serve notice of arbitration', ar: 'إرسال إخطار التحكيم' },
    { en: 'Nominate arbitrator', ar: 'تعيين المحكم' },
    { en: 'Prepare statement of claim and evidence bundle', ar: 'إعداد بيان الدعوى وملف الأدلة' },
    { en: 'Procedural timetable entered in calendar', ar: 'قيد الجدول الإجرائي في التقويم' },
    { en: 'Enforcement strategy for the award', ar: 'استراتيجية تنفيذ حكم التحكيم' }
  ],
  employment: [
    { en: 'Obtain employment contract, payslips and termination letter', ar: 'الحصول على عقد العمل وكشوف الرواتب وخطاب الإنهاء' },
    { en: 'Calculate end-of-service gratuity and entitlements', ar: 'احتساب مكافأة نهاية الخدمة والمستحقات' },
    { en: 'File complaint with the labour authority within the deadline', ar: 'تقديم الشكوى لدى جهة العمل المختصة ضمن المهلة' },
    { en: 'Attend amicable settlement session', ar: 'حضور جلسة التسوية الودية' },
    { en: 'Refer to labour court if unresolved', ar: 'الإحالة إلى المحكمة العمالية في حال عدم التسوية' }
  ],
  corporate: [
    { en: 'KYC on shareholders and directors', ar: 'التحقق من هوية الشركاء والمديرين' },
    { en: 'Reserve trade name', ar: 'حجز الاسم التجاري' },
    { en: 'Draft memorandum and articles of association', ar: 'صياغة عقد التأسيس والنظام الأساسي' },
    { en: 'Commercial registration filing', ar: 'تقديم طلب السجل التجاري' },
    { en: 'Open bank account and deposit capital', ar: 'فتح الحساب البنكي وإيداع رأس المال' },
    { en: 'Post-registration licences and registrations', ar: 'التراخيص والتسجيلات اللاحقة للتأسيس' }
  ],
  real_estate: [
    { en: 'Title deed and encumbrance search', ar: 'التحقق من سند الملكية والرهونات' },
    { en: 'Review sale or lease agreement', ar: 'مراجعة عقد البيع أو الإيجار' },
    { en: 'Confirm approvals and permits', ar: 'التأكد من الموافقات والتصاريح' },
    { en: 'Register transfer or lease with the authority', ar: 'تسجيل نقل الملكية أو الإيجار لدى الجهة المختصة' }
  ],
  commercial: [
    { en: 'Engagement letter and conflict check', ar: 'خطاب التكليف وفحص التعارض' },
    { en: 'Gather commercial terms and draft agreement', ar: 'جمع الشروط التجارية وصياغة الاتفاقية' },
    { en: 'Run AI risk review on draft', ar: 'إجراء مراجعة المخاطر بالذكاء الاصطناعي للمسودة' },
    { en: 'Negotiate and finalise', ar: 'التفاوض والإنهاء' },
    { en: 'Arrange signing and archive executed copy', ar: 'ترتيب التوقيع وأرشفة النسخة الموقعة' }
  ],
  family: [
    { en: 'Initial consultation notes and documents', ar: 'ملاحظات الاستشارة الأولية والمستندات' },
    { en: 'File claim with personal status court', ar: 'قيد الدعوى لدى محكمة الأحوال الشخصية' },
    { en: 'Reconciliation session', ar: 'جلسة الصلح' },
    { en: 'Hearings and judgment follow-up', ar: 'متابعة الجلسات والحكم' }
  ]
}
