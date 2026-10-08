import { unzipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { isSaudiVatNumber, parseZatcaTlv, zatcaTlv } from '../src/services/zatca'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('ZATCA QR encoding', () => {
  it('encodes the five phase 1 fields as TLV', () => {
    const tlv = zatcaTlv({ sellerName: 'مكتب المحاماة', vatNumber: '310122393500003', issuedAt: new Date('2026-10-08T09:30:15.123Z'), total: 1150, vat: 150 })
    expect(parseZatcaTlv(tlv)).toEqual({ 1: 'مكتب المحاماة', 2: '310122393500003', 3: '2026-10-08T09:30:15Z', 4: '1150.00', 5: '150.00' })
    // Over-long names are trimmed to fit the single-byte length.
    const long = parseZatcaTlv(zatcaTlv({ sellerName: 'شركة'.repeat(100), vatNumber: '310122393500003', issuedAt: new Date(), total: 1, vat: 0 }))
    expect(Buffer.byteLength(long[1])).toBeLessThanOrEqual(255)
    expect(long[2]).toBe('310122393500003')
    expect(isSaudiVatNumber('310122393500003')).toBe(true)
    expect(isSaudiVatNumber('300000000000001')).toBe(false)
  })
})

describe('Saudi tax invoices', () => {
  it('adds the QR code to issued invoices and marks B2C invoices as simplified', async () => {
    const { c } = await registered(ctx.app)
    expect((await c.patch('/api/org', { default_jurisdiction: 'ksa', default_currency: 'SAR' })).status).toBe(200)
    const bad = await c.put('/api/billing/settings', { vat_rate: null, payment_terms_days: 30, vat_number: '123456789012345' })
    expect(bad.status).toBe(400)
    expect((await c.put('/api/billing/settings', { vat_rate: null, payment_terms_days: 30, vat_number: '3101 2239 3500 003' })).status).toBe(200)

    const person = await c.post('/api/clients', { name: 'Retail Client' })
    const company = await c.post('/api/clients', { name: 'Gulf Trading Co', kind: 'company', vat_number: '300000000000003' })
    expect(company.data.client.vat_number).toBe('300000000000003')

    const make = async (clientId: string) => {
      const inv = await c.post('/api/billing/invoices', { client_id: clientId, fixed_lines: [{ description: 'Consultation', unit_price: 1000 }] })
      expect(inv.status).toBe(201)
      return inv.data.invoice.id as string
    }
    const b2c = await make(person.data.client.id)
    const draft = await c.get(`/api/billing/invoices/${b2c}`)
    expect(draft.data.zatca).toBeNull()

    const issued = await c.post(`/api/billing/invoices/${b2c}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.data.zatca.simplified).toBe(true)
    expect(issued.data.zatca.qr).toMatch(/^data:image\/png;base64,/)
    const fields = parseZatcaTlv(issued.data.zatca.tlv)
    expect(fields[2]).toBe('310122393500003')
    expect(fields[4]).toBe('1150.00') // 15% Saudi VAT
    expect(fields[5]).toBe('150.00')
    expect(Date.parse(fields[3])).toBeGreaterThan(Date.now() - 60_000)

    const download = (id: string, q = '') => ctx.app.request(`/api/billing/invoices/${id}/export${q}`, { headers: { cookie: c.cookie } })
    const docx = await download(b2c, '?lang=ar')
    expect(docx.status).toBe(200)
    const files = unzipSync(new Uint8Array(await docx.arrayBuffer()))
    expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true)
    const xml = new TextDecoder().decode(files['word/document.xml'])
    expect(xml).toContain('Simplified Tax Invoice')

    const b2b = await make(company.data.client.id)
    const issuedB2b = await c.post(`/api/billing/invoices/${b2b}/issue`)
    expect(issuedB2b.data.zatca.simplified).toBe(false)
    const xml2 = new TextDecoder().decode(unzipSync(new Uint8Array(await (await download(b2b)).arrayBuffer()))['word/document.xml'])
    expect(xml2).not.toContain('Simplified')
    expect(xml2).toContain('300000000000003')
  })

  it('does not add a QR code outside Saudi Arabia', async () => {
    const { c } = await registered(ctx.app)
    await c.put('/api/billing/settings', { vat_rate: null, payment_terms_days: 30, vat_number: 'OM1100000000' })
    const cl = await c.post('/api/clients', { name: 'Muscat Client' })
    const inv = await c.post('/api/billing/invoices', { client_id: cl.data.client.id, fixed_lines: [{ description: 'Advice', unit_price: 100 }] })
    const issued = await c.post(`/api/billing/invoices/${inv.data.invoice.id}/issue`)
    expect(issued.data.zatca).toBeNull()
  })
})
