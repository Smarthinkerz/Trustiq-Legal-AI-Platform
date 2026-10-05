import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const lastSystem = () => String(ctx.ai.calls.at(-1)![0]!.content)
const lastUser = () => String(ctx.ai.calls.at(-1)!.at(-1)!.content)

describe('Arab court pleadings', () => {
  it('offers pleading templates in Arabic and English', async () => {
    const { c } = await registered(ctx.app)
    const templates = (await c.get('/api/reference')).data.templates
    for (const id of ['appeal', 'cassation', 'defence_memo', 'payment_order', 'labour_complaint', 'fee_agreement']) {
      const tpl = templates.find((x: any) => x.id === id)
      expect(tpl, id).toBeTruthy()
      expect(tpl.name_ar.length).toBeGreaterThan(3)
    }
  })

  it('addresses appeals and cassation petitions to the right court for each country', async () => {
    const { c } = await registered(ctx.app)
    const cases: [string, string, string][] = [
      ['appeal', 'oman', 'محكمة الاستئناف'],
      ['cassation', 'tunisia', 'محكمة التعقيب'],
      ['cassation', 'jordan', 'محكمة التمييز'],
      ['cassation', 'egypt', 'محكمة النقض'],
      ['statement_of_claim', 'iraq', 'محكمة البداءة'],
      ['appeal', 'algeria', 'المجلس القضائي']
    ]
    for (const [template, jurisdiction, court] of cases) {
      ctx.ai.nextReply = 'صحيفة'
      const r = await c.post('/api/ai/draft', { template, jurisdiction, language: 'ar', instructions: 'استئناف حكم صادر برفض دعوى مطالبة مالية بمبلغ عشرة آلاف.' })
      expect(r.status, `${template}/${jurisdiction}`).toBe(201)
      expect(lastSystem(), `${template}/${jurisdiction}`).toContain(court)
      expect(lastSystem()).toContain('الطلبات')
    }
    // Agreements keep contract structure, not court formatting.
    ctx.ai.nextReply = 'AGREEMENT'
    await c.post('/api/ai/draft', { template: 'fee_agreement', jurisdiction: 'oman', instructions: 'Fixed fee of OMR 2,000 for a commercial claim.' })
    expect(lastSystem()).toContain('governing law')
    expect(lastSystem()).not.toContain('Address it to')
  })

  it('cites only articles from the firm library, and uses placeholders otherwise', async () => {
    const { c } = await registered(ctx.app)
    ctx.ai.nextReply = 'صحيفة'
    await c.post('/api/ai/draft', { template: 'statement_of_claim', jurisdiction: 'oman', language: 'ar', instructions: 'مطالبة بتعويض عن الإخلال بعقد توريد.' })
    expect(lastSystem()).toContain('Do not invent article numbers')
    expect(lastUser()).not.toContain('<sources>')

    const form = new FormData()
    form.set('file', new File(['المادة 176\nكل إضرار بالغير يلزم فاعله ولو كان غير مميز بالتعويض.'], 'law.txt', { type: 'text/plain' }))
    form.set('title', 'قانون المعاملات المدنية'); form.set('jurisdiction', 'oman'); form.set('number', '29/2013')
    expect((await c.raw('POST', '/api/library/sources', form)).status).toBe(201)
    ctx.ai.nextReply = 'صحيفة'
    await c.post('/api/ai/draft', { template: 'statement_of_claim', jurisdiction: 'oman', language: 'ar', instructions: 'مطالبة بالتعويض عن الإضرار بالغير وفق قانون المعاملات المدنية رقم 29/2013.' })
    expect(lastSystem()).toContain('Do not cite any article that is not in the sources')
    expect(lastUser()).toContain('<sources>')
    expect(lastUser()).toContain('كل إضرار بالغير يلزم فاعله')
  })
})
