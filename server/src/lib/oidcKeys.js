import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as jose from 'jose'

// BookStack (and OIDC in general) only accepts RS256-signed ID tokens, so we
// need a real RSA key pair, not just a shared JWT secret. The private key is
// generated once and persisted to disk (gitignored) so it stays stable
// across restarts — JWKS consumers cache the public key, and rotating it
// under them would break in-flight sign-ins.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY_DIR = path.join(__dirname, '..', '..', 'keys')
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'oidc-private.pem')

export const OIDC_KEY_ID = 'main'

function loadOrCreatePrivateKeyPem() {
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8')
  }
  fs.mkdirSync(KEY_DIR, { recursive: true })
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 })
  return privateKey
}

const privateKeyPem = loadOrCreatePrivateKeyPem()
const publicKeyObject = crypto.createPublicKey(privateKeyPem)

let cachedSigningKey = null
export async function getSigningKey() {
  if (!cachedSigningKey) cachedSigningKey = await jose.importPKCS8(privateKeyPem, 'RS256')
  return cachedSigningKey
}

export function getPublicKeyObject() {
  return publicKeyObject
}

export async function getPublicJwk() {
  const jwk = await jose.exportJWK(publicKeyObject)
  return { ...jwk, kid: OIDC_KEY_ID, use: 'sig', alg: 'RS256' }
}
