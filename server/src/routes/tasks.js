import ExcelJS from 'exceljs'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { notifyAssigned } from '../lib/mailer.js'
import { createNotification } from '../lib/notifications.js'
import { wantsEmailNotifications } from '../lib/notificationPrefs.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import {
  buildHeaderMap,
  existingTaskDedupeKeys,
  MAX_IMPORT_ROWS,
  normalizeIsoDateCells,
  parseImportRows,
} from '../lib/taskImport.js'
import {
  assertDateOrder,
  isValidTaskGrade,
  isValidTaskStatus,
  isValidTaskType,
} from '../lib/taskFields.js'
import { canDeleteTask, canModifyTask, taskPermissionFlags } from '../lib/taskPermissions.js'
import { deleteAttachmentFiles, taskImportUpload } from '../lib/uploads.js'

// Mounted at /api/projects/:projectId/tasks — every task belongs to a project.
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }
const linkTaskSelect = { id: true, title: true, type: true, grade: true, status: true }

const taskInclude = {
  assignee: { select: userSelect },
  createdBy: { select: userSelect },
  _count: { select: { attachments: true, comments: true } },
  checklistItems: { select: { done: true } },
}

// 상위 일감만 — POST/PATCH가 응답을 만들 때 쓴다. 상세페이지가 취소 시
// draftFromTask로 되돌아갈 기준을 다시 잡으려면 parentTask는 필요하지만,
// subtasks(하위 작업 목록 전체)는 이 두 경로에서 실제로 쓰이지 않는다 —
// 하위 작업은 TaskSubtasks.jsx가 자식 쪽에 직접 PATCH해서 로컬 state로만
// 관리하고, "내 필드"를 바꾸는 이 요청으로는 절대 바뀌지 않기 때문이다.
const taskWriteInclude = {
  ...taskInclude,
  parentTask: { select: linkTaskSelect },
}

// GET /:id 전용 — 상위/하위 일감을 전부 보여줘야 하는 유일한 곳이라 subtasks
// 목록 전체(무게가 있음)를 여기서만 포함한다. v1 스코프: 칸반 카드/테이블
// 행에는 진행률 배지를 붙이지 않고, 상세페이지에서만 계층을 보여준다.
const taskDetailInclude = {
  ...taskWriteInclude,
  subtasks: { select: { ...linkTaskSelect, assignee: { select: userSelect } } },
}

// The client never learns its own user id or site-admin flag (see
// src/lib/secureProfileStore.js — the cached session only carries
// name/email/picture), so permission gating is computed here and handed to
// it as plain booleans, the same way projects.js already hands back `myRole`
// instead of making the client re-derive it.
function decryptTask(task, memberIds, user, projectAccess) {
  return {
    ...task,
    assignee: task.assignee ? decryptUser(task.assignee) : null,
    createdBy: task.createdBy ? decryptUser(task.createdBy) : null,
    // 담당자가 프로젝트에서 빠져도 assigneeId는 그대로 두되(§4.4), UI가 비활성
    // 표시를 할 수 있도록 현재 멤버 여부를 별도로 알려준다.
    assigneeIsMember: task.assigneeId ? memberIds.has(task.assigneeId) : true,
    // GET /:id에서만 존재(taskDetailInclude) — subtasks의 assignee도 다른
    // user 객체와 동일하게 복호화를 거쳐야 한다.
    ...(task.subtasks && {
      subtasks: task.subtasks.map((s) => ({ ...s, assignee: s.assignee ? decryptUser(s.assignee) : null })),
    }),
    ...taskPermissionFlags(task, user, projectAccess),
  }
}

async function currentMemberIds(projectId) {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  })
  return new Set(members.map((m) => m.userId))
}

// 엑셀 일괄 등록의 작성자/담당자 이름 매칭 후보 목록. 탈퇴한 멤버는 실제 이름이
// DB에서 지워져 있어(decryptUser가 대신 채우는 표시용 문구) 매칭 대상에서 뺀다.
async function loadImportCandidateMembers(projectId) {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: {
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, deactivatedAt: true } },
    },
  })
  return members
    .filter((m) => !m.user.deactivatedAt)
    .map((m) => ({ ...m, user: decryptUser(m.user) }))
}

