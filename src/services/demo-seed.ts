// ---------------------------------------------------------------------------
// The invented firm a demo session opens: "Sample Law Firm (Demo)". Everything here is made up:
// company names are well-known fictional ones (Northwind, Contoso, Fabrikam, Tailspin), people are
// invented, emails use the reserved example.com domain and phone numbers are placeholders. It is
// written through the app's own API, so the sample data passes the same checks as a real firm's.
// ---------------------------------------------------------------------------

export const DEMO_FIRM = { en: 'Sample Law Firm (Demo)', ar: 'مكتب المحاماة النموذجي (تجريبي)' }

export type SeedCall = (method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown) => Promise<any>

const day = (offset: number, hour = 9) => {
  const d = new Date(Date.now() + offset * 86400_000)
  d.setUTCHours(hour - 4, 0, 0, 0) // Muscat time
  return d.toISOString()
}
const date = (offset: number) => day(offset).slice(0, 10)

const CLIENTS = [
  { key: 'northwind', kind: 'company', name: 'Northwind Trading LLC', name_ar: 'شركة نورثويند للتجارة ش.م.م', email: 'legal@northwind.example.com', phone: '+968 2400 0101', language: 'en' },
  { key: 'contoso', kind: 'company', name: 'Contoso Construction Co.', name_ar: 'شركة كونتوسو للإنشاءات', email: 'contracts@contoso.example.com', phone: '+968 2400 0102', language: 'ar' },
  { key: 'fabrikam', kind: 'company', name: 'Fabrikam Logistics SAOC', name_ar: 'فابريكام للخدمات اللوجستية ش.م.ع.م', email: 'office@fabrikam.example.com', phone: '+971 4 000 0103', language: 'en' },
  { key: 'tailspin', kind: 'company', name: 'Tailspin Holdings', name_ar: 'تيلسبن القابضة', email: 'board@tailspin.example.com', phone: '+966 11 000 0104', language: 'ar' },
  { key: 'mariam', kind: 'individual', name: 'Mariam Sample', name_ar: 'مريم سامبل', email: 'mariam.sample@example.com', phone: '+968 9000 0105', language: 'ar' },
  { key: 'yousef', kind: 'individual', name: 'Yousef Example', name_ar: 'يوسف إكزامبل', email: 'yousef.example@example.com', phone: '+968 9000 0106', language: 'en' }
] as const

const CASES = [
  { key: 'supply', client: 'northwind', title: 'Northwind supply contract dispute', title_ar: 'نزاع عقد التوريد لشركة نورثويند', jurisdiction: 'oman', practice_area: 'commercial', status: 'active', priority: 'high', court: 'Primary Court, Muscat', opposing_party: 'Adventure Works Supplies LLC', description: 'Claim for late delivery penalties under a 2025 supply agreement. Client seeks OMR 48,000 in liquidated damages.' },
  { key: 'tower', client: 'contoso', title: 'Contoso tower project: delay claim', title_ar: 'مشروع برج كونتوسو: مطالبة التأخير', jurisdiction: 'oman', practice_area: 'real_estate', status: 'active', priority: 'urgent', court: 'Commercial Court, Muscat', opposing_party: 'Litware Developments SAOC', description: 'Extension of time and prolongation costs under a FIDIC based construction contract.' },
  { key: 'warehouse', client: 'fabrikam', title: 'Fabrikam Dubai warehouse lease', title_ar: 'عقد إيجار مستودع فابريكام في دبي', jurisdiction: 'uae', practice_area: 'real_estate', status: 'under_review', priority: 'medium', description: 'Review and negotiation of a five year warehouse lease in Jebel Ali.' },
  { key: 'jv', client: 'tailspin', title: 'Tailspin Riyadh joint venture', title_ar: 'مشروع تيلسبن المشترك في الرياض', jurisdiction: 'ksa', practice_area: 'corporate', status: 'active', priority: 'high', description: 'Shareholders agreement and company formation for a 60/40 joint venture.' },
  { key: 'employment', client: 'mariam', title: 'Sample v. Tailwind Services: wrongful termination', title_ar: 'سامبل ضد تيلويند للخدمات: فصل تعسفي', jurisdiction: 'oman', practice_area: 'employment', status: 'active', priority: 'medium', court: 'Labour Court, Muscat', opposing_party: 'Tailwind Services LLC', description: 'End of service gratuity and compensation for unfair dismissal under the Labour Law.' },
  { key: 'inheritance', client: 'yousef', title: 'Example family estate distribution', title_ar: 'توزيع تركة عائلة إكزامبل', jurisdiction: 'oman', practice_area: 'family', status: 'pending', priority: 'low', description: 'Distribution of an estate between five heirs, including a residential property in Seeb.' }
] as const

