import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { taskStatusLabel, taskTypeLabel, TASK_STATUSES } from '../lib/taskFields'
import { Avatar } from '../components/ProjectMembers'

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

function ProjectSection({ section, statusFilter, myTasksOnly }) {
  const visibleTasks = section.tasks.filter((task) => {
    if (statusFilter && task.status !== statusFilter) return false
    if (myTasksOnly && !task.isMine) return false
    return true
  })

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-medium text-gray-900 dark:text-white">{section.projectName}</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">일감 {section.tasks.length}개</span>
          <Link
            to={`/projects/${section.projectId}/board`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            칸반 보드 보기 →
          </Link>
        </div>
      </div>

      {section.tasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          발행된 일감이 없습니다.
        </p>
      ) : visibleTasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          조건에 맞는 일감이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {visibleTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Link
                to={`/projects/${section.projectId}/board`}
                className="min-w-0 flex-1 truncate text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
              >
                {task.title}
              </Link>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {taskTypeLabel(task.type)}
              </span>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {taskStatusLabel(task.status)}
              </span>
              <span
                className={`flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400 ${
                  !task.assigneeIsMember ? 'opacity-50' : ''
                }`}
              >
                {task.assignee ? (
                  <>
                    <Avatar user={task.assignee} />
                    {task.assignee.name}
                  </>
                ) : (
                  '미배정'
                )}
              </span>
              <span className="w-16 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
                {formatDate(task.endAt) || ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TasksPage() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [myTasksOnly, setMyTasksOnly] = useState(false)

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

  const totalTasks = useMemo(() => sections.reduce((sum, s) => sum + s.tasks.length, 0), [sections])

  if (loading) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">일감관리</h2>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="">전체 상태</option>
          {TASK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={myTasksOnly}
            onChange={(e) => setMyTasksOnly(e.target.checked)}
          />
          내 일감만 보기
        </label>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {sections.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">
          속한 프로젝트가 없습니다.
        </p>
      ) : (
        sections.map((section) => (
          <ProjectSection
            key={section.projectId}
            section={section}
            statusFilter={statusFilter}
            myTasksOnly={myTasksOnly}
          />
        ))
      )}

      {sections.length > 0 && totalTasks === 0 && (
        <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          아직 발행된 일감이 없습니다.
        </p>
      )}
    </div>
  )
}

export default TasksPage
