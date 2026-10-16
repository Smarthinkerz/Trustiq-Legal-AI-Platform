import { beforeAll, describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/services/ai'
import { articleNumber, mentionedArticles } from '../src/services/legal-corpus'
import { quoteMatch, verifyAnswer } from '../src/services/verify'
import { runEmbeddingBackfill } from '../src/services/retrieval'
import { runEvalCase, runLegalEval, summarize } from '../src/services/legal-eval'
import { GCC_EVAL_CASES } from '../src/services/legal-eval-cases'
import { groundQuestion } from '../src/services/grounding'
import { CORPUS, fakeEmbeddings, fakeReranker } from './fixtures/gcc-corpus'
import { client, registered, setup } from './helpers'

const ADMIN = 'ops-court@trustiq.test'
let ctx: Awaited<ReturnType<typeof setup>>
const embeddings = fakeEmbeddings()
const reranker = fakeReranker()
beforeAll(async () => { ctx = await setup({ PLATFORM_ADMIN_EMAILS: ADMIN }, { embeddings, reranker }) })

type Client = Awaited<ReturnType<typeof registered>>['c']

async function upload(c: Client, doc: Record<string, string>, extra: Record<string, string> = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries({ ...doc, ...extra })) form.set(k, v)
  const r = await c.post('/api/library/sources', form)
  expect(r.status).toBe(201)
  return r.data.source.id as string
}

// The fake model answers with a function of the system prompt (which carries the [S#] sources).
function respond(fn: (system: string, question: string) => string) {
  ctx.ai.complete = async ({ messages }: { messages: ChatMessage[] }) => {
    ctx.ai.calls.push(messages)
    return { text: fn(String(messages[0]!.content), String(messages.at(-1)!.content)), model: 'test-model', promptTokens: 10, completionTokens: 20 }
  }
}
// The [S#] whose block contains the text.
function refFor(system: string, needle: string): string {
  const block = system.split(/\n\n(?=\[S\d+\] )/).find((b) => b.includes(needle))
  const ref = block && /\[(S\d+)\]/.exec(block)?.[1]
  if (!ref) throw new Error(`no source contains: ${needle}`)
  return ref
}

describe('article numbers', () => {
  it('reads article headings and mentions in English and Arabic', () => {
    expect(articleNumber('Article 43')).toBe('43')
    expect(articleNumber('المادة (٤٣)')).toBe('43')
    expect(articleNumber('المادة الثانية عشرة')).toBe('12')
    expect(articleNumber('المادة الأولى')).toBe('1')
    expect(articleNumber('Article IV')).toBe('4')
    expect(mentionedArticles('Under Articles 12 and 14 of the law')).toEqual(['12', '14'])
    expect(mentionedArticles('وفقاً للمادة (٤٣) من القانون')).toEqual(['43'])
    expect(mentionedArticles('نصت المادة الثالثة على')).toEqual(['3'])
  })

  it('matches quotes word for word, tolerating only diacritics and letter variants', () => {
    expect(quoteMatch('written notice of not less than ninety days', 'shall give the worker written notice of not less than ninety days before')).toBe('exact')
    expect(quoteMatch('written notice of not less than sixty days', 'written notice of not less than ninety days')).toBeNull()
    expect(quoteMatch('يجب على صاحب العمل اخطار العامل', 'يجب على صاحب العمل إخطار العامل كتابةً')).toBe('normalized')
    expect(quoteMatch('give the worker ... ninety days', 'shall give the worker written notice of not less than ninety days')).toBe('exact')
  })
})

