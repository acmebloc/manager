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
  reviewerId: '검수자',
  startAt: '시작일',
  endAt: '종료일',
  description: '설명',
  parentTaskId: '상위 일감',
  // 검수 산출물 파일의 등록/삭제 기록(taskReviews.js) — 필드 변경이 아니라
  // 자체 action('review_file_added'/'review_file_removed')을 쓰지만, from/toValue를
  // 그대로 통과시키기 위해 field 이름을 하나 차지한다.
  reviewFile: '검수 산출물',
}

function formatFieldValue(field, value, userNameById, taskTitleById) {
  if (field === 'assigneeId') return value ? userNameById.get(value) || '알 수 없음' : '미배정'
  if (field === 'reviewerId') return value ? userNameById.get(value) || '알 수 없음' : '미지정'
  if (field === 'parentTaskId') return value ? taskTitleById.get(value) || '알 수 없음' : '없음'
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

  // 담당자/검수자/상위일감 변경 이력에 등장하는 이름을 한 번에 조회 — 이미 프로젝트를
  // 나갔거나 삭제된 대상이라도 과거 이력에는 등장할 수 있다.
  const referencedUserIds = new Set()
  const referencedTaskIds = new Set()
  for (const a of activities) {
    if (a.field === 'assigneeId' || a.field === 'reviewerId') {
      if (a.fromValue) referencedUserIds.add(a.fromValue)
      if (a.toValue) referencedUserIds.add(a.toValue)
    }
    if (a.field === 'parentTaskId') {
      if (a.fromValue) referencedTaskIds.add(a.fromValue)
      if (a.toValue) referencedTaskIds.add(a.toValue)
    }
  }
  const [referencedUsers, referencedTasks] = await Promise.all([
    referencedUserIds.size
      ? prisma.user.findMany({ where: { id: { in: [...referencedUserIds] } }, select: userSelect })
      : [],
    referencedTaskIds.size
      ? prisma.task.findMany({ where: { id: { in: [...referencedTaskIds] } }, select: { id: true, title: true } })
      : [],
  ])
  const userNameById = new Map(referencedUsers.map((u) => [u.id, decryptUser(u).name]))
  const taskTitleById = new Map(referencedTasks.map((t) => [t.id, t.title]))

  res.json(
    activities.map((a) => ({
      id: a.id,
      actorName: a.actor ? decryptUser(a.actor).name : '알 수 없음',
      action: a.action,
      field: a.field,
      fieldLabel: a.field ? FIELD_LABELS[a.field] || a.field : null,
      fromLabel: a.field ? formatFieldValue(a.field, a.fromValue, userNameById, taskTitleById) : null,
      toLabel: a.field ? formatFieldValue(a.field, a.toValue, userNameById, taskTitleById) : null,
      createdAt: a.createdAt,
    })),
  )
})

export default router
