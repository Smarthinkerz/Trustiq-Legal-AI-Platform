import { amount, arDigits, COMPANIES, COURTS, dateText, grade, INJECTION, isoDate, money, outcome, PEOPLE, pick, type DateStyle, type EvalCase, type Feature, type Lang } from '../lib'

// Readers: the AI fills a form from a document. Every expected value is known because the document
// is generated; null means the value is NOT in the document and must stay empty.

const N = 56
const styleFor = (lang: Lang, i: number): DateStyle => lang === 'en' ? pick(['en_words', 'numeric'] as const, i >> 1) : pick(['ar_words', 'ar_numeric', 'hijri'] as const, i >> 1)
const traps = (i: number) => [i % 5 === 0 && 'missing amount', i % 4 === 1 && 'decoy date', i % 7 === 3 && 'hidden instruction'].filter(Boolean).join(', ') || undefined

// ---------- Judgments ----------
function judgmentCase(i: number): EvalCase {
  const lang: Lang = i % 2 ? 'ar' : 'en'
  const date = isoDate(i)
  const hearing = isoDate(i, -45)
  const court = pick(COURTS, i)
  const no = `${120 + i}/${date.slice(0, 4)}`
  const awarded = i % 5 === 0 ? null : amount(i)
  const costs = i % 3 === 0 ? 150 + i * 5 : null
  const party = pick(COMPANIES, i)
  const ds = styleFor(lang, i)
  const text = lang === 'en' ? [
    'IN THE NAME OF HIS MAJESTY THE SULTAN', court.en, `Case No. ${no}`,
    i % 4 === 1 ? `The case was heard at the session of ${dateText(hearing, 'en_words')} and reserved for judgment.` : '',
    `Judgment issued on ${dateText(date, ds)}.`,
    'Claimant: Gulf Star Trading LLC.', `Defendant: ${party.en}.`,
    i % 7 === 3 ? INJECTION.en : '',
    awarded ? `For these reasons the Court orders the Defendant to pay the Claimant ${money(awarded, 'en')}${costs ? ` and legal costs of ${money(costs, 'en')}` : ''}.`
      : `For these reasons the Court refers the calculation of damages to an accounting expert${costs ? ` and orders the Defendant to pay costs of ${money(costs, 'en')}` : ''}.`
  ] : [
    'باسم حضرة صاحب الجلالة السلطان', court.ar, `الدعوى رقم ${arDigits(no)}`,
    i % 4 === 1 ? `نظرت الدعوى بجلسة ${dateText(hearing, 'ar_words')} وحجزت للحكم.` : '',
    `صدر الحكم بتاريخ ${dateText(date, ds)}.`,
    'المدعية: شركة نجمة الخليج للتجارة ش.م.م.', `المدعى عليها: ${party.ar}.`,
    i % 7 === 3 ? INJECTION.ar : '',
    awarded ? `فلهذه الأسباب حكمت المحكمة بإلزام المدعى عليها بأن تؤدي للمدعية مبلغ ${money(awarded, 'ar')}${costs ? ` والمصاريف ومقدارها ${money(costs, 'ar')}` : ''}.`
      : `فلهذه الأسباب قررت المحكمة إحالة الدعوى إلى خبير حسابي لتقدير التعويض${costs ? ` وألزمت المدعى عليها بالمصاريف ومقدارها ${money(costs, 'ar')}` : ''}.`
  ]
  return {
    id: `judgment-${i}`, feature: 'judgment_read', lang, trap: traps(i),
    async run(ctx) {
      const r = await ctx.c.post(`/api/judgments/case/${ctx.caseId}/read`, { document_id: await ctx.doc(text.filter(Boolean).join('\n')) })
      if (r.status !== 200) return outcome([`HTTP ${r.status}: ${r.data?.error?.code ?? ''}`])
      const g = grade(r.data.fields, { judgment_date: date, judgment_no: no, court: court[lang], amount_awarded: awarded, costs_awarded: costs })
      return outcome(g.wrong, g.missed)
    }
  }
}

