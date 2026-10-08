import QRCode from 'qrcode'

// ---------------------------------------------------------------------------
// Saudi e-invoicing (ZATCA, phase 1): every tax invoice carries a QR code that
// encodes seller name, VAT number, time of issue, total and VAT as base64 TLV.
// ---------------------------------------------------------------------------

// Saudi VAT registration numbers are 15 digits that start and end with 3.
export const isSaudiVatNumber = (v: string) => /^3\d{13}3$/.test(v)

export const zatcaApplies = (jurisdiction: string | null | undefined, currency: string | null | undefined) =>
  jurisdiction === 'ksa' || currency === 'SAR'

function field(tag: number, value: string): Buffer {
  let bytes = Buffer.from(value, 'utf8')
  // A TLV length is a single byte; trim long names without splitting a character.
  while (bytes.length > 255) {
    value = Array.from(value).slice(0, -1).join('')
    bytes = Buffer.from(value, 'utf8')
  }
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes])
}

export function zatcaTlv(d: { sellerName: string; vatNumber: string; issuedAt: Date; total: number; vat: number }): string {
  return Buffer.concat([
    field(1, d.sellerName.trim()),
    field(2, d.vatNumber.trim()),
    field(3, d.issuedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')),
    field(4, d.total.toFixed(2)),
    field(5, d.vat.toFixed(2))
  ]).toString('base64')
}

export function parseZatcaTlv(b64: string): Record<number, string> {
  const buf = Buffer.from(b64, 'base64')
  const out: Record<number, string> = {}
  for (let i = 0; i + 2 <= buf.length;) {
    const tag = buf[i], len = buf[i + 1]
    out[tag] = buf.subarray(i + 2, i + 2 + len).toString('utf8')
    i += 2 + len
  }
  return out
}

export type ZatcaQr = { tlv: string; png: Buffer; dataUrl: string; simplified: boolean }

// QR for an issued invoice, or null when it does not apply (not Saudi, no VAT number, draft or void).
export async function invoiceZatcaQr(
  inv: Record<string, any>,
  seller: { name: string; vat_number: string | null; jurisdiction: string }
): Promise<ZatcaQr | null> {
  if (!zatcaApplies(seller.jurisdiction, inv.currency) || !seller.vat_number) return null
  if (!['issued', 'paid'].includes(inv.status)) return null
  const issuedAt = inv.issued_at ? new Date(inv.issued_at) : inv.issue_date ? new Date(inv.issue_date) : new Date()
  const tlv = zatcaTlv({ sellerName: seller.name, vatNumber: seller.vat_number, issuedAt, total: Number(inv.total), vat: Number(inv.vat_amount) })
  const png = await QRCode.toBuffer(tlv, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
  return { tlv, png, dataUrl: `data:image/png;base64,${png.toString('base64')}`, simplified: !inv.client_vat_number }
}
