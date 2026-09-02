import { prisma } from '../db.js'
import { decryptUser } from './fieldCrypto.js'
import { expandOccurrences } from './scheduleRecurrence.js'
import { taskGradeLabel, taskStatusLabel, taskTypeLabel } from './taskFields.js'

// Data-loading + row-shaping for the project export routes
// (routes/projectExport.js). See docs/project-export-spec.md for the full
// field/format spec this implements.

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function formatPerson(user) {
  if (!user) return ''
  return user.email ? `${user.name}(${user.email})` : user.name
}

// ---- Tasks ----

// projectName은 호출부(routes/projectExport.js)가 이미 조회해둔 Project.name을
// 그대로 넘긴다 — 이 함수가 다시 조회하면 한 요청 안에서 같은 프로젝트 행을
// 중복으로 읽게 된다(PK 조회라 비용은 작지만 불필요한 왕복).
export async function loadTaskExportData(projectId, projectName) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: {
      assignee: { select: userSelect },
      createdBy: { select: userSelect },
      _count: { select: { attachments: true } },
    },
  })

  return tasks.map((task) => ({
    id: task.id,
    projectName,
    title: task.title,
    createdBy: task.createdBy ? decryptUser(task.createdBy) : null,
    assignee: task.assignee ? decryptUser(task.assignee) : null,
    startAt: task.startAt,
    endAt: task.endAt,
    status: task.status,
    type: task.type,
    grade: task.grade,
    hasAttachment: task._count.attachments > 0,
  }))
}

export const TASK_TABLE_HEADERS = [
  '프로젝트명',
  '제목',
  '작성자',
  '담당자',
  '시작일',
  '종료일',
  '진행상태',
  '유형',
  '등급',
  '첨부파일유무',
]

// description/댓글/첨부파일 실물/TaskLink는 1차 범위에서 제외(spec §2) — 여기
// 없는 필드는 실수로 빠뜨린 게 아니라 의도적으로 뺀 것이다.
export function taskToTableRow(task) {
  return {
    프로젝트명: task.projectName,
    제목: task.title,
    작성자: formatPerson(task.createdBy),
    담당자: formatPerson(task.assignee),
    시작일: formatDate(task.startAt),
    종료일: formatDate(task.endAt),
    진행상태: taskStatusLabel(task.status),
    유형: taskTypeLabel(task.type),
    등급: taskGradeLabel(task.grade),
    첨부파일유무: task.hasAttachment ? 'O' : 'X',
  }
}

function personToJson(user) {
  return user ? { name: user.name, email: user.email } : null
}

// JSON은 스키마 방식(spec §4) — 필드명은 Prisma 필드명 기준으로 맞추고, 한글
// 라벨(statusLabel 등)은 CSV/Excel/HTML 전용이라 여기 넣지 않는다. status/type/
// grade 코드값만 내려주면 라벨은 taskFields.js의 매핑으로 소비 측이 언제든
// 재구성할 수 있다.
export function taskToJsonRow(task) {
  return {
    id: task.id,
    projectName: task.projectName,
    title: task.title,
    createdBy: personToJson(task.createdBy),
    assignee: personToJson(task.assignee),
    startAt: task.startAt,
    endAt: task.endAt,
    status: task.status,
    type: task.type,
    grade: task.grade,
    hasAttachment: task.hasAttachment,
  }
}

// ---- Schedules ----

const scheduleInclude = {
  owner: { select: userSelect },
  followers: { select: { user: { select: userSelect } } },
  overrides: true,
}

// 반복일정은 회차별 행 대신 시리즈당 1행만 만든다(spec §3.1) — 시작일/종료일은
// 개별 회차 취소(override.deleted)를 반영해, 남아있는 회차 중 최초 시작일/
// 최종 종료일로 계산한다. expandOccurrences가 이미 취소된 회차를 걸러주므로
// 그 결과에서 min/max만 뽑으면 된다. 모든 회차가 취소된 경우 null을 돌려줘
// 호출부가 이 일정을 내보내기에서 완전히 제외하게 한다(더 이상 유효한 일정이
// 아니라는 사용자 판단).
function recurringRange(schedule) {
  const occurrences = expandOccurrences(schedule)
  if (occurrences.length === 0) return null
  const starts = occurrences.map((o) => new Date(o.startAt).getTime())
  const ends = occurrences.filter((o) => o.endAt).map((o) => new Date(o.endAt).getTime())
  return {
    startAt: new Date(Math.min(...starts)),
    endAt: ends.length > 0 ? new Date(Math.max(...ends)) : null,
  }
}

