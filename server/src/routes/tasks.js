import ExcelJS from 'exceljs'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { notifyAssigned } from '../lib/mailer.js'
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

const taskInclude = {
  assignee: { select: userSelect },
  createdBy: { select: userSelect },
  _count: { select: { attachments: true, comments: true } },
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

const linkTaskSelect = { id: true, title: true, type: true, grade: true, status: true }

// Purely relational — no functional coupling (confirmed with the user):
// changing a linked task's status/fields never touches this task. 'parent'
// is directional (fromTask is the child); "children" is just the reverse
// query, not a separate stored type. 'related' is symmetric, so it's stored
// once but read from either side.
//
// Each type's delete+recreate pair runs inside one transaction so a save
// never leaves that type's links in a transiently-empty (or partially
// applied) state if a later step in the same request fails.
async function applyTaskLinks(projectId, taskId, { parentTaskIds, childTaskIds, relatedTaskIds }) {
  const operations = []

  if (parentTaskIds !== undefined) {
    const ids = await sameProjectTaskIds(projectId, taskId, parentTaskIds)
    operations.push(prisma.taskLink.deleteMany({ where: { fromTaskId: taskId, type: 'parent' } }))
    if (ids.length > 0) {
      operations.push(
        prisma.taskLink.createMany({
          data: ids.map((toTaskId) => ({ fromTaskId: taskId, toTaskId, type: 'parent' })),
        }),
      )
    }
  }
  if (childTaskIds !== undefined) {
    const ids = await sameProjectTaskIds(projectId, taskId, childTaskIds)
    operations.push(prisma.taskLink.deleteMany({ where: { toTaskId: taskId, type: 'parent' } }))
    if (ids.length > 0) {
      operations.push(
        prisma.taskLink.createMany({
          data: ids.map((fromTaskId) => ({ fromTaskId, toTaskId: taskId, type: 'parent' })),
        }),
      )
    }
  }
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
    if (!(await wantsEmailNotifications(task.assigneeId))) return
    notifyAssigned({
      to: decryptUser(task.assignee).email,
      actorName: actor.name,
      taskTitle: task.title,
      link: `/tasks/${task.projectId}/${task.id}`,
    })
  } catch (err) {
    console.error('[notify] notifyIfNewAssignee failed', { taskId: task.id, error: err.message })
  }
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
    include: taskInclude,
  })
  if (!task) return res.status(404).json({ error: 'Not found' })
  const memberIds = await currentMemberIds(req.params.projectId)
  res.json(decryptTask(task, memberIds, req.user, req.projectAccess))
})

router.get('/:id/links', requireProjectRole('member'), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
    select: { id: true },
  })
  if (!task) return res.status(404).json({ error: 'Not found' })

  const [parentLinks, childLinks, relatedLinks] = await Promise.all([
    prisma.taskLink.findMany({
      where: { fromTaskId: task.id, type: 'parent' },
      select: { toTask: { select: linkTaskSelect } },
    }),
    prisma.taskLink.findMany({
      where: { toTaskId: task.id, type: 'parent' },
      select: { fromTask: { select: linkTaskSelect } },
    }),
    prisma.taskLink.findMany({
      where: { type: 'related', OR: [{ fromTaskId: task.id }, { toTaskId: task.id }] },
      select: { fromTaskId: true, fromTask: { select: linkTaskSelect }, toTask: { select: linkTaskSelect } },
    }),
  ])

  res.json({
    parents: parentLinks.map((l) => l.toTask),
    children: childLinks.map((l) => l.fromTask),
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
    parentTaskIds,
    childTaskIds,
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
    },
    include: taskInclude,
  })
  await applyTaskLinks(req.params.projectId, task.id, { parentTaskIds, childTaskIds, relatedTaskIds })
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
    parentTaskIds,
    childTaskIds,
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

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(type !== undefined && { type }),
      ...(grade !== undefined && { grade }),
      ...(status !== undefined && { status }),
      ...(assigneeId !== undefined && { assigneeId: assigneeId || null }),
      ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    },
    include: taskInclude,
  })
  await applyTaskLinks(req.params.projectId, task.id, { parentTaskIds, childTaskIds, relatedTaskIds })
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

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    },
    include: taskInclude,
  })
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

    const task = await prisma.task.create({
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
    created.push(task)
  }

  const memberIds = await currentMemberIds(req.params.projectId)
  res.status(201).json({
    created: created.map((t) => decryptTask(t, memberIds, req.user, req.projectAccess)),
    failed,
  })
})

export default router