const NDA_EN = `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is made between Northwind Trading LLC ("Northwind") and Fabrikam Logistics SAOC ("Fabrikam").

1. Purpose. The parties wish to discuss a possible logistics partnership and will exchange Confidential Information for that purpose only.

2. Confidential Information means any business, technical or financial information disclosed by one party to the other, marked or reasonably understood as confidential.

3. Obligations. The receiving party shall keep Confidential Information secret, use it only for the Purpose, and disclose it only to employees and advisers who need to know it and are bound by duties of confidentiality.

4. Term. The obligations in this Agreement last for three (3) years from the date of the last disclosure.

5. Return of information. On request, each party shall return or destroy the other party's Confidential Information within fourteen (14) days.

6. Governing law. This Agreement is governed by the laws of the Sultanate of Oman, and the courts of Muscat have exclusive jurisdiction.

Signed for Northwind Trading LLC: ____________
Signed for Fabrikam Logistics SAOC: ____________`

const LEASE_AR = `عقد إيجار مستودع

أبرم هذا العقد بين:
الطرف الأول (المؤجر): شركة ليتوير للتطوير ش.م.ع.م.
الطرف الثاني (المستأجر): فابريكام للخدمات اللوجستية ش.م.ع.م.

البند الأول: العين المؤجرة
مستودع بمساحة ٤٬٥٠٠ متر مربع في المنطقة الحرة بجبل علي، إمارة دبي.

البند الثاني: مدة الإيجار
خمس سنوات تبدأ من الأول من يناير ٢٠٢٧، قابلة للتجديد باتفاق الطرفين كتابة.

البند الثالث: الأجرة
أجرة سنوية قدرها ٩٠٠٬٠٠٠ درهم إماراتي، تدفع على أربعة أقساط ربع سنوية مقدما، وتزاد بنسبة ٣٪ سنويا اعتبارا من السنة الثالثة.

البند الرابع: التأمين
يدفع المستأجر تأمينا قدره ٩٠٬٠٠٠ درهم يرد عند انتهاء العقد بعد خصم أي مستحقات.

البند الخامس: الصيانة
يتحمل المؤجر الصيانة الإنشائية، ويتحمل المستأجر الصيانة الدورية والتشغيلية.

البند السادس: القانون الواجب التطبيق
يخضع هذا العقد لقوانين إمارة دبي والقوانين الاتحادية لدولة الإمارات العربية المتحدة، وتختص محاكم دبي بالنظر في أي نزاع ينشأ عنه.`

const EMPLOYMENT_MEMO = `LEGAL MEMORANDUM

To: Case team
Re: Sample v. Tailwind Services LLC (wrongful termination)

1. Facts. The client, Ms. Mariam Sample, worked as a senior accountant for six years. Her employment was ended by email on 2 March without notice or a stated reason.

2. Issues. (a) Whether the termination was lawful. (b) What end of service benefits and compensation are due.

3. Analysis. The employer gave no written reason and no notice. Unless the employer can show a ground for dismissal without notice, the client should be entitled to notice pay, accrued leave and end of service benefits, and may claim compensation for unfair dismissal.

4. Next steps. File a complaint with the Ministry of Labour within the prescribed period, collect the employment contract, payslips and the termination email, and prepare a schedule of amounts claimed.`

const POA_AR = `وكالة خاصة

أنا الموقع أدناه يوسف إكزامبل، أوكل مكتب المحاماة النموذجي في تمثيلي أمام الجهات المختصة في جميع الإجراءات المتعلقة بقسمة تركة المرحوم والدي، بما في ذلك:
١. حصر الإرث واستخراج الإعلام الشرعي.
٢. مراجعة الدوائر العقارية بشأن العقار السكني الكائن في ولاية السيب.
٣. التوقيع على محاضر القسمة الرضائية نيابة عني.

وتسري هذه الوكالة لمدة سنة واحدة من تاريخ توقيعها.`

const SHA_EN = `SHAREHOLDERS AGREEMENT (DRAFT)

Parties: Tailspin Holdings (60%) and Wingtip Investments (40%), together the "Shareholders".

1. Company. The Shareholders will form a limited liability company in Riyadh to provide facilities management services.

2. Capital. The share capital is SAR 5,000,000, paid in proportion to shareholding within 30 days of registration.

3. Board. The board has five members: three appointed by Tailspin and two by Wingtip. The chair is appointed by Tailspin.

4. Reserved matters. The following require the approval of both Shareholders: changes to the articles, new shares, borrowing above SAR 1,000,000, and the sale of substantially all assets.

5. Transfers. Each Shareholder has a right of first refusal over the other's shares. A Shareholder may not transfer shares for three years without consent.

6. Deadlock. A deadlock on a reserved matter is referred to the chief executives, then to mediation, then to arbitration at the Saudi Center for Commercial Arbitration.

7. Governing law. This Agreement is governed by the laws of the Kingdom of Saudi Arabia.`

