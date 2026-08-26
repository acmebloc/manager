import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'

// Mounted at /api/projects/:projectId/comments
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true }

const commentInclude = {
  author: { select: userSelect },
  // Same reasoning as taskComments.js: a mentioned member's ProjectMember row
  // can be gone by the time this renders, but the User row (and their
  // current name) isn't.
  mentions: { select: { user: { select: userSelect } } },
}

function decryptComment(comment, currentUserId) {
  return {
    ...comment,
    author: decryptUser(comment.author),
    mentions: comment.mentions.map((m) => decryptUser(m.user)),
    isMine: comment.authorId === currentUserId,
  }
}

// Same "client already resolved the mentions" reasoning as taskComments.js —
// silently drop anyone who isn't actually a project member instead of
// rejecting the whole comment.
async function validMentionUserIds(projectId, mentionUserIds) {
  if (!Array.isArray(mentionUserIds) || mentionUserIds.length === 0) return []
  const members = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: mentionUserIds } },
    select: { userId: true },
  })
  return members.map((m) => m.userId)
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const comments = await prisma.projectComment.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: 'asc' },
    include: commentInclude,
  })
  res.json(comments.map((c) => decryptComment(c, req.user.id)))
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const { body, mentionUserIds } = req.body
  if (!body) return res.status(400).json({ error: 'body is required' })

  const mentionIds = await validMentionUserIds(req.params.projectId, mentionUserIds)
  const comment = await prisma.projectComment.create({
    data: {
      projectId: req.params.projectId,
      authorId: req.user.id,
      body,
      mentions: { create: mentionIds.map((userId) => ({ userId })) },
    },
    include: commentInclude,
  })
  res.status(201).json(decryptComment(comment, req.user.id))
})

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.projectComment.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { body, mentionUserIds } = req.body
  if (!body) return res.status(400).json({ error: 'body is required' })

  const mentionIds = await validMentionUserIds(req.params.projectId, mentionUserIds)
  const comment = await prisma.projectComment.update({
    where: { id: existing.id },
    data: {
      body,
      mentions: {
        deleteMany: {},
        create: mentionIds.map((userId) => ({ userId })),
      },
    },
    include: commentInclude,
  })
  res.json(decryptComment(comment, req.user.id))
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.projectComment.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  await prisma.projectComment.delete({ where: { id: existing.id } })
  res.status(204).end()
})

export default router
