import { beforeAll, describe, expect, it } from 'vitest'
import { missingDetails, poaText, renderPoaDocx } from '../src/services/poa'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

async function docText(buf: ArrayBuffer | Buffer) {
  const JSZip = (await import('jszip')).default
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

describe('power of attorney drafts', () => {
  it('builds the wording with the special powers stated expressly', () => {
    expect(missingDetails('litigation_specific', {})).toEqual(['case_ref'])
    expect(missingDetails('litigation_general', {})).toEqual([])
    const paras = poaText({
      principal: { kind: 'company', name: 'Al Noor Trading LLC', name_ar: 'شركة النور للتجارة', id_number: '1234567', rep: { name: 'Omar', name_ar: 'عمر', role: 'manager', id_number: '99' } },
      agents: [{ name: 'Salim Al Harthy', name_ar: 'سالم الحارثي', bar_number: 'B-101' }, { name: 'Sara', name_ar: null, bar_number: null }],
      firm: 'Al Noor Advocates', firmAr: 'مكتب النور للمحاماة', scope: 'litigation_specific', detail: { case_ref: '123/2026', court: 'Primary Court, Muscat', opponent: 'Gulf Builders LLC' },
      special: ['settle', 'receive'], substitute: true, validUntil: '2027-12-31'
    })
    expect(paras[0]!.en).toBe('Al Noor Trading LLC, commercial registration no. 1234567, represented by Omar in their capacity as manager (ID no. 99) ("the principal") hereby appoints the advocates Salim Al Harthy (advocate registration no. B-101), Sara of Al Noor Advocates, jointly or severally, as its attorneys:')
    expect(paras[0]!.ar).toMatch(/^إن شركة النور للتجارة، .*ويمثلها عمر بصفته مديراً .*توكل بموجب هذا المحامين/)
    expect(paras[1]!.en).toContain('case no. 123/2026 before Primary Court, Muscat against Gulf Builders LLC')
    expect(paras[2]!.en).toBe('2. The attorneys are expressly authorised to: settle and conciliate; receive money, cheques and documents on the principal\'s behalf and give receipts.')
    expect(paras[2]!.ar).toBe('2. وللوكلاء صراحةً حق: الصلح، قبض المبالغ والشيكات والمستندات باسم الموكل والتوقيع بالاستلام.')
    expect(paras[3]!.ar).toBe('3. وللوكلاء حق توكيل الغير من المحامين في كل أو بعض ما ذُكر.')
    expect(paras.at(-1)!.en).toBe('This power of attorney is valid until 31/12/2027.')
    const single = poaText({ principal: { kind: 'individual', name: 'Ali', name_ar: null, id_number: null }, agents: [{ name: 'Salim', name_ar: null, bar_number: null }],
      firm: 'F', firmAr: 'F', scope: 'litigation_general', detail: {}, special: [], substitute: false, validUntil: null })
    expect(single.map((p) => p.en)).toEqual([
      'I, Ali ("the principal"), hereby appoint the advocate Salim of F as my attorney:',
      expect.stringContaining('1. To represent the principal before all courts'),
      '2. The attorney may not delegate these powers to anyone else.',
      '3. To sign all documents and take all steps needed for the above.',
      'This power of attorney remains valid until it is revoked.'
    ])
  })

  it('drafts from the client, the matter and the firm\'s advocates', async () => {
    const { c: owner, me } = await registered(ctx.app)
    const co = (await owner.post('/api/clients', { kind: 'company', name: 'Al Noor Trading LLC', name_ar: 'شركة النور للتجارة' })).data.client
    await owner.put(`/api/corporate/client/${co.id}`, { legal_form: 'llc', cr_number: '1234567' })
    const mgr = (await owner.post(`/api/corporate/client/${co.id}/people`, { name: 'Omar Al Balushi', name_ar: 'عمر البلوشي', role: 'manager', id_number: '99' })).data.person
    const k = (await owner.post('/api/cases', { title: 'Supply dispute', jurisdiction: 'oman', client_id: co.id, court: 'Primary Court, Muscat', opposing_party: 'Gulf Builders LLC' })).data.case

    const opts = await owner.get(`/api/poa/options?client_id=${co.id}&case_id=${k.id}`)
    expect(opts.data.client).toMatchObject({ kind: 'company', cr_number: '1234567' })
    expect(opts.data.representatives.map((r: any) => r.name)).toEqual(['Omar Al Balushi'])
    expect(opts.data.case).toMatchObject({ court: 'Primary Court, Muscat', opposing_party: 'Gulf Builders LLC' })
    expect(opts.data.lawyers.map((l: any) => l.id)).toEqual([me.user.id])

    expect((await owner.put(`/api/poa/lawyers/${me.user.id}`, { name_ar: 'سالم الحارثي', bar_number: 'B-101' })).data.lawyer).toMatchObject({ bar_number: 'B-101' })

    const base = `client_id=${co.id}&case_id=${k.id}&agents=${me.user.id}&representative_id=${mgr.id}`
    expect((await owner.get(`/api/poa/draft?${base}&scope=litigation_specific`)).status).toBe(400)
    expect((await owner.get(`/api/poa/draft?${base}&scope=litigation_general&special=fly`)).status).toBe(400)
    const res = await owner.get(`/api/poa/draft?${base}&scope=litigation_specific&case_ref=${encodeURIComponent('123/2026')}&court=${encodeURIComponent('Primary Court, Muscat')}&special=settle,receive&substitute=true`)
    expect(res.status).toBe(200)
    expect(res.res.headers.get('content-type')).toContain('wordprocessingml')
    const log = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'poa'`, [k.id])
    expect(log[0]!.body).toBe('Power of attorney draft prepared (litigation specific) naming Owner Person')

    // Only the firm's own advocates and the company's own representatives.
    const other = await registered(ctx.app)
    expect((await owner.get(`/api/poa/draft?client_id=${co.id}&agents=${other.me.user.id}&scope=litigation_general`)).status).toBe(400)
    expect((await owner.get(`/api/poa/draft?client_id=${co.id}&agents=${me.user.id}&scope=litigation_general&representative_id=${crypto.randomUUID()}`)).status).toBe(400)
    expect((await other.c.get(`/api/poa/options?client_id=${co.id}`)).status).toBe(404)
    expect((await other.c.put(`/api/poa/lawyers/${me.user.id}`, { bar_number: 'X' })).status).toBe(404)
    expect((await client(ctx.app).get(`/api/poa/options?client_id=${co.id}`)).status).toBe(401)
  })

  it('prints both languages with a box for the notary', async () => {
    const text = await docText(await renderPoaDocx({ firmName: 'F', letterhead: null, title: { en: 'Power of attorney (draft)', ar: 'وكالة (مسودة)' },
      paras: [{ en: 'I, Ali, hereby appoint', ar: 'أنا علي أوكل' }], signer: 'Ali' }))
    expect(text).toContain('Power of attorney (draft)')
    expect(text).toContain('وكالة (مسودة)')
    expect(text).toContain('For the notary public / خاص بالكاتب بالعدل')
  })
})
