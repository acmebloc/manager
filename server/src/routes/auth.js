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

  // Three cases, which is why this isn't a single upsert:
  //
  // 새 가입 — Google이 준 값으로 그대로 만든다.
  // 재로그인 — 이메일만 갱신한다. 이름/사진은 마이페이지에서 고쳤을 수 있고,
  //   그 편집분이 남아야지 매번 Google 값으로 덮이면 안 된다.
  // 재가입(탈퇴했던 계정) — 탈퇴 때 이름·사진을 실제로 비웠으므로 남길 편집분이
  //   없다. Google 값으로 다시 채우고 deactivatedAt을 지워 되살린다. 같은 행을
  //   그대로 쓰기 때문에, 이 사람이 예전에 쓴 일감·댓글의 작성자와 배정돼 있던
  //   담당자 표시도 함께 원래대로 돌아온다.
  const existing = await prisma.user.findUnique({ where: { googleSub: payload.sub } })

  let user
  if (!existing) {
    user = await prisma.user.create({
      data: {
        googleSub: payload.sub,
        email: encryptField(payload.email),
        name: encryptField(payload.name),
        picture: encryptField(payload.picture),
      },
    })
  } else if (existing.deactivatedAt) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: encryptField(payload.email),
        name: encryptField(payload.name),
        picture: encryptField(payload.picture),
        deactivatedAt: null,
      },
    })
  } else {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { email: encryptField(payload.email) },
    })
  }

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
