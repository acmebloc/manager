import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { TASK_GRADES, TASK_STATUSES, TASK_TYPES, sortTasks, taskStatusLabel } from '../lib/taskFields'
import { submitStatusChange } from '../lib/taskReview'
import { Avatar } from '../components/ProjectMembers'
import TaskRelationBadges from '../components/TaskRelationBadges'
import ProjectPicker from '../components/ProjectPicker'
import TaskStatusDialog from '../components/TaskStatusDialog'
import TaskTable from '../components/TaskTable'

// 관계도는 그래프 라이브러리(@xyflow/react + dagre)를 끌고 오므로 따로 떼어낸다 —
// 관계도를 한 번도 안 여는 사용자가 그 용량을 받을 이유가 없다.
const TaskRelationGraph = lazy(() => import('../components/TaskRelationGraph'))

const VIEWS = [
  { value: 'board', label: '보드' },
  { value: 'list', label: '목록' },
  { value: 'graph', label: '관계도' },
]

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

// 상태 변경(PATCH) 응답은 상세페이지용이라 이 목록이 쓰지 않는 필드까지 실려온다.
// (subtasks/blockedByOpenCount는 관계 배지가 쓰므로 그대로 통과시킨다 —
//  안 그러면 드래그 직후 배지만 사라진다.)
// 특히 description은 본문에 base64 이미지가 박힐 수 있어서 목록 API(/api/my-tasks)도
// 애초에 안 내려주는 필드다 — 그대로 state에 넣으면 상태를 바꾼 일감마다 그만큼
// 화면에 계속 물려 있게 된다. 새로 늘어나는 필드는 그냥 통과시키고, 무겁거나
// 목록과 무관한 것만 덜어낸다(tasks.js의 GET / 이 쓰는 것과 같은 방식).
function toListTask(updated) {
  const {
    description: _description,
    followers: _followers,
    parentTask: _parentTask,
    createdReviewId: _createdReviewId,
    ...rest
  } = updated
  return rest
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
      {(task._count?.attachments > 0 ||
        task._count?.comments > 0 ||
        task.checklistItems?.length > 0 ||
        task.subtasks?.length > 0 ||
        task.blockedByOpenCount > 0) && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-400 dark:text-gray-500">
          {task._count.attachments > 0 && <span>첨부 {task._count.attachments}</span>}
          {task._count.comments > 0 && <span>댓글 {task._count.comments}</span>}
          {task.checklistItems?.length > 0 && (
            <span>
              체크리스트 {task.checklistItems.filter((i) => i.done).length}/{task.checklistItems.length}
            </span>
          )}
          <TaskRelationBadges task={task} />
        </div>
      )}
    </li>
  )
}

