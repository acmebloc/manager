import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { getProjectAccess } from '../lib/projectAccess.js'

const router = Router()

const scheduleInclude = {
  owner: { select: { id: true, name: true, email: true, picture: true } },
  project: { select: { id: true, name: true } },
}

function decryptSchedule(schedule) {
  return { ...schedule, owner: decryptUser(schedule.owner) }
}

// A schedule is visible if you own it, or if it belongs to a project you're
// on — a project milestone is no use if only its author can see it. Personal
// schedules (no project) stay private to their owner.
function visibleToUser(userId, memberProjectIds) {
  return {
    OR: [{ ownerId: userId }, { projectId: { in: memberProjectIds } }],
  }
}

async function memberProjectIds(userId) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  })
  return memberships.map((m) => m.projectId)
}

router.get('/', async (req, res) => {
  const { projectId } = req.query
  const projectIds = await memberProjectIds(req.user.id)

  if (projectId && !projectIds.includes(projectId)) {
    return res.status(404).json({ error: 'Project not found' })
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      ...visibleToUser(req.user.id, projectIds),
      ...(projectId && { projectId }),
    },
    orderBy: { startAt: 'asc' },
    include: scheduleInclude,
  })
  res.json(schedules.map(decryptSchedule))
})

router.post('/', async (req, res) => {
  const { title, startAt, endAt, projectId } = req.body
  if (!title || !startAt) {
    return res.status(400).json({ error: 'title and startAt are required' })
  }

  // Attaching a schedule to a project shares it with that project's members,
  // so the caller has to be one of them.
  if (projectId) {
    const access = await getProjectAccess(projectId, req.user.id)
    if (!access) return res.status(404).json({ error: 'Project not found' })
    if (access.role === 'viewer') return res.status(403).json({ error: 'Forbidden' })
  }

  const schedule = await prisma.schedule.create({
    data: {
      title,
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      projectId: projectId || null,
      ownerId: req.user.id,
    },
    include: scheduleInclude,
  })
  res.status(201).json(decryptSchedule(schedule))
})

// Editing and deleting stay with the person who created the schedule, even
// when others can see it through a shared project.
router.patch('/:id', async (req, res) => {
  const existing = await prisma.schedule.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { title, startAt, endAt, projectId } = req.body
  if (projectId) {
    const access = await getProjectAccess(projectId, req.user.id)
    if (!access) return res.status(404).json({ error: 'Project not found' })
    if (access.role === 'viewer') return res.status(403).json({ error: 'Forbidden' })
  }

  const schedule = await prisma.schedule.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(startAt !== undefined && { startAt: new Date(startAt) }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
      ...(projectId !== undefined && { projectId: projectId || null }),
    },
    include: scheduleInclude,
  })
  res.json(decryptSchedule(schedule))
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
