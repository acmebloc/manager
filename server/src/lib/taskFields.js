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