const NOTICE_AR = `إنذار قانوني

إلى: شركة أدفنتشر ووركس للتوريدات ش.م.م.

بالإشارة إلى عقد التوريد المبرم بينكم وبين موكلتنا شركة نورثويند للتجارة ش.م.م.، فقد تأخرتم في تسليم الدفعة الثالثة من البضائع لمدة تجاوزت خمسة وأربعين يوما عن الموعد المتفق عليه.

وعليه، ننذركم بضرورة تسليم البضائع المتأخرة وسداد غرامة التأخير المنصوص عليها في البند السابع من العقد، وقدرها ٤٨٬٠٠٠ ريال عماني، خلال خمسة عشر يوما من تاريخ استلامكم هذا الإنذار، وإلا ستضطر موكلتنا إلى اتخاذ الإجراءات القانونية اللازمة دون إنذار آخر.`

const DOCUMENTS = [
  { title: 'Mutual NDA: Northwind and Fabrikam', doc_type: 'nda', language: 'en', status: 'final', case: 'supply', content: NDA_EN },
  { title: 'عقد إيجار مستودع جبل علي', doc_type: 'lease', language: 'ar', status: 'review', case: 'warehouse', content: LEASE_AR },
  { title: 'Memo: wrongful termination claim', doc_type: 'legal_memo', language: 'en', status: 'draft', case: 'employment', content: EMPLOYMENT_MEMO },
  { title: 'وكالة خاصة: قسمة التركة', doc_type: 'poa', language: 'ar', status: 'final', case: 'inheritance', content: POA_AR },
  { title: 'Shareholders agreement (draft)', doc_type: 'shareholders', language: 'en', status: 'draft', case: 'jv', content: SHA_EN },
  { title: 'إنذار قانوني: تأخير التوريد', doc_type: 'legal_notice', language: 'ar', status: 'review', case: 'supply', content: NOTICE_AR }
] as const

const CLAUSES = [
  { title: 'Governing law (Oman)', category: 'general', body_en: 'This Agreement is governed by the laws of the Sultanate of Oman, and the courts of Muscat have exclusive jurisdiction over any dispute arising from it.', body_ar: 'تخضع هذه الاتفاقية لقوانين سلطنة عمان، وتختص محاكم مسقط دون غيرها بالنظر في أي نزاع ينشأ عنها.' },
  { title: 'Confidentiality', category: 'general', body_en: 'Each party shall keep the other party\'s confidential information secret and use it only to perform this Agreement.', body_ar: 'يلتزم كل طرف بالحفاظ على سرية المعلومات السرية للطرف الآخر وعدم استخدامها إلا لتنفيذ هذه الاتفاقية.' },
  { title: 'Force majeure', category: 'general', body_en: 'Neither party is liable for a failure to perform caused by events beyond its reasonable control, provided it notifies the other party promptly.', body_ar: 'لا يكون أي طرف مسؤولا عن الإخلال بالتزاماته بسبب أحداث خارجة عن إرادته المعقولة، بشرط إخطار الطرف الآخر فورا.' },
  { title: 'Arbitration (Oman Commercial Arbitration Centre)', category: 'general', body_en: 'Any dispute shall be finally settled by arbitration under the rules of the Oman Commercial Arbitration Centre by one arbitrator, seated in Muscat, in English.', body_ar: 'تتم تسوية أي نزاع نهائيا بالتحكيم وفق قواعد مركز عمان للتحكيم التجاري أمام محكم واحد، ويكون مقر التحكيم مسقط.' },
  { title: 'Late payment interest', category: 'general', body_en: 'Amounts not paid when due carry interest at 1% per month until paid in full.', body_ar: 'تستحق على المبالغ غير المسددة في موعدها فائدة بنسبة ١٪ شهريا حتى السداد الكامل.' }
]

const GLOSSARY = [
  { term_en: 'Liquidated damages', term_ar: 'التعويض الاتفاقي' },
  { term_en: 'Statement of claim', term_ar: 'صحيفة الدعوى' },
  { term_en: 'Power of attorney', term_ar: 'وكالة' },
  { term_en: 'End of service benefits', term_ar: 'مكافأة نهاية الخدمة' },
  { term_en: 'Right of first refusal', term_ar: 'حق الأولوية في الشراء' },
  { term_en: 'Force majeure', term_ar: 'القوة القاهرة' }
]

