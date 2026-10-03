import { beforeAll, describe, expect, it } from 'vitest'
import { allowedUrl, DEFAULT_IMPORT_DOMAINS, guessMeta, htmlToText, pageUrls } from '../src/services/library-import'
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
