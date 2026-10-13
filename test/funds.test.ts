import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

async function firm() {
  const r = await registered(ctx.app)
  const c = r.c
  const { data: { client: cl } } = await c.post('/api/clients', { name: 'Gulf Trading LLC', kind: 'company' })
  const { data: { case: k } } = await c.post('/api/cases', { title: 'Labour claim', jurisdiction: 'oman', client_id: cl.id })
  return { ...r, clientId: cl.id as string, caseId: k.id as string }
}

describe('client funds ledger', () => {
  it('records deposits and disbursements, refuses overdrafts and keeps a running balance', async () => {
    const { c, clientId, caseId } = await firm()
    const dep = await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'deposit', amount: 500, currency: 'OMR', description: 'Advance on fees and court costs', method: 'bank_transfer', reference: 'TRX-881', case_id: caseId })
    expect(dep.status).toBe(201)
    expect(dep.data.balance).toBe(500)
    const fee = await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'disbursement', amount: 120.5, currency: 'OMR', description: 'Court filing fee', case_id: caseId })
    expect(fee.data.balance).toBe(379.5)

    const over = await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'disbursement', amount: 400, currency: 'OMR', description: 'Expert fee' })
    expect(over.status).toBe(409)
    expect(over.data.error.message).toContain('379.500 OMR')
    // Each currency is its own balance.
    expect((await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'disbursement', amount: 1, currency: 'AED', description: 'Test entry' })).status).toBe(409)
    expect((await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'deposit', amount: 1, description: 'Test entry', entry_date: '2999-01-01' })).status).toBe(400)

    const view = (await c.get(`/api/funds/client/${clientId}`)).data
    expect(view.balances).toEqual([{ currency: 'OMR', balance: 379.5, received: 500, used: 120.5 }])
    expect(view.entries.map((e: any) => [e.kind, Number(e.delta)])).toEqual([['disbursement', -120.5], ['deposit', 500]])
    expect(view.entries[1]).toMatchObject({ receipt_no: expect.stringMatching(/^RV-\d{4}-0001$/), method: 'bank_transfer', case_reference: expect.any(String) })
    expect((await c.get(`/api/funds/case/${caseId}`)).data.balances).toEqual([{ currency: 'OMR', balance: 379.5 }])

    const receipt = await c.get(`/api/funds/entries/${view.entries[1].id}/receipt`)
    expect(receipt.status).toBe(200)
    expect((await c.get(`/api/funds/entries/${view.entries[0].id}/receipt`)).status).toBe(404)

    // Reversal corrects the disbursement but never deletes it; it cannot be reversed twice.
    const rev = await c.post(`/api/funds/entries/${view.entries[0].id}/reverse`, { reason: 'Fee was paid by the client directly' })
    expect(rev.data.balance).toBe(500)
    expect((await c.post(`/api/funds/entries/${view.entries[0].id}/reverse`, { reason: 'again' })).status).toBe(409)
    expect((await c.post(`/api/funds/entries/${rev.data.entry_id}/reverse`, { reason: 'undo' })).status).toBe(409)
    const after = (await c.get(`/api/funds/client/${clientId}`)).data.entries
    expect(after.find((e: any) => e.id === view.entries[0].id).reversed_by).toBe(rev.data.entry_id)

    // A deposit can't be reversed if the money has already been spent.
    await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'refund', amount: 450, currency: 'OMR', description: 'Refund of unused advance' })
    expect((await c.post(`/api/funds/entries/${view.entries[1].id}/reverse`, { reason: 'Entered twice' })).status).toBe(409)
  })

  it('pays an invoice from client funds and records the payment on the invoice', async () => {
    const { c, clientId } = await firm()
    await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'deposit', amount: 300, currency: 'OMR', description: 'Retainer' })
    const draft = await c.post('/api/billing/invoices', { client_id: clientId, currency: 'OMR', fixed_lines: [{ description: 'Advice', quantity: 1, unit_price: 200 }] })
    expect(draft.status).toBe(201)
    const inv = draft.data.invoice
    expect((await c.post(`/api/funds/client/${clientId}/apply`, { invoice_id: inv.id, amount: 50 })).status).toBe(409) // draft
    await c.post(`/api/billing/invoices/${inv.id}/issue`)
    const total = Number((await c.get(`/api/billing/invoices/${inv.id}`)).data.invoice.total)
    const open = (await c.get(`/api/funds/client/${clientId}`)).data.open_invoices
    expect(open).toMatchObject([{ id: inv.id }])
    expect((await c.post(`/api/funds/client/${clientId}/apply`, { invoice_id: inv.id, amount: total + 1 })).status).toBe(400)

    const paid = await c.post(`/api/funds/client/${clientId}/apply`, { invoice_id: inv.id, amount: total })
    expect(paid.status).toBe(201)
    expect(paid.data).toMatchObject({ invoice_status: 'paid', balance: 300 - total })
    const invoice = (await c.get(`/api/billing/invoices/${inv.id}`)).data
    expect(invoice.invoice).toMatchObject({ status: 'paid' })
    expect(invoice.payments.some((p: any) => p.method === 'client_funds')).toBe(true)
    const entries = (await c.get(`/api/funds/client/${clientId}`)).data.entries
    expect(entries[0]).toMatchObject({ kind: 'applied', invoice_number: invoice.invoice.number })
    expect((await c.post(`/api/funds/entries/${entries[0].id}/reverse`, { reason: 'wrong invoice' })).status).toBe(409)

    const report = (await c.get('/api/funds/report')).data
    expect(report.totals).toEqual({ OMR: 300 - total })
  })

  it('shows the client their statement in the portal and keeps firms and roles apart', async () => {
    const { c, clientId } = await firm()
    await c.post(`/api/funds/client/${clientId}/entries`, { kind: 'deposit', amount: 75, currency: 'OMR', description: 'Court fee deposit' })
    const email = `fund-${crypto.randomUUID().slice(0, 6)}@example.test`
    const inv = await c.post(`/api/clients/${clientId}/portal-invite`, { email })
    const token = new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token')!
    const portal = client(ctx.app)
    await portal.post('/api/auth/accept-invite', { token, name: 'Client Person', password: 'Str0ngPassw0rd' })
    const st = (await portal.get('/api/portal/funds')).data
    expect(st.balances).toEqual([{ currency: 'OMR', balance: 75, received: 75, used: 0 }])
    expect(st.entries[0]).toMatchObject({ kind: 'deposit', description: 'Court fee deposit' })
    expect(st.entries[0]).not.toHaveProperty('created_by_name')
    expect((await portal.get(`/api/funds/client/${clientId}`)).status).toBe(403)

    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/funds/client/${clientId}`)).status).toBe(404)
    expect((await other.c.post(`/api/funds/client/${clientId}/entries`, { kind: 'deposit', amount: 1, description: 'Test entry' })).status).toBe(404)
  })
})
