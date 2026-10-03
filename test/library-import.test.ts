import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowedUrl, DEFAULT_IMPORT_DOMAINS, describeFailure, failureCode, guessMeta, htmlToText, pageUrls, parseCertificates } from '../src/services/library-import'
import { looksGarbled } from '../src/services/extract'
import { lawReferences } from '../src/services/library'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const BASE = 'https://mjla.gov.om'
const listing = (items: [string, string][], extra = '') => `<!doctype html><html><head><title>القوانين</title></head><body>
  <nav><a href="/">الرئيسية</a><a href="/contact">اتصل بنا</a><a href="/en/laws">English</a></nav>
  <main><ul>${items.map(([href, text]) => `<li><a href="${href}">${text}</a></li>`).join('')}</ul>
  <a href="/laws/1/page/2">2</a><a href="https://evil.example.com/law">قانون خارجي مزيف</a>${extra}</main>
  <footer><a href="/privacy">الخصوصية</a></footer></body></html>`

const lawPage = (title: string, articles: string[]) => `<!doctype html><html><head><meta charset="utf-8"><title>${title} | وزارة العدل</title>
  <script>var tracking = "المادة 99 لا يجب أن تظهر"</script></head><body>
  <header><nav><a href="/">الرئيسية</a></nav></header>
  <main><h1>${title}</h1>${articles.map((a, i) => `<p><strong>المادة ${i + 1}</strong></p><p>${a}</p>`).join('')}</main>
  <footer>جميع الحقوق محفوظة</footer></body></html>`

describe('law import safety', () => {
  it('only allows official government legislation sites', () => {
    const d = DEFAULT_IMPORT_DOMAINS
    expect(allowedUrl('https://mjla.gov.om/laws/1/page/1', d)).not.toBeNull()
    expect(allowedUrl('https://www.uaelegislation.gov.ae/ar/legislations/1', d)).not.toBeNull()
    expect(allowedUrl('https://laws.boe.gov.sa/BoeLaws/Laws/', d)).not.toBeNull()
    expect(allowedUrl('https://www.almeezan.qa/LawPage.aspx?id=1', d)).not.toBeNull()
    for (const bad of [
      'https://mjla.gov.om.evil.com/x', 'https://evilgov.om/x', 'http://127.0.0.1/admin', 'https://10.0.0.5/x',
      'https://user:pass@mjla.gov.om/x', 'https://mjla.gov.om:8443/x', 'file:///etc/passwd', 'ftp://mjla.gov.om/x', 'not a url'
    ]) expect(allowedUrl(bad, d), bad).toBeNull()
  })

  it('reads law text and metadata from pages', () => {
    const text = htmlToText(lawPage('قانون العمل', ['نص المادة الأولى', 'نص المادة الثانية']))
    expect(text).toContain('المادة 1')
    expect(text).not.toContain('المادة 99')
    expect(text).not.toContain('الرئيسية')
    expect(guessMeta('مرسوم سلطاني رقم 53 / 2023 بإصدار قانون العمل', '')).toMatchObject({ number: '53/2023', year: 2023, kind: 'royal_decree', language: 'ar' })
    expect(guessMeta('Ministerial Decision No. 12/2019 on fees', 'The fees are')).toMatchObject({ number: '12/2019', kind: 'ministerial_decision', language: 'en' })
    expect(pageUrls('https://mjla.gov.om/laws/1/page/1', 3)).toEqual([
      'https://mjla.gov.om/laws/1/page/1', 'https://mjla.gov.om/laws/1/page/2', 'https://mjla.gov.om/laws/1/page/3'])
    expect(pageUrls('https://example.gov.ae/laws?page=4', 2)).toEqual(['https://example.gov.ae/laws?page=4', 'https://example.gov.ae/laws?page=5'])
    expect(pageUrls('https://mjla.gov.om/laws/1', 3)).toEqual(['https://mjla.gov.om/laws/1', 'https://mjla.gov.om/laws/1/page/2', 'https://mjla.gov.om/laws/1/page/3'])
    expect(pageUrls('https://qanoon.om/p/category/x/', 2)).toEqual(['https://qanoon.om/p/category/x/', 'https://qanoon.om/p/category/x/page/2/'])
  })
})

