import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { Avatar } from './ProjectMembers'
import { TASK_STATUSES } from '../lib/taskFields'

const EMPTY_COUNTS = Object.fromEntries(TASK_STATUSES.map((s) => [s.value, 0]))

// 이 위젯에서만 쓰는 상태별 색상 — 진행 단계가 눈에 띄어야 스캔이 빠르므로
// (등록: 아직 시작 전이라 중립, 진행: 파랑, 검수: 주의를 끌 노랑, 완료: 초록,
// TaskCard 등 다른 화면의 무채색 배지와는 별개 팔레트).
const STATUS_BADGE_CLASS = {
  todo: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  doing: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  review: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}

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

  const rowTotal = (counts) => TASK_STATUSES.reduce((sum, s) => sum + (counts[s.value] || 0), 0)

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
      user: m.user,
      counts: countsByAssignee.get(m.userId) || EMPTY_COUNTS,
    }))

    // 이미 프로젝트에서 빠졌지만(멤버 목록엔 없음) 그 사람에게 배정된 채로
    // 남아있는 일감이 있으면, 조용히 합계에서 빼지 않고 별도 행으로 표시한다
    // — 안 그러면 워크로드 합계가 실제 일감 수보다 적어 보인다.
    for (const [assigneeId, counts] of countsByAssignee) {
      if (assigneeId === 'unassigned' || memberIds.has(assigneeId)) continue
      const user = assigneeById.get(assigneeId)
      memberRows.push({ key: assigneeId, name: `${user?.name || '알 수 없음'} (전 멤버)`, user, counts })
    }

    const unassignedCounts = countsByAssignee.get('unassigned')
    if (unassignedCounts) memberRows.push({ key: 'unassigned', name: '미배정', user: null, counts: unassignedCounts })

    // 배정된 일감(합계)이 많은 사람이 맨 위로 — 담당자별로 일이 얼마나 몰려
    // 있는지 한눈에 보려는 화면이라, 이름순보다 이 정렬이 화면의 목적에 맞다.
    return memberRows.sort((a, b) => rowTotal(b.counts) - rowTotal(a.counts))
  }, [tasks, members])

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">워크로드</h3>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">일감이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-3">
              <span className="flex min-w-[8rem] shrink-0 items-center gap-2 text-sm text-gray-900 dark:text-white">
                <Avatar user={row.user} />
                {row.name}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {TASK_STATUSES.map((s) => (
                  <span key={s.value} className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_CLASS[s.value]}`}>
                    {s.label} {row.counts[s.value] || 0}
                  </span>
                ))}
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  합계 {rowTotal(row.counts)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectWorkload
