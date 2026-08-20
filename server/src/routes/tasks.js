import { Router } from 'express'
import { prisma } from '../db.js'

// Mounted at /api/projects/:projectId/tasks — every task belongs to a project.
const router = Router({ mergeParams: true })

async function loadOwnedProject(req, res) {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, ownerId: req.user.id },
  })
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return null
  }
  return project
}

router.get('/', async (req, res) => {
  if (!(await loadOwnedProject(req, res))) return
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: 'desc' },
  })
  res.json(tasks)
})

router.post('/', async (req, res) => {
  if (!(await loadOwnedProject(req, res))) return
  const { title, description, status, assigneeId, dueDate } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })
  const task = await prisma.task.create({
    data: {
      projectId: req.params.projectId,
      title,
      description,
      status: status || 'todo',
      assigneeId: assigneeId || null,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  })
  res.status(201).json(task)
})

router.patch('/:id', async (req, res) => {
  if (!(await loadOwnedProject(req, res))) return
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { title, description, status, assigneeId, dueDate } = req.body
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(assigneeId !== undefined && { assigneeId: assigneeId || null }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    },
  })
  res.json(task)
})

router.delete('/:id', async (req, res) => {
  if (!(await loadOwnedProject(req, res))) return
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  await prisma.task.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