describe('connection failures', () => {
  it('recognises legacy-encoded Arabic PDF text that needs OCR', () => {
    expect(looksGarbled('á`«fƒfÉ≤dG ¿hDƒ`°ûdGh ∫ó`©dG IQGRh …QGRh QGô`b 2024/33 º``bQ 2021/53 ºbQ …QGRƒdG QGô≤dG ΩÉµMCG '.repeat(4))).toBe(true)
    expect(looksGarbled('��ستناد� �إ¶ قانون �إلإجر�ء�ت �جلز�ئية �ل�سادر باملر�سوم �ل�سلطاÁ رقم '.repeat(5))).toBe(true)
    expect(looksGarbled('المادة 1 تسري أحكام هذا القانون على جميع أصحاب العمل والعمال في القطاع الخاص. '.repeat(5))).toBe(false)
    expect(looksGarbled('Article 1. This Law applies to all employers and workers in the private sector – including café staff. '.repeat(4))).toBe(false)
  })

  it('recognises law numbers however they are written', () => {
    expect(lawReferences('لخص المرسوم السلطاني رقم ٤٨ / ٢٠٠٩')).toEqual([{ number: '48', years: ['2009', '09'] }])
    expect(lawReferences('Royal Decree 2019/35 and the law No. 6 of 2022')).toEqual([{ number: '35', years: ['2019', '19'] }, { number: '6', years: ['2022', '22'] }])
    expect(lawReferences('قانون الأحوال الشخصية 32/97')).toEqual([{ number: '32', years: ['1997', '97'] }])
    expect(lawReferences('القانون رقم 35 لسنة 2003')).toEqual([{ number: '35', years: ['2003', '03'] }])
    expect(lawReferences('the meeting is on 12/10/2024 at 3/4 of the way')).toEqual([])
    expect(guessMeta('مرسوم سلطاني رقم ٣٢ / ٩٧ بإصدار قانون الأحوال الشخصية', '')).toMatchObject({ number: '32/1997', year: 1997 })
  })

  it('explains why a site could not be reached, with the underlying code', () => {
    const wrapped = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) })
    expect(failureCode(wrapped('UND_ERR_CONNECT_TIMEOUT'))).toBe('UND_ERR_CONNECT_TIMEOUT')
    expect(failureCode(Object.assign(new TypeError('fetch failed'), { cause: { cause: { code: 'ECONNRESET' } } }))).toBe('ECONNRESET')
    expect(failureCode(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe('TIMEOUT')
    expect(describeFailure('UND_ERR_CONNECT_TIMEOUT', 'mjla.gov.om')).toMatch(/did not answer in time.*outside their country/)
    expect(describeFailure('ECONNRESET', 'mjla.gov.om')).toMatch(/refused or dropped/)
    expect(describeFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'mjla.gov.om')).toMatch(/security certificate/)
    expect(describeFailure('ENOTFOUND', 'mjla.gov.om')).toMatch(/could not be found/)
  })

  it('records the reason when the importer cannot connect', async () => {
    const { c } = await registered(ctx.app)
    const url = `${BASE}/law/unreachable`
    // Simulate a site that drops connections from our server.
    ctx.web.pages.set(url, { throw: 'ECONNRESET' })
    await c.post('/api/library/imports', { jurisdiction: 'oman', items: [{ url }] })
    await ctx.runImports()
    const item = (await c.get('/api/library/imports')).data.items.find((i: any) => i.url === url)
    expect(item.status).toBe('failed')
    expect(item.detail).toMatch(/refused or dropped the connection.*ECONNRESET/)
  })
})

describe('certificate files', () => {
  const cert = (f: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures/certs', f)))
  it('reads issuer certificates published as PEM, DER or PKCS#7 bundles', () => {
    const pem = parseCertificates(cert('int.pem'))
    const der = parseCertificates(cert('int.der'))
    const p7c = parseCertificates(cert('bundle.p7c'))
    expect(pem.map((c) => c.subject)).toEqual(['CN=Test Intermediate CA'])
    expect(der.map((c) => c.subject)).toEqual(['CN=Test Intermediate CA'])
    expect(p7c.map((c) => c.subject).sort()).toEqual(['CN=Test Intermediate CA', 'CN=Test Root CA'])
    const [root] = parseCertificates(cert('root.pem'))
    expect(der[0]!.checkIssued(root!)).toBe(true)
    expect(der[0]!.infoAccess).toContain('CA Issuers - URI:http://pki.example.gov.om/root.crt')
    expect(parseCertificates(new TextEncoder().encode('not a certificate'))).toEqual([])
  })
})

describe('import from link', () => {
  it('finds laws across listing pages, imports them in the background and indexes their articles', async () => {
    const { c } = await registered(ctx.app)
    const { pages } = ctx.web
    pages.set(`${BASE}/laws/1/page/1`, { body: listing([['/law/101', 'المرسوم السلطاني رقم 53/2023 بإصدار قانون العمل'], ['/law/102', 'قانون الشركات التجارية']]) })
    pages.set(`${BASE}/laws/1/page/2`, { body: listing([['/law/103', 'قانون التحكيم في المنازعات المدنية والتجارية']]) })
    pages.set(`${BASE}/law/101`, { body: lawPage('المرسوم السلطاني رقم 53/2023 بإصدار قانون العمل', [
      'تسري أحكام هذا القانون على جميع أصحاب العمل والعمال في القطاع الخاص.',
      'يستحق العامل مكافأة نهاية الخدمة عند انتهاء عقد العمل وفقا لأحكام هذا القانون.',
      'لا يجوز تشغيل العامل أكثر من ثماني ساعات في اليوم الواحد.'
    ]) })
    // A summary page that links to the full text file.
    pages.set(`${BASE}/law/102`, { body: `<html><body><main><h1>قانون الشركات التجارية</h1><p>ملخص قصير</p><a href="/files/102.txt">تحميل</a></main></body></html>` })
    pages.set(`${BASE}/files/102.txt`, { type: 'text/plain; charset=utf-8', body: 'المادة 1\nتسري أحكام هذا القانون على الشركات التجارية المسجلة في سلطنة عمان.\n\nالمادة 2\nيجب أن يكون للشركة اسم تجاري مسجل لدى الوزارة المختصة.' })
    // Redirects are followed only within allowed sites.
    pages.set(`${BASE}/law/103`, { status: 302, location: 'https://evil.example.com/stolen' })

    const found = await c.post('/api/library/imports/discover', { url: `${BASE}/laws/1/page/1`, pages: 3 })
    expect(found.status).toBe(200)
    expect(found.data.pages_scanned).toBe(2)
    expect(found.data.links.map((l: any) => l.url)).toEqual([`${BASE}/law/101`, `${BASE}/law/102`, `${BASE}/law/103`])

    const queued = await c.post('/api/library/imports', {
      jurisdiction: 'oman',
      items: [...found.data.links.map((l: any) => ({ url: l.url, title: l.text })), { url: 'https://evil.example.com/x' }, { url: `${BASE}/law/101` }]
    })
    expect(queued.status).toBe(201)
    expect(queued.data.queued).toBe(3)
    expect(queued.data.skipped).toEqual([{ url: 'https://evil.example.com/x', reason: 'not_allowed' }])

    const before = await c.get('/api/library/imports')
    expect(before.data.summary.queued).toBe(3)
    await ctx.runImports()
    const after = await c.get('/api/library/imports')
    const byUrl = Object.fromEntries(after.data.items.map((i: any) => [i.url, i]))
    expect(byUrl[`${BASE}/law/101`].status).toBe('done')
    expect(byUrl[`${BASE}/law/102`].status).toBe('done')
    expect(byUrl[`${BASE}/law/103`].status).toBe('failed')
    expect(byUrl[`${BASE}/law/103`].detail).toMatch(/redirected/)
    expect(ctx.web.requested).not.toContain('https://evil.example.com/stolen')

    const src = await c.get(`/api/library/sources/${byUrl[`${BASE}/law/101`].source_id}`)
    expect(src.data.source).toMatchObject({ jurisdiction: 'oman', kind: 'royal_decree', number: '53/2023', year: 2023, language: 'ar', source_url: `${BASE}/law/101` })
    expect(src.data.chunks.map((x: any) => x.label).filter(Boolean)).toEqual(['المادة 1', 'المادة 2', 'المادة 3'])
    expect(src.data.source.articles).toBe(3)
    const companies = await c.get(`/api/library/sources/${byUrl[`${BASE}/law/102`].source_id}`)
    expect(companies.data.source.file_name).toBe('102.txt')
    expect(companies.data.chunks).toHaveLength(2)

    // Imported laws are searchable straight away.
    const hits = await c.get(`/api/library/search?q=${encodeURIComponent('مكافأة نهاية الخدمة')}`)
    expect(hits.data.items[0].text).toContain('مكافأة نهاية الخدمة')

    // Importing the same link again is skipped, not duplicated.
    await c.post('/api/library/imports', { jurisdiction: 'oman', items: [{ url: `${BASE}/law/101` }] })
    await ctx.runImports()
    const again = (await c.get('/api/library/imports')).data.items.find((i: any) => i.url === `${BASE}/law/101` && i.status === 'skipped')
    expect(again.detail).toBe('Already in the library')

    // Fix the broken page and retry the failure.
    pages.set(`${BASE}/law/103`, { body: lawPage('قانون التحكيم', ['يسري هذا القانون على كل تحكيم يجري في سلطنة عمان بين أشخاص القانون العام أو الخاص.', 'يكون اتفاق التحكيم مكتوبا وإلا كان باطلا.']) })
    expect((await c.post('/api/library/imports/retry-failed')).data.requeued).toBe(1)
    await ctx.runImports()
    expect((await c.get('/api/library/imports')).data.summary.failed).toBe(0)
    expect((await c.del('/api/library/imports')).data.removed).toBeGreaterThan(0)
  })

  it('follows a law page\'s download button to the PDF and reads garbled Gazette text with OCR, page batch by batch', async () => {
    const { c } = await registered(ctx.app)
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    // A legacy-encoded Gazette PDF: its text layer is Latin-1 symbols instead of Arabic.
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 10; i++) pdf.addPage().drawText('á`«fƒfÉdG ¿hDƒ`°ûdGh ó`©dG IQGRh …QGRh QGô`b º``bQ ºbQ …QGRƒdG QGôdG ÉµMCG ¢†©H Ójó©àH', { x: 40, y: 700, size: 10, font })
    const pdfBytes = await pdf.save()
    // Like mjla.gov.om: the page has only the title, menus and a "تحميل" button without a file extension.
    const lawUrl = `${BASE}/laws/ar/1/show/128`
    const mjlaPage = (button: string) => `<html><body><aside><ul><li><a href="/guides/1">الدليل الاسترشادي</a></li></ul></aside>
      <main><h5>مرسوم سلطاني رقم 29 / 2013 بإصدار قانون المعاملات المدنية</h5><span>القوانين - تاريخ النشر - عدد المشاهدات 2290 - وزارة العدل والشؤون القانونية</span>
      ${button}</main></body></html>`
    const item = { url: lawUrl, title: 'مرسوم سلطاني رقم 29 / 2013 بإصدار قانون المعاملات المدنية' }
    // An earlier import (before download buttons were followed) kept only the page's title text.
    ctx.web.pages.set(lawUrl, { body: mjlaPage('') })
    await c.post('/api/library/imports', { jurisdiction: 'oman', items: [item] })
    await ctx.runImports()
    const thin = (await c.get('/api/library/imports')).data.items[0]
    expect(thin.status).toBe('done')
    expect((await c.get(`/api/library/sources/${thin.source_id}`)).data.chunks).toHaveLength(1)

    ctx.web.pages.set(lawUrl, { body: mjlaPage('<a href="/storage/laws/abc123">تحميل مرسوم سلطاني رقم 29 / 2013 بإصدار قانون المعاملات المدنية</a>') })
    ctx.web.pages.set(`${BASE}/storage/laws/abc123`, { type: 'application/octet-stream', body: pdfBytes })

    const original = ctx.ai.complete
    const batches: string[] = []
    ctx.ai.complete = async ({ messages }) => {
      const name = (messages[0]!.content as any[])[0].file.filename as string
      batches.push(name)
      const text = name.includes('pages 1-8')
        ? 'المادة 1\nتسري أحكام هذا القانون على المعاملات المدنية في سلطنة عمان.\n\nالمادة 2\nالعقد شريعة المتعاقدين فلا يجوز نقضه ولا تعديله إلا باتفاق الطرفين أو للأسباب التي يقررها القانون.'
        : 'المادة 3\nيلتزم المتعاقد بتنفيذ العقد طبقا لما اشتمل عليه وبطريقة تتفق مع ما يوجبه حسن النية.'
      return { text, model: 'test-model', promptTokens: 10, completionTokens: 20 }
    }
    try {
      await c.post('/api/library/imports', { jurisdiction: 'oman', items: [item] })
      await ctx.runImports()
    } finally {
      ctx.ai.complete = original
    }
    expect(batches).toEqual(['abc123.pdf (pages 1-8)', 'abc123.pdf (pages 9-10)'])
    const redone = (await c.get('/api/library/imports')).data.items.find((i: any) => i.id !== thin.id)
    expect(redone).toMatchObject({ status: 'done', detail: 'Replaced the earlier title-only copy; Read with OCR' })
    expect((await c.get(`/api/library/sources/${thin.source_id}`)).status).toBe(404)
    const src = await c.get(`/api/library/sources/${redone.source_id}`)
    expect(src.data.source).toMatchObject({ title: 'مرسوم سلطاني رقم 29 / 2013 بإصدار قانون المعاملات المدنية', number: '29/2013', file_name: 'abc123.pdf' })
    expect(src.data.chunks.map((x: any) => x.label).filter(Boolean)).toEqual(['المادة 1', 'المادة 2', 'المادة 3'])
    expect(JSON.stringify(src.data.chunks)).not.toContain('QGRh')
  })

  it('reads blog-style law sites such as qanoon.om: posts only, no sidebars or archive links', async () => {
    const { c } = await registered(ctx.app)
    const Q = 'https://qanoon.om'
    const cat = `${Q}/p/category/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D9%85%D8%B9%D8%AF%D9%84/`
    const post = (slug: string, title: string) => `<article><h2><a href="${Q}/p/${slug}/">${title}</a></h2><p>نص مختصر</p>
      <a href="${Q}/p/${slug}/">متابعة القراءة “${title}”</a> <a href="${Q}/p/category/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D9%85%D8%B9%D8%AF%D9%84/">قانون معدل</a> <a href="${Q}/p/author/admin/">كاتب المقالة بواسطة admin</a></article>`
    const aside = `<aside><h3>أحدث المقالات</h3><ul><li><a href="${Q}/p/2026/og1667/">الجريدة الرسمية العدد ١٦٦٧</a></li></ul></aside>`
    ctx.web.pages.set(cat, { body: `<html><body><header><a href="${Q}/">Qanoon.om</a></header><main>${post('1997/rd1997032', 'قانون الأحوال الشخصية (معدل)')}${post('2023/rd2023053', 'قانون العمل (معدل)')}
      <a href="${cat}page/2/">الصفحة التالية</a></main>${aside}</body></html>` })
    ctx.web.pages.set(`${cat}page/2/`, { body: `<html><body><main>${post('2018/rd2018007', 'قانون الجزاء (معدل)')}</main>${aside}</body></html>` })
    ctx.web.pages.set(`${cat}page/3/`, { status: 404, body: 'not found' })
    const found = await c.post('/api/library/imports/discover', { url: cat, pages: 5 })
    expect(found.status).toBe(200)
    expect(found.data.links.map((l: any) => l.url)).toEqual([`${Q}/p/1997/rd1997032/`, `${Q}/p/2023/rd2023053/`, `${Q}/p/2018/rd2018007/`])
    expect(found.data.links[0].text).toContain('قانون الأحوال الشخصية')

    // A consolidated law page: articles numbered with Arabic-Indic digits.
    ctx.web.pages.set(`${Q}/p/1997/rd1997032/`, { body: `<html><head><title>قانون الأحوال الشخصية – Qanoon.om</title></head><body>${aside}<main><article><h1>مرسوم سلطاني رقم ٣٢ / ٩٧ بإصدار قانون الأحوال الشخصية</h1>
      <p>مادة (١)</p><p>الخطبة طلب التزوج والوعد به.</p><p>مادة (٢)</p><p>تمنع خطبة المرأة المحرمة ولو كان التحريم مؤقتا ويجوز التعريض بخطبة معتدة الوفاة.</p>
      <p>مادة (٣)</p><p>لكل من الخاطبين العدول عن الخطبة.</p></article></main></body></html>` })
    await c.post('/api/library/imports', { jurisdiction: 'oman', items: [{ url: `${Q}/p/1997/rd1997032/`, title: found.data.links[0].text }] })
    await ctx.runImports()
    const item = (await c.get('/api/library/imports')).data.items[0]
    expect(item.status).toBe('done')
    const src = await c.get(`/api/library/sources/${item.source_id}`)
    expect(src.data.chunks.map((x: any) => x.label).filter(Boolean)).toEqual(['مادة (١)', 'مادة (٢)', 'مادة (٣)'])
    expect(JSON.stringify(src.data.chunks)).not.toContain('الجريدة الرسمية العدد')
  })

  it('resolves relative links against <base href> and refuses to store unreadable PDF text', async () => {
    const { c } = await registered(ctx.app)
    ctx.web.pages.set(`${BASE}/legislation/list`, { body: `<html><head><base href="${BASE}/"></head><body><main>
      <a href="laws/ar/1/show/36">مرسوم سلطاني رقم 32 / 97 بإصدار قانون الأحوال الشخصية</a></main></body></html>` })
    const found = await c.post('/api/library/imports/discover', { url: `${BASE}/legislation/list` })
    expect(found.data.links.map((l: any) => l.url)).toEqual([`${BASE}/laws/ar/1/show/36`])

    // A legacy-encoded PDF whose OCR fails is reported, not stored as gibberish.
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage()
    for (let line = 0; line < 8; line++) page.drawText('á`«fƒfÉdG ¿hDƒ`°ûdGh ó`©dG IQGRh …QGRh QGô`b º``bQ ºbQ …QGRƒdG', { x: 20, y: 700 - line * 20, size: 10, font })
    ctx.web.pages.set(`${BASE}/files/old.pdf`, { type: 'application/pdf', body: await pdf.save() })
    const original = ctx.ai.complete
    ctx.ai.complete = async () => { throw new Error('model unavailable') }
    try {
      await c.post('/api/library/imports', { jurisdiction: 'oman', items: [{ url: `${BASE}/files/old.pdf` }] })
      await ctx.runImports()
    } finally {
      ctx.ai.complete = original
    }
    const item = (await c.get('/api/library/imports')).data.items[0]
    expect(item.status).toBe('failed')
    expect(item.detail).toMatch(/old font encoding/)
  })

  it('lets the assistant find a law named by number, in Arabic-Indic or Latin digits, whatever the chat jurisdiction', async () => {
    const { c } = await registered(ctx.app)
    const Q = 'https://qanoon.om'
    const law = (title: string, body: string) => `<html><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`
    ctx.web.pages.set(`${Q}/p/2009/rd2009048/`, { body: law('مرسوم سلطاني رقم ٤٨ / ٢٠٠٩ بإصدار قانون تنظيم الأرشيف الوطني',
      '<p>مادة (١)</p><p>تسري أحكام هذا القانون على الوثائق والمحفوظات العامة لدى وحدات الجهاز الإداري للدولة.</p><p>مادة (٢)</p><p>تنشأ هيئة عامة تسمى هيئة الوثائق والمحفوظات الوطنية تتمتع بالشخصية الاعتبارية.</p>') })
    // Other laws that mention royal decrees, years and numbers everywhere.
    for (let i = 1; i <= 4; i++) {
      ctx.web.pages.set(`${Q}/p/2010/rd201000${i}/`, { body: law(`مرسوم سلطاني رقم ${i} / 2010 بتعديل بعض أحكام قانون ${i}`,
        `<p>مادة (١)</p><p>يستبدل بنص المادة الأولى من المرسوم السلطاني رقم ${i}٨ / ٢٠٠٩ والمرسوم السلطاني رقم ٤٨٠ / ٢٠٠٨ النص الآتي في سنة ٢٠٠٩ رقم ٤٨.</p>`) })
    }
    await c.post('/api/library/imports', { jurisdiction: 'oman', items: [`${Q}/p/2009/rd2009048/`, ...[1, 2, 3, 4].map((i) => `${Q}/p/2010/rd201000${i}/`)].map((url) => ({ url })) })
    await ctx.runImports()
    const lawItem = (await c.get('/api/library/imports')).data.items.find((i: any) => i.url === `${Q}/p/2009/rd2009048/`)
    expect(lawItem.status).toBe('done')
    const src = await c.get(`/api/library/sources/${lawItem.source_id}`)
    expect(src.data.source).toMatchObject({ number: '48/2009', year: 2009, kind: 'royal_decree' })

    for (const message of ['لخص المرسوم السلطاني رقم ٤٨ / ٢٠٠٩', 'Summarise Royal Decree 48/2009', 'ما هو القانون رقم 48 لسنة 2009؟']) {
      ctx.ai.calls.length = 0
      // A UAE conversation still finds the Omani decree it names.
      const res = await c.post('/api/ai/chat', { message, jurisdiction: 'uae' })
      expect(res.status).toBe(200)
      const system = String(ctx.ai.calls[0]![0]!.content)
      expect(system, message).toContain('هيئة الوثائق والمحفوظات الوطنية')
    }
    // In an Oman conversation the named decree still comes before other matches.
    ctx.ai.calls.length = 0
    await c.post('/api/ai/chat', { message: 'لخص المرسوم السلطاني رقم ٤٨ / ٢٠٠٩', jurisdiction: 'oman' })
    const omanSystem = String(ctx.ai.calls[0]![0]!.content)
    expect(omanSystem).toContain('بتعديل بعض أحكام')
    expect(omanSystem.indexOf('تنظيم الأرشيف الوطني')).toBeLessThan(omanSystem.indexOf('بتعديل بعض أحكام'))
  })

  it('reports unreachable or empty pages clearly and keeps firms separate', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    ctx.web.pages.set(`${BASE}/empty`, { body: '<html><body><main><h1>صفحة</h1></main></body></html>' })
    await a.c.post('/api/library/imports', { jurisdiction: 'oman', items: [{ url: `${BASE}/empty` }, { url: `${BASE}/missing` }] })
    await ctx.runImports()
    const items = (await a.c.get('/api/library/imports')).data.items
    expect(items.find((i: any) => i.url === `${BASE}/empty`).detail).toMatch(/No law text/)
    expect(items.find((i: any) => i.url === `${BASE}/missing`).detail).toMatch(/HTTP 404/)
    expect((await b.c.get('/api/library/imports')).data.items).toHaveLength(0)

    const bad = await a.c.post('/api/library/imports/discover', { url: 'https://example.com/laws' })
    expect(bad.status).toBe(400)
    // Only platform admins may import into the shared library.
    expect((await a.c.post('/api/library/imports', { jurisdiction: 'oman', scope: 'platform', items: [{ url: `${BASE}/law/101` }] })).status).toBe(403)
  })
})
