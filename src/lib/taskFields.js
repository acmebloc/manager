// Mirrors server/src/lib/taskFields.js — kept in sync by hand, same as the
// EXT_ALLOWLIST/MIME_ALLOWLIST duplication in the attachment upload UI.
export const TASK_TYPES = [
  { value: 'plan', label: '기획' },
  { value: 'dev', label: '개발' },
  { value: 'design', label: '디자인' },
  { value: 'qa', label: 'QA' },
]

export const TASK_GRADES = [
  { value: 'urgent', label: '긴급' },
  { value: 'major', label: '주요' },
  { value: 'minor', label: '보통' },
]

export const TASK_STATUSES = [
  { value: 'todo', label: '등록' },
  { value: 'doing', label: '진행' },
  { value: 'review', label: '검수' },
  { value: 'done', label: '완료' },
]

const GRADE_RANK = { urgent: 0, major: 1, minor: 2 }

export function taskTypeLabel(value) {
  return TASK_TYPES.find((t) => t.value === value)?.label || value
}

export function taskGradeLabel(value) {
  return TASK_GRADES.find((g) => g.value === value)?.label || value
}

export function taskStatusLabel(value) {
  return TASK_STATUSES.find((s) => s.value === value)?.label || value
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
