import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { notifyMention } from '../lib/mailer.js'
import { wantsEmailNotifications } from '../lib/notificationPrefs.js'
import { requireProjectRole } from '../lib/projectAccess.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/comments
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true }

const commentInclude = {
  author: { select: userSelect },
  // Full user info, not just the id — a mentioned member's ProjectMember row
  // can be gone by the time this renders, but the User row (and their
  // current name) isn't, so the client can still resolve a departed
  // member's up-to-date name (spec §6.2's "renamed" case, extended to the
  // "left the project" case too).
  mentions: { select: { user: { select: userSelect } } },
}

// Same reasoning as tasks.js's decryptTask: the client never learns its own
// user id, so the author-only edit/delete rule is resolved here.
function decryptComment(comment, currentUserId) {
  return {
    ...comment,
    author: decryptUser(comment.author),
    mentions: comment.mentions.map((m) => decryptUser(m.user)),
    isMine: comment.authorId === currentUserId,
  }
}

async function loadTask(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
  })
  if (!task) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return task
}

// The client already knows exactly who it mentioned (it built the
// :mention[id] directives), so it sends the resolved ids directly instead
// of the server re-parsing them out of the body. Silently drop anyone who
// isn't actually a project member rather than reject the whole comment —
// a stale mention shouldn't block posting.
async function validMentionUserIds(projectId, mentionUserIds) {
  if (!Array.isArray(mentionUserIds) || mentionUserIds.length === 0) return []
  const members = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: mentionUserIds } },
    select: { userId: true },
  })
  return members.map((m) => m.userId)
}

// 새로 멘션된 사람에게만 메일 — 이미 멘션돼 있던 사람을 댓글 수정할 때마다
// 다시 알리지 않는다. 본인이 자기 자신을 멘션한 경우도 스킵.
async function notifyNewMentions({ comment, task, actor, newUserIds }) {
  if (newUserIds.size === 0) return
  const link = `/tasks/${task.projectId}/${task.id}`
  for (const mention of comment.mentions) {
    if (!newUserIds.has(mention.user.id) || mention.user.id === actor.id) continue
    // 호출부가 이 함수를 await 없이 fire-and-forget으로 부르므로, 멘션 한 명
    // 처리 중 DB 조회가 실패해도 나머지 멘션 알림을 계속 시도하고 프로세스가
    // 죽지 않도록 멘션별로 감싼다.
    try {
      if (!(await wantsEmailNotifications(mention.user.id))) continue
      const recipient = decryptUser(mention.user)
      notifyMention({
        to: recipient.email,
        actorName: actor.name,
        contextLabel: `"${task.title}" 일감 댓글`,
        link,
      })
    } catch (err) {
      console.error('[notify] notifyNewMentions failed', {
        commentId: comment.id,
        userId: mention.user.id,
        error: err.message,
      })
    }
  }
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const comments = await prisma.taskComment.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
    include: commentInclude,
  })
  res.json(comments.map((c) => decryptComment(c, req.user.id)))
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const { body, mentionUserIds } = req.body
  if (!body) return res.status(400).json({ error: 'body is required' })

  const mentionIds = await validMentionUserIds(req.params.projectId, mentionUserIds)
  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorId: req.user.id,
      body,
      mentions: { create: mentionIds.map((userId) => ({ userId })) },
    },
    include: commentInclude,
  })
  notifyNewMentions({ comment, task, actor: req.user, newUserIds: new Set(mentionIds) })
  res.status(201).json(decryptComment(comment, req.user.id))
})

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const existing = await prisma.taskComment.findFirst({
    where: { id: req.params.id, taskId: task.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { body, mentionUserIds } = req.body
  if (!body) return res.status(400).json({ error: 'body is required' })

  const oldMentions = await prisma.taskCommentMention.findMany({
    where: { commentId: existing.id },
    select: { userId: true },
  })
  const oldMentionIds = new Set(oldMentions.map((m) => m.userId))

  const mentionIds = await validMentionUserIds(req.params.projectId, mentionUserIds)
  const comment = await prisma.taskComment.update({
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
  notifyNewMentions({ comment, task, actor: req.user, newUserIds })
  res.json(decryptComment(comment, req.user.id))
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const existing = await prisma.taskComment.findFirst({
    where: { id: req.params.id, taskId: task.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  await prisma.taskComment.delete({ where: { id: existing.id } })
  res.status(204).end()
})

export default router
