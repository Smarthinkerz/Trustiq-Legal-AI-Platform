import type { Queryable } from '../db'

// Standard VAT / GST rates by jurisdiction. Firms can override the rate in billing settings.
// Qatar, Kuwait, Iraq and Libya have no general VAT; DIFC/ADGM follow UAE VAT; Jordan levies 16% general sales tax.
export const DEFAULT_VAT: Record<string, number> = {
  oman: 5, uae: 5, difc: 5, adgm: 5, ksa: 15, bahrain: 10, qatar: 0, kuwait: 0, gcc: 0,
  egypt: 14, jordan: 16, lebanon: 11, iraq: 0, morocco: 20, tunisia: 19, algeria: 19, libya: 0,
  international: 0
}

// ISO 4217 minor units: the Gulf dinars and the Omani rial use three decimals.
const MINOR_UNITS: Record<string, number> = { OMR: 3, KWD: 3, BHD: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3 }
export const decimalsFor = (currency: string) => MINOR_UNITS[currency] ?? 2

export function roundMoney(amount: number, currency: string) {
  const f = 10 ** decimalsFor(currency)
  return Math.round((amount + Number.EPSILON) * f) / f
}

export function timeAmount(minutes: number, rate: number, currency: string) {
  return roundMoney((minutes / 60) * rate, currency)
}

export type Totals = { subtotal: number; vat_amount: number; total: number }

export function computeTotals(lineAmounts: number[], vatRate: number, currency: string): Totals {
  const subtotal = roundMoney(lineAmounts.reduce((a, b) => a + b, 0), currency)
  const vat_amount = roundMoney((subtotal * vatRate) / 100, currency)
  return { subtotal, vat_amount, total: roundMoney(subtotal + vat_amount, currency) }
}

export async function recalcInvoice(q: Queryable, invoiceId: string) {
  const [inv] = await q.query('SELECT currency, vat_rate FROM invoices WHERE id = $1', [invoiceId])
  const lines = await q.query('SELECT amount FROM invoice_lines WHERE invoice_id = $1', [invoiceId])
  const t = computeTotals(lines.map((l) => Number(l.amount)), Number(inv.vat_rate), inv.currency)
  await q.query('UPDATE invoices SET subtotal = $2, vat_amount = $3, total = $4, updated_at = now() WHERE id = $1', [invoiceId, t.subtotal, t.vat_amount, t.total])
  return t
}

export type OrgBilling = {
  default_jurisdiction: string; default_currency: string; vat_number: string | null; vat_rate: number | null
  payment_terms_days: number; bank_details: string | null; invoice_footer: string | null; default_hourly_rate: number | null
  effective_vat_rate: number
}

export async function orgBilling(q: Queryable, orgId: string): Promise<OrgBilling> {
  const [o] = await q.query(
    `SELECT default_jurisdiction, default_currency, vat_number, vat_rate, payment_terms_days, bank_details, invoice_footer, default_hourly_rate
       FROM organizations WHERE id = $1`, [orgId])
  return {
    ...(o as Omit<OrgBilling, 'effective_vat_rate'>),
    effective_vat_rate: o.vat_rate != null ? Number(o.vat_rate) : DEFAULT_VAT[o.default_jurisdiction] ?? 0
  }
}

export const formatHours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