// Relationships are scoped to one project (confirmed with the user) — silently
// drop anything else, same "invalid input just doesn't apply" pattern as
// assignee/mention validation elsewhere in this file/taskComments.js. Also
// drops the task's own id, since a self-link is never meaningful.
async function sameProjectTaskIds(projectId, taskId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const candidates = ids.filter((id) => id !== taskId)
  if (candidates.length === 0) return []
  const found = await prisma.task.findMany({
    where: { id: { in: candidates }, projectId },
    select: { id: true },
  })
  return found.map((t) => t.id)
}

// Purely relational — no functional coupling: changing a linked task's
// status/fields never touches this task. Symmetric, so it's stored once but
// read from either side. (부모/자식 표시는 예전에 이 테이블의 'parent' 타입이었지만
// 실제 기능이 있는 Task.parentTaskId 계층으로 대체됐다 — 이제 이 함수는 'related'만
// 다룬다.)
//
// Delete+recreate runs inside one transaction so a save never leaves links in
// a transiently-empty (or partially applied) state if a later step in the
// same request fails.
async function applyTaskLinks(projectId, taskId, { relatedTaskIds }) {
  const operations = []

  if (relatedTaskIds !== undefined) {
    const ids = await sameProjectTaskIds(projectId, taskId, relatedTaskIds)
    operations.push(
      prisma.taskLink.deleteMany({
        where: { type: 'related', OR: [{ fromTaskId: taskId }, { toTaskId: taskId }] },
      }),
    )
    if (ids.length > 0) {
      operations.push(
        prisma.taskLink.createMany({
          data: ids.map((toTaskId) => ({ fromTaskId: taskId, toTaskId, type: 'related' })),
        }),
      )
    }
  }

  if (operations.length > 0) await prisma.$transaction(operations)
}

// 하위 작업 계층은 딱 1단계만 허용한다(서버 검증, DB 제약 아님) — 후보가 이미
// 누군가의 하위 작업이면(조부모가 생기므로) 거부하고, 이 일감 자신이 이미
// 하위 작업을 갖고 있으면(부모이면서 동시에 자식이 되므로) 거부한다.
// previousParentId와 같으면(안 바뀌는 경우) 검사를 건너뛴다. taskId가 없으면
// (생성 시점) 자기 자식 개수 검사는 스킵 — 새 일감은 아직 자식이 있을 수 없다.
async function assertValidParent(projectId, taskId, parentTaskId, previousParentId) {
  if (!parentTaskId) return null
  if (parentTaskId === previousParentId) return null
  if (parentTaskId === taskId) return '자기 자신을 상위 일감으로 지정할 수 없습니다'
  const candidate = await prisma.task.findFirst({
    where: { id: parentTaskId, projectId },
    select: { parentTaskId: true },
  })
  if (!candidate) return '상위 일감으로 지정하려는 일감이 같은 프로젝트 안에 없습니다'
  // 이 함수는 어느 쪽에서 불렸는지(상위 일감 필드를 직접 바꾼 건지, 하위 작업
  // 피커에서 다른 일감을 자식으로 추가한 건지) 모른 채로 "taskId를
  // parentTaskId의 자식으로 만들어도 되는가"만 판단한다 — 그래서 메시지도
  // "일감" 대신 항상 역할(상위/하위)로 지칭해야 어느 화면에서 떠도 뜻이
  // 통한다. "이 일감" 같은 표현은 하위 작업 피커에서 다른 일감을 추가할 때는
  // 사실 지금 보고 있는 화면의 일감(parentTaskId)을 가리키게 되어 헷갈린다.
  if (candidate.parentTaskId) return '상위 일감으로 지정하려는 일감은 이미 다른 일감의 하위 작업으로 등록되어 있어 상위 일감이 될 수 없습니다'
  if (taskId) {
    const ownChildrenCount = await prisma.task.count({ where: { parentTaskId: taskId } })
    if (ownChildrenCount > 0) return '하위 작업으로 지정하려는 일감에 이미 하위 작업이 있어 다른 일감의 하위 작업이 될 수 없습니다'
  }
  return null
}

