import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const BCRYPT_ROUNDS = 12
export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS)
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

// Used to equalise timing when an email does not exist.
export const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS)
