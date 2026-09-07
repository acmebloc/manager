import { useMemo, useState } from 'react'
import { GRADE_RANK, taskGradeLabel, taskStatusLabel, taskTypeLabel, TASK_STATUSES } from '../lib/taskFields'
import { Avatar } from './ProjectMembers'

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

const COLUMNS = [
  { key: 'title', label: '제목' },
  { key: 'type', label: '유형' },
  { key: 'grade', label: '등급' },
  { key: 'status', label: '상태' },
  { key: 'assigneeName', label: '담당자' },
  { key: 'endAt', label: '마감일' },
]

function sortValue(task, key) {
  if (key === 'grade') return GRADE_RANK[task.grade] ?? 99
  if (key === 'assigneeName') return task.assignee?.name || ''
  if (key === 'endAt') return task.endAt ? new Date(task.endAt).getTime() : Infinity
  return task[key] ?? ''
}

function compareTasks(a, b, key) {
  const av = sortValue(a, key)
  const bv = sortValue(b, key)
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv), 'ko')
}

const pillClassName =
  'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300'

// 보드(칸반)의 대안 뷰 — 여러 프로젝트를 한 화면에서 정렬/필터할 수 있는 목록.
// 프로젝트별로 테이블을 아예 분리하진 않되(한 개의 <table>), 프로젝트 경계마다
// 전체 폭 구분행(그룹 헤더)을 끼워 넣어 구분한다 — 얇은/굵은 선 차이보다 훨씬
// 뚜렷하다. 정렬은 전체를 한 줄로 섞지 않고 "프로젝트로 먼저 묶고, 그 안에서
// 고른 컬럼으로 정렬"하는 방식이라(칸반이 프로젝트별 섹션인 것과 같은 구조),
// 어떤 컬럼을 클릭해도 그룹 구분이 흐트러지지 않는다. 그룹 헤더 행을 클릭하면
// 그 프로젝트만 접혔다 펼쳐졌다 한다(기본은 전부 펼침) — 접힘/펼침을 구분하는
// 별도 아이콘은 없다(확인됨), 행이 있고 없고 자체가 상태 표시다. 상태 변경
// select는 보드의 드래그와 동일한 onMoveTask(낙관적 업데이트 + PATCH)를 그대로
// 호출한다 — 드래그가 안 되는 터치 기기에서도 이 select로 상태를 바꿀 수 있다.
function TaskTable({ sections, onNavigateToTask, onMoveTask }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [sortKey, setSortKey] = useState('endAt')
  const [sortDir, setSortDir] = useState('asc')
  // 기본값은 전부 펼쳐진 상태 — 접은 프로젝트의 id만 여기 담아둔다.
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => new Set())

  const toggleCollapse = (projectId) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const groups = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return sections
      .map((section) => {
        const filtered = section.tasks.filter((task) => {
          if (statusFilter && task.status !== statusFilter) return false
          if (myTasksOnly && !task.isMine) return false
          return true
        })
        const sorted = [...filtered].sort((a, b) => compareTasks(a, b, sortKey) * dir)
        return { projectId: section.projectId, projectName: section.projectName, tasks: sorted }
      })
      .filter((group) => group.tasks.length > 0)
  }, [sections, statusFilter, myTasksOnly, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="">전체 상태</option>
          {TASK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={myTasksOnly} onChange={(e) => setMyTasksOnly(e.target.checked)} />
          내 일감만 보기
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">확인 가능한 일감이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.projectId}>
                <tr className="bg-gray-100 dark:bg-gray-800">
                  <th
                    scope="rowgroup"
                    colSpan={COLUMNS.length}
                    onClick={() => toggleCollapse(group.projectId)}
                    className="cursor-pointer select-none px-3 py-1.5 text-left text-xs font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {group.projectName}
                    <span className="ml-1.5 font-normal text-gray-400 dark:text-gray-500">{group.tasks.length}건</span>
                  </th>
                </tr>
                {!collapsedProjectIds.has(group.projectId) && group.tasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => onNavigateToTask(group.projectId, task.id)}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{task.title}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={pillClassName}>{taskTypeLabel(task.type)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={pillClassName}>{taskGradeLabel(task.grade)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {task.canModify ? (
                        <select
                          value={task.status}
                          onChange={(e) => onMoveTask(group.projectId, task.id, e.target.value)}
                          className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={pillClassName}>{taskStatusLabel(task.status)}</span>
                      )}
                    </td>
                    <td className="max-w-[180px] px-3 py-2">
                      <span className={`flex items-center gap-1.5 ${!task.assigneeIsMember ? 'opacity-50' : ''}`}>
                        {task.assignee ? (
                          <>
                            <Avatar user={task.assignee} />
                            <span className="max-w-[140px] truncate">{task.assignee.name}</span>
                          </>
                        ) : (
                          '미배정'
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-300">
                      {formatDate(task.endAt) || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  )
}

export default TaskTable