// An assignee who isn't on the project couldn't open the task they were
// given, so reject that rather than creating one nobody can act on. Skipped
// entirely when assigneeId isn't actually changing, so a task whose assignee
// has since left the project can still be edited (see spec §4.4/§9).
async function assertAssigneeIsMember(projectId, assigneeId, previousAssigneeId) {
  if (!assigneeId) return null
  if (assigneeId === previousAssigneeId) return null
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assigneeId } },
  })
  return membership ? null : 'Assignee must be a member of this project'
}

// Fires only when the assignee is actually changing to someone new (guarded
// by callers via previousAssigneeId, same condition assertAssigneeIsMember
// skips on) — self-assignment doesn't need an email.
async function notifyIfNewAssignee(task, actor, previousAssigneeId) {
  if (!task.assigneeId || task.assigneeId === previousAssigneeId || task.assigneeId === actor.id) return
  // 호출부(POST/PATCH)가 이 함수를 await 없이 fire-and-forget으로 부르므로,
  // wantsEmailNotifications의 DB 조회가 실패하면(일시적 커넥션 장애 등) 여기서
  // 삼키지 않는 한 unhandled rejection이 돼 프로세스 전체가 죽는다
  // (mailer.js의 sendMail은 이미 안전하지만, 그 앞의 이 조회는 아니었다).
  try {
    const link = `/tasks/${task.projectId}/${task.id}`
    // 인앱 알림은 이메일 프리퍼런스와 무관하게 항상 적재한다.
    await createNotification({
      userId: task.assigneeId,
      actorId: actor.id,
      type: 'task_assigned',
      title: `"${task.title}" 담당자로 지정되었습니다`,
      link,
    })
    if (!(await wantsEmailNotifications(task.assigneeId))) return
    notifyAssigned({
      to: decryptUser(task.assignee).email,
      actorName: actor.name,
      taskTitle: task.title,
      link,
    })
  } catch (err) {
    console.error('[notify] notifyIfNewAssignee failed', { taskId: task.id, error: err.message })
  }
}

// 일감 필드 변경 이력(TaskActivity) 계산용. `data`는 prisma.task.update에 실제로
// 넘기는 조건부 스프레드 객체 그대로 — 그 안에 있는 키만 "이번 요청에서 실제로
// 바뀐 필드"다. description은 마크다운 원문이 길어질 수 있어 값 자체는 남기지
// 않고 변경됐다는 사실만 기록한다(항상 fromValue/toValue null).
const ACTIVITY_TRACKED_FIELDS = [
  'title',
  'type',
  'grade',
  'status',
  'assigneeId',
  'startAt',
  'endAt',
  'description',
  'parentTaskId',
]

function serializeActivityValue(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function computeTaskActivityChanges(existing, data) {
  const changes = []
  for (const field of ACTIVITY_TRACKED_FIELDS) {
    if (!(field in data)) continue
    if (field === 'description') {
      if (existing.description === data.description) continue
      changes.push({ field, fromValue: null, toValue: null })
      continue
    }
    const before = serializeActivityValue(existing[field])
    const after = serializeActivityValue(data[field])
    if (before === after) continue
    changes.push({ field, fromValue: before, toValue: after })
  }
  return changes
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const { status, assigneeId } = req.query
  const tasks = await prisma.task.findMany({
    where: {
      projectId: req.params.projectId,
      ...(status && isValidTaskStatus(status) && { status }),
      ...(assigneeId && { assigneeId }),
    },
    orderBy: { createdAt: 'desc' },
    include: taskInclude,
  })
  const memberIds = await currentMemberIds(req.params.projectId)
  // The board never shows description, which can now embed base64 images —
  // stripped here so a project full of illustrated tasks doesn't balloon
  // every board load. GET /:id still returns it in full, for the task page.
  res.json(
    tasks.map((t) => {
      const { description: _description, ...rest } = decryptTask(t, memberIds, req.user, req.projectAccess)
      return rest
    }),
  )
})

