// Encrypts the cached session (app token + display profile) at rest in the
// browser.
//
// The AES-GCM key is generated as non-extractable and kept only inside
// IndexedDB as a CryptoKey object — its raw bytes are never exposed to JS,
// so it can't be read from devtools/localStorage the way a plain string key
// could. localStorage only ever holds ciphertext + iv, never the session
// in the clear.
//
// This is purely a client-side cache for instant UI state ("already signed
// in as X") — the server (RDS) is the source of truth for the user record
// itself. The cached token is only ever sent to the server when an actual
// API call needs it; there's no "am I still logged in?" round trip on load.
//
// That last part is why loadSession has to check the token's own expiry: with
// no round trip, an expired token looks exactly like a valid one to every
// caller. And "a cache exists" is what the login page uses to decide whether
// to render the Gmail button at all, so a stale blob doesn't just fail — it
// removes the only way back in (LoginPage.jsx). Treating expired as
// signed-out here is what keeps that from happening.

const DB_NAME = 'acmebloc-secure-store'
const DB_VERSION = 1
const KEY_STORE = 'keys'
const KEY_ID = 'profile-key'
const STORAGE_KEY = 'acmebloc.session.v2'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getOrCreateKey() {
  const db = await openDb()

  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly')
    const request = tx.objectStore(KEY_STORE).get(KEY_ID)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (existing) {
    db.close()
    return existing
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  await new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite')
    tx.objectStore(KEY_STORE).put(key, KEY_ID)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return key
}

// Reads the `exp` out of the app token (a JWT) without verifying it — the
// signature is the server's business, and a client that lies to itself here
// only logs itself out early. Anything unreadable counts as expired: a token
// we can't make sense of is one the server won't accept either.
function isTokenExpired(token) {
  if (typeof token !== 'string') return true
  const parts = token.split('.')
  if (parts.length !== 3) return true
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    if (typeof exp !== 'number') return true
    return exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

// session: { token, profile: { name, email, picture } }
export async function saveSession(session) {
  const key = await getOrCreateKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(session))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext)),
    }),
  )
}

export async function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const { iv, data } = JSON.parse(raw)
    const key = await getOrCreateKey()
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(data),
    )
    const session = JSON.parse(new TextDecoder().decode(plaintext))

    // The blob itself has no expiry, so without this the cache outlives the
    // 7-day token forever and the app renders a signed-in shell whose every
    // request 401s. Drop it and report signed-out, which is what it is.
    if (isTokenExpired(session?.token)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }

    return session
  } catch {
    // Ciphertext unreadable (e.g. key store was cleared independently) — treat as signed out.
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
