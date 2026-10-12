import { beforeAll, describe, expect, it } from 'vitest'
import { previousPeriod, toCsv } from '../src/services/practice-insights'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)

describe('partner analytics', () => {
  it('computes the previous period of the same length', () => {
    expect(previousPeriod('2026-04-01', '2026-04-30')).toEqual({ from: '2026-03-02', to: '2026-03-31' })
    expect(previousPeriod('2026-04-01', '2026-06-30')).toEqual({ from: '2025-12-31', to: '2026-03-31' })
    expect(previousPeriod('2026-10-01', '2026-10-01')).toEqual({ from: '2026-09-30', to: '2026-09-30' })
  })

  it('makes CSV safe for Excel: BOM, quoting and no formulas', () => {
    const csv = toCsv([['Name', 'Amount'], ['=HYPERLINK("x")', -5], ['محمد, "الكبير"', 1.5]])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-5`)
    expect(csv).toContain('"محمد, ""الكبير""",1.5')
  })

  it('reports the period against the previous one, with lockup, lawyers, clients and enquiries', async () => {
    const { c, me } = await registered(ctx.app)
    await c.put(`/api/billing/rates/${me.user.id}`, { hourly_rate: 100 })
    const big = await c.post('/api/clients', { name: 'Gulf Trading LLC', name_ar: 'شركة الخليج للتجارة' })
    const small = await c.post('/api/clients', { name: 'Small Client' })
    const k1 = await c.post('/api/cases', { title: 'Big matter', jurisdiction: 'oman', client_id: big.data.client.id })
    const k2 = await c.post('/api/cases', { title: 'Small matter', jurisdiction: 'oman', client_id: small.data.client.id })
    // This period: 10h billable + 2h non-billable; previous period: 5h billable.
    await c.post('/api/billing/time', { case_id: k1.data.case.id, minutes: 600, description: 'Drafting', work_date: daysAgo(10), rate: 100 })
    await c.post('/api/billing/time', { case_id: k1.data.case.id, minutes: 120, description: 'Admin', work_date: daysAgo(10), billable: false })
    await c.post('/api/billing/time', { case_id: k2.data.case.id, minutes: 300, description: 'Old work', work_date: daysAgo(120), rate: 100 })
    // Invoice the big matter's time (1000 + 5% VAT = 1050), part-paid 400.
    const unbilled = await c.get(`/api/billing/unbilled?client_id=${big.data.client.id}`)
    const inv = await c.post('/api/billing/invoices', { client_id: big.data.client.id, case_id: k1.data.case.id, time_entry_ids: unbilled.data.time.map((x: any) => x.id) })
    await c.post(`/api/billing/invoices/${inv.data.invoice.id}/issue`)
    await c.post(`/api/billing/invoices/${inv.data.invoice.id}/payments`, { amount: 400 })
    const inv2 = await c.post('/api/billing/invoices', { client_id: small.data.client.id, fixed_lines: [{ description: 'Advice', quantity: 1, unit_price: 100 }] })
    await c.post(`/api/billing/invoices/${inv2.data.invoice.id}/issue`)
    await c.post('/api/website/leads', { name: 'Lead A', email: 'a@example.com' })
    await c.post('/api/website/leads', { name: 'Lead B', email: 'b@example.com' })

    const r = await c.get(`/api/reports/insights?from=${daysAgo(89)}&to=${today()}`)
    expect(r.status).toBe(200)
    const d = r.data
    expect(d.currency).toBe('OMR')
    expect(d.kpis.current).toMatchObject({ minutes: 720, billable_minutes: 600, utilisation_pct: 83, recorded_value: 1000, invoiced: 1155, collected: 400, new_matters: 2, new_clients: 2, leads: 2, leads_converted: 0, conversion_pct: 0 })
    expect(d.kpis.previous).toMatchObject({ billable_minutes: 300, recorded_value: 500, invoiced: 0 })
    // Lockup: unbilled 5h (500) and debtors 1155 - 400 = 755.
    expect(d.lockup).toMatchObject({ wip: 500, debtors: 755 })
    expect(d.lockup.debtor_days).toBe(Math.round(755 / (1155 / 90)))
    expect(d.trend).toHaveLength(12)
    expect(d.trend.at(-1)).toMatchObject({ invoiced: 1155, collected: 400 })
    const lawyer = d.lawyers.find((l: any) => l.id === me.user.id)
    expect(lawyer).toMatchObject({ billable_minutes: 600, recorded_value: 1000, billed_value: 1000, realization_pct: 100, open_matters: 2 })
    expect(d.clients[0]).toMatchObject({ name: 'Gulf Trading LLC', invoiced: 1050, collected: 400, outstanding: 650, share_pct: 90.9 })
    expect(d.concentration).toMatchObject({ top1_pct: 90.9, top5_pct: 100, billed_clients: 2 })
    expect(d.leads.by_status.new).toBe(2)

    const csv = await ctx.app.request(`/api/reports/insights/export?section=clients&from=${daysAgo(89)}&to=${today()}`, { headers: { cookie: c.cookie } })
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text).toContain('Gulf Trading LLC,شركة الخليج للتجارة,1050,400,650,90.9,1')
    expect((await c.get(`/api/reports/insights?from=${today()}&to=${daysAgo(5)}`)).status).toBe(400)
  })

  it('keeps other currencies out of the totals and is for owners and admins only', async () => {
    const { c } = await registered(ctx.app)
    const cl = await c.post('/api/clients', { name: 'Dollar Client' })
    const inv = await c.post('/api/billing/invoices', { client_id: cl.data.client.id, currency: 'USD', fixed_lines: [{ description: 'Work', quantity: 1, unit_price: 1000 }] })
    await c.post(`/api/billing/invoices/${inv.data.invoice.id}/issue`)
    const d = (await c.get('/api/reports/insights')).data
    expect(d.kpis.current.invoiced).toBe(0)
    expect(d.other_currencies).toEqual(['USD'])

    const invite = await c.post('/api/org/invites', { email: `l-${crypto.randomUUID().slice(0, 6)}@firm.test`, role: 'lawyer' })
    const lawyer = client(ctx.app)
    await lawyer.post('/api/auth/accept-invite', { token: new URL(invite.data.invite_url.replace('#', '')).searchParams.get('token'), name: 'Lawyer', password: 'Str0ngPassw0rd' })
    expect((await lawyer.get('/api/reports/insights')).status).toBe(403)
    expect((await lawyer.post('/api/reports/insights/summary', {})).status).toBe(403)
  })

  it('writes an AI summary from the figures only', async () => {
    const { c } = await registered(ctx.app)
    ctx.ai.nextReply = JSON.stringify({ headline: 'تحسّن التحصيل', points: ['نقطة'], actions: ['إجراء'], extra: 1 })
    const r = await c.post('/api/reports/insights/summary', { language: 'ar' })
    expect(r.status).toBe(200)
    expect(r.data.summary).toEqual({ headline: 'تحسّن التحصيل', points: ['نقطة'], actions: ['إجراء'] })
    const [sys, user] = ctx.ai.calls.at(-1)!
    expect(sys!.content).toContain('Use ONLY the figures')
    expect(sys!.content).toContain('Arabic')
    expect(user!.content).toMatch(/^<data>\n\{"currency":"OMR"/)
    ctx.ai.nextReply = 'nonsense'
    expect((await c.post('/api/reports/insights/summary', {})).status).toBe(502)
  })
})
