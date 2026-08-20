import { Router } from 'express'
import { prisma } from '../db.js'

const router = Router()

router.get('/', async (req, res) => {
  const { projectId } = req.query
  const schedules = await prisma.schedule.findMany({
    where: {
      ownerId: req.user.id,
      ...(projectId && { projectId }),
    },
    orderBy: { startAt: 'asc' },
  })
  res.json(schedules)
})

router.post('/', async (req, res) => {
  const { title, startAt, endAt, projectId } = req.body
  if (!title || !startAt) {
    return res.status(400).json({ error: 'title and startAt are required' })
  }
  const schedule = await prisma.schedule.create({
    data: {
      title,
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      projectId: projectId || null,
      ownerId: req.user.id,
    },
  })
  res.status(201).json(schedule)
})

router.patch('/:id', async (req, res) => {
  const existing = await prisma.schedule.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { title, startAt, endAt, projectId } = req.body
  const schedule = await prisma.schedule.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(startAt !== undefined && { startAt: new Date(startAt) }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
      ...(projectId !== undefined && { projectId: projectId || null }),
    },
  })
  res.json(schedule)
})

router.delete('/:id', async (req, res) => {
  const existing = await prisma.schedule.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  await prisma.schedule.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
