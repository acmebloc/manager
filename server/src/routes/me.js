import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser, encryptField } from '../lib/fieldCrypto.js'

const router = Router()

// Lets the signed-in user update their own display name and/or profile
// picture, persisting the mypage edit to the DB instead of just the
// browser's local cache.
router.patch('/', async (req, res) => {
  const { name, picture, emailNotificationsEnabled } = req.body
  const data = {}
  if (name !== undefined) data.name = encryptField(name)
  if (picture !== undefined) data.picture = encryptField(picture)
  if (emailNotificationsEnabled !== undefined) data.emailNotificationsEnabled = Boolean(emailNotificationsEnabled)
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'name, picture, or emailNotificationsEnabled is required' })
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data })
  res.json(decryptUser(user))
})

export default router
