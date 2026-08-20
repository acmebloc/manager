import crypto from 'node:crypto'

// Encrypts individual User columns (email, name, picture) at the application
// layer, on top of RDS's disk-level encryption. This protects that data even
// if the DB credentials alone leak (RDS encryption-at-rest doesn't help
// there, since a connected client just sees plaintext).
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getKey() {
  const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY || '', 'hex')
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 32-byte hex string (openssl rand -hex 32)')
  }
  return key
}

export function encryptField(plaintext) {
  if (plaintext == null) return null
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptField(stored) {
  if (stored == null) return null
  const raw = Buffer.from(stored, 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// Decrypts whichever of email/name/picture are present on the given user-ish
// object (works for a full User row or a partial `select` like {name, picture}).
export function decryptUser(user) {
  if (!user) return user
  return {
    ...user,
    ...('email' in user && { email: decryptField(user.email) }),
    ...('name' in user && { name: decryptField(user.name) }),
    ...('picture' in user && { picture: decryptField(user.picture) }),
  }
}
