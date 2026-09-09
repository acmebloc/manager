import ExcelJS from 'exceljs'
import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import {
  notifyAssigned,
  notifyReviewApproved,
  notifyReviewerAssigned,
  notifyReviewRejected,
  notifyReviewRequested,
} from '../lib/mailer.js'
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
import { canDeleteTask, canModifyTask, taskPermissionFlags, taskRoles } from '../lib/taskPermissions.js'
import { buildReviewPayload } from '../lib/taskReview.js'
import { resolveTransition } from '../lib/taskTransitions.js'
import { deleteAttachmentFiles, taskImportUpload } from '../lib/uploads.js'

// Mounted at /api/projects/:projectId/tasks — every task belongs to a project.
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }
const linkTaskSelect = { id: true, title: true, type: true, grade: true, status: true }

const taskInclude = {
  assignee: { select: userSelect },
  createdBy: { select: userSelect },
  // 산출물 파일(reviewId가 있는 첨부)은 첨부파일 개수에서 뺀다 — 칸반 카드의
  // "첨부 N" 배지가 검수 이력에 딸린 파일까지 세면 상세페이지의 첨부파일 목록
  // (같은 조건으로 걸러진다)과 숫자가 어긋난다. myTasks.js도 같은 조건을 손으로
  // 맞춰둔다.
  _count: { select: { attachments: { where: { reviewId: null } }, comments: true } },
  checklistItems: { select: { done: true } },
}

