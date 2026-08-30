import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { TASK_GRADES, TASK_STATUSES, TASK_TYPES } from '../lib/taskFields'
import { Avatar } from '../components/ProjectMembers'
import MarkdownContent from '../components/MarkdownContent'
import MarkdownEditor from '../components/MarkdownEditor'
import TaskAttachments from '../components/TaskAttachments'
import TaskComments from '../components/TaskComments'
import TaskLinks from '../components/TaskLinks'

const EMPTY_LINKS = { parents: [], children: [], related: [] }

const EMPTY_DRAFT = {
  title: '',
  description: '',
  type: 'dev',
  grade: 'minor',
  status: 'todo',
  assigneeId: '',
  startAt: '',
  endAt: '',
  parentTasks: [],
  childTasks: [],
  relatedTasks: [],
}

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

// links는 마지막으로 불러오거나 저장된 부모/자식/연결일감 — 편집 중 선택을
// 취소했을 때 되돌아갈 기준점이라 draft와 분리해서 들고 있는다(TaskFormPage 참고).
function draftFromTask(task, links = EMPTY_LINKS) {
  return {
    title: task.title,
    description: task.description || '',
    type: task.type,
    grade: task.grade,
    status: task.status,
    assigneeId: task.assigneeId || '',
    startAt: toDateInputValue(task.startAt),
    endAt: toDateInputValue(task.endAt),
    parentTasks: links.parents,
    childTasks: links.children,
    relatedTasks: links.related,
  }
}

// 새 담당자를 지정할 때는 프로젝트 멤버여야 하지만(서버가 강제), 이미 나간
// 담당자를 그대로 유지하는 경우까지 select에서 사라지면 안 되므로(스펙 4.4)
// 현재 담당자가 멤버 목록에 없어도 옵션에 끼워 넣는다.
function buildAssigneeOptions(members, task) {
  const options = [{ value: '', label: '미배정' }, ...members.map((m) => ({ value: m.id, label: m.name }))]
  if (task?.assigneeId && task.assignee && !members.some((m) => m.id === task.assigneeId)) {
    options.push({ value: task.assigneeId, label: `${task.assignee.name} (프로젝트 미참여)` })
  }
  return options
}

