import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { assertNotLastPm, isValidRole, requireProjectRole } from '../lib/projectAccess.js'
import { deleteAttachmentFiles } from '../lib/uploads.js'

const router = Router()

const memberSelect = {
  id: true,
  role: true,
  userId: true,
  user: { select: { id: true, name: true, email: true, picture: true } },
}

function decryptMember(member) {
  return { ...member, user: decryptUser(member.user) }
}

function myRoleFor(project, user) {
  if (user.isSiteAdmin) return 'pm'
  return project.members.find((m) => m.userId === user.id)?.role ?? null
}

// The site admin sees every project site-wide; everyone else only sees
// projects they're a member of.
router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: req.user.isSiteAdmin ? {} : { members: { some: { userId: req.user.id } } },
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: memberSelect },
      _count: { select: { tasks: true } },
    },
  })
  res.json(
    projects.map((project) => ({
      ...project,
      members: project.members.map(decryptMember),
      myRole: myRoleFor(project, req.user),
    })),
  )
})

// Any signed-in user can create a project, but creating it doesn't make you
// a member of it — the creator is only tracked for audit purposes (ownerId).
// A project needs at least one PM to be usable at all, so that's required
// up front rather than left to a follow-up step.
router.post('/', async (req, res) => {
  const { name, description, startAt, endAt, members = [] } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  if (!Array.isArray(members) || members.some((m) => !m?.userId || !isValidRole(m.role))) {
    return res.status(400).json({ error: 'members must be [{ userId, role }]' })
  }
  const userIds = members.map((m) => m.userId)
  if (new Set(userIds).size !== userIds.length) {
    return res.status(400).json({ error: 'Duplicate member userId' })
  }
  if (!members.some((m) => m.role === 'pm')) {
    return res.status(400).json({ error: 'At least one PM is required' })
  }

  const existingCount = await prisma.user.count({ where: { id: { in: userIds } } })
  if (existingCount !== userIds.length) {
    return res.status(400).json({ error: 'One or more members are not registered users' })
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      ownerId: req.user.id,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role })) },
    },
    include: { members: { select: memberSelect } },
  })

  res.status(201).json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: myRoleFor(project, req.user),
  })
})

router.get('/:id', requireProjectRole('member'), async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      members: { select: memberSelect },
      _count: { select: { tasks: true } },
    },
  })
  res.json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: req.projectAccess.role,
  })
})

router.patch('/:id', requireProjectRole('pm'), async (req, res) => {
  const { name, description, startAt, endAt } = req.body
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    },
    include: { members: { select: memberSelect } },
  })
  res.json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: req.projectAccess.role,
  })
})

router.delete('/:id', requireProjectRole('pm'), async (req, res) => {
  // Cascade deletes the TaskAttachment rows, but not their disk files — clean
  // those up first (spec §5.4) since the project + its tasks are about to go.
  const attachments = await prisma.taskAttachment.findMany({
    where: { task: { projectId: req.params.id } },
    select: { storageKey: true },
  })
  await deleteAttachmentFiles(attachments.map((a) => a.storageKey))

  await prisma.project.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

// --- members ---

router.get('/:id/members', requireProjectRole('member'), async (req, res) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.id },
    select: memberSelect,
    orderBy: { createdAt: 'asc' },
  })
  res.json(members.map(decryptMember))
})

router.post('/:id/members', requireProjectRole('pl'), async (req, res) => {
  const { userId, role = 'member' } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

  // Assigning pm/pl ("등급 부여") is a PM-only power — a PL can only invite
  // people in as plain members.
  if (req.projectAccess.role === 'pl' && role !== 'member') {
    return res.status(403).json({ error: 'PL은 멤버 등급으로만 초대할 수 있습니다' })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) return res.status(404).json({ error: 'User not found' })

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId } },
  })
  if (existing) return res.status(409).json({ error: 'Already a member' })

  const member = await prisma.projectMember.create({
    data: { projectId: req.params.id, userId, role },
    select: memberSelect,
  })
  res.status(201).json(decryptMember(member))
})

router.patch('/:id/members/:memberId', requireProjectRole('pm'), async (req, res) => {
  const { role } = req.body
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })

  if (role !== 'pm') {
    const problem = await assertNotLastPm(req.params.id, member, req.projectAccess.viaSiteAdmin)
    if (problem) return res.status(400).json({ error: problem })
  }

  const updated = await prisma.projectMember.update({
    where: { id: req.params.memberId },
    data: { role },
    select: memberSelect,
  })
  res.json(decryptMember(updated))
})

router.delete('/:id/members/:memberId', requireProjectRole('pl'), async (req, res) => {
  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })

  const problem = await assertNotLastPm(req.params.id, member, req.projectAccess.viaSiteAdmin)
  if (problem) return res.status(400).json({ error: problem })

  await prisma.projectMember.delete({ where: { id: req.params.memberId } })
  res.status(204).end()
})

export default router
