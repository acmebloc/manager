import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptField } from '../lib/fieldCrypto.js'

const router = Router()

// Public (no requireAuth) — an <img src> request can't carry a Bearer
// header. This is what BookStack's User::getAvatar() points at for OIDC
// users, so its avatar always reflects whatever picture is currently set
// here, instead of a one-time copy.
router.get('/:userId', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { picture: true },
  })
  if (!user) return res.status(404).end()

  const picture = decryptField(user.picture)
  if (!picture) return res.status(404).end()

  res.set('Cache-Control', 'no-cache')

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/.exec(picture)
  if (dataUrlMatch) {
    const [, contentType, base64Data] = dataUrlMatch
    res.set('Content-Type', contentType)
    return res.send(Buffer.from(base64Data, 'base64'))
  }

  // A real external URL (e.g. Google's default profile picture).
  res.redirect(picture)
})

export default router