// Standalone task page (TaskFormPage.jsx) needs to load one task directly —
// a direct link or refresh can't rely on the board's already-fetched list.
router.get('/:id', requireProjectRole('member'), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
    include: taskDetailInclude,
  })
  if (!task) return res.status(404).json({ error: 'Not found' })
  const memberIds = await currentMemberIds(req.params.projectId)
  res.json(decryptTask(task, memberIds, req.user, req.projectAccess))
})

// 'related'(연결일감)만 남았다 — 부모/자식은 Task.parentTaskId 계층으로 대체됨.
router.get('/:id/links', requireProjectRole('member'), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
    select: { id: true },
  })
  if (!task) return res.status(404).json({ error: 'Not found' })

  const relatedLinks = await prisma.taskLink.findMany({
    where: { type: 'related', OR: [{ fromTaskId: task.id }, { toTaskId: task.id }] },
    select: { fromTaskId: true, fromTask: { select: linkTaskSelect }, toTask: { select: linkTaskSelect } },
  })

  res.json({
    related: relatedLinks.map((l) => (l.fromTaskId === task.id ? l.toTask : l.fromTask)),
  })
})

router.post('/', requireProjectRole('member'), async (req, res) => {
  const {
    title,
    description,
    type,
    grade,
    status,
    assigneeId,
    startAt,
    endAt,
    parentTaskId,
    relatedTaskIds,
  } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })
  if (type !== undefined && !isValidTaskType(type)) {
    return res.status(400).json({ error: 'Invalid type' })
  }
  if (grade !== undefined && !isValidTaskGrade(grade)) {
    return res.status(400).json({ error: 'Invalid grade' })
  }
  if (status !== undefined && !isValidTaskStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const dateProblem = assertDateOrder(startAt, endAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  const problem = await assertAssigneeIsMember(req.params.projectId, assigneeId, null)
  if (problem) return res.status(400).json({ error: problem })

  const parentProblem = await assertValidParent(req.params.projectId, null, parentTaskId, null)
  if (parentProblem) return res.status(400).json({ error: parentProblem })

  const task = await prisma.task.create({
    data: {
      projectId: req.params.projectId,
      title,
      description,
      type: type || 'plan',
      grade: grade || 'minor',
      status: status || 'todo',
      createdById: req.user.id,
      assigneeId: assigneeId || null,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      parentTaskId: parentTaskId || null,
    },
    include: taskWriteInclude,
  })
  await applyTaskLinks(req.params.projectId, task.id, { relatedTaskIds })
  await prisma.taskActivity.create({ data: { taskId: task.id, actorId: req.user.id, action: 'created' } })
  notifyIfNewAssignee(task, req.user, null)
  const memberIds = await currentMemberIds(req.params.projectId)
  res.status(201).json(decryptTask(task, memberIds, req.user, req.projectAccess))
})

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (!canModifyTask(existing, req.user, req.projectAccess)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const {
    title,
    description,
    type,
    grade,
    status,
    assigneeId,
    startAt,
    endAt,
    parentTaskId,
    relatedTaskIds,
  } = req.body
  if (type !== undefined && !isValidTaskType(type)) {
    return res.status(400).json({ error: 'Invalid type' })
  }
  if (grade !== undefined && !isValidTaskGrade(grade)) {
    return res.status(400).json({ error: 'Invalid grade' })
  }
  if (status !== undefined && !isValidTaskStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const nextStartAt = startAt !== undefined ? startAt : existing.startAt
  const nextEndAt = endAt !== undefined ? endAt : existing.endAt
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  if (assigneeId !== undefined) {
    const problem = await assertAssigneeIsMember(req.params.projectId, assigneeId, existing.assigneeId)
    if (problem) return res.status(400).json({ error: problem })
  }

  if (parentTaskId !== undefined) {
    const parentProblem = await assertValidParent(
      req.params.projectId,
      req.params.id,
      parentTaskId,
      existing.parentTaskId,
    )
    if (parentProblem) return res.status(400).json({ error: parentProblem })
  }

  const data = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(type !== undefined && { type }),
    ...(grade !== undefined && { grade }),
    ...(status !== undefined && { status }),
    ...(assigneeId !== undefined && { assigneeId: assigneeId || null }),
    ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
    ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    ...(parentTaskId !== undefined && { parentTaskId: parentTaskId || null }),
  }
  const activityChanges = computeTaskActivityChanges(existing, data)
  // 마감일이 바뀌면 이전 마감 기준으로 이미 보낸 D-3 리마인더는 새 날짜에
  // 유효하지 않다 — 다시 보낼 수 있도록 리셋.
  if (activityChanges.some((c) => c.field === 'endAt')) data.dueReminderLastDaysLeft = null

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data,
    include: taskWriteInclude,
  })
  await applyTaskLinks(req.params.projectId, task.id, { relatedTaskIds })
  if (activityChanges.length > 0) {
    await prisma.taskActivity.createMany({
      data: activityChanges.map((c) => ({ taskId: task.id, actorId: req.user.id, action: 'field_changed', ...c })),
    })
  }
  notifyIfNewAssignee(task, req.user, existing.assigneeId)
  const memberIds = await currentMemberIds(req.params.projectId)
  res.json(decryptTask(task, memberIds, req.user, req.projectAccess))
})