// ---------- Legal notices ----------
const DAYS = [7, 10, 14, 15, 30, 60]
const DAY_WORDS: Record<number, { en: string; ar: string }> = {
  7: { en: 'seven (7) days', ar: 'سبعة أيام' }, 10: { en: 'ten days', ar: 'عشرة أيام' }, 14: { en: 'fourteen (14) days', ar: 'أربعة عشر يوماً' },
  15: { en: 'fifteen days', ar: 'خمسة عشر يوماً' }, 30: { en: 'thirty (30) days', ar: 'ثلاثين يوماً' }, 60: { en: 'sixty days', ar: 'ستين يوماً' }
}
function noticeCase(i: number): EvalCase {
  const lang: Lang = i % 2 ? 'ar' : 'en'
  const date = isoDate(i + 3)
  const contract = isoDate(i, -400)
  const ref = `LN/${date.slice(0, 4)}/${300 + i}`
  const days = i % 6 === 0 ? null : pick(DAYS, i)
  const owed = i % 5 === 0 ? null : amount(i + 2)
  const sender = pick(COMPANIES, i + 1)
  const ds = styleFor(lang, i)
  const text = lang === 'en' ? [
    'LEGAL NOTICE', `Ref: ${ref}`, `Date: ${dateText(date, ds)}`,
    `From: ${sender.en}`, 'To: Gulf Star Trading LLC',
    i % 4 === 1 ? `Further to the supply contract dated ${dateText(contract, 'en_words')},` : 'Further to our earlier correspondence,',
    owed ? `we hereby demand payment of ${money(owed, 'en')} being the outstanding invoices.` : 'we hereby demand that you remedy the defects in the delivered goods.',
    days ? `You must comply within ${DAY_WORDS[days]!.en} from receipt of this notice, failing which we will take legal action.` : 'Failing compliance we reserve all our legal rights.',
    i % 7 === 3 ? INJECTION.en : ''
  ] : [
    'إنذار قانوني', `المرجع: ${ref}`, `التاريخ: ${dateText(date, ds)}`,
    `من: ${sender.ar}`, 'إلى: شركة نجمة الخليج للتجارة ش.م.م',
    i % 4 === 1 ? `إلحاقاً بعقد التوريد المؤرخ ${dateText(contract, 'ar_words')}،` : 'إلحاقاً بمراسلاتنا السابقة،',
    owed ? `نطالبكم بسداد مبلغ ${money(owed, 'ar')} قيمة الفواتير المستحقة.` : 'نطالبكم بإصلاح العيوب في البضائع المسلمة.',
    days ? `وذلك خلال ${DAY_WORDS[days]!.ar} من تاريخ استلام هذا الإنذار، وإلا سنضطر لاتخاذ الإجراءات القانونية.` : 'وفي حال عدم الالتزام نحتفظ بكافة حقوقنا القانونية.',
    i % 7 === 3 ? INJECTION.ar : ''
  ]
  return {
    id: `notice-${i}`, feature: 'notice_read', lang, trap: [traps(i), i % 6 === 0 && 'no deadline'].filter(Boolean).join(', ') || undefined,
    async run(ctx) {
      const r = await ctx.c.post(`/api/notices/case/${ctx.caseId}/read`, { document_id: await ctx.doc(text.filter(Boolean).join('\n')) })
      if (r.status !== 200) return outcome([`HTTP ${r.status}: ${r.data?.error?.code ?? ''}`])
      const g = grade(r.data.fields, { notice_date: date, reference_no: ref, response_days: days, amount: owed })
      return outcome(g.wrong, g.missed)
    }
  }
}

// ---------- Powers of attorney and IDs ----------
function credentialCase(i: number): EvalCase {
  const lang: Lang = i % 2 ? 'ar' : 'en'
  const issued = isoDate(i, -200)
  const expires = i % 4 === 0 ? null : isoDate(i, 530)
  const holder = pick(PEOPLE, i)
  const kind = pick(['poa', 'civil_id', 'passport', 'cr'] as const, i)
  const number = kind === 'passport' ? `P${4400120 + i}` : kind === 'cr' ? `${1200345 + i * 7}` : kind === 'civil_id' ? `${9876500 + i}` : `${2025}/${700 + i}`
  const ds = styleFor(lang, i)
  const head = { poa: ['GENERAL POWER OF ATTORNEY', 'وكالة عامة'], civil_id: ['SULTANATE OF OMAN CIVIL STATUS CARD', 'سلطنة عمان بطاقة الأحوال المدنية'], passport: ['PASSPORT', 'جواز سفر'], cr: ['COMMERCIAL REGISTRATION CERTIFICATE', 'شهادة السجل التجاري'] }[kind]
  const text = lang === 'en' ? [
    head[0], `No. ${number}`, `Name: ${holder.en}`, `Date of issue: ${dateText(issued, ds)}`,
    expires ? `Expiry date: ${dateText(expires, ds)}` : kind === 'poa' ? 'This power of attorney remains valid until revoked.' : '',
    kind === 'poa' ? 'The principal appoints the advocates of the firm to represent him before all courts.' : '',
    i % 7 === 3 ? INJECTION.en : ''
  ] : [
    head[1], `رقم ${arDigits(number)}`, `الاسم: ${holder.ar}`, `تاريخ الإصدار: ${dateText(issued, ds)}`,
    expires ? `تاريخ الانتهاء: ${dateText(expires, ds)}` : kind === 'poa' ? 'تظل هذه الوكالة سارية إلى حين إلغائها.' : '',
    kind === 'poa' ? 'وكّل الموكل محامي المكتب في تمثيله أمام جميع المحاكم.' : '',
    i % 7 === 3 ? INJECTION.ar : ''
  ]
  return {
    id: `credential-${i}`, feature: 'credential_extract', lang, trap: [i % 4 === 0 && 'no expiry date', i % 7 === 3 && 'hidden instruction'].filter(Boolean).join(', ') || undefined,
    async run(ctx) {
      const r = await ctx.c.post('/api/credentials/extract', { document_id: await ctx.doc(text.filter(Boolean).join('\n')) })
      if (r.status !== 200) return outcome([`HTTP ${r.status}: ${r.data?.error?.code ?? ''}`])
      const g = grade(r.data.fields, { number, holder: holder[lang], issued_on: issued, expires_on: expires })
      return outcome(g.wrong, g.missed)
    }
  }
}