// 검수자·상위 일감·참조자 — POST/PATCH가 응답을 만들 때 쓴다. 상세페이지가
// 취소 시 draftFromTask로 되돌아갈 기준을 다시 잡으려면 셋 다 필요하지만,
// subtasks(하위 작업 목록 전체)는 이 두 경로에서 실제로 쓰이지 않는다 —
// 하위 작업은 TaskSubtasks.jsx가 자식 쪽에 직접 PATCH해서 로컬 state로만
// 관리하고, "내 필드"를 바꾸는 이 요청으로는 절대 바뀌지 않기 때문이다.
//
// 이 셋을 목록/보드용 taskInclude에 넣지 않는 이유는 같다: 칸반과 목록 뷰는
// 검수자 이름도 참조자도 보여주지 않는데, 넣으면 일감 하나마다 조인이 늘고
// 이름·이메일 복호화(fieldCrypto.js의 실제 AES 연산)까지 매번 돌게 된다.
// 권한 판정에 필요한 건 스칼라 reviewerId뿐이고 그건 항상 실려온다.
const taskWriteInclude = {
  ...taskInclude,
  reviewer: { select: userSelect },
  parentTask: { select: linkTaskSelect },
  followers: { select: { user: { select: userSelect } } },
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
    // 검수자는 taskWriteInclude/taskDetailInclude에서만 실려온다(위 주석 참고) —
    // 없는 경우 키 자체를 만들지 않아야 목록 응답이 "검수자 없음(null)"으로
    // 잘못 읽히지 않는다.
    ...(task.reviewer !== undefined && { reviewer: task.reviewer ? decryptUser(task.reviewer) : null }),
    // 담당자가 프로젝트에서 빠져도 assigneeId는 그대로 두되(§4.4), UI가 비활성
    // 표시를 할 수 있도록 현재 멤버 여부를 별도로 알려준다. 검수자도 같은 규칙.
    assigneeIsMember: task.assigneeId ? memberIds.has(task.assigneeId) : true,
    reviewerIsMember: task.reviewerId ? memberIds.has(task.reviewerId) : true,
    // taskWriteInclude/taskDetailInclude에서만 존재 — 조인 테이블 모양을 벗기고
    // 사용자 배열로 평평하게 내려준다(일정의 참조자와 같은 형태).
    ...(task.followers && { followers: task.followers.map((f) => decryptUser(f.user)) }),
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
// entirely when the id isn't actually changing, so a task whose assignee
// has since left the project can still be edited (see spec §4.4/§9). 검수자도
// 같은 규칙을 따르므로 메시지만 호출부가 정해서 넘긴다.
async function assertProjectMember(projectId, userId, previousUserId, message) {
  if (!userId) return null
  if (userId === previousUserId) return null
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  return membership ? null : message
}

const ASSIGNEE_NOT_MEMBER = 'Assignee must be a member of this project'
const REVIEWER_NOT_MEMBER = '검수자는 이 프로젝트의 멤버여야 합니다'

// 담당자와 검수자는 같은 사람일 수 없다 — 어느 쪽 필드를 바꿔서 충돌하든 같은
// 메시지로 막아야 하므로, 이번 요청이 끝난 뒤의 값 두 개를 함께 보고 판단한다
// (한쪽만 검사하면 "담당자를 검수자와 같은 사람으로 바꾸는" 방향이 새어나간다).
function assertAssigneeReviewerDistinct(assigneeId, reviewerId) {
  if (!assigneeId || !reviewerId) return null
  if (assigneeId !== reviewerId) return null
  return '담당자와 검수자는 같은 사람일 수 없습니다'
}

// 참조자(TaskFollower)는 프로젝트에 참여한 인원만 배정할 수 있다 — 멤버가 아닌
// id는 조용히 버린다(sameProjectTaskIds와 같은 "유효하지 않은 입력은 그냥
// 적용되지 않는다" 패턴). 일정의 참조자와 달리 전체 사용자 범위는 없다.
// applyTaskLinks처럼 삭제+생성을 한 트랜잭션으로 묶어, 중간에 실패해도 참조자가
// 비어버린 상태로 남지 않게 한다.
async function applyTaskFollowers(projectId, taskId, followerIds) {
  if (!Array.isArray(followerIds)) return
  const unique = [...new Set(followerIds.filter((id) => typeof id === 'string'))]
  const members =
    unique.length > 0
      ? await prisma.projectMember.findMany({
          where: { projectId, userId: { in: unique } },
          select: { userId: true },
        })
      : []

  const operations = [prisma.taskFollower.deleteMany({ where: { taskId } })]
  if (members.length > 0) {
    operations.push(
      prisma.taskFollower.createMany({ data: members.map((m) => ({ taskId, userId: m.userId })) }),
    )
  }
  await prisma.$transaction(operations)
}

// 참조자만 따로 다시 읽는다 — 갱신(applyTaskFollowers)이 task 저장과 다른
// 트랜잭션이라, 저장 응답에 실려온 followers는 갱신 전 값이다.
async function loadFollowers(taskId) {
  const rows = await prisma.taskFollower.findMany({
    where: { taskId },
    select: { user: { select: userSelect } },
  })
  return rows.map((r) => decryptUser(r.user))
}

// 인앱 알림은 이메일 프리퍼런스와 무관하게 항상 적재하고, 메일은 토글이 켜져
// 있을 때만 보낸다. 본인이 스스로 한 일에는 알림을 보내지 않는다.
async function notifyOne({ userId, user, actor, type, title, link, taskTitle, sendMail }) {
  if (!userId || userId === actor.id) return
  await createNotification({ userId, actorId: actor.id, type, title, link })
  if (!sendMail || !user) return
  if (!(await wantsEmailNotifications(userId))) return
  sendMail({ to: decryptUser(user).email, actorName: actor.name, taskTitle, link })
}

// 담당자/검수자가 실제로 새 사람으로 바뀔 때만 발송한다 — 자기 자신을 지정한
// 경우는 notifyOne이 걸러낸다.
//
// 호출부(POST/PATCH)가 이 함수를 await 없이 fire-and-forget으로 부르므로,
// 안에서 무엇이 실패하든(일시적 DB 커넥션 장애 등) 여기서 삼키지 않으면
// unhandled rejection이 돼 프로세스 전체가 위험해진다(index.js 주석 참고).
async function notifyPeopleChanges(task, actor, previous, { skipReviewer = false } = {}) {
  try {
    const link = `/tasks/${task.projectId}/${task.id}`
    if (task.assigneeId !== previous.assigneeId) {
      await notifyOne({
        userId: task.assigneeId,
        user: task.assignee,
        actor,
        type: 'task_assigned',
        title: `"${task.title}" 담당자로 지정되었습니다`,
        link,
        taskTitle: task.title,
        sendMail: notifyAssigned,
      })
    }
    // 검수요청과 동시에 검수자가 지정된 경우엔 "검수자로 지정되었습니다"를 보내지
    // 않는다 — 바로 뒤이어 나가는 "검수를 요청받았습니다"가 같은 사람에게 같은
    // 일감을 가리키는 중복 알림이 되기 때문이다.
    if (!skipReviewer && task.reviewerId !== previous.reviewerId) {
      await notifyOne({
        userId: task.reviewerId,
        user: task.reviewer,
        actor,
        type: 'task_reviewer_assigned',
        title: `"${task.title}" 검수자로 지정되었습니다`,
        link,
        taskTitle: task.title,
        sendMail: notifyReviewerAssigned,
      })
    }
  } catch (err) {
    console.error('[notify] notifyPeopleChanges failed', { taskId: task.id, error: err.message })
  }
}

// 검수 흐름 알림(docs/task-review-spec.md 5장) — "공을 넘겨받는 쪽"에만 메일이
// 가고, 참조자에게는 인앱 알림만 간다. task는 taskWriteInclude로 조회된 갱신
// 후의 일감(암호화된 assignee/reviewer가 실려 있어야 notifyOne이 복호화할 수
// 있다)이고, 참조자는 이미 복호화된 목록에서 뽑은 id 배열로 따로 받는다 —
// 여기서 다시 복호화하지 않도록 사용자 객체 대신 id만 넘긴다.
async function notifyReviewTransition(task, actor, action, followerUserIds = []) {
  try {
    const link = `/tasks/${task.projectId}/${task.id}`
    if (action === 'request') {
      await notifyOne({
        userId: task.reviewerId,
        user: task.reviewer,
        actor,
        type: 'task_review_requested',
        title: `"${task.title}" 검수를 요청받았습니다`,
        link,
        taskTitle: task.title,
        sendMail: notifyReviewRequested,
      })
    } else if (action === 'reject' || action === 'approve') {
      await notifyOne({
        userId: task.assigneeId,
        user: task.assignee,
        actor,
        type: action === 'reject' ? 'task_review_rejected' : 'task_review_approved',
        title:
          action === 'reject'
            ? `"${task.title}" 검수가 반려되었습니다`
            : `"${task.title}" 검수가 완료되었습니다`,
        link,
        taskTitle: task.title,
        sendMail: action === 'reject' ? notifyReviewRejected : notifyReviewApproved,
      })
    }

    // 참조자는 검수중 진입과 완료, 두 시점만 본다. 메일은 보내지 않고, 같은
    // 일감이 여러 차수를 돌며 반복 알림이 가는 것도 그대로 둔다(사용자 확인).
    if (action === 'request' || action === 'approve') {
      const followerTitle =
        action === 'request' ? `"${task.title}" 일감이 검수중으로 바뀌었습니다` : `"${task.title}" 일감이 완료되었습니다`
      for (const userId of followerUserIds) {
        await createNotification({
          userId,
          actorId: actor.id,
          type: 'task_follower',
          title: followerTitle,
          link,
        })
      }
    }
  } catch (err) {
    console.error('[notify] notifyReviewTransition failed', { taskId: task.id, error: err.message })
  }
}

// 일감 필드 변경 이력(TaskActivity) 계산용. `data`는 prisma.task.update에 실제로
// 넘기는 조건부 스프레드 객체 그대로 — 그 안에 있는 키만 "이번 요청에서 실제로
// 바뀐 필드"다. description은 마크다운 원문이 길어질 수 있어 값 자체는 남기지
// 않고 변경됐다는 사실만 기록한다(항상 fromValue/toValue null).
// 참조자(followerIds)는 일부러 빼둔다 — 진행 상황만 따라가는 사람이라 등록/해제를
// 로그로 남기지 않기로 확인됐다(docs/task-review-spec.md 5장).
const ACTIVITY_TRACKED_FIELDS = [
  'title',
  'type',
  'grade',
  'status',
  'assigneeId',
  'reviewerId',
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

// 새 일감은 검수 이력 없이 만들어지므로 검수중/완료로는 시작할 수 없다 —
// 그 두 상태는 반드시 전이(=이력 등록)를 거쳐야만 도달한다.
const CREATABLE_STATUSES = ['todo', 'doing']

router.post('/', requireProjectRole('member'), async (req, res) => {
  const {
    title,
    description,
    type,
    grade,
    status,
    assigneeId,
    reviewerId,
    startAt,
    endAt,
    parentTaskId,
    relatedTaskIds,
    followerIds,
  } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })
  if (type !== undefined && !isValidTaskType(type)) {
    return res.status(400).json({ error: 'Invalid type' })
  }
  if (grade !== undefined && !isValidTaskGrade(grade)) {
    return res.status(400).json({ error: 'Invalid grade' })
  }
  if (status !== undefined && !CREATABLE_STATUSES.includes(status)) {
    return res.status(400).json({ error: '새 일감은 대기 또는 진행중 상태로만 만들 수 있습니다' })
  }
  const dateProblem = assertDateOrder(startAt, endAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  const problem = await assertProjectMember(req.params.projectId, assigneeId, null, ASSIGNEE_NOT_MEMBER)
  if (problem) return res.status(400).json({ error: problem })

  const reviewerProblem = await assertProjectMember(req.params.projectId, reviewerId, null, REVIEWER_NOT_MEMBER)
  if (reviewerProblem) return res.status(400).json({ error: reviewerProblem })

  const distinctProblem = assertAssigneeReviewerDistinct(assigneeId, reviewerId)
  if (distinctProblem) return res.status(400).json({ error: distinctProblem })

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
      reviewerId: reviewerId || null,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      parentTaskId: parentTaskId || null,
    },
    include: taskWriteInclude,
  })
  await applyTaskLinks(req.params.projectId, task.id, { relatedTaskIds })
  await applyTaskFollowers(req.params.projectId, task.id, followerIds)
  await prisma.taskActivity.create({ data: { taskId: task.id, actorId: req.user.id, action: 'created' } })
  notifyPeopleChanges(task, req.user, { assigneeId: null, reviewerId: null })
  const memberIds = await currentMemberIds(req.params.projectId)
  const created = decryptTask(task, memberIds, req.user, req.projectAccess)
  // 참조자를 방금 넣었다면 create 응답에는 아직 없다(생성 뒤에 붙였으므로) —
  // 클라이언트가 저장 직후 화면에 그릴 수 있도록 여기서 다시 읽어 채워준다.
  res.status(201).json({
    ...created,
    followers: Array.isArray(followerIds) ? await loadFollowers(task.id) : created.followers,
  })
})

