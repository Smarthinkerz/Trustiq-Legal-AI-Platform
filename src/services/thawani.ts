import type { Logger } from '../lib/logger'
import type { TapCharge } from './tap'

// ---------------------------------------------------------------------------
// Thawani Checkout (Oman). A firm connects its own Thawani merchant account, so clients in Oman can
// pay invoices in rials with Omani debit and credit cards. The flow: create a checkout session,
// send the client to Thawani's hosted page, then read the session back (on return and from a
// background sweep) to learn whether it was paid. Amounts are in baisa (1 OMR = 1000 baisa).
// ---------------------------------------------------------------------------

export type ThawaniMode = 'test' | 'live'
export type ThawaniKeys = { secretKey: string; publishableKey: string; mode: ThawaniMode }

export type ThawaniSession = {
  session_id: string
  client_reference_id?: string
  payment_status: 'unpaid' | 'paid' | 'cancelled' | string
  total_amount?: number
  currency?: string
  metadata?: Record<string, string>
}

export interface ThawaniClient {
  createSession(body: {
    client_reference_id: string
    products: { name: string; quantity: number; unit_amount: number }[]
    success_url: string
    cancel_url: string
    metadata?: Record<string, string>
  }): Promise<ThawaniSession>
  retrieveSession(sessionId: string): Promise<ThawaniSession>
  payUrl(sessionId: string): string
  verifyKey(): Promise<boolean>
}

const HOSTS: Record<ThawaniMode, string> = { test: 'https://uatcheckout.thawani.om', live: 'https://checkout.thawani.om' }
export const THAWANI_HOSTS = Object.values(HOSTS)
// Thawani's smallest accepted charge is 100 baisa.
export const THAWANI_MIN_OMR = 0.1
export const THAWANI_KEY_RE = /^[A-Za-z0-9_-]{20,200}$/

export const toBaisa = (omr: number) => Math.round(omr * 1000)

export function createThawaniClient(keys: ThawaniKeys, log: Logger, fetchImpl: typeof fetch = fetch): ThawaniClient {
  const host = HOSTS[keys.mode]
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await fetchImpl(`${host}/api/v1${path}`, {
      method,
      headers: { 'thawani-api-key': keys.secretKey, 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000)
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) {
      log.warn('thawani request failed', { path: path.replace(/checkout_[\w-]+/, 'checkout_…'), status: res.status, code: data.code })
      const err = new Error(`Thawani ${method} ${path.split('/')[1]} failed: ${res.status} ${String(data.description ?? '').slice(0, 200)}`)
      ;(err as any).status = res.status
      throw err
    }
    return data.data
  }
  return {
    createSession: (body) => call('POST', '/checkout/session', { mode: 'payment', ...body }),
    retrieveSession: (id) => call('GET', `/checkout/session/${encodeURIComponent(id)}`),
    payUrl: (id) => `${host}/pay/${encodeURIComponent(id)}?key=${encodeURIComponent(keys.publishableKey)}`,
    // Only an authentication error means a wrong key; another client error still proves the key was accepted.
    async verifyKey() {
      try { await call('GET', '/checkout/session?limit=1&skip=0'); return true } catch (err: any) {
        if (err.status === 401 || err.status === 403) return false
        if (err.status >= 400 && err.status < 500) return true
        throw err
      }
    }
  }
}

// A session in the shape the invoice reconciler reads, so Tap and Thawani payments settle invoices
// through the same code path.
export function sessionAsCharge(s: ThawaniSession): TapCharge {
  const status = s.payment_status === 'paid' ? 'CAPTURED' : s.payment_status === 'cancelled' ? 'CANCELLED' : s.payment_status === 'unpaid' ? 'INITIATED' : 'FAILED'
  return {
    id: s.session_id,
    status,
    amount: Number(s.total_amount ?? 0) / 1000,
    currency: s.currency ?? 'OMR',
    metadata: s.metadata,
    response: status === 'FAILED' ? { message: `Thawani payment status: ${s.payment_status}` } : undefined
  }
}
