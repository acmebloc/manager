import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { taskGradeLabel, taskStatusLabel, taskTypeLabel } from '../lib/taskFields.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/activity — read-only,
// entries are written internally by tasks.js's own mutation handlers.
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }

const FIELD_LABELS = {
  title: '제목',
  type: '유형',
  grade: '등급',
  status: '상태',
  assigneeId: '담당자',
  startAt: '시작일',
  endAt: '종료일',
  description: '설명',
}

function formatFieldValue(field, value, userNameById) {
  if (field === 'assigneeId') return value ? userNameById.get(value) || '알 수 없음' : '미배정'
  if (value === null || value === undefined) return null
  if (field === 'type') return taskTypeLabel(value)
  if (field === 'grade') return taskGradeLabel(value)
  if (field === 'status') return taskStatusLabel(value)
  if (field === 'startAt' || field === 'endAt') return new Date(value).toLocaleDateString('ko-KR')
  return value
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    select: { id: true },
  })
  if (!task) return res.status(404).json({ error: 'Not found' })

  const activities = await prisma.taskActivity.findMany({
    where: { taskId: req.params.taskId },
    orderBy: { createdAt: 'desc' },
    include: { actor: { select: userSelect } },
  })

  // 담당자 변경 이력에 등장하는 사용자 이름을 한 번에 조회 — 이미 프로젝트를
  // 나갔거나 담당자가 아니게 된 사람도 과거 이력에는 등장할 수 있다.
  const referencedUserIds = new Set()
  for (const a of activities) {
    if (a.field !== 'assigneeId') continue
    if (a.fromValue) referencedUserIds.add(a.fromValue)
    if (a.toValue) referencedUserIds.add(a.toValue)
  }
  const referencedUsers = referencedUserIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...referencedUserIds] } }, select: userSelect })
    : []
  const userNameById = new Map(referencedUsers.map((u) => [u.id, decryptUser(u).name]))

  res.json(
    activities.map((a) => ({
      id: a.id,
      actorName: a.actor ? decryptUser(a.actor).name : '알 수 없음',
      action: a.action,
      field: a.field,
      fieldLabel: a.field ? FIELD_LABELS[a.field] || a.field : null,
      fromLabel: a.field ? formatFieldValue(a.field, a.fromValue, userNameById) : null,
      toLabel: a.field ? formatFieldValue(a.field, a.toValue, userNameById) : null,
      createdAt: a.createdAt,
    })),
  )
})

export default router
