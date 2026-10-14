import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderReceiptDocx } from '../src/services/originals'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const docxText = async (buf: Buffer | ArrayBuffer) => {
  const zip = await JSZip.loadAsync(buf)
  return (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '')
}

describe('originals register', () => {
  it('takes originals in with numbered receipts, tracks every movement and hands them back', async () => {
    const { c } = await registered(ctx.app)
    const { data: { client } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', name_ar: 'الخليج للتجارة' })
    const { data: { case: k } } = await c.post('/api/cases', { title: 'Bounced cheques', jurisdiction: 'uae', currency: 'AED', client_id: client.id })

    const r = await c.post('/api/originals', {
      client_id: client.id, case_id: k.id, received_on: '2026-10-01', received_from: 'Mr. Ahmed (finance manager)', location: 'Safe A',
      items: [
        { kind: 'cheque', description: 'Cheque drawn on Emirates NBD', reference_no: '000123', amount: 50000 },
        { kind: 'contract', description: 'Original supply agreement', copies: 2 }
      ]
    })
    expect(r.status).toBe(201)
    const [cheque, contract] = r.data.items
    expect(cheque).toMatchObject({ receipt: 'OR-00001', status: 'held', currency: 'AED', amount: 50000, location: 'Safe A' })
    expect(contract).toMatchObject({ receipt: 'OR-00002', amount: null, currency: null, copies: 2 })
    expect(cheque.movements.map((m: any) => m.action)).toEqual(['received'])

    // One bilingual receipt for both.
    const receipt = await c.get(`/api/originals/receipt?ids=${cheque.id},${contract.id}`)
    expect(receipt.status).toBe(200)
    expect(receipt.res.headers.get('content-type')).toContain('wordprocessingml')
    expect(receipt.res.headers.get('content-disposition')).toContain('receipt-OR-00001.docx')
    const text = await docxText(await renderReceiptDocx({
      type: 'receipt', firmName: 'Al Noor Advocates', firmNameAr: 'النور للمحاماة', letterhead: null, clientName: 'Gulf Trading LLC', clientNameAr: 'الخليج للتجارة',
      party: cheque.received_from, date: cheque.received_on, reference: k.reference, caseTitle: k.title, items: [cheque, contract]
    }))
    for (const s of ['Receipt of original documents', 'إيصال استلام أصول', 'OR-00001', 'OR-00002', 'Mr. Ahmed (finance manager)', 'Cheque drawn on Emirates NBD', '50000.000 AED', k.reference, 'الخليج للتجارة']) {
      expect(text).toContain(s)
    }

    // The cheque goes to court with the claim and comes back.
    expect((await c.post(`/api/originals/${cheque.id}/move`, { action: 'retrieved', on_date: '2026-10-02' })).status).toBe(409)
    expect((await c.post(`/api/originals/${cheque.id}/move`, { action: 'lodged', on_date: '2026-10-02' })).status).toBe(400)
    const lodged = await c.post(`/api/originals/${cheque.id}/move`, { action: 'lodged', on_date: '2026-10-05', party: 'Dubai Courts – case 1234/2026' })
    expect(lodged.data.original).toMatchObject({ status: 'lodged', lodged_with: 'Dubai Courts – case 1234/2026' })
    expect((await c.post(`/api/originals/${cheque.id}/move`, { action: 'moved', on_date: '2026-10-06', location: 'Safe B' })).status).toBe(409)
    const back = await c.post(`/api/originals/${cheque.id}/move`, { action: 'retrieved', on_date: '2026-10-20', location: 'Safe B', note: 'Returned by the court registry' })
    expect(back.data.original).toMatchObject({ status: 'held', lodged_with: null, location: 'Safe B' })
    expect((await c.post(`/api/originals/${contract.id}/move`, { action: 'returned', on_date: '2026-09-01', party: 'x' })).status).toBe(400)

    // Nothing to return while the matter is open; once it closes, both show up.
    expect((await c.get('/api/originals/register')).data.counts).toEqual({ held: 2, lodged: 0, to_return: 0 })
    await c.patch(`/api/cases/${k.id}`, { status: 'closed' })
    expect((await c.get('/api/originals/register?show=to_return')).data.items).toHaveLength(2)
    expect((await c.get('/api/dashboard')).data.counts.originals_to_return).toBe(2)

    expect((await c.get(`/api/originals/receipt?ids=${cheque.id}&type=return`)).status).toBe(400)
    const ret = await c.post('/api/originals/return', { ids: [cheque.id, contract.id], on_date: '2026-11-01', party: 'Mr. Ahmed' })
    expect(ret.data).toEqual({ returned: 2 })
    expect((await c.post(`/api/originals/${cheque.id}/move`, { action: 'moved', on_date: '2026-11-02', location: 'Safe A' })).status).toBe(409)
    const retRes = await c.get(`/api/originals/receipt?ids=${cheque.id},${contract.id}&type=return`)
    expect(retRes.status).toBe(200)
    const retText = await docxText(await renderReceiptDocx({
      type: 'return', firmName: 'Al Noor Advocates', firmNameAr: null, letterhead: null, clientName: 'Gulf Trading LLC', clientNameAr: null,
      party: 'Mr. Ahmed', date: '2026-11-01', reference: null, caseTitle: null, items: [cheque]
    }))
    expect(retText).toContain('إيصال تسليم أصول')
    expect(retText).toContain('has today returned the original documents listed below to Mr. Ahmed')
    expect((await c.get('/api/dashboard')).data.counts.originals_to_return).toBe(0)

    const list = (await c.get(`/api/originals?client_id=${client.id}`)).data.items
    expect(list.find((o: any) => o.id === cheque.id).movements.map((m: any) => m.action)).toEqual(['received', 'lodged', 'retrieved', 'returned'])
    expect((await c.get('/api/originals/register?show=all&format=csv')).res.headers.get('content-type')).toContain('text/csv')
  })

  it('numbers receipts per firm and keeps clients and matters apart', async () => {
    const a = await registered(ctx.app)
    const b = await registered(ctx.app)
    const { data: { client: ca } } = await a.c.post('/api/clients', { name: 'Client A' })
    const { data: { client: cb } } = await b.c.post('/api/clients', { name: 'Client B' })
    const { data: { client: ca2 } } = await a.c.post('/api/clients', { name: 'Client A2' })
    const { data: { case: k2 } } = await a.c.post('/api/cases', { title: 'Other client matter', jurisdiction: 'oman', client_id: ca2.id })
    const item = { kind: 'title_deed', description: 'Title deed plot 12, Bausher' }

    const first = await b.c.post('/api/originals', { client_id: cb.id, received_on: '2026-10-01', items: [item] })
    expect(first.data.items[0].receipt).toBe('OR-00001')
    expect((await a.c.post('/api/originals', { client_id: ca.id, case_id: k2.id, received_on: '2026-10-01', items: [item] })).status).toBe(400)
    expect((await a.c.post('/api/originals', { client_id: cb.id, received_on: '2026-10-01', items: [item] })).status).toBe(404)
    const x = (await a.c.post('/api/originals', { client_id: ca.id, received_on: '2026-10-01', items: [item] })).data.items[0]
    const y = (await a.c.post('/api/originals', { client_id: ca2.id, received_on: '2026-10-01', items: [item] })).data.items[0]
    expect([x.receipt, y.receipt]).toEqual(['OR-00001', 'OR-00002'])
    expect((await a.c.get(`/api/originals/receipt?ids=${x.id},${y.id}`)).status).toBe(400)
    expect((await b.c.get(`/api/originals/receipt?ids=${x.id}`)).status).toBe(404)
    // A client without any open matter: its originals are due back.
    expect((await a.c.get('/api/originals/register')).data.counts.to_return).toBe(1)

    const edited = await a.c.patch(`/api/originals/${x.id}`, { amount: 1200, location: 'Safe C' })
    expect(edited.data.original).toMatchObject({ amount: 1200, currency: 'OMR', location: 'Safe C', description: 'Title deed plot 12, Bausher' })
    expect((await a.c.patch(`/api/originals/${x.id}`, { amount: '' })).data.original).toMatchObject({ amount: null, currency: null })
    expect((await a.c.del(`/api/originals/${x.id}`)).status).toBe(200)
  })
})
