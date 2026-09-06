import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

function formatDateTime(value) {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function describeActivity(a) {
  if (a.action === 'created') return `${a.actorName}님이 일감을 생성했습니다`
  if (a.field === 'description') return `${a.actorName}님이 설명을 수정했습니다`
  return `${a.actorName}님이 ${a.fieldLabel}을(를) ${a.fromLabel ?? '(없음)'} → ${a.toLabel ?? '(없음)'}(으)로 변경했습니다`
}

// TaskComments/Comments.jsx와 동일한 패턴 — apiPath 자체를 props로 받는 대신
// projectId/taskId로 조립하고, 자체 useEffect로 독립적으로 불러온다.
function TaskActivityLog({ projectId, taskId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}/activity`)
        if (!cancelled) setItems(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId])

  if (loading) return null

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-white">활동 로그</h3>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">기록이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((a) => (
            <li key={a.id} className="text-xs text-gray-600 dark:text-gray-300">
              <span>{describeActivity(a)}</span>
              <span className="ml-2 text-gray-400 dark:text-gray-500">{formatDateTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TaskActivityLog
