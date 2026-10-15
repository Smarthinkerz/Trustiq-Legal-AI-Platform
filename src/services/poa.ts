import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { letterheadParagraphs, type Letterhead } from './export'

// ---------------------------------------------------------------------------
// Power of attorney drafts (مسودة وكالة): a bilingual draft for the client to
// take to the notary, naming the firm's advocates, the scope, and the special
// powers that must be stated expressly (admission, settlement, waiver,
// release, arbitration, receiving money) and the right to delegate.
// ---------------------------------------------------------------------------

export const SCOPES = ['litigation_general', 'litigation_specific', 'company_representation', 'real_estate', 'debt_collection', 'arbitration'] as const
export const SPECIAL = ['admit', 'settle', 'waive', 'release', 'arbitrate', 'receive'] as const
export type Scope = (typeof SCOPES)[number]
export type Special = (typeof SPECIAL)[number]
type Item = { en: string; ar: string }

export type Detail = { case_ref?: string | null; court?: string | null; opponent?: string | null; property?: string | null; debtor?: string | null }

// What each scope needs to be specific enough to use.
export function missingDetails(scope: Scope, d: Detail): string[] {
  const need: Partial<Record<Scope, (keyof Detail)[]>> = { litigation_specific: ['case_ref'], real_estate: ['property'], debt_collection: ['debtor'] }
  return (need[scope] ?? []).filter((k) => !String(d[k] ?? '').trim())
}

export function scopeClause(scope: Scope, d: Detail): Item {
  switch (scope) {
    case 'litigation_general':
      return {
        en: 'to represent the principal before all courts of every type and level, the public prosecution, the police and all judicial and administrative bodies, as claimant or defendant; to file and answer claims, submit pleadings and memoranda, attend hearings, apply for and challenge judgments by every method of appeal, and follow up their enforcement',
        ar: 'تمثيل الموكل أمام جميع المحاكم على اختلاف أنواعها ودرجاتها، والادعاء العام، والشرطة، وجميع الجهات القضائية والإدارية، مدعياً أو مدعى عليه، ورفع الدعاوى والرد عليها، وتقديم اللوائح والمذكرات، وحضور الجلسات، وطلب الأحكام والطعن فيها بجميع طرق الطعن، ومتابعة تنفيذها'
      }
    case 'litigation_specific': {
      const en = [`case no. ${d.case_ref}`, d.court ? `before ${d.court}` : '', d.opponent ? `against ${d.opponent}` : ''].filter(Boolean).join(' ')
      const ar = [`الدعوى رقم ${d.case_ref}`, d.court ? `أمام ${d.court}` : '', d.opponent ? `ضد ${d.opponent}` : ''].filter(Boolean).join(' ')
      return {
        en: `to represent the principal in ${en}, and in every appeal, objection and enforcement arising from it; to submit pleadings and memoranda, attend hearings and take every step the case requires`,
        ar: `تمثيل الموكل في ${ar}، وفي كل ما يتفرع عنها من طعون واعتراضات وتنفيذ، وتقديم اللوائح والمذكرات، وحضور الجلسات، واتخاذ جميع الإجراءات التي تتطلبها الدعوى`
      }
    }
    case 'company_representation':
      return {
        en: 'to represent the principal before ministries, government departments, the commercial registry, chambers of commerce and industry, municipalities and all public and private bodies, and to sign and submit applications, forms and documents for that purpose',
        ar: 'تمثيل الموكل أمام الوزارات والدوائر الحكومية والسجل التجاري وغرف التجارة والصناعة والبلديات وجميع الجهات العامة والخاصة، وتوقيع الطلبات والنماذج والمستندات وتقديمها لهذا الغرض'
      }
    case 'real_estate':
      return {
        en: `to represent the principal before the land registry and all real estate authorities in respect of the property described as: ${d.property}; to apply for and receive title documents and certificates, and to complete the procedures relating to the property`,
        ar: `تمثيل الموكل أمام السجل العقاري وجميع الجهات المختصة بالعقارات بخصوص العقار الموصوف بأنه: ${d.property}، وطلب سندات الملكية والشهادات واستلامها، وإتمام الإجراءات المتعلقة بالعقار`
      }
    case 'debt_collection':
      return {
        en: `to claim and collect the amounts owed to the principal by ${d.debtor}; to send notices and demands, file claims and complaints including those relating to returned cheques, and follow up enforcement`,
        ar: `مطالبة ${d.debtor} بالمبالغ المستحقة للموكل وتحصيلها، وإرسال الإنذارات والمطالبات، ورفع الدعاوى وتقديم الشكاوى بما فيها المتعلقة بالشيكات المرتجعة، ومتابعة التنفيذ`
      }
    case 'arbitration':
      return {
        en: 'to represent the principal in arbitration proceedings before any arbitral institution or tribunal; to appoint arbitrators, file statements and evidence, attend hearings, and apply to set aside, recognise or enforce arbitral awards',
        ar: 'تمثيل الموكل في إجراءات التحكيم أمام أي مركز أو هيئة تحكيم، وتعيين المحكمين، وتقديم المذكرات والبينات، وحضور الجلسات، وطلب إبطال أحكام التحكيم أو الاعتراف بها أو تنفيذها'
      }
  }
}