// Writes the whole sample firm. `call` performs one request as the demo user and returns its JSON.
export async function seedDemoFirm(call: SeedCall) {
  await call('PUT', '/api/billing/settings', { vat_rate: 5, payment_terms_days: 30, vat_number: 'OM0000000000', bank_details: 'Sample Bank SAOG, account 0000 0000 0000 (demo)', invoice_footer: 'Thank you for your business. This is a demo invoice.', default_hourly_rate: 60 }).catch(() => null)
  const clients: Record<string, string> = {}
  for (const { key, ...c } of CLIENTS) clients[key] = (await call('POST', '/api/clients', c)).client.id
  const cases: Record<string, string> = {}
  for (const { key, client, ...k } of CASES) cases[key] = (await call('POST', '/api/cases', { ...k, client_id: clients[client], opened_on: date(-60) })).case.id

  await call('POST', `/api/cases/${cases.supply}/notes`, { body: 'Client confirmed the third delivery arrived 45 days late. Penalty clause 7 caps damages at 10% of the contract value.' })
  await call('POST', `/api/cases/${cases.tower}/notes`, { body: 'المهندس الاستشاري أصدر تقريرا يؤيد تمديد المدة بثلاثة أشهر بسبب تأخر تسليم الموقع.' })

  for (const { case: k, ...d } of DOCUMENTS) await call('POST', '/api/documents', { ...d, case_id: cases[k] })

  const events = [
    { title: 'Hearing: Northwind v. Adventure Works', kind: 'hearing', starts_at: day(3, 10), location: 'Primary Court, Muscat, Hall 4', case_id: cases.supply },
    { title: 'جلسة: نزاع مشروع برج كونتوسو', kind: 'hearing', starts_at: day(9, 11), location: 'المحكمة التجارية، مسقط', case_id: cases.tower },
    { title: 'Deadline: Ministry of Labour complaint', kind: 'deadline', starts_at: day(5, 12), all_day: true, case_id: cases.employment },
    { title: 'Client meeting: Tailspin board', kind: 'meeting', starts_at: day(1, 14), location: 'Video call', case_id: cases.jv },
    { title: 'Filing: statement of defence (tower)', kind: 'filing', starts_at: day(14, 9), case_id: cases.tower }
  ]
  for (const e of events) await call('POST', '/api/events', e)

  const tasks = [
    { title: 'Prepare schedule of late deliveries', case_id: cases.supply, due_date: date(2), priority: 'high' },
    { title: 'مراجعة بند التأمين في عقد الإيجار', case_id: cases.warehouse, due_date: date(4), priority: 'medium' },
    { title: 'Collect payslips and termination email', case_id: cases.employment, due_date: date(3), priority: 'high' },
    { title: 'Draft reserved matters schedule', case_id: cases.jv, due_date: date(6), priority: 'medium' },
    { title: 'حصر الورثة واستخراج الإعلام الشرعي', case_id: cases.inheritance, due_date: date(10), priority: 'low' }
  ]
  for (const t of tasks) await call('POST', '/api/tasks', t)

  const time = [
    { case_id: cases.supply, minutes: 120, description: 'Review supply agreement and delivery records', work_date: date(-6) },
    { case_id: cases.supply, minutes: 90, description: 'Draft legal notice to supplier', work_date: date(-4) },
    { case_id: cases.tower, minutes: 180, description: 'Analyse delay events against the programme', work_date: date(-3) },
    { case_id: cases.jv, minutes: 150, description: 'Draft shareholders agreement', work_date: date(-2) },
    { case_id: cases.employment, minutes: 60, description: 'Initial consultation with client', work_date: date(-1) }
  ]
  for (const t of time) await call('POST', '/api/billing/time', t)
  await call('POST', '/api/billing/expenses', { case_id: cases.supply, description: 'Court filing fee', amount: 25, incurred_on: date(-5) })

  const paid = await call('POST', '/api/billing/invoices', { client_id: clients.tailspin, case_id: cases.jv, currency: 'OMR', fixed_lines: [{ description: 'Joint venture structuring advice (fixed fee)', quantity: 1, unit_price: 1500 }] })
  await call('POST', `/api/billing/invoices/${paid.invoice.id}/issue`, {})
  const open = await call('POST', '/api/billing/invoices', { client_id: clients.northwind, case_id: cases.supply, currency: 'OMR', fixed_lines: [{ description: 'Pre-action advice and legal notice', quantity: 1, unit_price: 850 }] })
  await call('POST', `/api/billing/invoices/${open.invoice.id}/issue`, {})
  await call('POST', `/api/billing/invoices/${paid.invoice.id}/payments`, { amount: Number(paid.invoice.total ?? 1575), method: 'bank_transfer', note: 'Demo payment' }).catch(() => null)

  for (const cl of CLAUSES) await call('POST', '/api/clauses', cl)
  for (const g of GLOSSARY) await call('POST', '/api/glossary', g)
  return { clients: Object.keys(clients).length, cases: Object.keys(cases).length, documents: DOCUMENTS.length }
}
