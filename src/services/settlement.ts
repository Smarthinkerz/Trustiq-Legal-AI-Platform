// ---------------------------------------------------------------------------
// Settlement negotiations (التسوية الودية): offers made by our client and
// received from the other side, checked against the client's instructions
// (the least they will take, or the most they will pay). The authority is
// internal and never shown in the client portal.
// ---------------------------------------------------------------------------

export type Position = 'receive' | 'pay'
export type Authority = { position: Position; amount: number | null; currency: string } | null
export type Offer = { direction: 'ours' | 'theirs'; amount: number; currency: string; status: string; made_on: string }

// Whether an offer is outside the client's instructions: below the least the client will take, or
// above the most they will pay. For our offers that means giving away more than allowed; for theirs,
// that the client has not authorised accepting it.
export function outsideAuthority(a: Authority, o: Pick<Offer, 'amount' | 'currency'>): boolean {
  if (!a || a.amount == null || a.currency !== o.currency) return false
  return a.position === 'receive' ? o.amount < a.amount : o.amount > a.amount
}

// The latest figure on each side and the gap between them (in the matter's terms: what the client asks
// for or offers, against what the other side offers or demands).
export function standing(offers: Offer[], position: Position | null) {
  const latest = (dir: 'ours' | 'theirs') =>
    [...offers].filter((o) => o.direction === dir && o.status !== 'withdrawn').sort((a, b) => b.made_on.localeCompare(a.made_on))[0] ?? null
  const ours = latest('ours')
  const theirs = latest('theirs')
  const accepted = offers.find((o) => o.status === 'accepted') ?? null
  const gap = ours && theirs && ours.currency === theirs.currency ? Math.round(Math.abs(ours.amount - theirs.amount) * 1000) / 1000 : null
  // Positions converge when the client receives and the other side's offer meets our ask (or the reverse when paying).
  const crossed = ours && theirs && ours.currency === theirs.currency && position
    ? (position === 'receive' ? theirs.amount >= ours.amount : theirs.amount <= ours.amount) : false
  return { ours: ours ? { amount: ours.amount, currency: ours.currency, made_on: ours.made_on } : null,
    theirs: theirs ? { amount: theirs.amount, currency: theirs.currency, made_on: theirs.made_on } : null,
    gap, crossed, settled: !!accepted }
}
