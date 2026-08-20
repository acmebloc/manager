// Thin wrapper around Google Identity Services (GIS). GIS is loaded via the
// <script> tag in index.html; this module waits for it to be ready and
// exposes the pieces the app needs.

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve()
      return
    }
    const started = Date.now()
    const interval = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - started > 10000) {
        clearInterval(interval)
        reject(new Error('Google Identity Services failed to load'))
      }
    }, 50)
  })
}

let initialized = false

// onCredential receives the raw Google ID token (JWT string) — the backend
// verifies it and returns the authoritative user record, so the frontend
// never needs to decode or trust the token's claims itself.
export async function initGoogleSignIn(onCredential) {
  if (!GOOGLE_CLIENT_ID) return false
  await waitForGis()

  if (!initialized) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => onCredential(response.credential),
      auto_select: false,
      cancel_on_tap_outside: true,
    })
    initialized = true
  }
  return true
}

export function renderGoogleButton(container, { width = 240 } = {}) {
  if (!container || !window.google?.accounts?.id) return
  container.innerHTML = ''
  window.google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'signup_with',
    logo_alignment: 'left',
    width,
  })
}

export function endGoogleSession() {
  window.google?.accounts?.id?.disableAutoSelect()
}
