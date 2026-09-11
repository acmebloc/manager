import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { doneCounterpartReason, notDone, taskStatusLabel } from '../lib/taskFields'

// 관계 삭제는 draft라 저장 전까지 서버에 반영되지 않는다 — 삭제가 일어난 섹션의
// 입력창 아래에 이 문구를 띄워 그 사실을 그 자리에서 알린다.
export const SAVE_NOTICE = '변경된 내용은 페이지 하단 저장 버튼을 누르시면 반영됩니다.'

// linkToTask=false면 제목을 링크가 아니라 평범한 텍스트로 그린다. 수정 중에
// 관계 일감으로 이동하면 편집하던 내용을 두고 화면이 떠나는 셈이고, 게다가
// 같은 라우트라 컴포넌트가 재사용되면서 **그 일감도 수정모드로 열린다.**
//
// removeBlockedReason이 있으면 제거 버튼을 비활성으로 그리고 그 이유를 title로
// 붙인다 — 버튼을 아예 숨기면 왜 이 관계만 못 지우는지 알 방법이 없다.
export function TaskChip({ task, projectId, onRemove, linkToTask = true, removeBlockedReason = null }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700">
      {linkToTask ? (
        <Link
          to={`/tasks/${projectId}/${task.id}`}
          className="min-w-0 flex-1 truncate text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
        >
          {task.title}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-white">{task.title}</span>
      )}
      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{taskStatusLabel(task.status)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(task.id)}
          disabled={Boolean(removeBlockedReason)}
          title={removeBlockedReason || undefined}
          className="shrink-0 text-xs text-red-600 hover:text-red-500 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:text-gray-300 dark:text-red-400 dark:disabled:text-gray-600 dark:disabled:hover:text-gray-600"
        >
          제거
        </button>
      )}
    </li>
  )
}

// 서버 호출 없이 이미 불러온 프로젝트 일감 목록에서 제목으로 클라이언트
// 필터링 — UserSearch(ProjectMembers.jsx)와 같은 타입-필터 패턴이지만 이건
// 디바운스도 필요 없다(로컬 배열 필터일 뿐).
// disabled일 때 입력창을 숨기지 않고 비활성 상태로 남겨두는 이유: 왜 지금
// 등록할 수 없는지를 placeholder로 그 자리에서 설명할 수 있다. 아예 사라지면
// 사용자는 기능이 없는 줄 안다(상위/하위 상호 배제가 정확히 그 경우다).
export function TaskPicker({ candidates, onPick, placeholder, disabled = false }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    if (disabled) return []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return candidates.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 6)
  }, [candidates, query, disabled])

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-900 dark:disabled:text-gray-500"
      />
      {filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(t)
                  setQuery('')
                }}
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 다중 선택용 "제목 + 목록(또는 빈 문구) + 피커" 섹션. 연결 일감(TaskLinks)과
// 하위 작업(TaskSubtasks) 둘 다 이 모양이라 공유한다 — 상위 일감(단일 선택,
// 하나 고르면 피커가 사라지는 다른 동작)은 이 컴포넌트로 억지로 맞추지 않고
// TaskSubtasks.jsx에 따로 둔다.
export function TaskLinkSection({
  title,
  badge,
  projectId,
  tasks,
  editing,
  candidates,
  onAdd,
  onRemove,
  placeholder,
  disabled = false,
  linkTasks = true,
  notice = null,
  // (task) => 제거할 수 없는 이유 또는 null. 하위 작업·후행 일감처럼 **상대
  // 일감을 고쳐야 반영되는** 관계에서, 상대가 완료라 서버가 거절할 것을 미리
  // 아는 경우에 쓴다(taskFields.js의 doneCounterpartReason).
  removeBlockedReason = null,
}) {
  const excludeIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])

  if (!editing && tasks.length === 0) return null

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{title}</p>
        {badge && <span className="text-xs text-gray-400 dark:text-gray-500">{badge}</span>}
      </div>
      {/* 비어 있을 때 "없음" 같은 문구를 두지 않는다. 조회 중이고 비어 있으면 위에서
          섹션째 숨기므로 그 문구는 **수정 중에만** 보였는데, 그 자리에는 이미 빈
          입력창이 있어서 같은 말을 두 번 하는 셈이었다. */}
      {tasks.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskChip
              key={t.id}
              task={t}
              projectId={projectId}
              onRemove={editing ? onRemove : null}
              linkToTask={linkTasks}
              removeBlockedReason={removeBlockedReason ? removeBlockedReason(t) : null}
            />
          ))}
        </ul>
      )}
      {editing && (
        <TaskPicker
          candidates={candidates.filter((t) => !excludeIds.has(t.id))}
          onPick={onAdd}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
      {/* 안내는 **그 섹션의 입력창 바로 아래**에 둔다. 상자 맨 위에 한 번만
          두면(예전 방식) 상자가 500px 넘게 길어서, 아래쪽 섹션에서 제거를 눌렀을
          때 문구가 화면 밖에 있다 — 정보는 있는데 필요한 순간에 안 보인다. */}
      {editing && notice && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{notice}</p>}
    </div>
  )
}

