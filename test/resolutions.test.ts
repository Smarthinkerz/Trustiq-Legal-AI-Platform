import { beforeAll, describe, expect, it } from 'vitest'
import { buildItems, missingParams, preamble, renderResolutionDocx } from '../src/services/resolutions'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const gulfDay = (days: number) => new Date(Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })) + days * 86_400_000).toISOString().slice(0, 10)

describe('corporate resolutions', () => {
  it('builds bilingual wording from the purpose', () => {
    expect(missingParams('appoint_manager', {})).toEqual(['person_name'])
    expect(missingParams('open_bank_account', { bank: 'Bank Muscat' })).toEqual(['person_name'])
    const items = buildItems('appoint_manager', { person_name: 'Omar Al Balushi', person_name_ar: 'عمر البلوشي', nationality: 'Omani', authority: 'sign alone up to OMR 50,000' },
      { implementer: { name: 'Salim Al Harthy', name_ar: 'سالم الحارثي' } })
    expect(items[0]!.en).toBe('To appoint Omar Al Balushi, Omani national, as manager of the company, with the following authority: sign alone up to OMR 50,000.')
    expect(items[0]!.ar).toContain('تعيين عمر البلوشي')
    expect(items[1]!.ar).toContain('تفويض سالم الحارثي باتخاذ جميع الإجراءات')
    const pre = preamble({ body: 'shareholders', company: 'Al Noor Trading LLC', companyAr: 'شركة النور للتجارة', legalForm: 'llc', cr: '1234567', place: 'Muscat', date: '2026-10-15', percent: 100, owner: null })
    expect(pre.en).toBe('The shareholders of Al Noor Trading LLC, a limited liability company, commercial registration no. 1234567, holding together 100% of the share capital, met at Muscat on 15/10/2026 and resolved as follows:')
    expect(pre.ar).toContain('المقيدة في السجل التجاري برقم 1234567')
  })

  it('drafts, numbers, signs and applies resolutions to the company record', async () => {
    const { c: owner } = await registered(ctx.app)
    const co = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Trading LLC', name_ar: 'شركة النور للتجارة' })).data.client
    // No shareholders yet: nothing to sign with.
    expect((await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'change_address', resolved_on: gulfDay(0), params: { address: 'Muscat' } })).status).toBe(400)

    await owner.put(`/api/corporate/client/${co.id}`, { legal_form: 'llc', cr_number: '1234567', total_shares: '1000', registered_address: 'Ruwi' })
    const salim = (await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Salim Al Harthy', name_ar: 'سالم الحارثي', role: 'shareholder', shares: '700' })).data.person
    const gulf = (await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Gulf Holding SAOC', role: 'shareholder', is_entity: true, shares: '300' })).data.person
    const oldMgr = (await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Khalid', role: 'manager' })).data.person

    expect((await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'appoint_manager', resolved_on: gulfDay(0), params: {} })).status).toBe(400)
    const r1 = await owner.post(`/api/resolutions/client/${co.id}`, {
      purpose: 'appoint_manager', resolved_on: gulfDay(-1), place: 'Muscat',
      params: { person_name: 'Omar Al Balushi', nationality: 'Omani', id_number: '9876543', authority: 'Sign alone up to OMR 50,000', implementer_id: salim.id }
    })
    expect(r1.status).toBe(201)
    expect(r1.data.resolution).toMatchObject({ number: 1, status: 'draft', percent_present: 100 })
    expect(r1.data.resolution.signers.map((s: any) => s.name)).toEqual(['Salim Al Harthy', 'Gulf Holding SAOC'])
    expect(r1.data.resolution.items).toHaveLength(2)

    // Only the majority shareholder signs the second one: 70% present.
    const r2 = await owner.post(`/api/resolutions/client/${co.id}`, {
      purpose: 'remove_manager', resolved_on: gulfDay(0), params: { remove_person_id: oldMgr.id, effective_on: gulfDay(0) }, signer_ids: [salim.id]
    })
    expect(r2.data.resolution).toMatchObject({ number: 2, percent_present: 70 })
    expect(r2.data.resolution.preamble.en).toContain('holding together 70% of the share capital')
    expect(r2.data.resolution.items[0].en).toBe(`To remove Khalid from the position of manager of the company with effect from ${gulfDay(0).split('-').reverse().join('/')}.`)
    expect((await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'remove_manager', resolved_on: gulfDay(0), params: { remove_person_id: gulf.id } })).status).toBe(400)

    // Wording can be edited while a draft.
    const edited = await owner.patch(`/api/resolutions/${r1.data.resolution.id}`, { items: [{ en: 'To appoint Omar Al Balushi as manager.', ar: 'تعيين عمر البلوشي مديراً.' }] })
    expect(edited.data.resolution.items).toEqual([{ en: 'To appoint Omar Al Balushi as manager.', ar: 'تعيين عمر البلوشي مديراً.' }])

    // Signing and applying writes the appointment into the company record.
    expect((await owner.post(`/api/resolutions/${r1.data.resolution.id}/sign`, { signed_on: gulfDay(3), apply: true })).status).toBe(400)
    expect((await owner.post(`/api/resolutions/${r1.data.resolution.id}/sign`, { signed_on: gulfDay(-2), apply: true })).status).toBe(400)
    const signed = await owner.post(`/api/resolutions/${r1.data.resolution.id}/sign`, { signed_on: gulfDay(0), apply: true })
    expect(signed.data.resolution).toMatchObject({ status: 'signed', signed_on: gulfDay(0) })
    expect(signed.data.resolution.applied_at).toBeTruthy()
    await owner.post(`/api/resolutions/${r2.data.resolution.id}/sign`, { signed_on: gulfDay(0), apply: true })
    const record = await owner.get(`/api/corporate/client/${co.id}`)
    const omar = record.data.people.find((p: any) => p.name === 'Omar Al Balushi')
    expect(omar).toMatchObject({ role: 'manager', nationality: 'Omani', signing_authority: 'Sign alone up to OMR 50,000', appointed_on: gulfDay(-1), notes: 'Resolution no. 1' })
    expect(record.data.people.find((p: any) => p.id === oldMgr.id).ceased_on).toBe(gulfDay(0))

    // A signed resolution is fixed; a lawyer cannot delete it.
    expect((await owner.patch(`/api/resolutions/${r1.data.resolution.id}`, { place: 'Sohar' })).status).toBe(409)
    expect((await owner.patch(`/api/resolutions/${r1.data.resolution.id}`, { notes: 'Original filed with the Ministry' })).status).toBe(200)
    expect((await owner.post(`/api/resolutions/${r1.data.resolution.id}/sign`, { signed_on: gulfDay(0) })).status).toBe(409)

    // Address change applied; a custom resolution with AI-drafted items.
    const r3 = (await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'change_address', resolved_on: gulfDay(0), params: { address: 'Al Khuwair, Muscat' } })).data.resolution
    await owner.post(`/api/resolutions/${r3.id}/sign`, { signed_on: gulfDay(0), apply: true })
    expect((await owner.get(`/api/corporate/client/${co.id}`)).data.profile.registered_address).toBe('Al Khuwair, Muscat')

    ctx.ai.nextReply = JSON.stringify({ items: [{ en: 'To increase the share capital to OMR [●].', ar: 'زيادة رأس مال الشركة إلى [●] ريال عماني.' }, { en: '', ar: '' }] })
    const ai = await owner.post(`/api/resolutions/client/${co.id}/ai`, { description: 'Increase the capital and amend the articles accordingly' })
    expect(ai.data.items).toEqual([{ en: 'To increase the share capital to OMR [●].', ar: 'زيادة رأس مال الشركة إلى [●] ريال عماني.' }])
    expect(ctx.ai.calls.at(-1)!.map((m: any) => m.content).join('\n')).toContain('Al Noor Trading LLC')
    expect((await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'other', resolved_on: gulfDay(0), params: {} })).status).toBe(400)
    const r4 = await owner.post(`/api/resolutions/client/${co.id}`, { purpose: 'other', resolved_on: gulfDay(0), params: {}, items: ai.data.items })
    expect(r4.data.resolution).toMatchObject({ number: 4, items: ai.data.items })
    // A resolution with [●] gaps cannot be signed.
    expect((await owner.post(`/api/resolutions/${r4.data.resolution.id}/sign`, { signed_on: gulfDay(0) })).status).toBe(422)

    // Figures the request did not give are replaced with [●].
    ctx.ai.nextReply = JSON.stringify({ items: [{ en: 'To increase the share capital to OMR 250,000 by issuing 50,000 new shares.', ar: '' }] })
    const guessed = await owner.post(`/api/resolutions/client/${co.id}/ai`, { description: 'Increase the capital to OMR 250,000' })
    expect(guessed.data).toMatchObject({ replaced: 1, items: [{ en: 'To increase the share capital to OMR 250,000 by issuing [●] new shares.' }] })

    const list = await owner.get(`/api/resolutions/client/${co.id}`)
    expect(list.data.items.map((r: any) => r.number)).toEqual([4, 3, 2, 1])
    expect(list.data.managers.map((m: any) => m.name)).toEqual(['Omar Al Balushi'])

    const docx = await owner.get(`/api/resolutions/${r1.data.resolution.id}/docx`)
    expect(docx.status).toBe(200)
    expect(docx.res.headers.get('content-type')).toContain('wordprocessingml')

    // Board resolutions need directors; other firms cannot see any of it.
    expect((await owner.post(`/api/resolutions/client/${co.id}`, { body: 'board', purpose: 'change_address', resolved_on: gulfDay(0), params: { address: 'Sohar' } })).status).toBe(400)
    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/resolutions/client/${co.id}`)).status).toBe(404)
    expect((await other.c.get(`/api/resolutions/${r1.data.resolution.id}/docx`)).status).toBe(404)
    expect((await other.c.del(`/api/resolutions/${r4.data.resolution.id}`)).status).toBe(404)
    expect((await client(ctx.app).get(`/api/resolutions/client/${co.id}`)).status).toBe(401)
    expect((await owner.del(`/api/resolutions/${r4.data.resolution.id}`)).status).toBe(200)
  })

  it('prints a bilingual resolution with signature blocks', async () => {
    const buf = await renderResolutionDocx({
      firmName: 'Firm', letterhead: null, number: 7, body: 'shareholders', company: 'Co',
      preamble: { en: 'The shareholders of Co met.', ar: 'اجتمع الشركاء.' }, items: [{ en: 'To approve.', ar: 'الموافقة.' }],
      signers: [{ id: 'a', name: 'A', name_ar: null, role: 'Shareholder / شريك', percent: 60 }, { id: 'b', name: 'B', name_ar: null, role: 'Shareholder / شريك', percent: 40 }]
    })
    const JSZip = (await import('jszip')).default
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')
    expect(xml).toContain('Resolution of the shareholders No. 7')
    expect(xml).toContain('قرار الشركاء رقم 7')
    expect(xml).toContain('1. To approve.')
    expect(xml).toContain('Shareholder / شريك (60%)')
  })
})