// 프로젝트 하나의 4단 칸반 보드 — 필터(전체 상태/내 일감만 보기)는 이 섹션
// 안에서만 유효하다 (프로젝트마다 독립).
function ProjectBoard({ section, onNavigateToTask, onRequestStatusChange }) {
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
              onRequestStatusChange(section.projectId, taskId, col.value)
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
                  // 완료된 일감은 canModify가 false지만 PM·등록자는 재오픈으로
                  // 끌어낼 수 있어야 한다 — 그래서 드래그 가능 여부는
                  // allowedTransitions로 판단한다.
                  draggable={task.allowedTransitions?.length > 0}
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
  // 어떤 뷰인지는 **URL만이 안다**(state로 따로 들고 있지 않는다). ?view=list로
  // 들어오면 목록이 켜진 채로 보이고(공유 가능한 링크), 토글도 URL을 바꾸는
  // 방식이라 새로고침에도 유지된다.
  //
  // 예전에는 마운트할 때 한 번만 읽어 state에 담았는데, 그러면 상단 메뉴의
  // [일감]을 눌러도 화면이 안 바뀌었다 — 목적지가 /tasks라 **이미 이 라우트에
  // 있으면 컴포넌트가 다시 마운트되지 않고**, useState 초기값도 다시 계산되지
  // 않는다. URL의 ?view=graph만 사라지고 화면은 관계도에 머물렀다.
  const requestedView = searchParams.get('view')
  const view = requestedView === 'list' || requestedView === 'graph' ? requestedView : 'board'
  // 관계도는 프로젝트 하나만 그린다(관계는 프로젝트 안에서만 맺어진다) — 보드·
  // 목록이 내 프로젝트 전체를 보여주는 것과 스코프가 달라서, 어느 프로젝트를
  // 보고 있는지 상단 선택기로 분명히 한다.
  const [graphProjects, setGraphProjects] = useState([])
  const [graphProjectId, setGraphProjectId] = useState(searchParams.get('projectId') || '')
  // 팝업이 필요한 전이를 기다리는 중 — { projectId, task, transition }
  const [pendingChange, setPendingChange] = useState(null)

  const changeView = (next) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'board') nextParams.delete('view')
    else nextParams.set('view', next)
    setSearchParams(nextParams, { replace: true })
  }

  const changeGraphProject = (projectId) => {
    setGraphProjectId(projectId)
    // 새로고침·링크 공유에서 선택이 유지되도록 URL에 남긴다(일정 화면과 동일).
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('projectId', projectId)
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

  // 관계도로 들어올 때만 프로젝트 목록을 읽는다 — 보드·목록은 my-tasks 하나로
  // 충분해서 이 요청이 필요 없다. 기본 선택은 가장 최근에 만들어진 프로젝트
  // (/api/projects가 createdAt desc)로, 일정 화면과 같은 기준이다.
  useEffect(() => {
    if (view !== 'graph' || graphProjects.length > 0) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/projects')
        if (cancelled) return
        setGraphProjects(data)
        setGraphProjectId((current) => (data.some((p) => p.id === current) ? current : (data[0]?.id ?? '')))
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view, graphProjects.length])

  // 프로젝트 상세 페이지의 "일감 바로가기"(?projectId=)로 들어왔을 때 해당
  // 프로젝트 섹션으로 스크롤 — 전용 라우트를 새로 만들지 않기 위한 경량 구현
  // (docs/project-menu-upgrade-spec.md 4.4).
  useEffect(() => {
    if (!scrollProjectId || sections.length === 0) return
    document.getElementById(`project-${scrollProjectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollProjectId, sections])

  const onNavigateToTask = (projectId, taskId) => navigate(`/tasks/${projectId}/${taskId}`)

  const applyTask = (projectId, taskId, updatedTask) =>
    setSections((current) =>
      current.map((s) =>
        s.projectId === projectId ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? updatedTask : t)) } : s,
      ),
    )

  // 관계 배지(하위 진행률 / 선행 대기)는 **다른 일감의 완료 여부**에 달려 있다.
  // 그래서 완료 경계를 넘는 상태 변경은 방금 옮긴 카드뿐 아니라 화면의 다른
  // 카드까지 낡게 만든다 — A를 완료했는데 A를 선행으로 둔 B의 "선행 대기 1"이
  // 그대로 남거나, 하위를 완료했는데 상위의 "하위 0/2"가 안 바뀌는 식이다.
  // 그 경우에만 목록을 다시 읽는다. 대기↔진행중처럼 배지에 영향이 없는 전이는
  // 낙관적 업데이트로 끝내서 드래그마다 전체 재조회가 일어나지 않게 한다.
  const refreshIfDoneBoundary = async (from, to) => {
    if (from !== 'done' && to !== 'done') return
    try {
      setSections(await apiFetch('/api/my-tasks'))
    } catch {
      // 재조회가 실패해도 상태 변경 자체는 이미 반영됐다 — 배지만 낡은 채로
      // 두고, 사용자가 새로고침하면 맞아진다. 여기서 에러를 띄우면 정작
      // 성공한 상태 변경이 실패처럼 보인다.
    }
  }

  const moveTask = async (projectId, task, status) => {
    // 낙관적 업데이트 — 실패하면 되돌린다.
    applyTask(projectId, task.id, { ...task, status })
    try {
      const { task: updated, uploadError } = await submitStatusChange(projectId, task.id, { status })
      applyTask(projectId, task.id, toListTask(updated))
      setError(uploadError)
      await refreshIfDoneBoundary(task.status, status)
    } catch (err) {
      applyTask(projectId, task.id, task)
      setError(err.message)
    }
  }

  // 칸반 드래그와 목록 뷰의 상태 select가 공유하는 입구. 검수중으로 들어가거나
  // 검수중에서 뒤로 나오는 전이는 팝업(검수 내용 / 반려 사유)을 먼저 띄우고,
  // 나머지는 바로 처리한다(docs/task-review-spec.md 4장).
  const onRequestStatusChange = (projectId, taskId, status) => {
    const section = sections.find((s) => s.projectId === projectId)
    const task = section?.tasks.find((t) => t.id === taskId)
    if (!task || task.status === status) return

    const transition = task.allowedTransitions?.find((t) => t.to === status)
    if (!transition) {
      setError(`"${task.title}"을(를) ${taskStatusLabel(task.status)}에서 ${taskStatusLabel(status)}(으)로는 바꿀 수 없어요`)
      return
    }
    if (transition.requires === 'request' || transition.requires === 'reject') {
      setPendingChange({ projectId, task, transition })
      return
    }
    setError('')
    moveTask(projectId, task, status)
  }

  // 팝업에서 온 제출은 에러를 삼키지 않는다 — 팝업이 잡아서 자기 안에 표시하고
  // 열린 채로 남아야 입력한 내용을 잃지 않는다.
  const submitPendingChange = async (payload) => {
    const { projectId, task, transition } = pendingChange
    const { task: updated, uploadError } = await submitStatusChange(projectId, task.id, {
      status: transition.to,
      ...payload,
    })
    applyTask(projectId, task.id, toListTask(updated))
    setError(uploadError)
    setPendingChange(null)
    await refreshIfDoneBoundary(task.status, transition.to)
  }

  if (loading) return null

  // 관계도는 캔버스가 화면 아래끝까지 내려가므로 아래 여백을 없앤다 — 남겨두면
  // 그만큼 페이지가 넘쳐 스크롤바가 생긴다.
  return (
    <div
      className={`mx-auto w-full max-w-[1400px] px-4 pt-8 ${
        view === 'graph' ? 'flex flex-1 flex-col pb-0' : 'pb-8'
      }`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">일감</h2>
        <div className="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => changeView(v.value)}
              className={`px-3 py-1.5 text-sm ${
                view === v.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {scrollProjectId && !sections.some((s) => s.projectId === scrollProjectId) && (
        <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
          요청한 프로젝트의 일감을 찾을 수 없어요(보관되었거나 접근 권한이 없는 프로젝트일 수 있어요).
        </p>
      )}

      {/* 관계도는 my-tasks(내 프로젝트 전체)가 아니라 프로젝트 하나를 그리므로
          sections 유무와 무관하게 자체 데이터로 동작한다 — 아래 분기보다 먼저 뺀다. */}
      {view === 'graph' ? (
        <>
          <ProjectPicker projects={graphProjects} selectedId={graphProjectId} onSelect={changeGraphProject} />
          {graphProjectId ? (
            <Suspense
              fallback={<p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>}
            >
              <TaskRelationGraph key={graphProjectId} projectId={graphProjectId} />
            </Suspense>
          ) : (
            <p className="py-12 text-center text-gray-500 dark:text-gray-400">확인 가능한 프로젝트가 없습니다.</p>
          )}
        </>
      ) : sections.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">확인 가능한 일감이 없습니다.</p>
      ) : view === 'board' ? (
        sections.map((section) => (
          <ProjectBoard
            key={section.projectId}
            section={section}
            onNavigateToTask={onNavigateToTask}
            onRequestStatusChange={onRequestStatusChange}
          />
        ))
      ) : (
        <TaskTable
          sections={sections}
          onNavigateToTask={onNavigateToTask}
          onRequestStatusChange={onRequestStatusChange}
        />
      )}

      {pendingChange && (
        <TaskStatusDialog
          projectId={pendingChange.projectId}
          task={pendingChange.task}
          requires={pendingChange.transition.requires}
          toStatus={pendingChange.transition.to}
          onCancel={() => setPendingChange(null)}
          onSubmit={submitPendingChange}
        />
      )}
    </div>
  )
}

export default TasksPage
