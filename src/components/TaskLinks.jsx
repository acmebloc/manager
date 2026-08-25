import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { taskStatusLabel } from '../lib/taskFields'

function TaskChip({ task, projectId, onRemove }) {
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
function TaskPicker({ candidates, onPick, placeholder }) {
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

function TaskLinkSection({ title, projectId, tasks, editing, candidates, onAdd, onRemove, placeholder }) {
  const excludeIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])

  if (!editing && tasks.length === 0) return null

  return (
    <div>
      <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{title}</p>
      {tasks.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {tasks.map((t) => (
            <TaskChip key={t.id} task={t} projectId={projectId} onRemove={editing ? onRemove : null} />
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">선택된 일감 없음</p>
      )}
      {editing && (
        <TaskPicker candidates={candidates.filter((t) => !excludeIds.has(t.id))} onPick={onAdd} placeholder={placeholder} />
      )}
    </div>
  )
}

// 부모/자식/연결일감 — 순수 관계 표시일 뿐, 이 셀렉션이 실제 일감에 아무런
// 기능적 영향도 주지 않는다 (상태 등은 각자 독립적으로 유지됨).
function TaskLinks({ projectId, editing, candidates, parents, childTasks, related, onChange }) {
  const hasAny = parents.length > 0 || childTasks.length > 0 || related.length > 0
  if (!editing && !hasAny) return null

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">연결된 일감</p>
      <TaskLinkSection
        title="부모일감"
        projectId={projectId}
        tasks={parents}
        editing={editing}
        candidates={candidates}
        onAdd={(t) => onChange('parents', [...parents, t])}
        onRemove={(id) => onChange('parents', parents.filter((t) => t.id !== id))}
        placeholder="부모일감 검색"
      />
      <TaskLinkSection
        title="자식일감"
        projectId={projectId}
        tasks={childTasks}
        editing={editing}
        candidates={candidates}
        onAdd={(t) => onChange('children', [...childTasks, t])}
        onRemove={(id) => onChange('children', childTasks.filter((t) => t.id !== id))}
        placeholder="자식일감 검색"
      />
      <TaskLinkSection
        title="연결일감"
        projectId={projectId}
        tasks={related}
        editing={editing}
        candidates={candidates}
        onAdd={(t) => onChange('related', [...related, t])}
        onRemove={(id) => onChange('related', related.filter((t) => t.id !== id))}
        placeholder="연결일감 검색"
      />
    </div>
  )
}

export default TaskLinks