// "일정" 다운로드는 화면(간트차트)과 같은 범위를 잡는다(spec §1, 확정) — 진짜
// Schedule 레코드뿐 아니라, 화면에 막대로 같이 뜨는 일감(시작일 또는 종료일 중
// 하나라도 있는 것)도 포함한다. 단, 화면이 날짜 없는 일감을 등록일 기준 1일짜리
// 회색 막대로 "표시만" 해주는 placeholder는 실제 날짜가 아니므로 내보내지 않는다
// (해당 일감은 "일감" 다운로드에 이미 포함돼 있어 정보 손실은 없다). 일감/진짜
// 일정 구분 컬럼은 두지 않기로 했다(spec §1) — 전부 "일정"으로만 취급한다.
// 화면(간트차트)에 막대로 뜨는 "날짜 있는 일감" 조건 — 여기와 loadScheduleExportData,
// countScheduleRows 셋이 반드시 같은 조건을 써야 한다(spec §3.1).
const datedTaskWhere = (projectId) => ({
  projectId,
  OR: [{ startAt: { not: null } }, { endAt: { not: null } }],
})

export async function loadScheduleExportData(projectId, projectName) {
  const [schedules, datedTasks] = await Promise.all([
    prisma.schedule.findMany({
      where: { projectId },
      orderBy: { startAt: 'asc' },
      include: scheduleInclude,
    }),
    prisma.task.findMany({
      where: datedTaskWhere(projectId),
      select: { id: true, title: true, startAt: true, endAt: true, assignee: { select: userSelect } },
    }),
  ])

  const results = []
  for (const schedule of schedules) {
    const isRecurring = Boolean(schedule.recurrenceIntervalWeeks)
    let range = { startAt: schedule.startAt, endAt: schedule.endAt }
    if (isRecurring) {
      const computed = recurringRange(schedule)
      if (!computed) continue
      range = computed
    }

    results.push({
      id: schedule.id,
      projectName,
      title: schedule.title,
      startAt: range.startAt,
      endAt: range.endAt,
      owner: decryptUser(schedule.owner),
      followers: schedule.followers.map((f) => decryptUser(f.user)),
      isRecurring,
    })
  }

  // 일감엔 "담당자"에 대응하는 값(assignee)은 있지만 "참조자"에 대응하는 개념이
  // 없다 — 없는 항목은 전부 빈칸으로 둔다(spec §1, 확정). 반복 대상도 아니라서
  // isRecurring은 항상 false.
  for (const task of datedTasks) {
    results.push({
      id: task.id,
      projectName,
      title: task.title,
      startAt: task.startAt,
      endAt: task.endAt,
      owner: task.assignee ? decryptUser(task.assignee) : null,
      followers: [],
      isRecurring: false,
    })
  }

  results.sort((a, b) => new Date(a.startAt || a.endAt) - new Date(b.startAt || b.endAt))
  return results
}

export const SCHEDULE_TABLE_HEADERS = ['프로젝트명', '제목', '시작일', '종료일', '담당자', '참조자', '반복여부']

// 반복여부는 O만 표시하고 비반복은 빈칸으로 둔다(spec §1, 확정) — 일감 유래
// 행이 전부 비반복이라 X로 채우면 그 칸이 온통 X로 뒤덮여 오히려 눈에 안 띄기
// 때문에, 참조자/날짜 등 다른 "해당 없음" 칸과 같은 방식(빈칸)으로 통일한다.
export function scheduleToTableRow(schedule) {
  return {
    프로젝트명: schedule.projectName,
    제목: schedule.title,
    시작일: formatDate(schedule.startAt),
    종료일: formatDate(schedule.endAt),
    담당자: formatPerson(schedule.owner),
    참조자: schedule.followers.map(formatPerson).join(', '),
    반복여부: schedule.isRecurring ? 'O' : '',
  }
}

export function scheduleToJsonRow(schedule) {
  return {
    id: schedule.id,
    projectName: schedule.projectName,
    title: schedule.title,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    owner: personToJson(schedule.owner),
    followers: schedule.followers.map((f) => personToJson(f)),
    isRecurring: schedule.isRecurring,
  }
}

// ---- 다운로드 전 사전 건수 체크(routes/projectExport.js) ----
// 실제로 생성될 행 수를 정확히 추정한다 — "일정" 파일에는 날짜 있는 일감도
// 병합되므로(위 datedTaskWhere), 스케줄 원본 건수만 세면 실제 출력보다 적게
// 잡혀 차단 기준을 무력화한다. 반복일정이 회차 취소로 통째로 제외되는 경우
// (recurringRange가 null)는 여기서 반영하지 않아 실제보다 살짝 크게 잡힐 수
// 있지만, 사전 차단용 상한 추정치로는 안전한 방향(더 엄격한 쪽)이라 문제없다.
export async function countTaskRows(projectId) {
  return prisma.task.count({ where: { projectId } })
}

export async function countScheduleRows(projectId) {
  const [scheduleCount, datedTaskCount] = await Promise.all([
    prisma.schedule.count({ where: { projectId } }),
    prisma.task.count({ where: datedTaskWhere(projectId) }),
  ])
  return scheduleCount + datedTaskCount
}