// 상태 외에 이 요청이 실제로 건드리는 필드들 — 완료 잠금(spec 8장) 검사에 쓴다.
// 상태만 바꾸는 요청(=재오픈)은 완료 상태에서도 통과해야 하므로, "상태 말고
// 뭔가를 더 바꾸려 하는가"를 이 목록으로 판단한다.
const EDITABLE_FIELD_KEYS = [
  'title',
  'description',
  'type',
  'grade',
  'assigneeId',
  'reviewerId',
  'startAt',
  'endAt',
  'parentTaskId',
  'relatedTaskIds',
  'followerIds',
]

const DONE_LOCK_MESSAGE =
  '완료된 일감은 수정할 수 없습니다. PM 또는 등록자가 진행중으로 되돌린 뒤 수정해주세요'

router.patch('/:id', requireProjectRole('member'), async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, projectId: req.params.projectId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const {
    title,
    description,
    type,
    grade,
    status,
    assigneeId,
    reviewerId,
    startAt,
    endAt,
    parentTaskId,
    relatedTaskIds,
    followerIds,
    review,
  } = req.body

  // 필드 수정과 상태 전이는 권한 규칙이 다르다 — 필드는 canModifyTask + 완료
  // 잠금, 상태는 전이표(taskTransitions.js)가 각각 판단한다. 그래서 예전처럼
  // 맨 위에서 canModifyTask 하나로 걸러버릴 수 없다.
  const touchesFields = EDITABLE_FIELD_KEYS.some((key) => req.body[key] !== undefined)
  if (touchesFields) {
    if (existing.status === 'done') return res.status(409).json({ error: DONE_LOCK_MESSAGE })
    if (!canModifyTask(existing, req.user, req.projectAccess)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  if (type !== undefined && !isValidTaskType(type)) {
    return res.status(400).json({ error: 'Invalid type' })
  }
  if (grade !== undefined && !isValidTaskGrade(grade)) {
    return res.status(400).json({ error: 'Invalid grade' })
  }
  if (status !== undefined && !isValidTaskStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  // --- 상태 전이 판정 ---
  const wantsStatusChange = status !== undefined && status !== existing.status
  let transition = null
  let reviewData = null
  if (wantsStatusChange) {
    const resolved = resolveTransition(existing.status, status, taskRoles(existing, req.user, req.projectAccess))
    if (resolved.error) return res.status(resolved.httpStatus).json({ error: resolved.error })
    transition = resolved.transition
    if (transition.requires) {
      const payload = buildReviewPayload(transition.requires, review || {})
      if (payload.error) return res.status(400).json({ error: payload.error })
      reviewData = payload.data
    }
  }

  const nextStartAt = startAt !== undefined ? startAt : existing.startAt
  const nextEndAt = endAt !== undefined ? endAt : existing.endAt
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  if (assigneeId !== undefined) {
    const problem = await assertProjectMember(
      req.params.projectId,
      assigneeId,
      existing.assigneeId,
      ASSIGNEE_NOT_MEMBER,
    )
    if (problem) return res.status(400).json({ error: problem })
  }
  if (reviewerId !== undefined) {
    const problem = await assertProjectMember(
      req.params.projectId,
      reviewerId,
      existing.reviewerId,
      REVIEWER_NOT_MEMBER,
    )
    if (problem) return res.status(400).json({ error: problem })
  }

  const nextAssigneeId = assigneeId !== undefined ? assigneeId || null : existing.assigneeId
  const nextReviewerId = reviewerId !== undefined ? reviewerId || null : existing.reviewerId
  const distinctProblem = assertAssigneeReviewerDistinct(nextAssigneeId, nextReviewerId)
  if (distinctProblem) return res.status(400).json({ error: distinctProblem })

  // 검수요청은 검수자가 없으면 성립하지 않는다 — 팝업이 이 값을 함께 보내지만,
  // API를 직접 호출하는 경우까지 대비해 여기서 막는다.
  if (transition?.requires === 'request' && !nextReviewerId) {
    return res.status(400).json({ error: '검수자를 지정해주세요' })
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
    ...(reviewerId !== undefined && { reviewerId: reviewerId || null }),
    ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
    ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    ...(parentTaskId !== undefined && { parentTaskId: parentTaskId || null }),
  }
  const activityChanges = computeTaskActivityChanges(existing, data)
  // 마감일이 바뀌면 이전 마감 기준으로 이미 보낸 D-3 리마인더는 새 날짜에
  // 유효하지 않다 — 다시 보낼 수 있도록 리셋.
  if (activityChanges.some((c) => c.field === 'endAt')) data.dueReminderLastDaysLeft = null

  // 상태 전이와 검수 이력은 한 트랜잭션으로 묶는다 — 하나만 남으면 "이력 없이
  // 검수중인 일감" 또는 "상태는 그대로인데 이력만 늘어난 일감"이 된다.
  // where에 현재 상태를 함께 걸어, 이 핸들러가 판정한 뒤 다른 사람이 먼저
  // 상태를 바꿔버린 경우(칸반을 띄워둔 채 새로고침 안 한 화면)를 걸러낸다.
  let task
  let createdReview
  try {
    const operations = [
      prisma.task.update({
        where: wantsStatusChange
          ? { id: req.params.id, status: existing.status }
          : { id: req.params.id },
        data,
        include: taskWriteInclude,
      }),
    ]
    if (reviewData) {
      operations.push(
        prisma.taskReview.create({
          data: { taskId: req.params.id, authorId: req.user.id, ...reviewData },
        }),
      )
    }
    const results = await prisma.$transaction(operations)
    task = results[0]
    createdReview = results[1]
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(409).json({ error: '이미 다른 사람이 처리했습니다. 새로고침 후 다시 시도해주세요' })
    }
    console.error('[tasks] PATCH failed', { taskId: req.params.id, error: err.message })
    return res.status(500).json({ error: '저장 중 문제가 발생했습니다' })
  }

  await applyTaskLinks(req.params.projectId, task.id, { relatedTaskIds })
  await applyTaskFollowers(req.params.projectId, task.id, followerIds)
  if (activityChanges.length > 0) {
    await prisma.taskActivity.createMany({
      data: activityChanges.map((c) => ({ taskId: task.id, actorId: req.user.id, action: 'field_changed', ...c })),
    })
  }

  const memberIds = await currentMemberIds(req.params.projectId)
  const updated = decryptTask(task, memberIds, req.user, req.projectAccess)
  // 참조자를 이번 요청에서 갱신했다면 다시 읽는다 — 갱신(applyTaskFollowers)이
  // task 저장과 다른 트랜잭션이라 응답에 실려온 값은 갱신 전 상태다. 손대지
  // 않았다면 이미 맞는 값이므로 조회를 한 번 아낀다(칸반 드래그처럼 상태만
  // 바꾸는 요청이 이 경로의 대부분이다).
  const followers = Array.isArray(followerIds) ? await loadFollowers(task.id) : updated.followers

  notifyPeopleChanges(task, req.user, existing, { skipReviewer: transition?.action === 'request' })
  if (transition) {
    notifyReviewTransition(task, req.user, transition.action, followers.map((f) => f.id))
  }

  // 방금 만든 검수 이력의 id를 함께 돌려준다 — 산출물 파일은 이력이 생긴 뒤에야
  // 붙일 수 있어서(2단계 업로드), 팝업이 이 값으로 곧바로 업로드를 이어간다.
  res.json({ ...updated, followers, createdReviewId: createdReview?.id ?? null })
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
  // 완료된 일감은 간트차트에서 막대를 끌어도 날짜가 바뀌지 않는다 — 완료 잠금
  // (spec 8장)은 이 우회 경로에도 똑같이 적용된다.
  if (existing.status === 'done') return res.status(409).json({ error: DONE_LOCK_MESSAGE })

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

    const assigneeProblem = await assertProjectMember(
      req.params.projectId,
      row.assigneeId,
      null,
      ASSIGNEE_NOT_MEMBER,
    )
    const assigneeId = assigneeProblem ? null : row.assigneeId || null
    // 검수자도 담당자와 같은 방식 — 프리뷰 이후 프로젝트에서 빠졌으면 조용히
    // 비우고 등록은 계속한다. 담당자와 같은 사람이면 검수자만 버린다(행 전체를
    // 실패시키지 않는다).
    const reviewerProblem = await assertProjectMember(
      req.params.projectId,
      row.reviewerId,
      null,
      REVIEWER_NOT_MEMBER,
    )
    const reviewerId =
      reviewerProblem || !row.reviewerId || row.reviewerId === assigneeId ? null : row.reviewerId

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
          reviewerId,
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
    // 참조자는 일감 생성과 별개 테이블이라, 실패해도 이미 만들어진 일감을
    // "실패한 행"으로 되돌리지 않고 로그만 남긴다(활동 로그와 같은 취급).
    try {
      await applyTaskFollowers(req.params.projectId, task.id, row.followerIds)
    } catch (err) {
      console.error('[taskFollower] import/commit failed', { taskId: task.id, error: err.message })
    }
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
