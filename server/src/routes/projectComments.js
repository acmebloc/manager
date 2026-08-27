import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { notifyMention } from '../lib/mailer.js'
import { wantsEmailNotifications } from '../lib/notificationPrefs.js'
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

// taskComments.js의 notifyNewMentions와 동일한 규칙: 새로 멘션된 사람에게만,
// 본인 멘션은 스킵. 프로젝트 이름은 알릴 대상이 있을 때만 조회한다.
async function notifyNewMentions({ comment, projectId, actor, newUserIds }) {
  if (newUserIds.size === 0) return
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })
  const link = `/projects/${projectId}`
  for (const mention of comment.mentions) {
    if (!newUserIds.has(mention.user.id) || mention.user.id === actor.id) continue
    if (!(await wantsEmailNotifications(mention.user.id))) continue
    const recipient = decryptUser(mention.user)
    notifyMention({
      to: recipient.email,
      actorName: actor.name,
      contextLabel: `"${project.name}" 프로젝트 댓글`,
      link,
    })
  }
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
  notifyNewMentions({
    comment,
    projectId: req.params.projectId,
    actor: req.user,
    newUserIds: new Set(mentionIds),
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

  const oldMentions = await prisma.projectCommentMention.findMany({
    where: { commentId: existing.id },
    select: { userId: true },
  })
  const oldMentionIds = new Set(oldMentions.map((m) => m.userId))

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
  const newUserIds = new Set(mentionIds.filter((id) => !oldMentionIds.has(id)))
  notifyNewMentions({ comment, projectId: req.params.projectId, actor: req.user, newUserIds })
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
