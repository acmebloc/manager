export const TASK_TYPES = ['plan', 'dev', 'design', 'qa']
export const TASK_GRADES = ['urgent', 'major', 'minor']
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done']

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