export const SPECIAL_TEXT: Record<Special, Item> = {
  admit: { en: 'admit claims', ar: 'الإقرار' },
  settle: { en: 'settle and conciliate', ar: 'الصلح' },
  waive: { en: 'waive claims and withdraw proceedings', ar: 'التنازل وترك الخصومة' },
  release: { en: 'release debtors', ar: 'الإبراء' },
  arbitrate: { en: 'agree to arbitration', ar: 'الاتفاق على التحكيم' },
  receive: { en: 'receive money, cheques and documents on the principal\'s behalf and give receipts', ar: 'قبض المبالغ والشيكات والمستندات باسم الموكل والتوقيع بالاستلام' }
}

export type Agent = { name: string; name_ar: string | null; bar_number: string | null }
export type Principal = { kind: 'individual' | 'company'; name: string; name_ar: string | null; id_number: string | null
  rep?: { name: string; name_ar: string | null; role: string; id_number: string | null } | null }

// Accusative after بصفته.
const ROLE_AR: Record<string, string> = { manager: 'مديراً', director: 'عضواً في مجلس الإدارة', signatory: 'مفوضاً بالتوقيع', shareholder: 'شريكاً' }
const dmy = (iso: string) => iso.split('-').reverse().join('/')

// The paragraphs of the draft, in both languages.
export function poaText(o: { principal: Principal; agents: Agent[]; firm: string; firmAr: string; scope: Scope; detail: Detail; special: Special[]; substitute: boolean; validUntil: string | null }) {
  const p = o.principal
  const who: Item = p.kind === 'company'
    ? {
        en: `${p.name}${p.id_number ? `, commercial registration no. ${p.id_number}` : ''}${p.rep ? `, represented by ${p.rep.name} in their capacity as ${p.rep.role}${p.rep.id_number ? ` (ID no. ${p.rep.id_number})` : ''}` : ''}`,
        ar: `${p.name_ar || p.name}${p.id_number ? `، المقيدة في السجل التجاري برقم ${p.id_number}` : ''}${p.rep ? `، ويمثلها ${p.rep.name_ar || p.rep.name} بصفته ${ROLE_AR[p.rep.role] ?? p.rep.role}${p.rep.id_number ? ` (هوية رقم ${p.rep.id_number})` : ''}` : ''}`
      }
    : { en: `${p.name}${p.id_number ? `, holder of ID no. ${p.id_number}` : ''}`, ar: `${p.name_ar || p.name}${p.id_number ? `، حامل الهوية رقم ${p.id_number}` : ''}` }
  const agentsEn = o.agents.map((a) => `${a.name}${a.bar_number ? ` (advocate registration no. ${a.bar_number})` : ''}`).join(', ')
  const agentsAr = o.agents.map((a) => `${a.name_ar || a.name}${a.bar_number ? ` (قيد محاماة رقم ${a.bar_number})` : ''}`).join('، ')
  const several = o.agents.length > 1
  const scope = scopeClause(o.scope, o.detail)
  const company = p.kind === 'company'
  const lawyersAr = `${several ? 'المحامين' : 'المحامي'} ${agentsAr} من ${o.firmAr}${several ? '، مجتمعين أو منفردين،' : ''}`
  const paras: Item[] = [
    company
      // A company speaks of itself in the third person.
      ? { en: `${who.en} ("the principal") hereby appoints the advocate${several ? 's' : ''} ${agentsEn} of ${o.firm}${several ? ', jointly or severally,' : ''} as its attorney${several ? 's' : ''}:`,
          ar: `إن ${who.ar} ("الموكلة")، توكل بموجب هذا ${lawyersAr} وذلك من أجل:` }
      : { en: `I, ${who.en} ("the principal"), hereby appoint the advocate${several ? 's' : ''} ${agentsEn} of ${o.firm}${several ? ', jointly or severally,' : ''} as my attorney${several ? 's' : ''}:`,
          ar: `أنا ${who.ar} ("الموكل")، أوكل بموجب هذا ${lawyersAr} وذلك من أجل:` },
    // Each scope clause starts "to ..."; as an item it starts with a capital.
    { en: `1. T${scope.en.slice(1)}.`, ar: `1. ${scope.ar}.` }
  ]
  let n = 2
  if (o.special.length) {
    paras.push({
      en: `${n++}. The attorney${several ? 's are' : ' is'} expressly authorised to: ${o.special.map((s) => SPECIAL_TEXT[s].en).join('; ')}.`,
      ar: `${n - 1}. ${several ? 'وللوكلاء' : 'وللوكيل'} صراحةً حق: ${o.special.map((s) => SPECIAL_TEXT[s].ar).join('، ')}.`
    })
  }
  paras.push(o.substitute
    ? { en: `${n++}. The attorney${several ? 's' : ''} may delegate all or part of these powers to another advocate.`, ar: `${n - 1}. ${several ? 'وللوكلاء' : 'وللوكيل'} حق توكيل الغير من المحامين في كل أو بعض ما ذُكر.` }
    : { en: `${n++}. The attorney${several ? 's' : ''} may not delegate these powers to anyone else.`, ar: `${n - 1}. ${several ? 'وليس للوكلاء' : 'وليس للوكيل'} حق توكيل الغير.` })
  paras.push({ en: `${n++}. To sign all documents and take all steps needed for the above.`, ar: `${n - 1}. وتوقيع جميع المستندات واتخاذ جميع الإجراءات اللازمة لما تقدم.` })
  paras.push(o.validUntil
    ? { en: `This power of attorney is valid until ${dmy(o.validUntil)}.`, ar: `تسري هذه الوكالة حتى ${dmy(o.validUntil)}.` }
    : { en: 'This power of attorney remains valid until it is revoked.', ar: 'تسري هذه الوكالة ما لم يتم إلغاؤها.' })
  return paras
}