function TaskFormPage() {
  const { projectId, taskId } = useParams()
  const navigate = useNavigate()
  const isNew = !taskId

  const [project, setProject] = useState(null)
  const [members, setMembers] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [task, setTask] = useState(null)
  const [links, setLinks] = useState(EMPTY_LINKS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const requests = [
          apiFetch(`/api/projects/${projectId}`),
          apiFetch(`/api/projects/${projectId}/members`),
          apiFetch(`/api/projects/${projectId}/tasks`),
        ]
        if (!isNew) {
          requests.push(apiFetch(`/api/projects/${projectId}/tasks/${taskId}`))
          requests.push(apiFetch(`/api/projects/${projectId}/tasks/${taskId}/links`))
        }
        const [projectData, memberData, taskListData, taskData, linksData] = await Promise.all(requests)
        if (cancelled) return
        setProject(projectData)
        setMembers(memberData)
        setAllTasks(taskListData)
        if (taskData) {
          setTask(taskData)
          setLinks(linksData)
          setDraft(draftFromTask(taskData, linksData))
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId, isNew])

  // 자기 자신은 스스로의 부모/자식/연결로 고를 수 없다. GET .../tasks(목록)의
  // 풍부한 형태가 아니라 GET .../links가 돌려주는 것과 같은 가벼운 형태로
  // 맞춰둔다 — 그래야 isDirty 비교(JSON.stringify)가 "같은 일감인데 다른
  // 모양"으로 어긋나지 않는다.
  const linkCandidates = useMemo(
    () =>
      allTasks
        .filter((t) => t.id !== taskId)
        .map((t) => ({ id: t.id, title: t.title, type: t.type, grade: t.grade, status: t.status })),
    [allTasks, taskId],
  )

  const setLinkField = (key, tasks) => {
    const draftKey = { parents: 'parentTasks', children: 'childTasks', related: 'relatedTasks' }[key]
    setDraft((d) => ({ ...d, [draftKey]: tasks }))
  }

  const memberUsers = useMemo(() => members.map((m) => m.user), [members])
  const mentionUsersById = useMemo(() => new Map(memberUsers.map((m) => [m.id, m])), [memberUsers])
  const assigneeOptions = useMemo(() => buildAssigneeOptions(memberUsers, task), [memberUsers, task])

  const dateProblem = draft.startAt && draft.endAt && draft.startAt > draft.endAt ? '시작일은 종료일보다 늦을 수 없습니다' : ''

  const dateOutOfProjectRange = useMemo(() => {
    if (!project) return false
    const start = draft.startAt && project.startAt && draft.startAt < toDateInputValue(project.startAt)
    const end = draft.endAt && project.endAt && draft.endAt > toDateInputValue(project.endAt)
    return Boolean(start || end)
  }, [draft, project])

  const isDirty = useMemo(() => {
    if (!editing) return false
    const baseline = task ? draftFromTask(task, links) : EMPTY_DRAFT
    return JSON.stringify(draft) !== JSON.stringify(baseline)
  }, [editing, task, links, draft])

  const goToTasks = () => navigate('/tasks')

  const requestGoToTasks = () => {
    if (isDirty && !window.confirm('저장하지 않은 변경이 있습니다. 나갈까요?')) return
    goToTasks()
  }

  const cancelEdit = () => {
    if (isNew) {
      goToTasks()
      return
    }
    setDraft(draftFromTask(task, links))
    setEditing(false)
    setError('')
  }

  const save = async (event) => {
    event.preventDefault()
    if (dateProblem) return
    setSaving(true)
    try {
      const newLinks = {
        parents: draft.parentTasks,
        children: draft.childTasks,
        related: draft.relatedTasks,
      }
      const body = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        type: draft.type,
        grade: draft.grade,
        assigneeId: draft.assigneeId || null,
        startAt: draft.startAt || null,
        endAt: draft.endAt || null,
        ...(isNew ? {} : { status: draft.status }),
        parentTaskIds: newLinks.parents.map((t) => t.id),
        childTaskIds: newLinks.children.map((t) => t.id),
        relatedTaskIds: newLinks.related.map((t) => t.id),
      }
      if (isNew) {
        const created = await apiFetch(`/api/projects/${projectId}/tasks`, { method: 'POST', body })
        // /tasks/new and /tasks/:taskId render the same component — set state
        // before navigating so the transition never renders with `task` still
        // null (isNew flips to false as soon as the URL changes, regardless
        // of whether the navigation actually remounts this component).
        setTask(created)
        setLinks(newLinks)
        setDraft(draftFromTask(created, newLinks))
        setEditing(false)
        navigate(`/tasks/${projectId}/${created.id}`, { replace: true })
      } else {
        const updated = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body })
        setTask(updated)
        setLinks(newLinks)
        setEditing(false)
      }
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Status alone is editable straight from the read view — matching the
  // kanban board's drag-to-change-status, no need to enter the full edit form.
  // Guarded against overlapping requests: without it, quickly picking two
  // statuses in a row could let the first (slower) response land after the
  // second and silently revert the value the user actually chose.
  const [statusUpdating, setStatusUpdating] = useState(false)
  const updateStatus = async (status) => {
    setStatusUpdating(true)
    try {
      const updated = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status },
      })
      setTask(updated)
      setDraft((d) => ({ ...d, status: updated.status }))
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setStatusUpdating(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('일감을 삭제할까요? 첨부파일과 댓글도 함께 삭제됩니다.')) return
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
      goToTasks()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      <button
        type="button"
        onClick={requestGoToTasks}
        className="mb-4 inline-block text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white"
      >
        ← 일감 ({project?.name})
      </button>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {isNew ? '새 일감' : '일감 수정'}
          </h2>

          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="제목"
            autoFocus
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />

          <div className={`grid gap-2 ${isNew ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              유형
              <select
                value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              등급
              <select
                value={draft.grade}
                onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {TASK_GRADES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            {!isNew && (
              <label className="text-xs text-gray-500 dark:text-gray-400">
                상태
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="text-xs text-gray-500 dark:text-gray-400">
            담당자
            <select
              value={draft.assigneeId}
              onChange={(e) => setDraft((d) => ({ ...d, assigneeId: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {assigneeOptions.map((o) => (
                <option key={o.value || 'none'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              시작일
              <input
                type="date"
                value={draft.startAt}
                onChange={(e) => setDraft((d) => ({ ...d, startAt: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              종료일
              <input
                type="date"
                value={draft.endAt}
                onChange={(e) => setDraft((d) => ({ ...d, endAt: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <div className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              등록일
              <p className="mt-1 rounded-md border border-transparent px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                {isNew ? formatDate(new Date().toISOString()) : formatDate(task.createdAt)}
              </p>
            </div>
          </div>
          {dateProblem && <p className="text-sm text-red-600 dark:text-red-400">{dateProblem}</p>}
          {dateOutOfProjectRange && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              프로젝트 기간을 벗어난 날짜예요. 저장은 막지 않지만 확인해 주세요.
            </p>
          )}

          <div>
            {/* Not a <label> — it would wrap the editor's own toolbar buttons,
                and a label's click-forwarding to its first focusable control
                can steal focus/activate that button on an unrelated click. */}
            <p className="text-xs text-gray-500 dark:text-gray-400">본문</p>
            <div className="mt-1">
              <MarkdownEditor
                value={draft.description}
                onChange={(md) => setDraft((d) => ({ ...d, description: md }))}
                mentionMembers={memberUsers}
                mentionUsersById={mentionUsersById}
                placeholder="본문을 입력하세요"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !draft.title.trim() || Boolean(dateProblem)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? '저장 중...' : isNew ? '만들기' : '저장'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h2>
            <div className="flex shrink-0 gap-2">
              {task.canModify && (
                <button
                  type="button"
                  onClick={() => {
                    // Re-sync from the latest task — a quick status change
                    // via the select just below can otherwise land between
                    // this click and load, and the stale draft would then
                    // overwrite it back on save.
                    setDraft(draftFromTask(task, links))
                    setEditing(true)
                  }}
                  className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                >
                  수정
                </button>
              )}
              {task.canDelete && (
                <button type="button" onClick={remove} className="text-sm text-red-600 hover:text-red-500 dark:text-red-400">
                  삭제
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {TASK_TYPES.find((t) => t.value === task.type)?.label}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {TASK_GRADES.find((g) => g.value === task.grade)?.label}
            </span>
            {task.canModify ? (
              <select
                value={task.status}
                onChange={(e) => updateStatus(e.target.value)}
                disabled={statusUpdating}
                className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {TASK_STATUSES.find((s) => s.value === task.status)?.label}
              </span>
            )}
          </div>

          {task.description && <MarkdownContent text={task.description} mentionUsersById={mentionUsersById} />}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
            <div>
              <dt className="mb-1">담당자</dt>
              <dd className="flex items-center gap-1.5">
                {task.assignee ? (
                  <span className={`flex items-center gap-1.5 ${!task.assigneeIsMember ? 'opacity-50' : ''}`}>
                    <Avatar user={task.assignee} />
                    {task.assignee.name}
                    {!task.assigneeIsMember && ' (프로젝트 미참여)'}
                  </span>
                ) : (
                  '미배정'
                )}
              </dd>
            </div>
            <div>
              <dt className="mb-1">등록자</dt>
              <dd>{task.createdBy?.name || '등록자 미상'}</dd>
            </div>
            <div>
              <dt className="mb-1">시작일 ~ 종료일</dt>
              <dd>
                {formatDate(task.startAt) || '?'} ~ {formatDate(task.endAt) || '?'}
              </dd>
            </div>
            <div>
              <dt className="mb-1">등록일</dt>
              <dd>{formatDate(task.createdAt)}</dd>
            </div>
          </dl>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      <div className="mt-4">
        <TaskLinks
          projectId={projectId}
          editing={editing}
          candidates={linkCandidates}
          parents={draft.parentTasks}
          childTasks={draft.childTasks}
          related={draft.relatedTasks}
          onChange={setLinkField}
        />
      </div>

      {!isNew && (
        <>
          <hr className="my-4 border-gray-100 dark:border-gray-800" />
          <div className="mb-4">
            <TaskAttachments projectId={projectId} taskId={taskId} canModify={task.canModify} />
          </div>
          <TaskComments projectId={projectId} taskId={taskId} members={memberUsers} />
        </>
      )}
    </div>
  )
}

export default TaskFormPage
