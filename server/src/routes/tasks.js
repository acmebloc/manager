import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'

// Mounted at /api/projects/:projectId/tasks — every task belongs to a project.
const router = Router({ mergeParams: true })

const taskInclude = {
  assignee: { select: { id: true, name: true, email: true, picture: true } },
}

function decryptTask(task) {
  return { ...task, assignee: task.assignee ? decryptUser(task.assignee) : null }
}

// An assignee who isn't on the project couldn't open the task they were
// given, so reject that rather than creating one nobody can act on.
async function assertAssigneeIsMember(projectId, assigneeId) {
  if (!assigneeId) return null
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  })
  return membership ? null : 'Assignee must be a member of this project'
}

router.get('/', requireProjectRole('viewer'), async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: 'desc' },
    include: taskInclude,
  })
  res.json(tasks.map(decryptTask))
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const { title, description, status, assigneeId, dueDate } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const problem = await assertAssigneeIsMember(req.params.projectId, assigneeId)
  if (problem) return res.status(400).json({ error: problem })

  const task = await prisma.task.create({
    data: {
      projectId: req.params.projectId,
      title,
      description,
      status: status || 'todo',
      assigneeId: assigneeId || null,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    include: taskInclude,
  })
  res.status(201).json(decryptTask(task))
})

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { title, description, status, assigneeId, dueDate } = req.body
  if (assigneeId !== undefined) {
    const problem = await assertAssigneeIsMember(req.params.projectId, assigneeId)
    if (problem) return res.status(400).json({ error: problem })
  }

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(assigneeId !== undefined && { assigneeId: assigneeId || null }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    },
    include: taskInclude,
  })
  res.json(decryptTask(task))
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  await prisma.task.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
