// Mirrors server/src/lib/taskFields.js — kept in sync by hand, same as the
// EXT_ALLOWLIST/MIME_ALLOWLIST duplication in the attachment upload UI.
// 순서는 실제 업무가 흘러가는 순서(기획 → 디자인 → 개발 → QA)로 둔다 — 드롭다운과
// 배지에 이 배열 순서가 그대로 노출된다.
export const TASK_TYPES = [
  { value: 'plan', label: '기획' },
  { value: 'design', label: '디자인' },
  { value: 'dev', label: '개발' },
  { value: 'qa', label: 'QA' },
]

export const TASK_GRADES = [
  { value: 'urgent', label: '긴급' },
  { value: 'major', label: '주요' },
  { value: 'minor', label: '보통' },
]

// 검수 기능(docs/task-review-spec.md 1장)과 함께 라벨이 '등록/진행/검수' →
// '대기/진행중/검수중'으로 바뀌었다. 값은 그대로다.
export const TASK_STATUSES = [
  { value: 'todo', label: '대기' },
  { value: 'doing', label: '진행중' },
  { value: 'review', label: '검수중' },
  { value: 'done', label: '완료' },
]

export const GRADE_RANK = { urgent: 0, major: 1, minor: 2 }

// Date · ISO 문자열 · 'YYYY-MM-DD' 무엇이 와도 UTC 기준 날짜 문자열로 맞춘다 —
// 일감과 프로젝트 날짜는 모두 날짜 입력에서 온 값이라 일 단위 비교로 충분하다.
function toDayString(value) {
  if (!value) return ''
  return typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10)
}

// 프로젝트 기간을 벗어난 날짜인지 — 일감 폼과 엑셀 일괄등록 검수 화면이 같은
// 판정을 써야 하므로 여기 한 곳에 둔다. 서버의 assertWithinProjectPeriod와 같은
// 규칙을 손으로 맞춰둔 사본이고(EXT_ALLOWLIST 복제와 같은 이유), 이 사본은 입력
// 중 즉시 피드백만 담당한다 — 실제 차단은 서버가 다시 판단한다.
//
// 시작일·종료일을 **각각** 기간 전체와 비교한다. 시작일은 프로젝트 시작일과만,
// 종료일은 프로젝트 종료일과만 비교하면 "종료일 없이 시작일만 프로젝트 종료
// 뒤로" 같은 경우가 그냥 통과한다. 프로젝트 기간이 양쪽 다 비어 있으면 제약 없음.
export function isOutsideProjectPeriod(project, dates) {
  const from = toDayString(project?.startAt)
  const to = toDayString(project?.endAt)
  if (!from && !to) return false
  return dates.some((value) => {
    const day = toDayString(value)
    if (!day) return false
    return Boolean(from && day < from) || Boolean(to && day > to)
  })
}

// 안내 문구용 '프로젝트명 YY.MM.DD ~ YY.MM.DD'. 두 날짜가 한 문장에 들어가므로
// toLocaleDateString의 '2026. 9. 9.' 대신 짧게 쓴다. 한쪽만 정해진 프로젝트는
// 없는 쪽을 '미정'으로 표시하고, 양쪽 다 없으면 빈 문자열(검사 자체가 없다).
export function projectPeriodLabel(project) {
  const from = toDayString(project?.startAt)
  const to = toDayString(project?.endAt)
  if (!from && !to) return ''
  const short = (day) => (day ? `${day.slice(2, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}` : '미정')
  return `${project.name} ${short(from)} ~ ${short(to)}`
}

export function taskTypeLabel(value) {
  return TASK_TYPES.find((t) => t.value === value)?.label || value
}

export function taskGradeLabel(value) {
  return TASK_GRADES.find((g) => g.value === value)?.label || value
}

export function taskStatusLabel(value) {
  return TASK_STATUSES.find((s) => s.value === value)?.label || value
}

// 상태 드롭다운에 실제로 띄울 선택지 — 현재 상태와 서버가 허용한 전이 대상만
// 남기고, 순서는 언제나 TASK_STATUSES의 표준 순서를 따른다(어떤 전이가 가능한지에
// 따라 옵션 순서가 뒤바뀌면 같은 자리에 다른 상태가 오게 되어 잘못 고르기 쉽다).
export function statusOptions(currentStatus, allowedTransitions = []) {
  const reachable = new Set([currentStatus, ...allowedTransitions.map((t) => t.to)])
  return TASK_STATUSES.filter((s) => reachable.has(s.value))
}

// 등급 → 종료일(빠른 순, 없으면 뒤로) → 생성일(빠른 순). 사용자 지정 순서 없음(스펙 4.2).
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const gradeDiff = (GRADE_RANK[a.grade] ?? 99) - (GRADE_RANK[b.grade] ?? 99)
    if (gradeDiff !== 0) return gradeDiff
    if (a.endAt && b.endAt) {
      const endDiff = new Date(a.endAt) - new Date(b.endAt)
      if (endDiff !== 0) return endDiff
    } else if (a.endAt || b.endAt) {
      return a.endAt ? -1 : 1
    }
    return new Date(a.createdAt) - new Date(b.createdAt)
  })
}
