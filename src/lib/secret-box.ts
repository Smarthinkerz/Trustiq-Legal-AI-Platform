import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// AES-256-GCM for secrets kept in the database (OAuth refresh tokens).
// Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.

const keyFrom = (secret: string) => createHash('sha256').update(`trustiq-secret-box:v1:${secret}`).digest()

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

// Returns null when the value was sealed with another key or has been tampered with.
export function open(sealed: string, secret: string): string | null {
  const [v, iv, tag, ct] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || ct === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
