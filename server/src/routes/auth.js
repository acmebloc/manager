import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '../db.js'
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

  const user = await prisma.user.upsert({
    where: { googleSub: payload.sub },
    update: { email: payload.email, name: payload.name, picture: payload.picture },
    create: {
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    },
  })

  res.json({ token: signAppToken(user), user })
})

export default router