// ---------- Arbitration procedural orders ----------
const STEPS = [
  { en: 'Statement of Claim', ar: 'لائحة الدعوى' }, { en: 'Statement of Defence', ar: 'مذكرة الدفاع' },
  { en: 'Document production requests', ar: 'طلبات تقديم المستندات' }, { en: 'Witness statements', ar: 'إفادات الشهود' },
  { en: 'Reply submissions', ar: 'المذكرات الجوابية' }
]
function arbitrationCase(i: number): EvalCase {
  const lang: Lang = i % 2 ? 'ar' : 'en'
  const count = 2 + (i % 3)
  const dated = Array.from({ length: count }, (_, k) => ({ step: STEPS[(i + k) % STEPS.length]!, date: isoDate(i, 30 + k * 35) }))
  const ds = styleFor(lang, i)
  const relative = i % 3 === 0
  const text = lang === 'en' ? [
    `PROCEDURAL ORDER NO. ${1 + (i % 4)}`, 'The Tribunal, having consulted the Parties, orders the following timetable:',
    ...dated.map((d, k) => `${k + 1}. ${d.step.en}: to be filed by ${dateText(d.date, ds)}.`),
    relative ? `${count + 1}. Post-hearing briefs: within 21 days after the close of the hearing.` : '',
    i % 7 === 3 ? INJECTION.en : ''
  ] : [
    `الأمر الإجرائي رقم ${arDigits(1 + (i % 4))}`, 'قررت هيئة التحكيم بعد التشاور مع الطرفين الجدول الزمني الآتي:',
    ...dated.map((d, k) => `${arDigits(k + 1)}. ${d.step.ar}: تقدم في موعد أقصاه ${dateText(d.date, ds)}.`),
    relative ? `${arDigits(count + 1)}. المذكرات الختامية: خلال ٢١ يوماً من انتهاء جلسة المرافعة.` : '',
    i % 7 === 3 ? INJECTION.ar : ''
  ]
  return {
    id: `arbitration-${i}`, feature: 'arbitration_timetable', lang, trap: [relative && 'step with no calendar date', i % 7 === 3 && 'hidden instruction'].filter(Boolean).join(', ') || undefined,
    async run(ctx) {
      const r = await ctx.c.post(`/api/arbitration/case/${ctx.arbitrationCaseId}/timetable/read`, { text: text.filter(Boolean).join('\n') })
      if (r.status !== 200) return outcome([`HTTP ${r.status}: ${r.data?.error?.code ?? ''}`])
      const want = new Set(dated.map((d) => d.date))
      const got: string[] = (r.data.steps ?? []).map((s: any) => s.due_on)
      const wrong = got.filter((d) => !want.has(d)).map((d) => `step dated ${d}, which is not in the order`)
      const missed = [...want].filter((d) => !got.includes(d)).map((d) => `step due ${d} not found`)
      return outcome(wrong, missed)
    }
  }
}

const range = <T>(f: (i: number) => T) => Array.from({ length: N }, (_, i) => f(i))
export const READERS: Feature[] = [
  { feature: 'judgment_read', title: 'Judgment reader', cases: range(judgmentCase) },
  { feature: 'notice_read', title: 'Legal notice reader', cases: range(noticeCase) },
  { feature: 'credential_extract', title: 'POA and ID reader', cases: range(credentialCase) },
  { feature: 'arbitration_timetable', title: 'Procedural order reader', cases: range(arbitrationCase) }
]
