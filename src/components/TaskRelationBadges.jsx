// 하위 작업 진행률과 미완료 선행 수 배지. 칸반 카드와 목록 뷰가 같은 표기를
// 쓰도록 한 곳에 둔다(docs/task-relations-spec.md 3장) — 관계를 등록해도
// 목록에서 안 보이면 아무도 눈치채지 못하기 때문에, 이 배지가 이 기능의 실질이다.
//
// 둘 다 없으면 null이라 호출부가 빈 줄을 그리지 않는다. 감싸는 span이 자체
// flex라 부모의 배지 줄 안에 그대로 끼워 넣어도 다른 배지와 같은 간격으로 붙는다.
function TaskRelationBadges({ task }) {
  const subtasks = task.subtasks ?? []
  const blockedByOpenCount = task.blockedByOpenCount ?? 0
  if (subtasks.length === 0 && blockedByOpenCount === 0) return null

  return (
    <span className="flex flex-wrap gap-2">
      {subtasks.length > 0 && (
        <span>
          하위 {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length}
        </span>
      )}
      {/* 미완료 선행은 "지금은 손대기 어려운 일감"이라는 신호라 다른 배지보다
          눈에 띄어야 한다. 다만 상태 변경을 실제로 막지는 않으므로(spec 2장)
          오류색이 아니라 주의색까지만 쓴다. */}
      {blockedByOpenCount > 0 && (
        <span className="text-amber-600 dark:text-amber-400">선행 대기 {blockedByOpenCount}</span>
      )}
    </span>
  )
}

export default TaskRelationBadges
