import { Router } from 'express'
import { prisma } from '../db.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { canEditTaskFields } from '../lib/taskPermissions.js'

// Mounted at /api/projects/:projectId/tasks/:taskId/checklist — a light
// add/toggle/delete list, not user-authored content like comments, so there's
// no "only the author can edit" rule: anyone who can modify the task
// (canEditTaskFields — admin/creator/assignee/reviewer) can touch its checklist
// items. 완료된 일감은 통째로 잠기므로 체크 토글도 막힌다
// (docs/task-review-spec.md 8장).
const router = Router({ mergeParams: true })

function checklistDenyMessage(task) {
  if (task.status === 'done') return '완료된 일감은 체크리스트를 변경할 수 없습니다'
  return 'Forbidden'
}

async function loadTask(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    // status와 reviewerId는 권한 판정(canEditTaskFields)에 필요하다 — 완료
    // 잠금과 검수자 여부를 여기서 같이 본다.
    select: { id: true, status: true, createdById: true, assigneeId: true, reviewerId: true },
  })
  if (!task) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return task
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return

  const items = await prisma.taskChecklistItem.findMany({
    where: { taskId: task.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  res.json(items)
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canEditTaskFields(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: checklistDenyMessage(task) })
  }

  const { text } = req.body
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' })

  // 새 항목은 항상 맨 뒤 — 현재 가장 큰 order보다 1 크게.
  const last = await prisma.taskChecklistItem.findFirst({
    where: { taskId: task.id },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const item = await prisma.taskChecklistItem.create({
    data: { taskId: task.id, text: text.trim(), order: (last?.order ?? -1) + 1 },
  })
  res.status(201).json(item)
})

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canEditTaskFields(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: checklistDenyMessage(task) })
  }

  const existing = await prisma.taskChecklistItem.findFirst({
    where: { id: req.params.id, taskId: task.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  // order는 GET /의 정렬 기준으로만 쓰이고, 지금은 재정렬 UI 자체가 없어
  // 여기서 받지 않는다 — 나중에 드래그 재정렬이 생기면 그때 추가한다.
  const { done } = req.body
  const item = await prisma.taskChecklistItem.update({
    where: { id: existing.id },
    data: { ...(done !== undefined && { done: Boolean(done) }) },
  })
  res.json(item)
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await loadTask(req, res)
  if (!task) return
  if (!canEditTaskFields(task, req.user, req.projectAccess)) {
    return res.status(403).json({ error: checklistDenyMessage(task) })
  }

  const existing = await prisma.taskChecklistItem.findFirst({
    where: { id: req.params.id, taskId: task.id },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  await prisma.taskChecklistItem.delete({ where: { id: existing.id } })
  res.status(204).end()
})

export default router
