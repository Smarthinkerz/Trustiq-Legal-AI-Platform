import { beforeAll, describe, expect, it } from 'vitest'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('matter budgets and profitability', () => {
  it('tracks budget use, alerts at 80% and 100%, and reports billing and realization', async () => {
    const { c, email } = await registered(ctx.app)
    await c.put('/api/billing/settings', { vat_rate: null, payment_terms_days: 30, default_hourly_rate: 100 })
    const cl = await c.post('/api/clients', { name: 'Budget Client' })
    const k = await c.post('/api/cases', { title: 'Hourly matter', jurisdiction: 'oman', client_id: cl.data.client.id, fee_arrangement: 'hourly', budget_amount: 1000 })
    expect(k.data.case).toMatchObject({ fee_arrangement: 'hourly' })
    const id = k.data.case.id
    const log = (minutes: number) => c.post('/api/billing/time', { case_id: id, minutes, description: 'Drafting and research' })

    await log(420) // 7h × 100 = 700 (70%)
    let f = (await c.get(`/api/cases/${id}/financials`)).data.financials
    expect(f).toMatchObject({ recorded_value: 700, limit: 1000, used_pct: 70, budget_state: 'ok', hours: 7 })
    expect(ctx.mails.some((m) => m.to === email && m.subject.startsWith('Budget at 80%'))).toBe(false)

    await log(60) // 800 → 80%
    expect(ctx.mails.filter((m) => m.to === email && m.subject.startsWith('Budget at 80%'))).toHaveLength(1)
    await log(30) // 850: no second 80% email
    expect(ctx.mails.filter((m) => m.to === email && m.subject.startsWith('Budget at 80%'))).toHaveLength(1)
    await log(180) // 1150 → over
    expect(ctx.mails.some((m) => m.to === email && m.subject.startsWith('Over budget') && m.text.includes('115%'))).toBe(true)
    f = (await c.get(`/api/cases/${id}/financials`)).data.financials
    expect(f).toMatchObject({ budget_state: 'over', unbilled_time: 1150 })

    // Bill it at a discount: 11.5h worth 1150 invoiced as an agreed 920 plus a 50 expense.
    await c.post('/api/billing/expenses', { case_id: id, amount: 50, description: 'Court fee' })
    const unbilled = await c.get(`/api/billing/unbilled?client_id=${cl.data.client.id}`)
    const inv = await c.post('/api/billing/invoices', {
      client_id: cl.data.client.id, case_id: id, time_entry_ids: [], expense_ids: unbilled.data.expenses.map((x: any) => x.id),
      fixed_lines: [{ description: 'Agreed fee for the work to date', unit_price: 920 }]
    })
    await c.post(`/api/billing/invoices/${inv.data.invoice.id}/issue`)
    await c.post(`/api/billing/invoices/${inv.data.invoice.id}/payments`, { amount: 500 })
    f = (await c.get(`/api/cases/${id}/financials`)).data.financials
    // Fees billed 920 (970 net minus the 50 expense) against 1150 recorded = 80%.
    expect(f).toMatchObject({ invoiced_net: 970, collected: 500, realization_pct: 80, expenses: 50, unbilled_expenses: 0 })
    expect(f.outstanding).toBeCloseTo(970 * 1.05 - 500, 2)
    expect(f.effective_rate).toBe(80) // 920 / 11.5h

    // Raising the budget resets the alerts.
    await c.patch(`/api/cases/${id}`, { budget_amount: 5000 })
    expect((await c.get(`/api/cases/${id}/financials`)).data.financials).toMatchObject({ budget_state: 'ok', budget_alert_level: 0 })

    // Fixed fee: time beyond the fee is a write-down.
    const fixed = await c.post('/api/cases', { title: 'Fixed fee matter', jurisdiction: 'oman', fee_arrangement: 'fixed', fee_amount: 300 })
    await c.post('/api/billing/time', { case_id: fixed.data.case.id, minutes: 240, description: 'Contract drafting' })
    const ff = (await c.get(`/api/cases/${fixed.data.case.id}/financials`)).data.financials
    expect(ff).toMatchObject({ recorded_value: 400, limit: 300, fee_income: 300, write_down: 100, effective_rate: 75, budget_state: 'over' })

    const report = await c.get('/api/reports/matters')
    expect(report.status).toBe(200)
    expect(report.data.items.map((i: any) => i.reference)).toEqual([ff.reference, f.reference]) // most at risk first
    expect((await c.post('/api/cases', { title: 'Bad', jurisdiction: 'oman', fee_arrangement: 'success' })).status).toBe(400)

    const other = await registered(ctx.app)
    expect((await other.c.get(`/api/cases/${id}/financials`)).status).toBe(404)
    expect((await other.c.get('/api/reports/matters')).data.items).toHaveLength(0)
  })
})
