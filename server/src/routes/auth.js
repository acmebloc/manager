import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '../db.js'
import { decryptUser, encryptField } from '../lib/fieldCrypto.js'
import { signAppToken } from '../lib/appToken.js'

const router = Router()
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

// Frontend calls this once with the Google ID token it just received from
// the Gmail sign-in popup. We verify it against Google, upsert the user row,
// and hand back our own longer-lived token for subsequent API calls.
router.post('/login', async (req, res) => {
  const { idToken } = req.body
  if (!idToken) return res.status(400).json({ error: 'idToken is required' })

  let payload
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch {
    return res.status(401).json({ error: 'Invalid Google ID token' })
  }

  // Only fill name/picture from Google on first sign-up — a returning user
  // may have customized them on the mypage, and those edits are the ones
  // that should stick, not whatever Google happens to report this time.
  const user = await prisma.user.upsert({
    where: { googleSub: payload.sub },
    update: {
      email: encryptField(payload.email),
    },
    create: {
      googleSub: payload.sub,
      email: encryptField(payload.email),
      name: encryptField(payload.name),
      picture: encryptField(payload.picture),
    },
  })

  const token = signAppToken(user)

  // The SPA uses `token` as a Bearer header for its own API calls. The
  // cookie is separate — it's read server-side by the OIDC /authorize
  // endpoint during a full-page redirect (e.g. from BookStack), where no JS
  // is around to attach a Bearer header.
  res.cookie('manager_session', token, {
    httpOnly: true,
    secure: (process.env.FRONTEND_ORIGIN || '').startsWith('https://'),
    sameSite: 'lax',
    // Explicit — without this, the browser's default path would be scoped
    // to /api/auth (the directory of this request), so it wouldn't be sent
    // on a plain navigation to /oidc/authorize (e.g. from BookStack's
    // auto-initiate redirect), breaking the whole "already logged in, skip
    // the login screen entirely" flow.
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })

  res.json({ token, user: decryptUser(user) })
})

// Clears the httpOnly session cookie. The SPA's own logged-in state lives in
// the encrypted browser cache and is cleared separately (there's no
// server-side token revocation, the JWT is just stateless) — but without
// this, that cookie stays valid until its natural expiry, so a "withdrawn"
// user who looks logged out in Manager would still get silently logged into
// BookStack via /oidc/authorize, which only ever checks this cookie.
router.post('/logout', (req, res) => {
  res.clearCookie('manager_session', { path: '/' })
  res.json({ ok: true })
})

export default router
