// ---------------------------------------------------------------------------
// Standing GCC legal evaluation set. General Arabic leaderboards do not predict legal accuracy,
// so these cases measure what matters for a court filing: citation traps, repealed law,
// confusion between GCC jurisdictions, the law versus its implementing regulation, and the same
// answer in Arabic and English. Every case is asked in both languages.
//
// Expectations name instruments by number and year only (no article wording), so the set can run
// against any library. A case whose expected law is not in the library is reported as a coverage
// gap, not a failure. The instrument numbers below must be confirmed by a lawyer before the set is
// relied on (see docs/legal-review/).
// ---------------------------------------------------------------------------

export type EvalCategory = 'citation_trap' | 'repealed' | 'jurisdiction' | 'law_vs_regulation' | 'parity'
export type LawId = { number: string; year: string; jurisdiction: string; label: string }

export type EvalCase = {
  id: string
  category: EvalCategory
  jurisdiction: string
  // Relevant date for the law (defaults to the run date).
  as_of?: string
  question: { en: string; ar: string }
  // The answer should cite at least one of these (when it is in the library).
  cite_any?: LawId[]
  // Citing any of these is a failure (repealed, wrong country, or wrong instrument).
  must_not_cite?: (LawId & { reason: string })[]
  // An article number that does not exist; stating it with a citation is a failure.
  trap_article?: string
}

const OM_LABOUR_NEW: LawId = { number: '53', year: '2023', jurisdiction: 'oman', label: 'Oman Labour Law, Royal Decree 53/2023' }
const OM_LABOUR_OLD: LawId = { number: '35', year: '2003', jurisdiction: 'oman', label: 'Oman Labour Law, Royal Decree 35/2003 (repealed)' }
const UAE_LABOUR_NEW: LawId = { number: '33', year: '2021', jurisdiction: 'uae', label: 'UAE Labour Relations, Federal Decree-Law 33/2021' }
const UAE_LABOUR_OLD: LawId = { number: '8', year: '1980', jurisdiction: 'uae', label: 'UAE Labour Law, Federal Law 8/1980 (repealed)' }
const OM_PDPL: LawId = { number: '6', year: '2022', jurisdiction: 'oman', label: 'Oman Personal Data Protection Law, Royal Decree 6/2022' }
const OM_PDPL_REG: LawId = { number: '34', year: '2024', jurisdiction: 'oman', label: 'Oman PDPL Executive Regulation, Ministerial Decision 34/2024' }
const UAE_PDPL: LawId = { number: '45', year: '2021', jurisdiction: 'uae', label: 'UAE Personal Data Protection, Federal Decree-Law 45/2021' }
const QA_PDPL: LawId = { number: '13', year: '2016', jurisdiction: 'qatar', label: 'Qatar Personal Data Privacy Protection Law 13/2016' }
const BH_PDPL: LawId = { number: '30', year: '2018', jurisdiction: 'bahrain', label: 'Bahrain Personal Data Protection Law 30/2018' }
const OM_COMPANIES_NEW: LawId = { number: '18', year: '2019', jurisdiction: 'oman', label: 'Oman Commercial Companies Law, Royal Decree 18/2019' }
const OM_COMPANIES_OLD: LawId = { number: '4', year: '1974', jurisdiction: 'oman', label: 'Oman Commercial Companies Law, Royal Decree 4/1974 (repealed)' }
const UAE_COMPANIES_NEW: LawId = { number: '32', year: '2021', jurisdiction: 'uae', label: 'UAE Commercial Companies, Federal Decree-Law 32/2021' }
const UAE_COMPANIES_OLD: LawId = { number: '2', year: '2015', jurisdiction: 'uae', label: 'UAE Commercial Companies, Federal Law 2/2015 (repealed)' }
const OM_PENAL_NEW: LawId = { number: '7', year: '2018', jurisdiction: 'oman', label: 'Oman Penal Code, Royal Decree 7/2018' }
const OM_PENAL_OLD: LawId = { number: '7', year: '1974', jurisdiction: 'oman', label: 'Oman Penal Code, Royal Decree 7/1974 (repealed)' }
const UAE_PENAL_NEW: LawId = { number: '31', year: '2021', jurisdiction: 'uae', label: 'UAE Crimes and Penalties, Federal Decree-Law 31/2021' }

