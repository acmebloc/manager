import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { TASK_GRADES, TASK_STATUSES, TASK_TYPES, sortTasks } from '../lib/taskFields'
import { Avatar } from '../components/ProjectMembers'
import TaskTable from '../components/TaskTable'

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

function TaskCard({ task, draggable, onDragStart, onClick }) {
  return (
    <li
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onClick={onClick}
      className={`flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      <p className="text-xs font-medium text-gray-900 dark:text-white">{task.title}</p>
      <div className="flex flex-wrap gap-1 text-xs">
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {TASK_TYPES.find((t) => t.value === task.type)?.label}
        </span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {TASK_GRADES.find((g) => g.value === task.grade)?.label}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span className={`flex items-center gap-1 ${!task.assigneeIsMember ? 'opacity-50' : ''}`}>
          {task.assignee ? (
            <>
              <Avatar user={task.assignee} />
              {task.assignee.name}
            </>
          ) : (
            '미배정'
          )}
        </span>
        {task.endAt && <span>{formatDate(task.endAt)}</span>}
      </div>
      {(task._count?.attachments > 0 || task._count?.comments > 0 || task.checklistItems?.length > 0) && (
        <div className="flex gap-2 text-xs text-gray-400 dark:text-gray-500">
          {task._count.attachments > 0 && <span>첨부 {task._count.attachments}</span>}
          {task._count.comments > 0 && <span>댓글 {task._count.comments}</span>}
          {task.checklistItems?.length > 0 && (
            <span>
              체크리스트 {task.checklistItems.filter((i) => i.done).length}/{task.checklistItems.length}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

// 프로젝트 하나의 4단 칸반 보드 — 필터(전체 상태/내 일감만 보기)는 이 섹션
// 안에서만 유효하다 (프로젝트마다 독립).
function ProjectBoard({ section, onNavigateToTask, onMoveTask }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [dragOverStatus, setDragOverStatus] = useState(null)

  const visibleTasks = useMemo(
    () =>
      section.tasks.filter((task) => {
        if (statusFilter && task.status !== statusFilter) return false
        if (myTasksOnly && !task.isMine) return false
        return true
      }),
    [section.tasks, statusFilter, myTasksOnly],
  )

  const columns = useMemo(() => {
    const byStatus = new Map(TASK_STATUSES.map((s) => [s.value, []]))
    for (const task of visibleTasks) {
      byStatus.get(task.status)?.push(task)
    }
    for (const [status, list] of byStatus) {
      byStatus.set(status, sortTasks(list))
    }
    return byStatus
  }, [visibleTasks])

  return (
    <section id={`project-${section.projectId}`} className="mb-8 scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium text-gray-900 dark:text-white">{section.projectName}</h3>
        <div className="flex items-center gap-3">
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
          <Link
            to={`/tasks/${section.projectId}/new`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            새 일감
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TASK_STATUSES.map((col) => (
          <div
            key={col.value}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverStatus(col.value)
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === col.value ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              const taskId = e.dataTransfer.getData('text/plain')
              setDragOverStatus(null)
              onMoveTask(section.projectId, taskId, col.value)
            }}
            className={`flex min-h-[200px] flex-col gap-2 rounded-lg p-2 ${
              dragOverStatus === col.value ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-gray-50 dark:bg-gray-800/50'
            }`}
          >
            <h4 className="px-1 text-sm font-medium text-gray-600 dark:text-gray-300">
              {col.label} ({columns.get(col.value)?.length ?? 0})
            </h4>
            <ul className="flex flex-col gap-2">
              {columns.get(col.value)?.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  draggable={task.canModify}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                  onClick={() => onNavigateToTask(section.projectId, task.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function TasksPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const scrollProjectId = searchParams.get('projectId')
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // ?view=list로 들어오면 목록이 기본으로 켜진 상태로 보이게(공유 가능한
  // 링크) — 토글을 누를 때도 같은 파라미터를 반영해 새로고침해도 유지된다.
  const [view, setView] = useState(searchParams.get('view') === 'list' ? 'list' : 'board')

  const changeView = (next) => {
    setView(next)
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'list') nextParams.set('view', 'list')
    else nextParams.delete('view')
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/my-tasks')
        if (!cancelled) setSections(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 프로젝트 상세 페이지의 "일감 바로가기"(?projectId=)로 들어왔을 때 해당
  // 프로젝트 섹션으로 스크롤 — 전용 라우트를 새로 만들지 않기 위한 경량 구현
  // (docs/project-menu-upgrade-spec.md 4.4).
  useEffect(() => {
    if (!scrollProjectId || sections.length === 0) return
    document.getElementById(`project-${scrollProjectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollProjectId, sections])

  const onNavigateToTask = (projectId, taskId) => navigate(`/tasks/${projectId}/${taskId}`)

  const onMoveTask = async (projectId, taskId, status) => {
    const section = sections.find((s) => s.projectId === projectId)
    const task = section?.tasks.find((t) => t.id === taskId)
    if (!task || task.status === status || !task.canModify) return

    const applyTask = (updatedTask) =>
      setSections((current) =>
        current.map((s) =>
          s.projectId === projectId
            ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? updatedTask : t)) }
            : s,
        ),
      )

    // 낙관적 업데이트 — 실패하면 되돌린다.
    applyTask({ ...task, status })
    try {
      const updated = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status },
      })
      applyTask(updated)
    } catch (err) {
      applyTask(task)
      setError(err.message)
    }
  }

  if (loading) return null

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">일감</h2>
        <div className="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
          <button
            type="button"
            onClick={() => changeView('board')}
            className={`px-3 py-1.5 text-sm ${
              view === 'board'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            보드
          </button>
          <button
            type="button"
            onClick={() => changeView('list')}
            className={`px-3 py-1.5 text-sm ${
              view === 'list'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            목록
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {scrollProjectId && !sections.some((s) => s.projectId === scrollProjectId) && (
        <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
          요청한 프로젝트의 일감을 찾을 수 없어요(보관되었거나 접근 권한이 없는 프로젝트일 수 있어요).
        </p>
      )}

      {sections.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">확인 가능한 일감이 없습니다.</p>
      ) : view === 'board' ? (
        sections.map((section) => (
          <ProjectBoard
            key={section.projectId}
            section={section}
            onNavigateToTask={onNavigateToTask}
            onMoveTask={onMoveTask}
          />
        ))
      ) : (
        <TaskTable sections={sections} onNavigateToTask={onNavigateToTask} onMoveTask={onMoveTask} />
      )}
    </div>
  )
}

export default TasksPage
