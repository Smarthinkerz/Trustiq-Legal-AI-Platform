import { createHash } from 'node:crypto'
import { isSaudiVatNumber, zatcaTlv } from './zatca'

// ---------------------------------------------------------------------------
// Saudi e-invoicing, phase 2 groundwork: each issued Saudi invoice gets a UUID, an invoice counter
// (ICV) and the hash of the previous invoice (PIH), and can be exported as UBL 2.1 XML in the ZATCA
// layout. The invoice hash is SHA-256 over the XML without the QR reference, UBL extensions and
// signature, as the ZATCA specification requires; the XML is written in canonical form (no
// whitespace between elements, sorted namespaces) so it hashes the same before and after the QR
// is added.
//
// Not yet done (needs each firm's ZATCA onboarding): the cryptographic stamp (CSID certificate and
// XAdES signature) and clearance/reporting through the Fatoora API. Validate exports with the ZATCA
// SDK before relying on them.
// ---------------------------------------------------------------------------

// Previous-invoice hash for a seller's first invoice: base64 of the SHA-256 of "0" (per ZATCA).
export const FIRST_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

export type ZatcaSeller = {
  name: string; vat_number: string | null; cr_number: string | null
  street: string | null; building: string | null; district: string | null; city: string | null; postal_code: string | null
}
export type ZatcaInvoice = {
  number: string; uuid: string; icv: number; pih: string; issued_at: Date; currency: string
  subtotal: number; vat_rate: number; vat_amount: number; total: number
  client_name: string; client_vat_number: string | null; client_address: string | null
  lines: { description: string; quantity: number; unit_price: number; amount: number }[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
// Canonical elements: always an end tag, attributes sorted.
const el = (name: string, content: string, attrs: Record<string, string> = {}) =>
  `<${name}${Object.keys(attrs).sort().map((k) => ` ${k}="${esc(attrs[k]!)}"`).join('')}>${content}</${name}>`
const txt = (name: string, value: string | number, attrs?: Record<string, string>) => el(name, esc(String(value)), attrs)
const money = (name: string, n: number, currency: string) => txt(name, amt(n), { currencyID: currency })

const NS = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
}

// A tax invoice (B2B) when the buyer has a VAT number, otherwise a simplified invoice (B2C).
export const isStandard = (inv: Pick<ZatcaInvoice, 'client_vat_number'>) => !!inv.client_vat_number?.trim()

function taxCategory(rate: number) {
  return rate > 0
    ? txt('cbc:ID', 'S') + txt('cbc:Percent', amt(rate))
    : txt('cbc:ID', 'O') + txt('cbc:Percent', '0.00') + txt('cbc:TaxExemptionReasonCode', 'VATEX-SA-OOS') + txt('cbc:TaxExemptionReason', 'Not subject to VAT')
}

function body(inv: ZatcaInvoice, seller: ZatcaSeller, qr: string | null) {
  const cur = inv.currency
  const iso = inv.issued_at.toISOString()
  const scheme = el('cac:TaxScheme', txt('cbc:ID', 'VAT'))
  const docRef = (id: string, inner: string) => el('cac:AdditionalDocumentReference', txt('cbc:ID', id) + inner)
  const attachment = (data: string) => el('cac:Attachment', txt('cbc:EmbeddedDocumentBinaryObject', data, { mimeCode: 'text/plain' }))
  const supplier = el('cac:AccountingSupplierParty', el('cac:Party',
    (seller.cr_number ? el('cac:PartyIdentification', txt('cbc:ID', seller.cr_number, { schemeID: 'CRN' })) : '') +
    el('cac:PostalAddress',
      txt('cbc:StreetName', seller.street ?? '') + txt('cbc:BuildingNumber', seller.building ?? '') +
      txt('cbc:CitySubdivisionName', seller.district ?? '') + txt('cbc:CityName', seller.city ?? '') + txt('cbc:PostalZone', seller.postal_code ?? '') +
      el('cac:Country', txt('cbc:IdentificationCode', 'SA'))) +
    el('cac:PartyTaxScheme', txt('cbc:CompanyID', seller.vat_number ?? '') + scheme) +
    el('cac:PartyLegalEntity', txt('cbc:RegistrationName', seller.name))))
  const customer = el('cac:AccountingCustomerParty', el('cac:Party',
    (inv.client_address ? el('cac:PostalAddress', txt('cbc:StreetName', inv.client_address) + el('cac:Country', txt('cbc:IdentificationCode', 'SA'))) : '') +
    (inv.client_vat_number ? el('cac:PartyTaxScheme', txt('cbc:CompanyID', inv.client_vat_number) + scheme) : '') +
    el('cac:PartyLegalEntity', txt('cbc:RegistrationName', inv.client_name))))
  const lines = inv.lines.map((l, i) => {
    const lineVat = l.amount * inv.vat_rate / 100
    return el('cac:InvoiceLine',
      txt('cbc:ID', i + 1) + txt('cbc:InvoicedQuantity', l.quantity, { unitCode: 'PCE' }) + money('cbc:LineExtensionAmount', l.amount, cur) +
      el('cac:TaxTotal', money('cbc:TaxAmount', lineVat, cur) + money('cbc:RoundingAmount', l.amount + lineVat, cur)) +
      el('cac:Item', txt('cbc:Name', l.description.slice(0, 1000)) + el('cac:ClassifiedTaxCategory', taxCategory(inv.vat_rate) + scheme)) +
      el('cac:Price', money('cbc:PriceAmount', l.unit_price, cur)))
  }).join('')
  return txt('cbc:ProfileID', 'reporting:1.0') + txt('cbc:ID', inv.number) + txt('cbc:UUID', inv.uuid) +
    txt('cbc:IssueDate', iso.slice(0, 10)) + txt('cbc:IssueTime', iso.slice(11, 19)) +
    txt('cbc:InvoiceTypeCode', '388', { name: isStandard(inv) ? '0100000' : '0200000' }) +
    txt('cbc:DocumentCurrencyCode', cur) + txt('cbc:TaxCurrencyCode', 'SAR') +
    docRef('ICV', txt('cbc:UUID', inv.icv)) + docRef('PIH', attachment(inv.pih)) + (qr ? docRef('QR', attachment(qr)) : '') +
    supplier + customer +
    (isStandard(inv) ? el('cac:Delivery', txt('cbc:ActualDeliveryDate', iso.slice(0, 10))) : '') +
    el('cac:PaymentMeans', txt('cbc:PaymentMeansCode', '30')) +
    el('cac:TaxTotal', money('cbc:TaxAmount', inv.vat_amount, cur)) +
    el('cac:TaxTotal', money('cbc:TaxAmount', inv.vat_amount, cur) + el('cac:TaxSubtotal',
      money('cbc:TaxableAmount', inv.subtotal, cur) + money('cbc:TaxAmount', inv.vat_amount, cur) + el('cac:TaxCategory', taxCategory(inv.vat_rate) + scheme))) +
    el('cac:LegalMonetaryTotal', money('cbc:LineExtensionAmount', inv.subtotal, cur) + money('cbc:TaxExclusiveAmount', inv.subtotal, cur) +
      money('cbc:TaxInclusiveAmount', inv.total, cur) + money('cbc:PayableAmount', inv.total, cur)) +
    lines
}

const root = (content: string) => el('Invoice', content, NS)

// Base64 SHA-256 of the invoice without the QR reference (and without extensions or signature, which this export does not add).
export const invoiceHash = (inv: ZatcaInvoice, seller: ZatcaSeller) => createHash('sha256').update(root(body(inv, seller, null)), 'utf8').digest('base64')

export function invoiceXml(inv: ZatcaInvoice, seller: ZatcaSeller) {
  const qr = zatcaTlv({ sellerName: seller.name, vatNumber: seller.vat_number ?? '', issuedAt: inv.issued_at, total: inv.total, vat: inv.vat_amount })
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root(body(inv, seller, qr))}`
}

// What is still missing before an export can pass ZATCA validation.
export function zatcaReadiness(seller: ZatcaSeller, inv?: Pick<ZatcaInvoice, 'client_vat_number' | 'client_address'>): string[] {
  const missing: string[] = []
  if (!seller.vat_number || !isSaudiVatNumber(seller.vat_number)) missing.push('seller_vat_number')
  if (!seller.cr_number) missing.push('seller_cr_number')
  if (!seller.street) missing.push('seller_street')
  if (!seller.building || !/^\d{4}$/.test(seller.building)) missing.push('seller_building_number')
  if (!seller.district) missing.push('seller_district')
  if (!seller.city) missing.push('seller_city')
  if (!seller.postal_code || !/^\d{5}$/.test(seller.postal_code)) missing.push('seller_postal_code')
  if (inv && isStandard(inv as ZatcaInvoice)) {
    if (!isSaudiVatNumber(inv.client_vat_number!.replace(/\s/g, ''))) missing.push('buyer_vat_number')
    if (!inv.client_address?.trim()) missing.push('buyer_address')
  }
  return missing
}
