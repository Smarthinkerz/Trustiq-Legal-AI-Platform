import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) compatible with Google Authenticator, Microsoft Authenticator, 1Password, etc.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function totpCode(secret: string, time = Date.now(), step = 30): string {
  const counter = Math.floor(time / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

// Accepts the current code and one step either side to tolerate clock drift.
export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  const c = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return false
  for (const drift of [-1, 0, 1]) {
    const expected = totpCode(secret, time + drift * 30_000)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true
  }
  return false
}

export function otpauthUri(secret: string, account: string, issuer = 'TrustiqLegal') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const s = randomBytes(5).toString('hex').toUpperCase()
    return `${s.slice(0, 5)}-${s.slice(5)}`
  })
}