describe('court-grade research', () => {
  let c: Client
  let ids: Record<keyof typeof CORPUS, string>
  beforeAll(async () => {
    c = (await registered(ctx.app)).c
    ids = {} as any
    for (const [k, doc] of Object.entries(CORPUS)) ids[k as keyof typeof CORPUS] = await upload(c, doc as any)
    // The new Labour Law replaces the old one from 26 July 2023; the regulation implements the PDPL.
    expect((await c.post(`/api/library/sources/${ids.omLabourNew}/relations`, { relation: 'replaces', to_source_id: ids.omLabourOld, effective_on: '2023-07-26' })).status).toBe(201)
    expect((await c.post(`/api/library/sources/${ids.omPdplReg}/relations`, { relation: 'implements', to_source_id: ids.omPdpl })).status).toBe(201)
  })

  it('versions the library: repeal dates, versions and links', async () => {
    const old = await c.get(`/api/library/sources/${ids.omLabourOld}`)
    expect(old.data.source).toMatchObject({ status: 'repealed', effective_to: '2023-07-26' })
    expect(old.data.relations[0]).toMatchObject({ relation: 'replaces', direction: 'in', id: ids.omLabourNew })
    expect(old.data.versions.map((v: any) => v.id)).toEqual([ids.omLabourOld, ids.omLabourNew])
    expect(old.data.chunks.find((x: any) => x.label === 'Article 37')).toMatchObject({ article_no: '37', status: 'in_force' })

    // Point in time: 2019 finds the old law, today the new one.
    const then = await c.get('/api/library/search?q=notice%20terminate%20indefinite&jurisdiction=oman&as_of=2019-06-01')
    expect(then.data.items.map((p: any) => p.source_id)).toContain(ids.omLabourOld)
    expect(then.data.items.map((p: any) => p.source_id)).not.toContain(ids.omLabourNew)
    const now = await c.get('/api/library/search?q=notice%20terminate%20indefinite&jurisdiction=oman&as_of=2026-10-16')
    expect(now.data.items.map((p: any) => p.source_id)).not.toContain(ids.omLabourOld)

    // One article repealed by a later decree, then the link removed.
    const amend = await upload(c, { title: 'Amending decree', jurisdiction: 'oman', kind: 'royal_decree', language: 'en', number: '9/2026', effective_from: '2026-03-01', text: 'Article 1\nArticle 70 of the Labour Law is repealed.\n\nArticle 2\nThis decree is published in the Official Gazette.' })
    const rel = await c.post(`/api/library/sources/${amend}/relations`, { relation: 'repeals', to_source_id: ids.omLabourNew, to_article: '70', effective_on: '2026-03-01' })
    expect(rel.status).toBe(201)
    let fresh = await c.get(`/api/library/sources/${ids.omLabourNew}`)
    expect(fresh.data.chunks.find((x: any) => x.article_no === '70')).toMatchObject({ status: 'repealed', changed_on: '2026-03-01' })
    expect(fresh.data.source.status).toBe('in_force')
    expect((await c.del(`/api/library/relations/${rel.data.relation.id}`)).status).toBe(200)
    fresh = await c.get(`/api/library/sources/${ids.omLabourNew}`)
    expect(fresh.data.chunks.find((x: any) => x.article_no === '70')).toMatchObject({ status: 'in_force', changed_on: null })
  })

  it('stops a firm from repealing a law in the shared library', async () => {
    const admin = await registered(ctx.app, { email: ADMIN })
    const shared = await upload(admin.c, { ...CORPUS.uaeLabour, title: 'Shared labour law' } as any, { scope: 'platform' })
    const r = await c.post(`/api/library/sources/${ids.uaeLabour}/relations`, { relation: 'repeals', to_source_id: shared })
    expect(r.status).toBe(403)
    // Linking its own regulation to a shared law is fine.
    expect((await c.post(`/api/library/sources/${ids.omPdplReg}/relations`, { relation: 'implements', to_source_id: shared })).status).toBe(201)
  })

  it('tells the model what each instrument is and verifies a correct answer', async () => {
    respond((sys) => {
      const law = refFor(sys, 'not less than ninety days')
      return `The employer must give «written notice of not less than ninety days» [${law}] under Article 43 [${law}].`
    })
    const r = await c.post('/api/ai/chat', { message: 'What notice must an employer give to end an indefinite contract?', jurisdiction: 'oman' })
    expect(r.status).toBe(200)
    expect(r.data.verification).toMatchObject({ status: 'passed', errors: 0, citations: 1 })
    expect(r.data.verification.checks.map((x: any) => x.code)).toEqual(expect.arrayContaining(['quote_exact', 'article_matches', 'in_force']))
    const sys = String(ctx.ai.calls.at(-1)![0]!.content)
    expect(sys).toContain('Relevant date for the law:')
    expect(sys).toContain('type: royal decree')
    // Stored with the answer.
    const conv = await c.get(`/api/ai/conversations/${r.data.conversation_id}`)
    expect(conv.data.messages.at(-1).verification.status).toBe('passed')
  })

  it('flags a changed quote, a non-existent article and an unknown reference', async () => {
    respond((sys) => {
      const law = refFor(sys, 'not less than ninety days')
      return `The employer must give «written notice of not less than sixty days» [${law}].\nThis is set by Article 52 [${law}].\nSee also [S99].`
    })
    const r = await c.post('/api/ai/chat', { message: 'What notice must an employer give to end an indefinite contract?', jurisdiction: 'oman' })
    expect(r.data.verification.status).toBe('failed')
    expect(r.data.verification.checks.filter((x: any) => x.severity === 'error').map((x: any) => x.code).sort()).toEqual(['article_not_found', 'quote_not_found', 'unknown_reference'])
    // Regenerated once with the failures named, still failing: the answer is withheld, not shown.
    expect(r.data.abstained).toBe('failed_check')
    expect(r.data.reply).toContain('I could not find this in the available sources.')
    expect(r.data.reply).not.toContain('sixty days')
    expect(String(ctx.ai.calls.at(-1)!.at(-1)!.content)).toContain('failed the automatic citation check')
    // The withheld text is kept in the log for review.
    const log = await c.get(`/api/ai/log?conversation_id=${r.data.conversation_id}`)
    expect(log.data.items.at(-1).verification.status).toBe('failed')
  })

  it('catches the law versus implementing regulation confusion', async () => {
    respond((sys) => {
      const law = refFor(sys, 'in accordance with the controls set out in the regulation')
      return `Before a transfer abroad, Article 30 of the Personal Data Protection Law requires a risk assessment [${law}].`
    })
    const r = await c.post('/api/ai/chat', { message: 'What must a controller do before transferring personal data outside Oman under Royal Decree 6/2022?', jurisdiction: 'oman' })
    const err = r.data.verification.checks.find((x: any) => x.code === 'instrument_confusion')
    expect(err).toBeTruthy()
    expect(err.detail).toContain('Executive Regulation')
    // The prompt told the model the regulation is not the law.
    const sys = String(ctx.ai.calls.at(-1)![0]!.content)
    expect(sys).toMatch(/implementing regulation of Personal Data Protection Law/)
  })

  it('flags a repealed law cited as current, unless the answer says it was repealed', async () => {
    respond((sys) => `Notice is thirty days [${refFor(sys, 'not less than thirty days')}].`)
    let r = await c.post('/api/ai/chat', { message: 'What notice does Royal Decree 35/2003 require?', jurisdiction: 'oman' })
    expect(r.data.verification.checks.find((x: any) => x.code === 'not_in_force')).toBeTruthy()
    respond((sys) => `Royal Decree 35/2003 required thirty days, but it was repealed [${refFor(sys, 'not less than thirty days')}].`)
    r = await c.post('/api/ai/chat', { message: 'What notice did Royal Decree 35/2003 require?', jurisdiction: 'oman' })
    expect(r.data.verification.checks.find((x: any) => x.code === 'not_in_force_acknowledged')).toBeTruthy()
    expect(r.data.verification.errors).toBe(0)
    // On a date when the old law applied, it is in force.
    respond((sys) => `Notice was thirty days [${refFor(sys, 'not less than thirty days')}].`)
    r = await c.post('/api/ai/chat', { message: 'What notice applied to a dismissal in Oman?', jurisdiction: 'oman', as_of: '2019-06-01' })
    expect(r.data.verification).toMatchObject({ status: 'passed', as_of: '2019-06-01' })
  })

  it('flags a source from another jurisdiction and laws named but not in the library', async () => {
    const [src] = await ctx.db.query(
      `SELECT c.id AS chunk_id, s.id AS source_id, s.title, s.number, s.jurisdiction, s.kind, s.status, c.article_no, c.status AS article_status, c.text
         FROM library_chunks c JOIN library_sources s ON s.id = c.source_id WHERE s.id = $1 AND c.article_no = '43'`, [ids.uaeLabour])
    const me = await c.get('/api/auth/me')
    const v = await verifyAnswer(ctx.db, {
      orgId: me.data.org.id, asOf: '2026-10-16', allowedJurisdictions: ['oman', 'gcc'],
      sources: [{ ...src, ref: 'S1', citation: 'UAE labour law', changed_on: null, effective_from: null, effective_to: null } as any],
      answer: 'Gratuity is paid within fourteen days [S1]. Royal Decree 99/2020 also applies.'
    })
    expect(v.checks.map((x) => x.code)).toEqual(expect.arrayContaining(['jurisdiction_mismatch', 'unverified_law_reference']))
    expect(v.status).toBe('failed')
  })

  it('keeps an exportable AI use and verification log per document', async () => {
    respond((sys) => `Annual leave is thirty days [${refFor(sys, 'paid annual leave')}].`)
    const chat = await c.post('/api/ai/chat', { message: 'How much paid annual leave does a worker get?', jurisdiction: 'oman' })
    const doc = await c.post('/api/documents', { title: 'Memo on leave', content: 'Leave memo', language: 'en' })
    expect(doc.status).toBe(201)
    const docId = doc.data.document.id
    expect((await c.post(`/api/ai/log/${chat.data.log_id}/attach`, { document_id: docId })).status).toBe(200)
    expect((await c.post(`/api/ai/log/${chat.data.log_id}/review`, { note: 'Checked against the Official Gazette' })).status).toBe(200)

    // Drafting and analysis are logged against their document too.
    respond(() => 'NOTICE OF TERMINATION\n\nUnder Article 43 of the Labour Law, ninety days notice is given.')
    const draft = await c.post('/api/ai/draft', { template: 'legal_memo', language: 'en', jurisdiction: 'oman', instructions: 'Notice to terminate an indefinite labour contract under Royal Decree 53/2023' })
    expect(draft.status).toBe(201)
    expect(draft.data.verification.checks.find((x: any) => x.code === 'article_matches')).toBeTruthy()
    // A draft that cites an article the law does not have is regenerated once, then refused and not saved.
    const before = (await c.get('/api/documents')).data.total
    respond(() => 'NOTICE\n\nUnder Article 999 of the Labour Law, notice is waived.')
    const blocked = await c.post('/api/ai/draft', { template: 'legal_memo', language: 'en', jurisdiction: 'oman', instructions: 'Notice to terminate an indefinite labour contract under Royal Decree 53/2023' })
    expect(blocked.status).toBe(422)
    expect(blocked.data.error.code).toBe('draft_failed_check')
    expect((await c.get('/api/documents')).data.total).toBe(before)

    const log = await c.get(`/api/ai/log?document_id=${docId}`)
    expect(log.data.items).toHaveLength(1)
    expect(log.data.items[0]).toMatchObject({ feature: 'chat', reviewed_by_name: 'Owner Person', review_note: 'Checked against the Official Gazette' })
    expect(log.data.items[0].output_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await c.get(`/api/ai/log?document_id=${draft.data.document.id}`)).data.items[0].feature).toBe('draft')

    const txt = await c.get(`/api/ai/log/export?document_id=${docId}&format=txt`)
    expect(txt.res.headers.get('content-type')).toContain('text/plain')
    expect(txt.data).toContain('AI use and verification record')
    expect(txt.data).toContain('Lawyer verification: Owner Person')
    expect(txt.data).toMatch(/Labour Law \(No\. 53\/2023\)/)
    const ar = await c.get(`/api/ai/log/export?document_id=${docId}&format=txt&lang=ar`)
    expect(ar.data).toContain('سجل استخدام الذكاء الاصطناعي والتحقق')
    const csv = await c.get(`/api/ai/log/export?document_id=${docId}&format=csv`)
    expect(csv.data.split('\r\n')[0]).toContain('check_status')
    const json = await c.get(`/api/ai/log/export?document_id=${docId}&format=json`)
    expect(json.data.entries[0].verification.status).toBe('passed')

    // Another firm cannot see or change the entry.
    const other = await registered(ctx.app)
    expect((await other.c.post(`/api/ai/log/${chat.data.log_id}/review`, {})).status).toBe(404)
    expect((await other.c.get(`/api/ai/log/export?document_id=${docId}`)).status).toBe(404)
  })

  it('retrieves across languages with embeddings and reranks', async () => {
    const me = await c.get('/api/auth/me')
    const deps = { db: ctx.db, config: ctx.config, log: ctx.log, embeddings, reranker }
    // BM25 alone cannot match an English question to an Arabic article.
    const bm25 = await groundQuestion({ db: ctx.db, config: ctx.config, log: ctx.log }, me.data.org.id, { question: 'When must the controller notify a breach of personal data?', jurisdiction: 'uae', asOf: '2026-10-16', max: 6 })
    expect(bm25.retrieval.mode).toBe('bm25')
    expect(bm25.sources.some((s) => s.source_id === ids.uaePdplAr)).toBe(false)

    expect(await runEmbeddingBackfill({ db: ctx.db, log: ctx.log, embeddings }, { max: 10_000 })).toBeGreaterThan(0)
    const hybrid = await groundQuestion(deps, me.data.org.id, { question: 'When must the controller notify a breach of personal data?', jurisdiction: 'uae', asOf: '2026-10-16', max: 6 })
    expect(hybrid.retrieval).toMatchObject({ mode: 'hybrid', reranked: true })
    expect(hybrid.sources[0]).toMatchObject({ source_id: ids.uaePdplAr, article_no: '9' })
    // Dense hits still respect the firm and jurisdiction.
    expect(hybrid.sources.every((s) => ['uae', 'gcc'].includes(s.jurisdiction))).toBe(true)
    const other = await registered(ctx.app)
    const otherMe = await other.c.get('/api/auth/me')
    const none = await groundQuestion(deps, otherMe.data.org.id, { question: 'When must the controller notify a breach of personal data?', jurisdiction: 'uae', asOf: '2026-10-16', max: 6 })
    expect(none.sources.some((s) => s.source_id === ids.uaePdplAr)).toBe(false)

    // Arabic and English questions reach the same Omani article.
    const en = await groundQuestion(deps, me.data.org.id, { question: 'How many days of paid annual leave?', jurisdiction: 'oman', asOf: '2026-10-16', max: 3 })
    const ar = await groundQuestion(deps, me.data.org.id, { question: 'كم يوماً مدة الإجازة السنوية مدفوعة الأجر؟', jurisdiction: 'oman', asOf: '2026-10-16', max: 3 })
    expect(en.sources.some((s) => s.article_no === '70')).toBe(true)
    expect(ar.sources.some((s) => s.article_no === '70')).toBe(true)
  })

  it('runs the standing GCC evaluation set and scores traps, repeal, jurisdiction and parity', async () => {
    const me = await c.get('/api/auth/me')
    // A careful model: cites the first source of the right jurisdiction, never states trap articles.
    respond((sys, q) => {
      if (/999|٩٩٩|777|٧٧٧/.test(q)) return 'The library has no such article; I cannot quote it.'
      const first = /\[(S\d+)\]/.exec(sys.split('<sources>')[1] ?? '')
      return first ? `Here is the rule [${first[1]}].` : 'The library does not cover this.'
    })
    const deps = { db: ctx.db, config: ctx.config, log: ctx.log, ai: ctx.ai, embeddings, reranker }
    const careful = await runLegalEval(deps, { orgId: me.data.org.id, userId: me.data.user.id, today: '2026-10-16' })
    expect(careful.results).toHaveLength(GCC_EVAL_CASES.length * 2)
    const res = (id: string, lang = 'en') => careful.results.find((r) => r.case_id === id && r.lang === lang)!
    expect(res('om-labour-current')).toMatchObject({ pass: true, coverage_gap: false })
    expect(res('om-labour-current').cited[0].law).toBe('oman:53/2023')
    expect(res('om-labour-2019').cited[0].law).toBe('oman:35/2003')
    expect(res('qa-not-bh-pdpl').coverage_gap).toBe(true)
    expect(res('om-labour-article-999').pass).toBe(true)
    expect(careful.summary.coverage_gaps).toBeGreaterThan(0)
    expect(careful.summary.parity.total).toBeGreaterThan(0)
    expect(careful.summary.by_category.repealed.total).toBeGreaterThan(0)

    // A careless model states the trap article and cites the repealed law.
    respond((sys, q) => {
      if (/999|٩٩٩/.test(q)) return `Article 999 says workers get a bonus [S1].`
      const old = sys.split(/\n\n(?=\[S\d+\] )/).find((b) => b.includes('35/2003'))
      return old ? `Notice is thirty days [${/\[(S\d+)\]/.exec(old)![1]}].` : 'Unknown.'
    })
    const library = await ctx.db.query<any>('SELECT jurisdiction, title, number FROM library_sources WHERE org_id = $1', [me.data.org.id])
    const trap = await runEvalCase(deps, { orgId: me.data.org.id, userId: me.data.user.id, library }, GCC_EVAL_CASES.find((k) => k.id === 'om-labour-article-999')!, 'en', '2026-10-16')
    expect(trap.pass).toBe(false)
    expect(trap.reasons.join(' ')).toMatch(/Article 999/)
    const repealed = await runEvalCase(deps, { orgId: me.data.org.id, userId: me.data.user.id, library }, { ...GCC_EVAL_CASES.find((k) => k.id === 'om-labour-current')!, question: { en: 'What notice did Royal Decree 35/2003 require?', ar: '' } }, 'en', '2026-10-16')
    expect(repealed.pass).toBe(false)
    expect(repealed.reasons.join(' ')).toMatch(/repealed by Royal Decree 53\/2023|not_in_force/)
    expect(summarize([trap, repealed]).passed).toBe(0)
  })

  it('lets platform admins start and read evaluation runs', async () => {
    const outsider = await registered(ctx.app)
    expect((await outsider.c.post('/api/admin/legal-eval', {})).status).toBe(403)
    const ops = client(ctx.app)
    expect((await ops.post('/api/auth/login', { email: ADMIN, password: 'Str0ngPassw0rd' })).status).toBe(200)
    expect((await ops.get('/api/admin/legal-eval/cases')).data.items.length).toBe(GCC_EVAL_CASES.length)
    respond(() => 'The library does not cover this.')
    const start = await ops.post('/api/admin/legal-eval', { case_ids: ['om-labour-current', 'om-labour-article-999'], languages: ['en'] })
    expect(start.status).toBe(202)
    await ctx.runDeferred()
    const run = await ops.get(`/api/admin/legal-eval/runs/${start.data.run.id}`)
    expect(run.data.run).toMatchObject({ status: 'done', model: 'test-model' })
    expect(run.data.run.summary.answers).toBe(2)
    expect((await ops.get('/api/admin/legal-eval/runs')).data.items[0].id).toBe(start.data.run.id)
  })
})
