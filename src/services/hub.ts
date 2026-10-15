import { createHmac, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Reading webhooks from the SmarThinkerz Hub Team Checkout.
//
// PROVISIONAL: this follows the Hub integration scheme used for Tap (an HMAC
// SHA-256 of the raw body, hex encoded, keyed with the shared secret). The
// field and header names below must be checked against the Team Checkout
// contract when the Hub agent publishes it; everything else in firm billing
// only depends on the normalized HubEvent this returns.
// ---------------------------------------------------------------------------

export type HubEvent = { type: 'paid' | 'renewed' | 'renewal_failed'; quoteId: string; reference: string; amount: number; currency: string }

const TYPES: Record<string, HubEvent['type']> = {
  'checkout.paid': 'paid', 'payment.paid': 'paid', paid: 'paid',
  'subscription.renewed': 'renewed', 'renewal.paid': 'renewed', renewed: 'renewed',
  'subscription.renewal_failed': 'renewal_failed', 'renewal.failed': 'renewal_failed', renewal_failed: 'renewal_failed'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function hubSignature(secret: string, rawBody: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function parseHubEvent(opts: { rawBody: string; headers: (name: string) => string | undefined; secret: string; toleranceMs: number; now?: number }):
  { ok: true; event: HubEvent } | { ok: false; reason: string } {
  const given = (opts.headers('x-hub-signature') ?? '').trim().toLowerCase().replace(/^sha256=/, '')
  if (!/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: 'invalid_signature' }
  const expected = hubSignature(opts.secret, opts.rawBody)
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))) return { ok: false, reason: 'invalid_signature' }
  let p: any
  try { p = JSON.parse(opts.rawBody) } catch { return { ok: false, reason: 'invalid_payload' } }
  const sent = Date.parse(String(p?.created_at ?? p?.timestamp ?? ''))
  if (Number.isFinite(sent) && Math.abs((opts.now ?? Date.now()) - sent) > opts.toleranceMs) return { ok: false, reason: 'stale' }
  const type = TYPES[String(p?.type ?? p?.event ?? '')]
  const quoteId = String(p?.quote_id ?? p?.metadata?.quote_id ?? '')
  const reference = String(p?.reference ?? p?.payment_id ?? p?.charge_id ?? '')
  const amount = Number(p?.amount ?? 0)
  const currency = String(p?.currency ?? '').toUpperCase()
  if (!type || !UUID.test(quoteId) || !/^[\w.:-]{3,120}$/.test(reference)) return { ok: false, reason: 'invalid_payload' }
  if (type !== 'renewal_failed' && (!(amount > 0) || !/^[A-Z]{3}$/.test(currency))) return { ok: false, reason: 'invalid_payload' }
  return { ok: true, event: { type, quoteId, reference, amount, currency } }
}
