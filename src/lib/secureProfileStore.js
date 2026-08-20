// Encrypts the cached profile (name, email, picture) at rest in the browser.
//
// The AES-GCM key is generated as non-extractable and kept only inside
// IndexedDB as a CryptoKey object — its raw bytes are never exposed to JS,
// so it can't be read from devtools/localStorage the way a plain string key
// could. localStorage only ever holds ciphertext + iv, never the profile
// in the clear. This protects against casual inspection of cached data;
// it is not a substitute for server-side session management once a backend
// exists.

const DB_NAME = 'acmebloc-secure-store'
const DB_VERSION = 1
const KEY_STORE = 'keys'
const KEY_ID = 'profile-key'
const STORAGE_KEY = 'acmebloc.profile.v1'

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

export async function saveProfile(profile) {
  const key = await getOrCreateKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(profile))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext)),
    }),
  )
}

export async function loadProfile() {
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
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    // Ciphertext unreadable (e.g. key store was cleared independently) — treat as signed out.
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function deleteProfile() {
  localStorage.removeItem(STORAGE_KEY)
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