// Backs the project Gantt chart (일정 메뉴) — any project member may drag a
// task's bar to reschedule it there, which is a broader edit right than the
// task's own PATCH allows (canModifyTask: admin/creator/assignee only). This
// route only ever touches startAt/endAt, never the rest of the task, so that
// broader right can't be used to sneak in other field changes.
router.patch('/:id/dates', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { startAt, endAt } = req.body
  const nextStartAt = startAt !== undefined ? startAt : existing.startAt
  const nextEndAt = endAt !== undefined ? endAt : existing.endAt
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  const data = {
    ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
    ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
  }
  const activityChanges = computeTaskActivityChanges(existing, data)
  if (activityChanges.some((c) => c.field === 'endAt')) data.dueReminderLastDaysLeft = null

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data,
    include: taskInclude,
  })
  if (activityChanges.length > 0) {
    await prisma.taskActivity.createMany({
      data: activityChanges.map((c) => ({ taskId: task.id, actorId: req.user.id, action: 'field_changed', ...c })),
    })
  }
  const memberIds = await currentMemberIds(req.params.projectId)
  res.json(decryptTask(task, memberIds, req.user, req.projectAccess))
})

router.delete('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (!canDeleteTask(existing, req.user, req.projectAccess)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // Attachments cascade at the DB level, but their disk files don't — clean
  // those up first (spec §5.4).
  const attachments = await prisma.taskAttachment.findMany({
    where: { taskId: req.params.id },
    select: { storageKey: true },
  })
  await deleteAttachmentFiles(attachments.map((a) => a.storageKey))

  await prisma.task.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

// 엑셀 업로드 → 헤더 매핑 → 파싱 결과만 반환(DB 쓰기 없음). 프로젝트 상세페이지의
// "검수(미리보기)" 단계가 이 응답을 그대로 화면에 그린다.
router.post('/import/preview', requireProjectRole('pm'), (req, res) => {
  taskImportUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'file is required' })

    const workbook = new ExcelJS.Workbook()
    try {
      const buffer = await normalizeIsoDateCells(req.file.buffer)
      await workbook.xlsx.load(buffer)
    } catch {
      return res.status(400).json({ error: '엑셀 파일을 읽을 수 없습니다' })
    }

    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
      return res
        .status(400)
        .json({ error: '엑셀 파일에서 시트를 찾을 수 없습니다. 올바른 .xlsx 파일인지 확인해주세요' })
    }

    let headerMap
    try {
      headerMap = buildHeaderMap(worksheet.getRow(1))
    } catch (headerErr) {
      return res.status(400).json({ error: headerErr.message })
    }

    if (worksheet.lastRow && worksheet.lastRow.number - 1 > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `한 번에 최대 ${MAX_IMPORT_ROWS}행까지 처리할 수 있습니다` })
    }

    const members = await loadImportCandidateMembers(req.params.projectId)
    const rows = parseImportRows(worksheet, headerMap, members)

    const existingTasks = await prisma.task.findMany({
      where: { projectId: req.params.projectId },
      select: { title: true, startAt: true, endAt: true },
    })

    res.json({
      rows,
      existingTaskKeys: existingTaskDedupeKeys(existingTasks),
      // 검수 화면의 담당자/작성자 드롭다운용 — 이름만 필요하니 role/createdAt은
      // 뺀다(어차피 firstPm 계산은 서버가 파싱 단계에서 이미 끝냈다).
      members: members.map((m) => ({ userId: m.userId, name: m.user.name })),
    })
  })
})

