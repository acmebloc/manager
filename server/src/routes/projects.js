import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { isValidRole, requireProjectRole } from '../lib/projectAccess.js'

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

// Only projects the caller belongs to. Membership covers the owner too, so
// there's no separate "or I own it" branch.
router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: req.user.id } } },
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
      myRole: project.members.find((m) => m.userId === req.user.id)?.role,
      isOwner: project.ownerId === req.user.id,
    })),
  )
})

// Creating a project also enrolls the creator as an admin member, in one
// transaction — a project with no members would be invisible to everyone,
// including the person who just made it.
router.post('/', async (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const project = await prisma.project.create({
    data: {
      name,
      description,
      ownerId: req.user.id,
      members: { create: { userId: req.user.id, role: 'admin' } },
    },
    include: { members: { select: memberSelect } },
  })

  res.status(201).json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: 'admin',
    isOwner: true,
  })
})

router.get('/:id', requireProjectRole('viewer'), async (req, res) => {
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
    isOwner: req.projectAccess.isOwner,
  })
})

router.patch('/:id', requireProjectRole('admin'), async (req, res) => {
  const { name, description } = req.body
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
    },
    include: { members: { select: memberSelect } },
  })
  res.json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: req.projectAccess.role,
    isOwner: req.projectAccess.isOwner,
  })
})

// Deleting takes the whole project's contents with it, so it stays with the
// owner rather than any admin.
router.delete('/:id', requireProjectRole('admin'), async (req, res) => {
  if (!req.projectAccess.isOwner) {
    return res.status(403).json({ error: 'Only the project owner can delete it' })
  }
  await prisma.project.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

// --- members ---

router.get('/:id/members', requireProjectRole('viewer'), async (req, res) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.id },
    select: memberSelect,
    orderBy: { createdAt: 'asc' },
  })
  res.json(members.map(decryptMember))
})

router.post('/:id/members', requireProjectRole('admin'), async (req, res) => {
  const { userId, role = 'member' } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

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

router.patch('/:id/members/:memberId', requireProjectRole('admin'), async (req, res) => {
  const { role } = req.body
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })
  if (member.userId === req.projectAccess.project.ownerId) {
    return res.status(403).json({ error: "The owner's role cannot be changed" })
  }

  const updated = await prisma.projectMember.update({
    where: { id: req.params.memberId },
    data: { role },
    select: memberSelect,
  })
  res.json(decryptMember(updated))
})

router.delete('/:id/members/:memberId', requireProjectRole('admin'), async (req, res) => {
  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })
  if (member.userId === req.projectAccess.project.ownerId) {
    return res.status(403).json({ error: 'The owner cannot be removed' })
  }

  await prisma.projectMember.delete({ where: { id: req.params.memberId } })
  res.status(204).end()
})

export default router
