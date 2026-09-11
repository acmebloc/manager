import { doneCounterpartReason, notDone } from '../lib/taskFields'
import { SAVE_NOTICE, TaskChip, TaskLinkSection, TaskPicker } from './TaskLinks'

// 계층(상위 일감 / 하위 작업) 두 섹션. 관계(TaskLinks)와 한 상자로 묶는 건
// 부모(TaskFormPage)가 하므로 여기서는 테두리를 그리지 않고 섹션만 내놓는다.
//
// **상위와 하위는 서로를 배제한다.** 계층이 1단계뿐이라(assertValidParent)
// 상위가 있는 일감은 남의 상위가 될 수 없고, 하위가 있는 일감은 남의 하위가
// 될 수 없다. 서버는 이미 막고 있었지만 화면이 그걸 반영하지 않아서, 성공할
// 수 없는 동작을 피커가 계속 제안하고 있었다. 이제 입력창을 **숨기지 않고
// 비활성**으로 남기고 왜 안 되는지를 placeholder로 알려준다.
//
// 두 목록 모두 draft다 — 하위 작업은 상대 일감의 필드지만 저장 버튼을 누를 때
// 함께 반영된다(TaskFormPage의 applyRelationChanges). 그래서 여기서 판단하는
// "상위가 있나 / 하위가 있나"는 화면 상태와 항상 일치하고, 예전처럼 화면에서
// 지운 상위 때문에 서버가 거절하는 일이 없다.
const PARENT_BLOCKED_PLACEHOLDER = '하위 작업이 있어 상위 일감을 등록할 수 없습니다. 하위 작업을 먼저 삭제하세요'
const CHILD_BLOCKED_PLACEHOLDER = '상위 일감이 있어 하위 작업을 등록할 수 없습니다. 상위 일감을 먼저 삭제하세요'

function TaskSubtasks({
  projectId,
  editing,
  candidates,
  parentTask,
  onParentChange,
  subtasks,
  onSubtasksChange,
  related,
  lastRemoved,
  onRemoved,
}) {
  const total = subtasks.length
  const done = subtasks.filter((t) => t.status === 'done').length

  const hasChildren = total > 0
  const childIds = new Set(subtasks.map((t) => t.id))
  // 연결로 이어진 일감은 계층으로도 걸 수 없다 — 양방향 배타이고 서버가
  // 강제한다(taskRelationRules.js). 여기서 빼지 않으면 저장할 때 400이 나는데,
  // 하위 쪽은 patchSelf가 먼저 커밋된 뒤라 절반만 반영된 채 멈춘다.
  const relatedIds = new Set(related.map((t) => t.id))

  return (
    <>
      {/* 조회 중이고 상위 일감이 없으면 보여줄 게 없으므로 섹션째 숨긴다 —
          TaskLinkSection이 스스로 하는 것과 같은 규칙. */}
      {(editing || parentTask) && (
        <div>
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">상위 일감</p>
          {parentTask && (
            <ul className="mb-2 flex flex-col gap-1">
              <TaskChip
                task={parentTask}
                projectId={projectId}
                onRemove={
                  editing
                    ? () => {
                        onParentChange(null)
                        onRemoved('parent')
                      }
                    : null
                }
                linkToTask={!editing}
              />
            </ul>
          )}
          {editing && !parentTask && (
            <TaskPicker
              candidates={candidates.filter((t) => !relatedIds.has(t.id))}
              onPick={onParentChange}
              placeholder={hasChildren ? PARENT_BLOCKED_PLACEHOLDER : '상위 일감 검색'}
              disabled={hasChildren}
            />
          )}
          {editing && lastRemoved === 'parent' && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{SAVE_NOTICE}</p>
          )}
        </div>
      )}

      <TaskLinkSection
        title="하위 작업"
        badge={total > 0 ? `${done}/${total} 완료` : null}
        projectId={projectId}
        tasks={subtasks}
        editing={editing}
        // 이미 하위인 일감·상위 일감 자신·연결로 이어진 일감을 후보에서 뺀다.
        // 완료된 일감도 뺀다 — 하위는 상대의 parentTaskId를 고치는 일이라 상대가
        // 완료면 서버가 거절한다(taskFields.js의 doneCounterpartReason).
        candidates={candidates.filter(
          (t) => !childIds.has(t.id) && t.id !== parentTask?.id && !relatedIds.has(t.id) && notDone(t),
        )}
        onAdd={(t) => onSubtasksChange((current) => [...current, t])}
        onRemove={(id) => {
          onSubtasksChange((current) => current.filter((t) => t.id !== id))
          onRemoved('subtasks')
        }}
        placeholder={parentTask ? CHILD_BLOCKED_PLACEHOLDER : '하위 작업으로 추가할 일감 검색'}
        disabled={Boolean(parentTask)}
        linkTasks={!editing}
        notice={lastRemoved === 'subtasks' ? SAVE_NOTICE : null}
        removeBlockedReason={doneCounterpartReason}
      />
    </>
  )
}

export default TaskSubtasks
