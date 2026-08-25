import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { TASK_GRADES, TASK_STATUSES, TASK_TYPES, sortTasks } from '../lib/taskFields'
import { Avatar } from '../components/ProjectMembers'

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
      <p className="font-medium text-gray-900 dark:text-white">{task.title}</p>
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
      {(task._count?.attachments > 0 || task._count?.comments > 0) && (
        <div className="flex gap-2 text-xs text-gray-400 dark:text-gray-500">
          {task._count.attachments > 0 && <span>첨부 {task._count.attachments}</span>}
          {task._count.comments > 0 && <span>댓글 {task._count.comments}</span>}
        </div>
      )}
    </li>
  )
}

function TaskBoardPage() {
  const { id: projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragOverStatus, setDragOverStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [projectData, taskData] = await Promise.all([
          apiFetch(`/api/projects/${projectId}`),
          apiFetch(`/api/projects/${projectId}/tasks`),
        ])
        if (cancelled) return
        setProject(projectData)
        setTasks(taskData)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const columns = useMemo(() => {
    const byStatus = new Map(TASK_STATUSES.map((s) => [s.value, []]))
    for (const task of tasks) {
      byStatus.get(task.status)?.push(task)
    }
    for (const [status, list] of byStatus) {
      byStatus.set(status, sortTasks(list))
    }
    return byStatus
  }, [tasks])

  const replaceTask = (updated) => {
    setTasks((current) => current.map((t) => (t.id === updated.id ? updated : t)))
  }

  const moveTask = async (taskId, status) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === status || !task.canModify) return
    // 낙관적 업데이트 — 실패하면 되돌린다.
    setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)))
    try {
      const updated = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status },
      })
      replaceTask(updated)
    } catch (err) {
      setTasks((current) => current.map((t) => (t.id === taskId ? task : t)))
      setError(err.message)
    }
  }

  if (loading) return null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link to="/tasks" className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white">
            ← 일감관리
          </Link>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{project?.name} 칸반 보드</h2>
        </div>
        <Link
          to={`/projects/${projectId}/tasks/new`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          새 일감
        </Link>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

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
              moveTask(taskId, col.value)
            }}
            className={`flex min-h-[200px] flex-col gap-2 rounded-lg p-2 ${
              dragOverStatus === col.value ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-gray-50 dark:bg-gray-800/50'
            }`}
          >
            <h3 className="px-1 text-sm font-medium text-gray-600 dark:text-gray-300">
              {col.label} ({columns.get(col.value)?.length ?? 0})
            </h3>
            <ul className="flex flex-col gap-2">
              {columns.get(col.value)?.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  draggable={task.canModify}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                  onClick={() => navigate(`/projects/${projectId}/tasks/${task.id}`)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export default TaskBoardPage
