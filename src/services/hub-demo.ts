import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Checking a SmarThinkerz Hub access code. This is the Hub's own demo code scheme, called exactly the
// way Hala calls it (src/lib/demo-access.ts there): a signed POST to the Hub's /api/demo/validate.
// The Hub signs and checks app requests with three headers:
//   X-SmarThinkerz-App:       <app id registered in the Hub>
//   X-SmarThinkerz-Timestamp: <unix seconds>
//   X-SmarThinkerz-Signature: sha256=<hex HMAC-SHA256(partner secret, "<timestamp>.<raw body>")>
// and answers whether the code is genuine and live, with the hire's name. The call only reads: the
// Hub records no usage for it. TrustIQ never stores a code; it decides nothing about a code itself.
// ---------------------------------------------------------------------------

export type DemoRefusal =
  | 'empty' | 'referral_shaped' | 'wrong_app' | 'unknown_code' | 'revoked' | 'demo_paused'
  // The Hub could not be asked, or refused our signature: our fault, never the hire's code.
  | 'validator_unavailable'

export type DemoVerdict =
  | { ok: true; hireName: string | null; codeType: 'trainee' | 'owner' | null }
  | { ok: false; reason: DemoRefusal }

export type HubDemoConfig = { url: string; appId: string; secret: string }

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// The Hub compares codes trimmed and upper-cased.
export const normalizeCode = (code: string) => code.trim().toUpperCase()

// A hire may type "dm abcd efgh jklm" or paste it without dashes; the Hub's codes are DM-XXXX-XXXX-XXXX.
export function canonicalDemoCode(code: string): string {
  const c = normalizeCode(code)
  const bare = c.replace(/[\s-]+/g, '')
  if (!new RegExp(`^DM[${CODE_ALPHABET}]{12}$`).test(bare)) return c
  const g = bare.slice(2)
  return `DM-${g.slice(0, 4)}-${g.slice(4, 8)}-${g.slice(8, 12)}`
}

// A trainee's referral code (3 letters of a first name, then 2 or 3 characters with a digit) earns a
// commission and must never open a demo, whatever the Hub would say. Same shape test as Hala.
export function isReferralShaped(code: string): boolean {
  const c = normalizeCode(code)
  if (!new RegExp(`^[A-Z]{3}[${CODE_ALPHABET}]{2,3}$`).test(c)) return false
  return /[23456789]/.test(c.slice(3))
}

const HUB_REASONS: Record<string, DemoRefusal> = {
  missing_code: 'empty',
  referral_code_not_accepted: 'referral_shaped',
  app_not_allowed: 'wrong_app',
  kill_switch: 'demo_paused',
  revoked: 'revoked',
  trainee_ended: 'revoked'
}

export function signHubRequest(secret: string, body: string, nowMs = Date.now()) {
  const ts = Math.floor(nowMs / 1000).toString()
  return { ts, signature: `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex')}` }
}

// Fails closed: a Hub that cannot answer never lets a code through.
export async function validateDemoCode(cfg: HubDemoConfig, rawCode: string, fetchImpl: typeof fetch = fetch): Promise<DemoVerdict> {
  if (!normalizeCode(rawCode)) return { ok: false, reason: 'empty' }
  if (isReferralShaped(rawCode)) return { ok: false, reason: 'referral_shaped' }
  const body = JSON.stringify({ code: canonicalDemoCode(rawCode), app_id: cfg.appId })
  const { ts, signature } = signHubRequest(cfg.secret, body)
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-smarthinkerz-app': cfg.appId, 'x-smarthinkerz-timestamp': ts, 'x-smarthinkerz-signature': signature },
      body,
      signal: AbortSignal.timeout(8000)
    })
    // 401 (signature or clock), 404 (route moved) and 5xx are ours to fix, not a bad code.
    if (!res.ok) return { ok: false, reason: res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500 ? 'validator_unavailable' : 'unknown_code' }
    const d: any = await res.json().catch(() => null)
    if (!d || typeof d !== 'object') return { ok: false, reason: 'validator_unavailable' }
    if (d.valid !== true) return { ok: false, reason: HUB_REASONS[d.reason] ?? 'unknown_code' }
    // The owner's "demo off everywhere" switch is honored; the Hub's daily action cap and monthly
    // ceiling are not (as in Hala), because TrustIQ caps demo AI spend itself and a demo must not
    // stop in front of a client.
    if (d.kill_switch === true || d.reason === 'kill_switch') return { ok: false, reason: 'demo_paused' }
    const name = typeof d.trainee?.name === 'string' ? d.trainee.name.trim().slice(0, 120) : ''
    return { ok: true, hireName: name || null, codeType: d.code_type === 'owner' || d.code_type === 'trainee' ? d.code_type : null }
  } catch {
    return { ok: false, reason: 'validator_unavailable' }
  }
}
