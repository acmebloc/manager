import { Router } from 'express'
import { prisma } from '../db.js'

// Board posts are readable by every signed-in member; only the author can edit or delete.
const router = Router()

router.get('/', async (req, res) => {
  const posts = await prisma.boardPost.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true, picture: true } } },
  })
  res.json(posts)
})

router.post('/', async (req, res) => {
  const { title, content } = req.body
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' })
  }
  const post = await prisma.boardPost.create({
    data: { title, content, authorId: req.user.id },
  })
  res.status(201).json(post)
})

router.get('/:id', async (req, res) => {
  const post = await prisma.boardPost.findUnique({
    where: { id: req.params.id },
    include: { author: { select: { id: true, name: true, picture: true } } },
  })
  if (!post) return res.status(404).json({ error: 'Not found' })
  res.json(post)
})

router.patch('/:id', async (req, res) => {
  const existing = await prisma.boardPost.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { title, content } = req.body
  const post = await prisma.boardPost.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
    },
  })
  res.json(post)
})

router.delete('/:id', async (req, res) => {
  const existing = await prisma.boardPost.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  await prisma.boardPost.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