// Bilingual draft: English left, Arabic right, a signature block and space for the notary.
export async function renderPoaDocx(o: { firmName: string; letterhead: Letterhead | null; title: Item; paras: Item[]; signer: string }) {
  const color = (o.letterhead?.primary_color ?? '#1a365d').replace('#', '')
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const thin = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' }
  const p = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({
    bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 120 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 21, font: rtl ? 'Arial' : 'Calibri', rightToLeft: rtl })]
  })
  const cell = (children: Paragraph[], borders: any = { top: none, bottom: none, left: none, right: none }) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders, children })
  const pair = (it: Item, opts: { bold?: boolean; size?: number } = {}) => new TableRow({ children: [cell([p(it.en, false, opts)]), cell([p(it.ar, true, opts)])] })
  const body = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [pair(o.title, { bold: true, size: 28 }), ...o.paras.map((x) => pair(x))] })
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const sign = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
    cell([p('Principal / الموكل', false, { bold: true }), p(o.signer, /[؀-ۿ]/.test(o.signer)), p('Signature / التوقيع: ____________________', false), p('Date / التاريخ: ____________________', false)]),
    cell([p('For the notary public / خاص بالكاتب بالعدل', false, { bold: true, size: 18 }), p('', false), p('', false), p('', false)], box)
  ] })] })
  const doc = new Document({
    creator: o.firmName,
    title: o.title.en,
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [...letterheadParagraphs(o.letterhead, false, 'Calibri', color), body, new Paragraph({ text: '' }), sign, new Paragraph({ text: '' }),
        p('Draft prepared by the firm for notarisation. The notary\'s own form and requirements prevail.', false, { size: 16 }),
        p('مسودة أعدها المكتب لغرض التوثيق، ويُعتمد نموذج الكاتب بالعدل ومتطلباته.', true, { size: 16 })]
    }]
  })
  return Packer.toBuffer(doc)
}
