import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { verifyAppToken } from '../lib/appToken.js'

// Verifies the app-issued JWT (obtained once via POST /api/auth/login) rather
// than the short-lived Google ID token, so clients don't need to re-run the
// Google sign-in flow on every request.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })

  try {
    const payload = verifyAppToken(token)
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return res.status(401).json({ error: 'User not found' })
    // 탈퇴하면 세션과 쿠키는 지워지지만 이미 발급된 JWT 자체는 만료(7일)까지
    // 서명이 유효하다 — 저장해둔 토큰으로 계속 API를 쓰지 못하게 여기서 막는다.
    // 재가입하면 deactivatedAt이 지워지므로 자연히 다시 통과한다.
    if (user.deactivatedAt) return res.status(401).json({ error: 'Withdrawn account' })
    req.user = decryptUser(user)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
