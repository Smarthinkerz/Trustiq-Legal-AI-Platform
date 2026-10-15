import { INCLUDED_SEATS, PRICES } from '../public/static/site/firm-pricing.js'
import { PLANS } from './lib/plans'
import { esc, head } from './pages/layout'

type Lang = 'en' | 'ar'

export type { Lang }

const fmt = (n: number | null, lang: Lang, unlimited: string) =>
  n === null ? unlimited : n.toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-US')

const copy = {
  en: {
    title: 'TrustiqLegal – AI-powered legal practice platform for Middle East law firms',
    description: 'Matter management, document drafting and AI contract review for law firms across the GCC and the Middle East, in English and Arabic.',
    chat: {
      title: 'TrustiqLegal assistant', open: 'Questions? Ask us', placeholder: 'Ask about features, pricing or how it works…', send: 'Send', close: 'Close chat',
      greeting: 'Hello! I can explain how TrustiqLegal works, what each feature does and which plan fits your firm. What would you like to know?',
      note: 'Automated assistant about the TrustiqLegal platform. Not legal advice.', error: 'Sorry, something went wrong. Please try again.', typing: 'Typing…', book: 'Start your free trial'
    },
    nav: { features: 'Features', blog: 'Blog', pricing: 'Pricing', security: 'Security', signin: 'Sign in', start: 'Start free trial', other: 'العربية', otherHref: '/ar' },
    hero: {
      eyebrow: 'Built for Middle East legal practice',
      h1: 'Run your law firm in one bilingual, AI-assisted workspace',
      p: 'Manage matters and clients, keep every document versioned, draft agreements in English or Arabic, and get structured AI contract reviews grounded in the jurisdiction you practise in.',
      cta: 'Start your 14-day free trial', cta2: 'See pricing', note: 'No credit card required.'
    },
    heroCard: ['Case reference, status, priority and owner on every matter', 'Documents with version history and branded Word export', 'AI review with risk score, issues and missing clauses', 'Hearings, filings and deadlines with overdue alerts'],
    featuresTitle: 'Everything a modern Middle East practice needs', featuresSub: 'Designed for the way firms in the GCC, Egypt, Jordan, Lebanon, Iraq and North Africa actually work.',
    features: [
      ['fa-folder-open', 'Matters & clients', 'Automatic case references, status and priority, responsible lawyer and a notes timeline, with bilingual client records and ID/CR numbers.'],
      ['fa-file-lines', 'Documents with Arabic OCR', 'Upload PDF and Word files – scanned Arabic papers are read automatically – edit with full version history and export on your letterhead.'],
      ['fa-pen-nib', 'AI drafting', 'Generate first drafts of 12 common instruments – from NDAs and employment contracts to statements of claim – in English or Arabic.'],
      ['fa-magnifying-glass-chart', 'AI contract review', 'Summaries, risk scoring, compliance checks and clause-by-clause reviews, with every issue rated by severity and a recommended fix.'],
      ['fa-book-open', 'Arab law library with citations', 'Search laws, royal decrees and judgments article by article in Arabic or English. The AI answers from your library and cites the exact article.'],
      ['fa-comments', 'Legal research assistant', 'Jurisdiction-aware answers that can draw on a matter\'s facts, with saved conversations and a verification checklist on every answer.'],
      ['fa-file-invoice-dollar', 'Time, billing & VAT invoices', 'Log time and expenses, then issue bilingual tax invoices with the right VAT for Oman, the UAE, KSA and Bahrain, and track what is outstanding.'],
      ['fa-door-open', 'Secure client portal', 'Clients follow their matters, download shared documents and invoices, send files and message their lawyer – without email attachments.'],
      ['fa-list-check', 'Tasks, checklists & templates', 'Litigation, arbitration, employment and corporate checklists, conflict checks, and firm templates that fill in client and case details.'],
      ['fa-calendar-days', 'Calendar, reminders & sync', 'Hearings and deadlines with a daily email digest and a private feed for Outlook, Google and Apple Calendar.'],
      ['fa-chart-line', 'Practice reports', 'Hours by lawyer, billable value, collections and receivables aging, and case intake trends for partners.'],
      ['fa-language', 'Truly bilingual', 'The entire interface works in English and Arabic with right-to-left layout, and documents can be drafted and exported in either language.']
    ],
    securityTitle: 'Security and control by design',
    security: [
      ['fa-user-shield', 'Role-based access', 'Owner, admin, lawyer and staff roles. Only authorised people can delete records or manage your team.'],
      ['fa-clipboard-list', 'Complete audit trail', 'Sign-ins, edits, downloads, exports and AI usage are logged with user, time and IP address.'],
      ['fa-lock', 'Protected accounts', 'Two-step verification with authenticator apps, salted password hashing, secure sessions, brute-force lockout and encrypted connections.'],
      ['fa-file-export', 'Your data stays yours', 'Export your workspace at any time. Your documents are never used to train AI models.']
    ],
    disclaimer: 'TrustiqLegal is a tool for legal professionals and does not provide legal advice. AI output must be reviewed by a qualified lawyer.',
    pricingTitle: 'Simple, transparent pricing', pricingSub: 'Every plan includes the bilingual workspace, all GCC and Arab jurisdictions, version history and the audit log. Prices exclude VAT.',
    perMonth: '/month', custom: 'Custom', unlimited: 'Unlimited', popular: 'Most popular',
    plans: {
      starter: { name: 'Starter', desc: 'For solo practitioners and boutique firms', price: 'OMR 199' },
      starterPlus: { name: 'Starter Plus', desc: 'For firms with 4 to 10 lawyers', price: 'from OMR 234', note: '4 lawyers, OMR 35 per additional lawyer', usd: 'or from USD 609 outside Oman (USD 90 per additional lawyer)' },
      professional: { name: 'Professional', desc: 'For growing law firms', price: 'OMR 649' },
      enterprise: { name: 'Enterprise', desc: 'For large firms and in-house legal teams' }
    },
    usd: (n: number) => `or USD ${n.toLocaleString('en-US')} outside Oman`,
    firm: {
      name: 'Firms', title: 'Have more lawyers on your team?', desc: 'Get an instant price for your whole firm.', price: 'Live quote', cta: 'Get a firm quote',
      lines: ['Up to 25 lawyers, priced instantly', 'Starter Plus or Professional, priced for your team', 'Support staff seats included free', 'Annual billing: pay 10 months, get 12'],
      form: {
        title: 'Price for your firm', intro: 'The price updates as you type. Prices exclude VAT.',
        firm_name: 'Firm name', country: 'Country', contact_name: 'Contact name', email: 'Work email', phone: 'Phone',
        lawyers: 'Number of lawyers', support: 'Support staff (paralegals, secretaries)', cycle: 'Billing', monthly: 'Monthly', annual: 'Annual (pay 10 months, get 12)',
        countries: { OM: 'Oman', AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait', BH: 'Bahrain', EG: 'Egypt', JO: 'Jordan', LB: 'Lebanon', IQ: 'Iraq', MA: 'Morocco', TN: 'Tunisia', GB: 'United Kingdom', US: 'United States', OTHER: 'Other country' },
        plan: { starter: 'Starter', starter_plus: 'Starter Plus', professional: 'Professional' }, recommended: 'Recommended',
        needTitle: 'Do you need any of these? They come with Professional.', features: { advanced_reviews: 'AI risk, compliance and full contract reviews', playbook_review: 'Review against the firm\'s playbook', unlimited_cases: 'Unlimited open cases' },
        limCases: '{n} open cases', limCasesUnlimited: 'Unlimited open cases', limDocs: '{n} new documents a month', proAlso: 'Also includes AI risk, compliance and full reviews, and playbook review.',
        base: 'Plan, {n} lawyers included', extra: '{n} extra lawyers × {price}', ai: '{n} AI requests a month for the firm', supportSeats: '{n} support staff seats, free',
        perMonth: '{price} a month', annualTotal: '{price} a year (12 months for the price of 10)', monthlyTotal: '{price} due monthly',
        vat: 'Prices exclude VAT.', supportNote: 'Support staff can view, upload and organize. They cannot use AI drafting.',
        shared: 'Limits are shared across the firm.',
        enterpriseTitle: 'More than 25 lawyers', enterpriseText: 'We will prepare an Enterprise quote for your firm. Send your details and our team will reply by email.',
        submit: 'Continue', submitEnterprise: 'Request an Enterprise quote', sending: 'Sending…',
        done: 'Thank you. We have your details and will email {email} with your payment link and next steps.', doneEnterprise: 'Thank you. Our team will email {email} with your Enterprise quote.',
        error: 'Something went wrong. Please check the form and try again.', close: 'Close', invalid: 'Enter the number of lawyers.'
      }
    },
    lines: {
      seats: (n: string) => `${n} lawyer seats included`, cases: (n: string) => `${n} open cases`,
      perLawyer: { cases: '5 open cases per lawyer', docs: '15 new documents per lawyer / month', ai: '100 AI requests per lawyer / month' }, docs: (n: string) => `${n} new documents / month`, ai: (n: string) => `${n} AI requests / month`,
      drafting: 'AI drafting, research and summaries', advanced: 'AI risk, compliance and full reviews', support: 'Email support', priority: 'Priority support',
      onboarding: 'Dedicated onboarding and data migration', sla: 'Custom limits and service levels'
    },
    choose: 'Start free trial', contact: 'Contact sales',
    ctaTitle: 'Try TrustiqLegal with your own matters', ctaP: 'Set up your firm in two minutes. Invite your team, upload a contract and see the AI review for yourself.',
    footer: { product: 'Product', legal: 'Legal', contact: 'Contact', terms: 'Terms of Service', privacy: 'Privacy Policy', rights: 'All rights reserved.' }
  },
  ar: {
    title: 'TrustiqLegal – منصة ذكية لإدارة الممارسة القانونية لمكاتب المحاماة في الشرق الأوسط',
    description: 'إدارة القضايا وصياغة المستندات ومراجعة العقود بالذكاء الاصطناعي لمكاتب المحاماة في دول الخليج والشرق الأوسط، بالعربية والإنجليزية.',
    chat: {
      title: 'مساعد TrustiqLegal', open: 'لديك سؤال؟ اسألنا', placeholder: 'اسأل عن المزايا أو الأسعار أو طريقة العمل…', send: 'إرسال', close: 'إغلاق المحادثة',
      greeting: 'مرحبًا! يمكنني أن أشرح لك طريقة عمل TrustiqLegal ومزايا كل قسم والباقة المناسبة لمكتبك. ماذا تود أن تعرف؟',
      note: 'مساعد آلي حول منصة TrustiqLegal. لا يقدّم استشارات قانونية.', error: 'عذرًا، حدث خطأ. يُرجى المحاولة مرة أخرى.', typing: 'يكتب…', book: 'ابدأ تجربتك المجانية'
    },
    nav: { features: 'المزايا', blog: 'المدونة', pricing: 'الأسعار', security: 'الأمان', signin: 'تسجيل الدخول', start: 'ابدأ التجربة المجانية', other: 'English', otherHref: '/' },
    hero: {
      eyebrow: 'مصممة للممارسة القانونية في الشرق الأوسط',
      h1: 'أدِر مكتب المحاماة من مساحة عمل واحدة ثنائية اللغة ومدعومة بالذكاء الاصطناعي',
      p: 'نظّم القضايا والموكلين، واحتفظ بسجل إصدارات لكل مستند، وصُغ الاتفاقيات بالعربية أو الإنجليزية، واحصل على مراجعات منظمة للعقود وفق الولاية القضائية التي تعمل بها.',
      cta: 'ابدأ تجربتك المجانية لمدة ١٤ يوماً', cta2: 'اطّلع على الأسعار', note: 'لا حاجة لبطاقة ائتمان.'
    },
    heroCard: ['رقم مرجعي وحالة وأولوية ومسؤول لكل قضية', 'مستندات بسجل إصدارات وتصدير Word بترويسة المكتب', 'مراجعة ذكية بدرجة مخاطر وملاحظات وبنود ناقصة', 'جلسات ومواعيد إيداع ومهل مع تنبيهات بالتأخير'],
    featuresTitle: 'كل ما يحتاجه مكتب محاماة حديث في الشرق الأوسط', featuresSub: 'مصممة وفق طريقة عمل المكاتب في دول الخليج ومصر والأردن ولبنان والعراق وشمال أفريقيا.',
    features: [
      ['fa-folder-open', 'القضايا والموكلون', 'أرقام مرجعية تلقائية، ومتابعة الحالة والأولوية، والمحامي المسؤول وسجل الملاحظات، مع سجلات موكلين ثنائية اللغة وأرقام الهوية أو السجل التجاري.'],
      ['fa-file-lines', 'مستندات مع قراءة العربية الممسوحة', 'ارفع ملفات PDF وWord – وتُقرأ الأوراق العربية الممسوحة تلقائيًا – وعدّلها مع سجل إصدارات كامل وصدّرها بترويسة مكتبك.'],
      ['fa-pen-nib', 'الصياغة الذكية', 'أنشئ مسودات أولية لـ ١٢ نوعاً من المستندات الشائعة – من اتفاقيات عدم الإفصاح وعقود العمل إلى صحف الدعوى – بالعربية أو الإنجليزية.'],
      ['fa-magnifying-glass-chart', 'مراجعة العقود بالذكاء الاصطناعي', 'ملخصات، وتقييم مخاطر، وفحص امتثال، ومراجعة بنداً ببند، مع تصنيف كل ملاحظة حسب خطورتها وتوصية بالمعالجة.'],
      ['fa-book-open', 'مكتبة قوانين عربية مع الإسناد', 'ابحث في القوانين والمراسيم والأحكام مادةً بمادة بالعربية أو الإنجليزية، ويجيب المساعد الذكي من مكتبتك مستشهدًا بالمادة بعينها.'],
      ['fa-comments', 'مساعد البحث القانوني', 'إجابات مرتبطة بالولاية القضائية يمكنها الاستناد إلى وقائع القضية، مع حفظ المحادثات وقائمة تحقق في نهاية كل إجابة.'],
      ['fa-file-invoice-dollar', 'الوقت والفواتير الضريبية', 'سجّل الوقت والمصروفات وأصدر فواتير ضريبية ثنائية اللغة بنسبة الضريبة الصحيحة لعُمان والإمارات والسعودية والبحرين، وتابع المستحقات.'],
      ['fa-door-open', 'بوابة موكلين آمنة', 'يتابع الموكلون قضاياهم وينزّلون المستندات والفواتير ويرسلون الملفات ويراسلون محاميهم دون مرفقات البريد.'],
      ['fa-list-check', 'مهام وقوائم خطوات ونماذج', 'قوائم خطوات للتقاضي والتحكيم والعمل والشركات، وفحص تعارض المصالح، ونماذج مكتبك تُملأ ببيانات الموكل والقضية.'],
      ['fa-calendar-days', 'التقويم والتذكيرات والمزامنة', 'جلسات ومواعيد مع ملخص يومي بالبريد ورابط خاص للمزامنة مع Outlook وGoogle وApple.'],
      ['fa-chart-line', 'تقارير الأداء', 'الساعات حسب المحامي والقيمة القابلة للفوترة والتحصيل وأعمار الذمم واتجاهات القضايا للشركاء.'],
      ['fa-language', 'ثنائية اللغة بالكامل', 'الواجهة كاملة بالعربية والإنجليزية مع دعم الاتجاه من اليمين إلى اليسار، وصياغة المستندات وتصديرها بأي من اللغتين.']
    ],
    securityTitle: 'الأمان والتحكم في صميم التصميم',
    security: [
      ['fa-user-shield', 'صلاحيات حسب الدور', 'أدوار المالك والمسؤول والمحامي والموظف. لا يستطيع حذف السجلات أو إدارة الفريق إلا المخوّلون.'],
      ['fa-clipboard-list', 'سجل تدقيق كامل', 'تسجيل عمليات الدخول والتعديل والتنزيل والتصدير واستخدام الذكاء الاصطناعي مع المستخدم والوقت وعنوان IP.'],
      ['fa-lock', 'حسابات محمية', 'التحقق بخطوتين عبر تطبيقات المصادقة، وتشفير كلمات المرور، وجلسات آمنة، وقفل الحساب عند محاولات الاختراق، واتصالات مشفرة.'],
      ['fa-file-export', 'بياناتك ملكك', 'صدّر بيانات مساحة العمل في أي وقت. لا تُستخدم مستنداتك أبداً لتدريب نماذج الذكاء الاصطناعي.']
    ],
    disclaimer: 'TrustiqLegal أداة للمهنيين القانونيين ولا تقدم استشارات قانونية. يجب أن يراجع محامٍ مؤهل مخرجات الذكاء الاصطناعي.',
    pricingTitle: 'أسعار واضحة وبسيطة', pricingSub: 'تشمل جميع الباقات مساحة العمل ثنائية اللغة وجميع الولايات القضائية الخليجية والعربية وسجل الإصدارات وسجل التدقيق. الأسعار لا تشمل ضريبة القيمة المضافة.',
    perMonth: '/شهرياً', custom: 'حسب الطلب', unlimited: 'غير محدود', popular: 'الأكثر طلباً',
    plans: {
      starter: { name: 'الأساسية', desc: 'للمحامين المستقلين والمكاتب الصغيرة', price: '١٩٩ ر.ع.' },
      starterPlus: { name: 'الأساسية بلس', desc: 'للمكاتب التي تضم من ٤ إلى ١٠ محامين', price: 'من ٢٣٤ ر.ع.', note: '٤ محامين، و٣٥ ر.ع. لكل محامٍ إضافي', usd: 'أو من ٦٠٩ دولارات أمريكية خارج عُمان (٩٠ دولاراً لكل محامٍ إضافي)' },
      professional: { name: 'الاحترافية', desc: 'لمكاتب المحاماة المتنامية', price: '٦٤٩ ر.ع.' },
      enterprise: { name: 'المؤسسات', desc: 'للمكاتب الكبيرة والإدارات القانونية' }
    },
    usd: (n: number) => `أو ${n.toLocaleString('en-US')} دولار أمريكي خارج عُمان`,
    firm: {
      name: 'المكاتب', title: 'هل في فريقك محامون أكثر؟', desc: 'احصل على سعر فوري لمكتبك بالكامل.', price: 'عرض سعر فوري', cta: 'احسب سعر مكتبك',
      lines: ['حتى ٢٥ محامياً بسعر فوري', 'الأساسية بلس أو الاحترافية بسعر يناسب فريقك', 'مقاعد الموظفين المساندين مجانية', 'الاشتراك السنوي: ادفع ١٠ أشهر واحصل على ١٢'],
      form: {
        title: 'سعر مكتبك', intro: 'يتحدث السعر مع كل تغيير. الأسعار لا تشمل ضريبة القيمة المضافة.',
        firm_name: 'اسم المكتب', country: 'الدولة', contact_name: 'اسم جهة الاتصال', email: 'البريد الإلكتروني للعمل', phone: 'الهاتف',
        lawyers: 'عدد المحامين', support: 'الموظفون المساندون (مساعدون قانونيون وسكرتارية)', cycle: 'الفوترة', monthly: 'شهرياً', annual: 'سنوياً (ادفع ١٠ أشهر واحصل على ١٢)',
        countries: { OM: 'عُمان', AE: 'الإمارات العربية المتحدة', SA: 'السعودية', QA: 'قطر', KW: 'الكويت', BH: 'البحرين', EG: 'مصر', JO: 'الأردن', LB: 'لبنان', IQ: 'العراق', MA: 'المغرب', TN: 'تونس', GB: 'المملكة المتحدة', US: 'الولايات المتحدة', OTHER: 'دولة أخرى' },
        plan: { starter: 'الأساسية', starter_plus: 'الأساسية بلس', professional: 'الاحترافية' }, recommended: 'الموصى بها',
        needTitle: 'هل تحتاج إلى أي من هذه؟ متوفرة في الباقة الاحترافية.', features: { advanced_reviews: 'مراجعات المخاطر والامتثال والمراجعة الشاملة للعقود بالذكاء الاصطناعي', playbook_review: 'المراجعة وفق دليل التفاوض الخاص بالمكتب', unlimited_cases: 'قضايا مفتوحة غير محدودة' },
        limCases: '{n} قضية مفتوحة', limCasesUnlimited: 'قضايا مفتوحة غير محدودة', limDocs: '{n} مستند جديد شهرياً', proAlso: 'تشمل أيضاً مراجعات المخاطر والامتثال والمراجعة الشاملة، والمراجعة وفق دليل التفاوض.',
        base: 'الباقة، تشمل {n} محامين', extra: '{n} محامين إضافيين × {price}', ai: '{n} طلب ذكاء اصطناعي شهرياً للمكتب', supportSeats: '{n} مقاعد للموظفين المساندين، مجاناً',
        perMonth: '{price} شهرياً', annualTotal: '{price} سنوياً (١٢ شهراً بسعر ١٠)', monthlyTotal: '{price} تُدفع شهرياً',
        vat: 'الأسعار لا تشمل ضريبة القيمة المضافة.', supportNote: 'يستطيع الموظفون المساندون العرض والرفع والتنظيم، دون صياغة بالذكاء الاصطناعي.',
        shared: 'الحدود مشتركة لجميع أعضاء المكتب.',
        enterpriseTitle: 'أكثر من ٢٥ محامياً', enterpriseText: 'سنعدّ لمكتبك عرض سعر لباقة المؤسسات. أرسل بياناتك وسيرد فريقنا بالبريد الإلكتروني.',
        submit: 'متابعة', submitEnterprise: 'اطلب عرض سعر المؤسسات', sending: 'جارٍ الإرسال…',
        done: 'شكراً لك. وصلتنا بياناتك وسنرسل إلى {email} رابط الدفع والخطوات التالية.', doneEnterprise: 'شكراً لك. سيرسل فريقنا عرض سعر المؤسسات إلى {email}.',
        error: 'حدث خطأ. يرجى مراجعة النموذج والمحاولة مرة أخرى.', close: 'إغلاق', invalid: 'أدخل عدد المحامين.'
      }
    },
    lines: {
      seats: (n: string) => `${n} مقاعد محامين مشمولة`, cases: (n: string) => `${n} قضايا مفتوحة`,
      perLawyer: { cases: '٥ قضايا مفتوحة لكل محامٍ', docs: '١٥ مستنداً جديداً لكل محامٍ شهرياً', ai: '١٠٠ طلب ذكاء اصطناعي لكل محامٍ شهرياً' }, docs: (n: string) => `${n} مستند جديد شهرياً`, ai: (n: string) => `${n} طلب ذكاء اصطناعي شهرياً`,
      drafting: 'صياغة وبحث وملخصات بالذكاء الاصطناعي', advanced: 'مراجعات المخاطر والامتثال والمراجعة الشاملة', support: 'دعم عبر البريد الإلكتروني', priority: 'دعم ذو أولوية',
      onboarding: 'إعداد مخصص ونقل البيانات', sla: 'حدود ومستويات خدمة مخصصة'
    },
    choose: 'ابدأ التجربة المجانية', contact: 'تواصل مع المبيعات',
    ctaTitle: 'جرّب TrustiqLegal على قضاياك الفعلية', ctaP: 'جهّز مكتبك خلال دقيقتين. ادعُ فريقك، وارفع عقداً، وشاهد المراجعة الذكية بنفسك.',
    footer: { product: 'المنتج', legal: 'قانوني', contact: 'تواصل', terms: 'شروط الخدمة', privacy: 'سياسة الخصوصية', rights: 'جميع الحقوق محفوظة.' }
  }
}

// Shared header and footer for the homepage and the TrustiqLegal blog.
// On the homepage section links are in-page anchors; elsewhere they lead back to the homepage.
export function siteNav(lang: Lang, o: { home?: boolean; active?: 'blog'; otherHref?: string } = {}) {
  const t = copy[lang]
  const homeHref = lang === 'ar' ? '/ar' : '/'
  const anchor = (id: string) => (o.home ? `#${id}` : `${homeHref}#${id}`)
  const blogHref = lang === 'ar' ? '/ar/blog' : '/blog'
  const register = `/app#/register${lang === 'ar' ? '?lang=ar' : ''}`
  const login = `/app#/login${lang === 'ar' ? '?lang=ar' : ''}`
  return `<nav class="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
      <a href="${homeHref}" class="flex items-center gap-2 text-brand-900 font-bold text-xl"><i class="fas fa-scale-balanced"></i>TrustiqLegal</a>
      <div class="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
        <a href="${anchor('features')}" class="hover:text-slate-900">${t.nav.features}</a>
        <a href="${anchor('security')}" class="hover:text-slate-900">${t.nav.security}</a>
        <a href="${blogHref}" class="hover:text-slate-900${o.active === 'blog' ? ' text-slate-900 font-semibold' : ''}">${t.nav.blog}</a>
        <a href="${anchor('pricing')}" class="hover:text-slate-900">${t.nav.pricing}</a>
        <a href="${o.otherHref ?? t.nav.otherHref}" class="hover:text-slate-900" lang="${lang === 'ar' ? 'en' : 'ar'}">${t.nav.other}</a>
      </div>
      <div class="flex items-center gap-2">
        <a href="${blogHref}" class="md:hidden text-sm font-medium text-slate-600 hover:text-slate-900 px-2">${t.nav.blog}</a>
        <a href="${login}" class="btn btn-ghost hidden sm:inline-flex">${t.nav.signin}</a>
        <a href="${register}" class="btn btn-primary">${t.nav.start}</a>
      </div>
    </div>
  </nav>`
}

export function siteFooter(lang: Lang, opts: { salesEmail: string; supportEmail: string; home?: boolean }) {
  const t = copy[lang]
  const anchor = (id: string) => (opts.home ? `#${id}` : `${lang === 'ar' ? '/ar' : '/'}#${id}`)
  const blogHref = lang === 'ar' ? '/ar/blog' : '/blog'
  return `<footer class="bg-slate-900 text-slate-400 py-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-4 gap-8 text-sm">
      <div>
        <div class="flex items-center gap-2 text-white font-bold mb-3"><i class="fas fa-scale-balanced text-gold-300"></i>TrustiqLegal</div>
        <p>${t.description}</p>
      </div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.product}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="${anchor('features')}">${t.nav.features}</a></li><li><a class="hover:text-white" href="${anchor('pricing')}">${t.nav.pricing}</a></li><li><a class="hover:text-white" href="${anchor('security')}">${t.nav.security}</a></li><li><a class="hover:text-white" href="${blogHref}">${t.nav.blog}</a></li></ul></div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.legal}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="/terms">${t.footer.terms}</a></li><li><a class="hover:text-white" href="/privacy">${t.footer.privacy}</a></li></ul></div>
      <div><h4 class="text-white font-semibold mb-3">${t.footer.contact}</h4><ul class="space-y-2">
        <li><a class="hover:text-white" href="mailto:${esc(opts.salesEmail)}">${esc(opts.salesEmail)}</a></li><li><a class="hover:text-white" href="mailto:${esc(opts.supportEmail)}">${esc(opts.supportEmail)}</a></li></ul></div>
    </div>
    <p class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-6 border-t border-slate-800 text-center text-xs">&copy; ${new Date().getFullYear()} TrustiqLegal. ${t.footer.rights}</p>
  </footer>`
}

export function landingPage(opts: { assetVersion: string; salesEmail: string; supportEmail: string; lang?: Lang }) {
  const lang = opts.lang ?? 'en'
  const t = copy[lang]
  const L = t.lines
  const check = (text: string, on = true) =>
    `<li class="flex items-start gap-3"><i class="fas ${on ? 'fa-check text-emerald-600' : 'fa-xmark text-slate-300'} mt-1"></i><span class="${on ? '' : 'text-slate-400'}">${esc(text)}</span></li>`
  const S = PLANS.starter, P = PLANS.professional
  const register = `/app#/register${lang === 'ar' ? '?lang=ar' : ''}`
  const login = `/app#/login${lang === 'ar' ? '?lang=ar' : ''}`
  const sales = `mailto:${esc(opts.salesEmail)}?subject=${encodeURIComponent('TrustiqLegal Enterprise')}`

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  ${head({ title: t.title, description: t.description, assetVersion: opts.assetVersion, lang })}
  <link rel="alternate" hreflang="en" href="/" /><link rel="alternate" hreflang="ar" href="/ar" />
</head>
<body class="bg-white text-slate-900 antialiased">
  ${siteNav(lang, { home: true })}

  <header class="hero-gradient text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
      <div>
        <p class="uppercase tracking-widest text-xs font-semibold text-gold-300 mb-4">${t.hero.eyebrow}</p>
        <h1 class="text-4xl md:text-5xl font-bold leading-tight mb-6">${t.hero.h1}</h1>
        <p class="text-lg text-slate-200 leading-relaxed mb-8">${t.hero.p}</p>
        <div class="flex flex-col sm:flex-row gap-3">
          <a href="${register}" class="btn btn-gold text-base px-6 py-3"><i class="fas fa-rocket"></i>${t.hero.cta}</a>
          <a href="#pricing" class="btn btn-outline-light text-base px-6 py-3">${t.hero.cta2}</a>
        </div>
        <p class="text-sm text-slate-300 mt-4">${t.hero.note}</p>
      </div>
      <div class="hidden md:block">
        <div class="rounded-2xl bg-white/10 border border-white/20 p-8 space-y-5">
          ${t.heroCard.map((x) => `<div class="flex items-start gap-3"><i class="fas fa-circle-check text-emerald-300 text-xl mt-0.5"></i><span>${esc(x)}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </header>

  <section id="features" class="py-20 md:py-28 bg-slate-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-14 max-w-2xl mx-auto">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.featuresTitle}</h2>
        <p class="text-lg text-slate-600">${t.featuresSub}</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        ${t.features.map(([icon, title, body]) => `
        <div class="bg-white rounded-xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition">
          <div class="w-11 h-11 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center mb-4"><i class="fas ${icon} text-lg"></i></div>
          <h3 class="font-bold text-lg mb-2">${esc(title)}</h3>
          <p class="text-slate-600 text-sm leading-relaxed">${esc(body)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section id="security" class="py-20 md:py-24">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <h2 class="text-3xl md:text-4xl font-bold mb-12 text-center">${t.securityTitle}</h2>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        ${t.security.map(([icon, title, body]) => `
        <div>
          <i class="fas ${icon} text-2xl text-brand-700 mb-3"></i>
          <h3 class="font-bold mb-2">${esc(title)}</h3>
          <p class="text-slate-600 text-sm leading-relaxed">${esc(body)}</p>
        </div>`).join('')}
      </div>
      <p class="mt-12 text-center text-sm text-slate-500 max-w-3xl mx-auto"><i class="fas fa-circle-info"></i> ${t.disclaimer}</p>
    </div>
  </section>

  <section id="pricing" class="py-20 md:py-28 bg-slate-50">
    <div class="max-w-7xl 2xl:max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-14 max-w-2xl mx-auto">
        <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.pricingTitle}</h2>
        <p class="text-lg text-slate-600">${t.pricingSub}</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-6 items-stretch">
        <div class="pricing-card">
          <h3 class="text-2xl font-bold mb-1">${t.plans.starter.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.starter.desc}</p>
          <p class="mb-1"><span class="text-4xl font-extrabold whitespace-nowrap">${t.plans.starter.price}</span><span class="text-slate-500">${t.perMonth}</span></p>
          <p class="text-sm text-slate-500 mb-8">${esc(t.usd(PRICES.USD.starter))}</p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.seats(fmt(INCLUDED_SEATS.starter, lang, '')))}${check(L.cases(fmt(S.maxActiveCases, lang, t.unlimited)))}${check(L.docs(fmt(S.documentsPerMonth, lang, t.unlimited)))}${check(L.ai(fmt(S.aiRequestsPerMonth, lang, t.unlimited)))}
            ${check(L.drafting)}${check(L.support)}${check(L.advanced, false)}
          </ul>
          <a href="${register}" class="btn btn-secondary w-full">${t.choose}</a>
        </div>
        <div class="pricing-card">
          <h3 class="text-2xl font-bold mb-1">${t.plans.starterPlus.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.starterPlus.desc}</p>
          <p class="mb-1"><span class="text-4xl font-extrabold whitespace-nowrap">${t.plans.starterPlus.price}</span><span class="text-slate-500">${t.perMonth}</span></p>
          <p class="text-sm text-slate-600">${t.plans.starterPlus.note}</p>
          <p class="text-sm text-slate-500 mb-8">${t.plans.starterPlus.usd}</p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.perLawyer.cases)}${check(L.perLawyer.docs)}${check(L.perLawyer.ai)}
            ${check(L.drafting)}${check(L.support)}${check(L.advanced, false)}
          </ul>
          <button type="button" class="btn btn-secondary w-full" data-firm-quote>${t.firm.cta}</button>
        </div>
        <div class="pricing-card featured">
          <div class="absolute -top-3 inset-x-0 flex justify-center"><span class="bg-brand-700 text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">${t.popular}</span></div>
          <h3 class="text-2xl font-bold mb-1">${t.plans.professional.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.professional.desc}</p>
          <p class="mb-1"><span class="text-4xl font-extrabold whitespace-nowrap">${t.plans.professional.price}</span><span class="text-slate-500">${t.perMonth}</span></p>
          <p class="text-sm text-slate-500 mb-8">${esc(t.usd(PRICES.USD.professional))}</p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.seats(fmt(INCLUDED_SEATS.professional, lang, '')))}${check(L.cases(fmt(P.maxActiveCases, lang, t.unlimited)))}${check(L.docs(fmt(P.documentsPerMonth, lang, t.unlimited)))}${check(L.ai(fmt(P.aiRequestsPerMonth, lang, t.unlimited)))}
            ${check(L.drafting)}${check(L.advanced)}${check(L.priority)}
          </ul>
          <a href="${register}" class="btn btn-primary w-full">${t.choose}</a>
        </div>
        <div class="pricing-card border-2 border-dashed border-brand-300" id="firms">
          <h3 class="text-2xl font-bold mb-1">${t.firm.name}</h3>
          <p class="text-slate-600 mb-6">${t.firm.title}</p>
          <p class="mb-8"><span class="text-3xl font-extrabold">${t.firm.price}</span></p>
          <ul class="space-y-3 mb-8 flex-1">${t.firm.lines.map((l) => check(l)).join('')}</ul>
          <button type="button" class="btn btn-primary w-full" data-firm-quote>${t.firm.cta}</button>
        </div>
        <div class="pricing-card">
          <h3 class="text-2xl font-bold mb-1">${t.plans.enterprise.name}</h3>
          <p class="text-slate-600 mb-6">${t.plans.enterprise.desc}</p>
          <p class="mb-8"><span class="text-4xl font-extrabold">${t.custom}</span></p>
          <ul class="space-y-3 mb-8 flex-1">
            ${check(L.cases(t.unlimited))}${check(L.docs(t.unlimited))}${check(L.ai(t.unlimited))}
            ${check(L.advanced)}${check(L.sla)}${check(L.onboarding)}
          </ul>
          <a href="${sales}" class="btn btn-secondary w-full">${t.contact}</a>
        </div>
      </div>
    </div>
  </section>

  <section class="hero-gradient text-white py-16 md:py-20">
    <div class="max-w-3xl mx-auto px-4 text-center">
      <h2 class="text-3xl md:text-4xl font-bold mb-4">${t.ctaTitle}</h2>
      <p class="text-lg text-slate-200 mb-8">${t.ctaP}</p>
      <a href="${register}" class="btn btn-gold text-base px-6 py-3">${t.hero.cta}</a>
    </div>
  </section>

  ${siteFooter(lang, { ...opts, home: true })}
  <div id="firm-quote" hidden data-t="${esc(JSON.stringify(t.firm.form))}" data-lang="${lang}"></div>
  <script type="module" src="/static/site/firm-quote.js?v=${opts.assetVersion}"></script>
  <div id="tq-chat" data-endpoint="/help/chat" data-lang="${lang}" data-color="#1a365d"
    data-greeting="${esc(t.chat.greeting)}" data-t="${esc(JSON.stringify(t.chat))}" data-consult="${register}"></div>
  <script src="/static/site/chat.js?v=${opts.assetVersion}" defer></script>
</body>
</html>`
}
