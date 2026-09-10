import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { TaskChip, TaskLinkSection, TaskPicker } from './TaskLinks'

// 상위 일감(parentTaskId)은 이 일감 자신의 필드라 draft로 관리된다 — 부모
// 컴포넌트(TaskFormPage)가 staged 상태로 들고 있다가 저장 버튼을 눌러야 실제로
// PATCH된다(다른 필드들과 동일). 하위 작업(자식)은 반대 방향이다 — "다른
// 일감이 나를 상위로 가리키는 것"이라, 여기서 고르거나 빼면 그 즉시 그 자식
// 일감 쪽에 PATCH(parentTaskId)를 보낸다(별도의 하위작업 전용 API 없이 기존
// PATCH /:id — assertValidParent 검증 포함 — 를 그대로 재사용). taskId가 없으면
// (아직 저장 전인 새 일감) 하위 작업 자체를 고를 대상이 없으므로 그 부분만 숨긴다.
function TaskSubtasks({ projectId, taskId, editing, candidates, parentTask, onParentChange, subtasks, onSubtasksChange }) {
  const [error, setError] = useState('')

  const parentPickCandidates = candidates.filter((t) => t.id !== parentTask?.id)
  const total = subtasks.length
  const done = subtasks.filter((t) => t.status === 'done').length

  // onSubtasksChange에 배열을 직접 만들어 넘기면, 픽커에서 연달아 빠르게
  // 추가/제거했을 때 두 핸들러가 같은 렌더링 시점의(오래된) subtasks를 각자
  // 붙잡고 있어 나중에 끝난 쪽이 먼저 끝난 쪽의 결과를 덮어써 버린다 — 서버엔
  // 둘 다 정상 반영됐는데 화면 목록만 하나 누락되는 상태가 된다. React의
  // 함수형 업데이트로 넘겨 항상 최신 state 기준으로 계산되게 한다.
  const addChild = async (candidate) => {
    setError('')
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${candidate.id}`, {
        method: 'PATCH',
        body: { parentTaskId: taskId },
      })
      onSubtasksChange((current) => [...current, candidate])
    } catch (err) {
      setError(err.message)
    }
  }

  const removeChild = async (childId) => {
    setError('')
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${childId}`, {
        method: 'PATCH',
        body: { parentTaskId: null },
      })
      onSubtasksChange((current) => current.filter((t) => t.id !== childId))
    } catch (err) {
      setError(err.message)
    }
  }

  // 테두리를 그리지 않고 섹션만 내놓는다 — 계층과 관계(TaskLinks)를 한 상자로
  // 묶는 건 부모(TaskFormPage)가 한다. 그래서 "보여줄 게 없으면 통째로 숨긴다"는
  // 판단도 부모 몫이고, 여기서는 섹션별로만 숨긴다.
  return (
    <>
      {/* 조회 중이고 상위 일감이 없으면 "없음"만 남으므로 섹션째 숨긴다 —
          TaskLinkSection이 스스로 하는 것과 같은 규칙. */}
      {(editing || parentTask) && (
        <div>
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">상위 일감</p>
          {parentTask ? (
            <ul className="mb-2 flex flex-col gap-1">
              <TaskChip task={parentTask} projectId={projectId} onRemove={editing ? () => onParentChange(null) : null} />
            </ul>
          ) : (
            <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">없음</p>
          )}
          {editing && !parentTask && (
            <TaskPicker candidates={parentPickCandidates} onPick={onParentChange} placeholder="상위 일감 검색" />
          )}
        </div>
      )}

      {taskId && (
        <TaskLinkSection
          title="하위 작업"
          badge={total > 0 ? `${done}/${total} 완료` : null}
          projectId={projectId}
          tasks={subtasks}
          editing={editing}
          candidates={candidates}
          onAdd={addChild}
          onRemove={removeChild}
          placeholder="하위 작업으로 추가할 일감 검색"
          emptyLabel="없음"
        />
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </>
  )
}

export default TaskSubtasks