export const GCC_EVAL_CASES: EvalCase[] = [
  // Repealed law: the current law must be cited, not its predecessor.
  {
    id: 'om-labour-current', category: 'repealed', jurisdiction: 'oman',
    question: { en: 'Under the current Omani labour law, what notice must an employer give to terminate an indefinite employment contract?', ar: 'وفقاً لقانون العمل العُماني الساري، ما مدة الإخطار التي يجب على صاحب العمل تقديمها لإنهاء عقد عمل غير محدد المدة؟' },
    cite_any: [OM_LABOUR_NEW], must_not_cite: [{ ...OM_LABOUR_OLD, reason: 'repealed by Royal Decree 53/2023' }]
  },
  {
    id: 'uae-labour-current', category: 'repealed', jurisdiction: 'uae',
    question: { en: 'Under current UAE labour law, how is end of service gratuity calculated for a full-time employee?', ar: 'وفقاً لقانون العمل الإماراتي الساري، كيف تُحسب مكافأة نهاية الخدمة للعامل بدوام كامل؟' },
    cite_any: [UAE_LABOUR_NEW], must_not_cite: [{ ...UAE_LABOUR_OLD, reason: 'replaced by Federal Decree-Law 33/2021' }]
  },
  {
    id: 'om-companies-current', category: 'repealed', jurisdiction: 'oman',
    question: { en: 'What is the minimum number of partners for a limited liability company in Oman?', ar: 'ما الحد الأدنى لعدد الشركاء في الشركة محدودة المسؤولية في سلطنة عُمان؟' },
    cite_any: [OM_COMPANIES_NEW], must_not_cite: [{ ...OM_COMPANIES_OLD, reason: 'repealed by Royal Decree 18/2019' }]
  },
  {
    id: 'uae-companies-current', category: 'repealed', jurisdiction: 'uae',
    question: { en: 'Can a single shareholder own a limited liability company in the UAE?', ar: 'هل يجوز أن يملك شخص واحد شركة ذات مسؤولية محدودة في دولة الإمارات؟' },
    cite_any: [UAE_COMPANIES_NEW], must_not_cite: [{ ...UAE_COMPANIES_OLD, reason: 'replaced by Federal Decree-Law 32/2021' }]
  },
  {
    id: 'om-penal-current', category: 'repealed', jurisdiction: 'oman',
    question: { en: 'What penalty does the Omani Penal Code set for breach of trust?', ar: 'ما العقوبة التي يقررها قانون الجزاء العُماني لجريمة خيانة الأمانة؟' },
    cite_any: [OM_PENAL_NEW], must_not_cite: [{ ...OM_PENAL_OLD, reason: 'repealed by Royal Decree 7/2018' }]
  },
  // Point in time: facts before the change must use the law in force then.
  {
    id: 'om-labour-2019', category: 'repealed', jurisdiction: 'oman', as_of: '2019-06-01',
    question: { en: 'A worker in Oman was dismissed in June 2019. Which labour law governed the dismissal and what did it say about notice?', ar: 'فُصل عامل في سلطنة عُمان في يونيو ٢٠١٩. ما قانون العمل الذي كان يحكم الفصل وماذا نص بشأن الإخطار؟' },
    cite_any: [OM_LABOUR_OLD], must_not_cite: [{ ...OM_LABOUR_NEW, reason: 'not in force in June 2019' }]
  },
  // Jurisdiction confusion between GCC states with similar laws.
  {
    id: 'om-not-uae-labour', category: 'jurisdiction', jurisdiction: 'oman',
    question: { en: 'What are the maximum working hours per week for a private sector worker in Oman?', ar: 'ما الحد الأقصى لساعات العمل الأسبوعية لعامل القطاع الخاص في سلطنة عُمان؟' },
    cite_any: [OM_LABOUR_NEW], must_not_cite: [{ ...UAE_LABOUR_NEW, reason: 'UAE law in an Omani matter' }]
  },
  {
    id: 'uae-not-om-pdpl', category: 'jurisdiction', jurisdiction: 'uae',
    question: { en: 'When must a UAE controller notify a personal data breach?', ar: 'متى يجب على المتحكم في دولة الإمارات الإبلاغ عن خرق البيانات الشخصية؟' },
    cite_any: [UAE_PDPL], must_not_cite: [{ ...OM_PDPL, reason: 'Omani law in a UAE matter' }, { ...QA_PDPL, reason: 'Qatari law in a UAE matter' }]
  },
  {
    id: 'qa-not-bh-pdpl', category: 'jurisdiction', jurisdiction: 'qatar',
    question: { en: 'What rights does a data subject have under Qatari personal data law?', ar: 'ما حقوق صاحب البيانات بموجب قانون حماية البيانات الشخصية القطري؟' },
    cite_any: [QA_PDPL], must_not_cite: [{ ...BH_PDPL, reason: 'Bahraini law in a Qatari matter' }, { ...UAE_PDPL, reason: 'UAE law in a Qatari matter' }]
  },
  {
    id: 'uae-penal-not-om', category: 'jurisdiction', jurisdiction: 'uae',
    question: { en: 'What is the penalty for forgery of an official document in the UAE?', ar: 'ما عقوبة تزوير محرر رسمي في دولة الإمارات؟' },
    cite_any: [UAE_PENAL_NEW], must_not_cite: [{ ...OM_PENAL_NEW, reason: 'Omani law in a UAE matter' }]
  },
  // The law versus its implementing regulation: article numbers must not be swapped.
  {
    id: 'om-pdpl-law-vs-reg', category: 'law_vs_regulation', jurisdiction: 'oman',
    question: { en: 'Under Oman\'s Personal Data Protection Law, what must a controller do before transferring personal data outside Oman? Cite the law and its executive regulation separately.', ar: 'وفقاً لقانون حماية البيانات الشخصية العُماني، ما الذي يجب على المتحكم فعله قبل نقل البيانات الشخصية خارج سلطنة عُمان؟ اذكر القانون ولائحته التنفيذية كلاً على حدة.' },
    cite_any: [OM_PDPL, OM_PDPL_REG]
  },
  {
    id: 'om-pdpl-consent', category: 'law_vs_regulation', jurisdiction: 'oman',
    question: { en: 'What form must consent take under Oman\'s Personal Data Protection Law and its executive regulation?', ar: 'ما الشكل الذي يجب أن تتخذه الموافقة وفقاً لقانون حماية البيانات الشخصية العُماني ولائحته التنفيذية؟' },
    cite_any: [OM_PDPL, OM_PDPL_REG]
  },
  // Citation traps: articles that do not exist and quotes that invite fabrication.
  {
    id: 'om-labour-article-999', category: 'citation_trap', jurisdiction: 'oman', trap_article: '999',
    question: { en: 'Quote Article 999 of the Omani Labour Law (Royal Decree 53/2023) in full.', ar: 'اقتبس نص المادة ٩٩٩ من قانون العمل العُماني الصادر بالمرسوم السلطاني رقم ٥٣/٢٠٢٣ كاملاً.' }
  },
  {
    id: 'uae-pdpl-article-777', category: 'citation_trap', jurisdiction: 'uae', trap_article: '777',
    question: { en: 'What does Article 777 of UAE Federal Decree-Law 45/2021 say about fines?', ar: 'ماذا تنص المادة ٧٧٧ من المرسوم بقانون اتحادي رقم ٤٥ لسنة ٢٠٢١ بشأن الغرامات؟' }
  },
  {
    id: 'om-pdpl-quote', category: 'citation_trap', jurisdiction: 'oman',
    question: { en: 'Give me the exact wording of the article of Oman\'s Personal Data Protection Law that defines "personal data", in quotation marks.', ar: 'أعطني النص الحرفي للمادة التي تعرّف "البيانات الشخصية" في قانون حماية البيانات الشخصية العُماني، بين علامتي تنصيص.' },
    cite_any: [OM_PDPL]
  },
  // Parity: the same question in Arabic and English must rest on the same instruments.
  {
    id: 'om-labour-annual-leave', category: 'parity', jurisdiction: 'oman',
    question: { en: 'How many days of paid annual leave is a worker entitled to in Oman?', ar: 'كم يوماً من الإجازة السنوية مدفوعة الأجر يستحقها العامل في سلطنة عُمان؟' },
    cite_any: [OM_LABOUR_NEW]
  },
  {
    id: 'uae-labour-probation', category: 'parity', jurisdiction: 'uae',
    question: { en: 'What is the maximum probation period under UAE labour law?', ar: 'ما الحد الأقصى لفترة التجربة وفقاً لقانون العمل الإماراتي؟' },
    cite_any: [UAE_LABOUR_NEW]
  },
  {
    id: 'bh-pdpl-sensitive', category: 'parity', jurisdiction: 'bahrain',
    question: { en: 'When may sensitive personal data be processed in Bahrain?', ar: 'متى يجوز معالجة البيانات الشخصية الحساسة في مملكة البحرين؟' },
    cite_any: [BH_PDPL]
  }
]
