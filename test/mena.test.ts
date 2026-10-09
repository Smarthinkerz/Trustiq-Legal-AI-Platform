import { beforeAll, describe, expect, it } from 'vitest'
import { calculateDeadline } from '../src/services/deadlines'
import { allowedUrl, DEFAULT_IMPORT_DOMAINS } from '../src/services/library-import'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const MENA = ['egypt', 'jordan', 'lebanon', 'iraq', 'morocco', 'tunisia', 'algeria', 'libya']

describe('Middle East and North Africa jurisdictions', () => {
  it('lists the wider Arab region with currencies and Arabic names', async () => {
    const { c } = await registered(ctx.app)
    const ref = (await c.get('/api/reference')).data
    const codes = ref.jurisdictions.map((j: any) => j.code)
    for (const code of MENA) expect(codes).toContain(code)
    expect(ref.jurisdictions.find((j: any) => j.code === 'egypt')).toMatchObject({ currency: 'EGP', name_ar: 'جمهورية مصر العربية', region: 'mena' })
    for (const cur of ['EGP', 'JOD', 'IQD', 'MAD', 'TND', 'DZD', 'LYD', 'LBP']) expect(ref.currencies).toContain(cur)
  })

  it('firms in Egypt or Jordan get their VAT, currency precision and cases', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.patch('/api/org', { default_jurisdiction: 'egypt', default_currency: 'EGP' })).status).toBe(200)
    expect((await c.get('/api/billing/settings')).data.settings.effective_vat_rate).toBe(14)
    await c.patch('/api/org', { default_jurisdiction: 'jordan', default_currency: 'JOD' })
    expect((await c.get('/api/billing/settings')).data.settings.effective_vat_rate).toBe(16)
    const k = await c.post('/api/cases', { title: 'Amman commercial dispute', jurisdiction: 'jordan', currency: 'JOD', estimated_value: 1250.125 })
    expect(k.status).toBe(201)
    expect(k.data.case).toMatchObject({ jurisdiction: 'jordan', currency: 'JOD' })
  })

  it('counts deadlines on each country\'s weekend', () => {
    // Friday 6 Nov 2026: a weekend day in Egypt, a working day in Morocco.
    expect(calculateDeadline({ start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'egypt' }).due).toBe('2026-11-08')
    expect(calculateDeadline({ start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'morocco' }).due).toBe('2026-11-06')
    // Saturday 7 Nov: weekend in Lebanon and Tunisia → Monday 9 Nov.
    expect(calculateDeadline({ start: '2026-10-08', amount: 30, unit: 'days', jurisdiction: 'lebanon' }).due).toBe('2026-11-09')
  })

  it('imports from Arab government legislation sites', () => {
    for (const url of ['https://www.lob.gov.jo/AR/Pages/AdvancedSearch.aspx', 'https://www.sgg.gov.ma/arabe/Legislations.aspx', 'https://www.joradp.dz/HAR/Index.htm', 'https://www.iort.gov.tn/'])
      expect(allowedUrl(url, DEFAULT_IMPORT_DOMAINS), url).not.toBeNull()
    expect(allowedUrl('https://joradp.dz.evil.com/x', DEFAULT_IMPORT_DOMAINS)).toBeNull()
  })

  it('the assistant searches local law for Arab jurisdictions without mixing in GCC-only instruments', async () => {
    const { c } = await registered(ctx.app)
    const add = async (jurisdiction: string, title: string, text: string) => {
      const form = new FormData()
      form.set('file', new File([text], 'law.txt', { type: 'text/plain' }))
      form.set('title', title); form.set('jurisdiction', jurisdiction); form.set('kind', 'law')
      const r = await c.raw('POST', '/api/library/sources', form)
      expect(r.status).toBe(201)
    }
    await add('egypt', 'القانون المدني المصري', 'المادة 147\nالعقد شريعة المتعاقدين فلا يجوز نقضه ولا تعديله إلا باتفاق الطرفين.')
    await add('gcc', 'قانون خليجي موحد', 'المادة 1\nالعقد شريعة المتعاقدين في دول المجلس وفق القانون الموحد.')
    ctx.ai.calls.length = 0
    await c.post('/api/ai/chat', { message: 'هل العقد شريعة المتعاقدين؟', jurisdiction: 'egypt' })
    const system = String(ctx.ai.calls[0]![0]!.content)
    expect(system).toContain('القانون المدني المصري')
    expect(system).not.toContain('قانون خليجي موحد')
    ctx.ai.calls.length = 0
    await c.post('/api/ai/chat', { message: 'هل العقد شريعة المتعاقدين؟', jurisdiction: 'oman' })
    expect(String(ctx.ai.calls[0]![0]!.content)).toContain('قانون خليجي موحد')
  })
})

describe('Hijri date preference', () => {
  it('is on automatically for Saudi firms and can be overridden per user', async () => {
    const { c } = await registered(ctx.app)
    let me = await c.get('/api/auth/me')
    expect(me.data.user.hijri_dates).toBe('auto')
    expect(me.data.user.show_hijri).toBe(false)
    await c.patch('/api/org', { default_jurisdiction: 'ksa' })
    me = await c.get('/api/auth/me')
    expect(me.data.user.show_hijri).toBe(true)
    const off = await c.patch('/api/auth/me', { hijri_dates: 'off' })
    expect(off.data.user.show_hijri).toBe(false)
    await c.patch('/api/org', { default_jurisdiction: 'oman' })
    const on = await c.patch('/api/auth/me', { hijri_dates: 'on' })
    expect(on.data.user.show_hijri).toBe(true)
    expect((await c.patch('/api/auth/me', { hijri_dates: 'sometimes' })).status).toBe(400)
  })
})
