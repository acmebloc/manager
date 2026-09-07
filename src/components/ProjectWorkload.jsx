import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { TASK_STATUSES } from '../lib/taskFields'

const EMPTY_COUNTS = Object.fromEntries(TASK_STATUSES.map((s) => [s.value, 0]))

// 새 집계 API 없이 GET /api/projects/:id/tasks(이미 상태+담당자를 포함해서
// 내려줌)를 그대로 불러다 담당자별로 클라이언트에서 group-by만 한다 —
// TaskAttachments.jsx와 같은 자체 fetch 패턴. 프로젝트 하나 안에서만 보는
// 스코프라(교차 프로젝트 아님), 새로 만들 것도 이것뿐이다.
function ProjectWorkload({ projectId, pm, pl, otherMembers }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/projects/${projectId}/tasks`)
        if (!cancelled) setTasks(data)
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

  const members = useMemo(() => {
    const list = []
    if (pm) list.push(pm)
    if (pl) list.push(pl)
    return [...list, ...otherMembers]
  }, [pm, pl, otherMembers])

  const rows = useMemo(() => {
    const countsByAssignee = new Map()
    const assigneeById = new Map()
    for (const task of tasks) {
      const key = task.assigneeId || 'unassigned'
      const counts = countsByAssignee.get(key) || { ...EMPTY_COUNTS }
      counts[task.status] = (counts[task.status] || 0) + 1
      countsByAssignee.set(key, counts)
      if (task.assigneeId && task.assignee) assigneeById.set(task.assigneeId, task.assignee)
    }

    const memberIds = new Set(members.map((m) => m.userId))
    const memberRows = members.map((m) => ({
      key: m.userId,
      name: m.user.name,
      counts: countsByAssignee.get(m.userId) || EMPTY_COUNTS,
    }))

    // 이미 프로젝트에서 빠졌지만(멤버 목록엔 없음) 그 사람에게 배정된 채로
    // 남아있는 일감이 있으면, 조용히 합계에서 빼지 않고 별도 행으로 표시한다
    // — 안 그러면 워크로드 합계가 실제 일감 수보다 적어 보인다.
    for (const [assigneeId, counts] of countsByAssignee) {
      if (assigneeId === 'unassigned' || memberIds.has(assigneeId)) continue
      memberRows.push({ key: assigneeId, name: `${assigneeById.get(assigneeId)?.name || '알 수 없음'} (전 멤버)`, counts })
    }

    const unassignedCounts = countsByAssignee.get('unassigned')
    if (unassignedCounts) memberRows.push({ key: 'unassigned', name: '미배정', counts: unassignedCounts })
    return memberRows
  }, [tasks, members])

  const rowTotal = (counts) => TASK_STATUSES.reduce((sum, s) => sum + (counts[s.value] || 0), 0)

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">워크로드</h3>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">일감이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-left text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-4 font-medium">담당자</th>
                {TASK_STATUSES.map((s) => (
                  <th key={s.value} className="px-3 py-1 text-center font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="px-3 py-1 text-center font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="whitespace-nowrap py-1.5 pr-4 text-gray-900 dark:text-white">{row.name}</td>
                  {TASK_STATUSES.map((s) => (
                    <td key={s.value} className="px-3 py-1.5 text-center text-gray-600 dark:text-gray-300">
                      {row.counts[s.value] || 0}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-center font-medium text-gray-900 dark:text-white">
                    {rowTotal(row.counts)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ProjectWorkload
