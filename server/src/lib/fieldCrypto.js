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

// 탈퇴한 사용자가 화면에 표시될 때 쓰는 이름. 탈퇴하면 name 자체가 DB에서
// 비워지므로(routes/me.js의 DELETE), 되살릴 이름이 없어 여기서 채워준다.
export const DEACTIVATED_USER_NAME = '비활성화된 사용자'

// Decrypts whichever of email/name/picture are present on the given user-ish
// object (works for a full User row or a partial `select` like {name, picture}).
//
// 사용자 정보가 클라이언트로 나가는 길목은 전부 이 함수를 지나므로(라우트
// 14곳), 탈퇴 사용자 표시도 각 라우트가 아니라 여기서 한 번에 처리한다.
// 단 그러려면 각 select에 deactivatedAt이 포함돼 있어야 한다 — 빠져 있으면
// 탈퇴 여부를 알 수 없어 빈 이름이 그대로 나간다.
export function decryptUser(user) {
  if (!user) return user

  if (user.deactivatedAt) {
    return {
      ...user,
      ...('email' in user && { email: null }),
      ...('name' in user && { name: DEACTIVATED_USER_NAME }),
      ...('picture' in user && { picture: null }),
      isDeactivated: true,
    }
  }

  return {
    ...user,
    ...('email' in user && { email: decryptField(user.email) }),
    ...('name' in user && { name: decryptField(user.name) }),
    ...('picture' in user && { picture: decryptField(user.picture) }),
    ...('deactivatedAt' in user && { isDeactivated: false }),
  }
}