// 계층(상위/하위)이 아닌 관계들 — 선행·후행·연결(docs/task-relations-spec.md).
// 계층은 진행률이 붙는 진짜 부모-자식이라 TaskSubtasks.jsx가 따로 담당하고,
// 여기는 "순서"와 "그냥 관련"만 다룬다. 세 관계 모두 상태 전이에는 관여하지
// 않는다 — 연결된 일감의 상태가 바뀌어도 이 일감은 그대로다.
//
// **선행과 후행 둘 다 편집할 수 있다.** 예전에는 후행을 읽기 전용으로 뒀는데
// ("같은 관계를 두 곳에서 지울 수 있어 헷갈린다"), 그 근거를 하위 작업에는
// 적용하지 않아 규칙이 갈라져 있었다 — 하위도 후행과 똑같이 "상대 일감이 나를
// 가리키는" 역방향 관계인데 편집이 열려 있었다. 개념이 같으면 다루는 방식도
// 같아야 한다.
//
// 후행 편집은 상대 일감의 선행 목록을 바꾸는 일이라, 저장할 때 목록 전체를
// 덮어쓰지 않고 링크 하나만 붙이거나 뗀다(서버의 blocked-by 경로).
function TaskLinks({
  projectId,
  editing,
  candidates,
  related,
  onRelatedChange,
  blockedBy,
  onBlockedByChange,
  blocking,
  onBlockingChange,
  parentTask,
  subtasks,
  lastRemoved,
  onRemoved,
}) {
  // 후행 일감은 선행 후보에서 뺀다 — 그걸 선행으로 잡으면 곧바로 순환이라 서버가
  // 거절한다. 간접 순환(A→B→C→A)은 서버만 잡을 수 있지만, 가장 흔한 직접 순환은
  // 애초에 고를 수 없게 하는 쪽이 저장 후 에러를 보는 것보다 낫다.
  const blockingIds = new Set(blocking.map((t) => t.id))
  const blockedByIds = new Set(blockedBy.map((t) => t.id))
  const relatedIds = new Set(related.map((t) => t.id))

  // 선행·후행 후보에서 서로를 뺀다 — 한 쌍을 양방향으로 걸면 곧바로 순환이라
  // 서버가 거절한다. 간접 순환(A→B→C→A)은 서버만 잡을 수 있지만, 가장 흔한
  // 직접 순환은 애초에 고를 수 없게 하는 쪽이 저장 후 에러를 보는 것보다 낫다.
  //
  // **연결로 이어진 일감도 뺀다.** 연결은 상위/하위/선행/후행 어느 것과도 같은
  // 상대에게 함께 걸 수 없다(서버의 taskRelationRules.js가 양방향으로 강제).
  const excludeFromOrdered = (t) => relatedIds.has(t.id)
  const blockedByCandidates = candidates.filter((t) => !blockingIds.has(t.id) && !excludeFromOrdered(t))
  // 후행만 완료된 일감을 뺀다 — 후행은 상대의 선행 목록을 고치는 일이라 상대가
  // 완료면 서버가 거절한다(taskFields.js의 doneCounterpartReason). 선행은 내
  // 필드라 상관없다.
  const blockingCandidates = candidates.filter(
    (t) => !blockedByIds.has(t.id) && !excludeFromOrdered(t) && notDone(t),
  )

  // 연결 후보에서는 나머지 **네 관계 모두**를 뺀다. 연결은 "순서도 계층도 아닌
  // 그냥 관련"이라는 가장 약한 관계라, 더 구체적인 관계가 이미 있으면 덧붙여도
  // 정보가 늘지 않고 상자에 같은 제목이 두 번 뜬다. 예전에는 선행·후행만 뺐고
  // 계층은 빠져 있어서 상위 일감을 연결로도 걸 수 있었다.
  const takenIds = new Set([
    ...blockingIds,
    ...blockedByIds,
    ...subtasks.map((t) => t.id),
    ...(parentTask ? [parentTask.id] : []),
  ])
  const relatedCandidates = candidates.filter((t) => !takenIds.has(t.id))

  // TaskSubtasks와 마찬가지로 테두리 없이 섹션만 내놓는다 — 상자는 부모가 하나만
  // 그린다. 각 TaskLinkSection이 비어 있으면 스스로 사라지므로 여기서 전체를
  // 숨기는 판단은 하지 않는다.
  return (
    <>
      <TaskLinkSection
        title="선행 일감"
        projectId={projectId}
        tasks={blockedBy}
        editing={editing}
        candidates={blockedByCandidates}
        onAdd={(t) => onBlockedByChange([...blockedBy, t])}
        onRemove={(id) => {
          onBlockedByChange(blockedBy.filter((t) => t.id !== id))
          onRemoved('blockedBy')
        }}
        placeholder="먼저 끝나야 하는 일감 검색"
        linkTasks={!editing}
        notice={lastRemoved === 'blockedBy' ? SAVE_NOTICE : null}
      />
      {/* 안내는 선행 피커 바로 아래에 둔다 — 후행 뒤로 밀면 무엇에 대한 설명인지
          한눈에 안 붙는다. */}
      {editing && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          선행 일감은 이 일감보다 먼저 끝나야 하는 일감이에요 — 상태 변경을 막지는 않고, 목록에 &quot;선행 대기&quot;
          배지로만 표시됩니다.
        </p>
      )}
      <TaskLinkSection
        title="후행 일감"
        projectId={projectId}
        tasks={blocking}
        editing={editing}
        candidates={blockingCandidates}
        onAdd={(t) => onBlockingChange((current) => [...current, t])}
        onRemove={(id) => {
          onBlockingChange((current) => current.filter((t) => t.id !== id))
          onRemoved('blocking')
        }}
        placeholder="이 일감이 끝나야 시작할 수 있는 일감 검색"
        linkTasks={!editing}
        notice={lastRemoved === 'blocking' ? SAVE_NOTICE : null}
        removeBlockedReason={doneCounterpartReason}
      />
      <TaskLinkSection
        title="연결 일감"
        projectId={projectId}
        tasks={related}
        editing={editing}
        candidates={relatedCandidates}
        onAdd={(t) => onRelatedChange([...related, t])}
        onRemove={(id) => {
          onRelatedChange(related.filter((t) => t.id !== id))
          onRemoved('related')
        }}
        placeholder="연결 일감 검색"
        linkTasks={!editing}
        notice={lastRemoved === 'related' ? SAVE_NOTICE : null}
      />
    </>
  )
}

export default TaskLinks
