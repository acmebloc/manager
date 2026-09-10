import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { taskStatusLabel } from '../lib/taskFields'

export function TaskChip({ task, projectId, onRemove }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-700">
      <Link
        to={`/tasks/${projectId}/${task.id}`}
        className="min-w-0 flex-1 truncate text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
      >
        {task.title}
      </Link>
      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{taskStatusLabel(task.status)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(task.id)}
          className="shrink-0 text-xs text-red-600 hover:text-red-500 dark:text-red-400"
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
export function TaskPicker({ candidates, onPick, placeholder }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return candidates.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 6)
  }, [candidates, query])

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
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
  emptyLabel = '선택된 일감 없음',
}) {
  const excludeIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])

  if (!editing && tasks.length === 0) return null

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{title}</p>
        {badge && <span className="text-xs text-gray-400 dark:text-gray-500">{badge}</span>}
      </div>
      {tasks.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskChip key={t.id} task={t} projectId={projectId} onRemove={editing ? onRemove : null} />
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">{emptyLabel}</p>
      )}
      {editing && (
        <TaskPicker candidates={candidates.filter((t) => !excludeIds.has(t.id))} onPick={onAdd} placeholder={placeholder} />
      )}
    </div>
  )
}

// 계층(상위/하위)이 아닌 관계들 — 선행·후행·연결(docs/task-relations-spec.md).
// 계층은 진행률이 붙는 진짜 부모-자식이라 TaskSubtasks.jsx가 따로 담당하고,
// 여기는 "순서"와 "그냥 관련"만 다룬다. 세 관계 모두 상태 전이에는 관여하지
// 않는다 — 연결된 일감의 상태가 바뀌어도 이 일감은 그대로다.
//
// 편집은 선행 방향 한쪽만 연다. 후행("이 일감이 끝나야 시작할 수 있는 일감")은
// 읽기 전용으로 보여주고, 바꾸려면 그 일감 화면에서 자기 선행을 고친다 —
// 양방향 편집을 다 열면 피커가 둘로 늘고 같은 관계를 두 곳에서 지울 수 있어
// 헷갈린다(spec 2장).
function TaskLinks({
  projectId,
  editing,
  candidates,
  related,
  onRelatedChange,
  blockedBy,
  onBlockedByChange,
  blocking,
}) {
  if (!editing && related.length === 0 && blockedBy.length === 0 && blocking.length === 0) return null

  // 후행 일감은 선행 후보에서 뺀다 — 그걸 선행으로 잡으면 곧바로 순환이라 서버가
  // 거절한다. 간접 순환(A→B→C→A)은 서버만 잡을 수 있지만, 가장 흔한 직접 순환은
  // 애초에 고를 수 없게 하는 쪽이 저장 후 에러를 보는 것보다 낫다.
  const blockingIds = new Set(blocking.map((t) => t.id))
  const blockedByCandidates = candidates.filter((t) => !blockingIds.has(t.id))

  // 반대로 선행·후행으로 이미 이어진 일감은 연결 후보에서 뺀다. 연결 일감은
  // 순서 관계보다 약한 "그냥 관련"이라, 같은 쌍을 양쪽에 걸면 한 상자 안에 같은
  // 제목이 두 번 뜨면서 정보만 늘고 뜻은 안 늘어난다. (반대 방향은 막지 않는다 —
  // 연결로 걸어둔 일감을 나중에 선행으로 올리는 건 관계를 구체화하는 것이다.)
  const orderedIds = new Set([...blockingIds, ...blockedBy.map((t) => t.id)])
  const relatedCandidates = candidates.filter((t) => !orderedIds.has(t.id))

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <TaskLinkSection
        title="선행 일감"
        projectId={projectId}
        tasks={blockedBy}
        editing={editing}
        candidates={blockedByCandidates}
        onAdd={(t) => onBlockedByChange([...blockedBy, t])}
        onRemove={(id) => onBlockedByChange(blockedBy.filter((t) => t.id !== id))}
        placeholder="먼저 끝나야 하는 일감 검색"
        emptyLabel="없음"
      />
      {/* 안내는 선행 피커 바로 아래에 둔다 — 후행 뒤로 밀면 무엇에 대한 설명인지
          한눈에 안 붙는다. */}
      {editing && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          선행 일감은 이 일감보다 먼저 끝나야 하는 일감이에요 — 상태 변경을 막지는 않고, 목록에 &quot;선행 대기&quot;
          배지로만 표시됩니다. 후행 일감은 여기서 바꿀 수 없고, 그 일감의 선행 목록에서 고칩니다.
        </p>
      )}
      {/* editing={false}를 고정으로 넘겨 피커와 제거 버튼을 없앤다 — 비어 있으면
          TaskLinkSection이 스스로 사라지므로 후행이 없는 일감에는 아무것도 안 뜬다. */}
      <TaskLinkSection title="후행 일감" projectId={projectId} tasks={blocking} editing={false} candidates={[]} />
      <TaskLinkSection
        title="연결 일감"
        projectId={projectId}
        tasks={related}
        editing={editing}
        candidates={relatedCandidates}
        onAdd={(t) => onRelatedChange([...related, t])}
        onRemove={(id) => onRelatedChange(related.filter((t) => t.id !== id))}
        placeholder="연결 일감 검색"
      />
    </div>
  )
}

export default TaskLinks
