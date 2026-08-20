import { prisma } from '../db.js'
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
    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
