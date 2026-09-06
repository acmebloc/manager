import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'

// Mounted at /api/notifications — always scoped to req.user.id, no project
// access check needed (unlike task/project sub-resources).
const router = Router()

const actorSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }
const PAGE_SIZE = 20

function decorate(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    link: notification.link,
    actorName: notification.actor ? decryptUser(notification.actor).name : null,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  }
}

router.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: actorSelect } },
    }),
    prisma.notification.count({ where: { userId: req.user.id } }),
  ])
  res.json({ items: items.map(decorate), total, page, pageSize: PAGE_SIZE })
})

router.get('/unread-count', async (req, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } })
  res.json({ count })
})

router.patch('/:id/read', async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  })
  if (result.count === 0) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  })
  res.status(204).end()
})

export default router
