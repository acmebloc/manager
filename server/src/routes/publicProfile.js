import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptField } from '../lib/fieldCrypto.js'

const router = Router()

// Public (no requireAuth) — lets external services (BookStack) read a
// user's current display name live, the same way /api/avatar mirrors the
// current picture, instead of a one-time copy taken at OIDC login time.
router.get('/:userId', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { name: true },
  })
  if (!user) return res.status(404).end()

  res.set('Cache-Control', 'no-cache')
  res.json({ name: decryptField(user.name) })
})

export default router
