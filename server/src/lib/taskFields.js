export const TASK_TYPES = ['plan', 'design', 'dev', 'qa']
export const TASK_GRADES = ['urgent', 'major', 'minor']
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done']

// Mirrors src/lib/taskFields.js's label lists — kept in sync by hand, same as
// the TASK_TYPES/TASK_GRADES/TASK_STATUSES value arrays above. Only the
// project export routes (projectExport.js) need labels server-side; every
// other route hands the raw value to the client and lets it look up the label.
const TASK_TYPE_LABELS = { plan: '기획', design: '디자인', dev: '개발', qa: 'QA' }
const TASK_GRADE_LABELS = { urgent: '긴급', major: '주요', minor: '보통' }
// 검수 기능(docs/task-review-spec.md 1장)과 함께 '등록/진행/검수' → '대기/진행중/
// 검수중'으로 바뀌었다 — 값은 그대로고 라벨만 바뀐 것이라 마이그레이션은 없다.
const TASK_STATUS_LABELS = { todo: '대기', doing: '진행중', review: '검수중', done: '완료' }

export function taskTypeLabel(v) {
  return TASK_TYPE_LABELS[v] || v
}

export function taskGradeLabel(v) {
  return TASK_GRADE_LABELS[v] || v
}

export function taskStatusLabel(v) {
  return TASK_STATUS_LABELS[v] || v
}

export function isValidTaskType(v) {
  return TASK_TYPES.includes(v)
}

export function isValidTaskGrade(v) {
  return TASK_GRADES.includes(v)
}

export function isValidTaskStatus(v) {
  return TASK_STATUSES.includes(v)
}

export function assertDateOrder(startAt, endAt) {
  if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
    return '시작일은 종료일보다 늦을 수 없습니다'
  }
  return null
}

// Date · ISO 문자열 · 'YYYY-MM-DD' 무엇이 와도 UTC 기준 날짜 문자열로 맞춘다.
// 일감과 프로젝트의 날짜는 모두 날짜 입력(자정 UTC)에서 온 값이라 일 단위로
// 비교하면 되고, 시각까지 비교하면 같은 날인데 경계에서 어긋난다.
function toDayString(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function shortDay(day) {
  return day ? `${day.slice(2, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}` : '미정'
}

// 프로젝트 기간을 벗어난 일감 날짜는 저장하지 않는다(사용자 확인 2026-09-09).
// 프로젝트의 시작/종료가 비어 있으면 그 방향으로는 제약이 없다 — 기간을 정하지
// 않은 프로젝트에서는 아무 날짜나 쓸 수 있다.
//
// 시작일과 종료일을 **각각** 기간 전체와 비교한다. 시작일은 프로젝트 시작일과만,
// 종료일은 프로젝트 종료일과만 비교하면 "종료일 없이 시작일만 프로젝트 종료 뒤로"
// 같은 경우가 그냥 통과한다.
//
// 문구는 src/lib/taskFields.js의 projectPeriodLabel이 화면에서 즉시 보여주는
// 것과 같은 형태로 맞춰둔다(손으로 동기화) — 폼에서 막히지 않고 여기까지 오는
// 경로(엑셀 일괄등록, 간트 막대 드래그, API 직접 호출)에서도 같은 안내를 보게
// 하려는 것이다.
export function assertWithinProjectPeriod(project, startAt, endAt) {
  const from = toDayString(project?.startAt)
  const to = toDayString(project?.endAt)
  if (!from && !to) return null

  const outside = (value) => {
    const day = toDayString(value)
    if (!day) return false
    return Boolean(from && day < from) || Boolean(to && day > to)
  }
  if (!outside(startAt) && !outside(endAt)) return null

  return `프로젝트 기간을 벗어난 날짜예요. 프로젝트 기간을 확인하세요. (${project.name} ${shortDay(from)} ~ ${shortDay(to)})`
}
