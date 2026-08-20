import { Router } from 'express'
import { prisma } from '../db.js'

const router = Router()

router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'desc' },
  })
  res.json(projects)
})

router.post('/', async (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const project = await prisma.project.create({
    data: { name, description, ownerId: req.user.id },
  })
  res.status(201).json(project)
})

router.get('/:id', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!project) return res.status(404).json({ error: 'Not found' })
  res.json(project)
})

router.patch('/:id', async (req, res) => {
  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, description } = req.body
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
    },
  })
  res.json(project)
})

router.delete('/:id', async (req, res) => {
  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  await prisma.project.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