// 미리보기(검수 화면)에서 사용자가 체크·수정까지 마친 행 목록을 그대로 받아
// 실제로 일감을 생성한다. 검수 화면 자체가 이미 제목 필수/날짜 순서를 막고
// 있으므로 정상적인 사용에서는 걸릴 일이 없지만, 프리뷰와 커밋 사이에 담당자가
// 프로젝트에서 빠졌을 수 있어 담당자만 다시 검증하고 — 문제가 있으면 그 행
// 전체를 버리지 않고 미배정으로 낮춰 등록을 계속한다.
router.post('/import/commit', requireProjectRole('pm'), async (req, res) => {
  const { rows } = req.body
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' })
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(400).json({ error: `한 번에 최대 ${MAX_IMPORT_ROWS}행까지 처리할 수 있습니다` })
  }

  const created = []
  const failed = []

  for (const row of rows) {
    if (!row.title) {
      failed.push({ rowNumber: row.rowNumber, error: 'title is required' })
      continue
    }
    const dateProblem = assertDateOrder(row.startAt, row.endAt)
    if (dateProblem) {
      failed.push({ rowNumber: row.rowNumber, error: dateProblem })
      continue
    }

    const assigneeProblem = await assertAssigneeIsMember(req.params.projectId, row.assigneeId, null)
    const assigneeId = assigneeProblem ? null : row.assigneeId || null

    // createdById는 assigneeId와 달리 프로젝트 멤버 여부를 다시 검증하지 않고
    // 그대로 저장한다(작성자는 FK만 유효하면 되고, 프로젝트 멤버일 필요는
    // 없다 — 검수 화면의 드롭다운도 항상 유효한 멤버 id만 보내지만, 이 API를
    // 직접 호출하는 경우까지 대비해 존재하지 않는 id면 여기서 막는다). create가
    // FK 제약 위반 등으로 reject되면(Express 4는 이 라우트를 await하지 않아
    // 잡지 않은 reject가 요청을 응답 없이 그대로 멈춰버린다 — index.js의
    // unhandledRejection 핸들러는 로그만 남기지 응답을 대신 보내주지 않는다)
    // 그 행만 실패 처리하고 나머지 행 등록은 계속 진행한다.
    let task
    try {
      task = await prisma.task.create({
        data: {
          projectId: req.params.projectId,
          title: row.title,
          createdById: row.createdById || null,
          assigneeId,
          startAt: row.startAt ? new Date(row.startAt) : null,
          endAt: row.endAt ? new Date(row.endAt) : null,
        },
        include: taskInclude,
      })
    } catch (err) {
      failed.push({ rowNumber: row.rowNumber, error: err.message })
      continue
    }
    created.push(task)
    // 일감 생성 자체는 이미 성공했다 — 활동 로그 기록이 실패하더라도(위 catch와
    // 묶여 있으면 방금 만든 일감이 "실패한 행"으로 잘못 보고된다) 그 행을
    // failed로 되돌리지 않고 로그만 남긴다.
    try {
      await prisma.taskActivity.create({ data: { taskId: task.id, actorId: req.user.id, action: 'created' } })
    } catch (err) {
      console.error('[taskActivity] import/commit logging failed', { taskId: task.id, error: err.message })
    }
  }

  const memberIds = await currentMemberIds(req.params.projectId)
  res.status(201).json({
    created: created.map((t) => decryptTask(t, memberIds, req.user, req.projectAccess)),
    failed,
  })
})

export default router
