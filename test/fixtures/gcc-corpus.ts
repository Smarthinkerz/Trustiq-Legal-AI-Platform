import { normalizeText } from '../../src/services/library'
import type { EmbeddingService, RerankService } from '../../src/services/retrieval'

// Test instruments. The wording is invented for tests and is NOT the official text of these laws;
// only the structure (numbers, articles, links between instruments) mirrors the real ones.
export const CORPUS = {
  omLabourOld: {
    title: 'Labour Law', jurisdiction: 'oman', kind: 'royal_decree', language: 'en', number: '35/2003', year: '2003',
    text: `Labour Law (test fixture)

Article 1
This law applies to employers and workers in the private sector.

Article 37
Either party may terminate a contract of indefinite term after giving written notice of not less than thirty days.

Article 40
The employer may terminate the contract without notice for serious misconduct.`
  },
  omLabourNew: {
    title: 'Labour Law', jurisdiction: 'oman', kind: 'royal_decree', language: 'en', number: '53/2023', year: '2023', effective_from: '2023-07-26',
    text: `Labour Law (test fixture)

Article 1
This law applies to employers and workers in the private sector.

Article 43
The employer shall give the worker written notice of not less than ninety days before terminating a contract of indefinite term.

Article 70
The worker is entitled to paid annual leave of thirty days for each year of service.`
  },
  omLabourNewAr: {
    title: 'قانون العمل', jurisdiction: 'oman', kind: 'royal_decree', language: 'ar', number: '53/2023', year: '2023', effective_from: '2023-07-26',
    text: `قانون العمل (نص اختباري)

المادة (43)
يجب على صاحب العمل إخطار العامل كتابةً قبل تسعين يوماً على الأقل من إنهاء العقد غير محدد المدة.

المادة (70)
يستحق العامل إجازة سنوية مدفوعة الأجر مدتها ثلاثون يوماً عن كل سنة خدمة.`
  },
  uaeLabour: {
    title: 'Federal Decree-Law on the Regulation of Labour Relations', jurisdiction: 'uae', kind: 'law', language: 'en', number: '33/2021', year: '2021',
    text: `Labour Relations (test fixture)

Article 9
The probation period shall not exceed six months.

Article 43
The employer shall give written notice of termination and pay the end of service gratuity within fourteen days.`
  },
  omPdpl: {
    title: 'Personal Data Protection Law', jurisdiction: 'oman', kind: 'royal_decree', language: 'en', number: '6/2022', year: '2022',
    text: `Personal Data Protection Law (test fixture)

Article 1
In applying this law, personal data means data that makes a natural person identifiable.

Article 23
The controller may transfer personal data outside the Sultanate in accordance with the controls set out in the regulation.`
  },
  omPdplReg: {
    title: 'Executive Regulation of the Personal Data Protection Law', jurisdiction: 'oman', kind: 'regulation', language: 'en', number: '34/2024', year: '2024',
    text: `Executive Regulation (test fixture)

Article 1
Definitions for this regulation.

Article 30
Before transferring personal data outside the Sultanate the controller shall carry out a risk assessment.`
  },
  uaePdplAr: {
    title: 'المرسوم بقانون اتحادي بشأن حماية البيانات الشخصية', jurisdiction: 'uae', kind: 'law', language: 'ar', number: '45/2021', year: '2021',
    text: `حماية البيانات الشخصية (نص اختباري)

المادة (9)
يلتزم المتحكم بإبلاغ المكتب عن أي خرق للبيانات الشخصية فور علمه به.

المادة (13)
لصاحب البيانات الحق في طلب تصحيح بياناته الشخصية.`
  }
} as const

// A tiny bilingual "semantic" space: each dimension is one legal concept, in English and Arabic.
const CONCEPTS: string[][] = [
  ['notice', 'اخطار'], ['terminat', 'انهاء'], ['breach', 'خرق'], ['notif', 'ابلاغ'], ['personal data', 'البيانات الشخصيه', 'بياناته الشخصيه'],
  ['leave', 'اجازه'], ['transfer', 'نقل'], ['gratuity', 'مكافاه'], ['probation', 'التجربه'], ['correct', 'تصحيح'], ['controller', 'المتحكم']
]
export function conceptVector(text: string): number[] {
  const t = normalizeText(text)
  return [0.05, ...CONCEPTS.map((words) => words.reduce((n, w) => n + t.split(w).length - 1, 0))]
}

export function fakeEmbeddings() {
  const svc: EmbeddingService & { calls: number } = {
    configured: true, model: 'test-bge-m3', calls: 0,
    async embed(texts) { svc.calls++; return texts.map(conceptVector) }
  }
  return svc
}

export function fakeReranker() {
  const svc: RerankService & { calls: number } = {
    configured: true, model: 'test-bge-reranker-v2-m3', calls: 0,
    async rerank(query, docs) {
      svc.calls++
      const q = conceptVector(query)
      return docs.map((d) => conceptVector(d).reduce((s, x, i) => s + (i ? x * q[i]! : 0), 0))
    }
  }
  return svc
}
