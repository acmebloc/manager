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

// 다중 선택용 "제목 + 목록(또는 빈 문구) + 피커" 섹션. 연결일감(TaskLinks)과
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

// 연결일감 — 순수 관계 표시일 뿐, 이 셀렉션이 실제 일감에 아무런 기능적
// 영향도 주지 않는다(상태 등은 각자 독립적으로 유지됨). 예전엔 여기에
// 부모일감/자식일감도 있었지만, 실제 기능(진행률 롤업)이 있는 진짜 계층으로
// 대체돼 TaskSubtasks.jsx로 옮겨갔다.
function TaskLinks({ projectId, editing, candidates, related, onChange }) {
  if (!editing && related.length === 0) return null

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <TaskLinkSection
        title="연결일감"
        projectId={projectId}
        tasks={related}
        editing={editing}
        candidates={candidates}
        onAdd={(t) => onChange([...related, t])}
        onRemove={(id) => onChange(related.filter((t) => t.id !== id))}
        placeholder="연결일감 검색"
      />
    </div>
  )
}

export default TaskLinks
