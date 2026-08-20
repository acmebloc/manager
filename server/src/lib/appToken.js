import jwt from 'jsonwebtoken'

const EXPIRES_IN = '7d'

export function signAppToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: EXPIRES_IN })
}

export function verifyAppToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
