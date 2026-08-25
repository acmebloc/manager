import { useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { TASK_GRADES, TASK_STATUSES, TASK_TYPES } from '../lib/taskFields'
import { Avatar } from './ProjectMembers'
import MarkdownContent from './MarkdownContent'
import MarkdownEditor from './MarkdownEditor'
import TaskAttachments from './TaskAttachments'
import TaskComments from './TaskComments'

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

// 새 담당자를 지정할 때는 프로젝트 멤버여야 하지만(서버가 강제), 이미 나간
// 담당자를 그대로 유지하는 경우까지 select에서 사라지면 안 되므로(스펙 4.4)
// 현재 담당자가 멤버 목록에 없어도 옵션에 끼워 넣는다.
function buildAssigneeOptions(members, task) {
  const options = [{ value: '', label: '미배정' }, ...members.map((m) => ({ value: m.id, label: m.name }))]
  if (task.assigneeId && task.assignee && !members.some((m) => m.id === task.assigneeId)) {
    options.push({ value: task.assigneeId, label: `${task.assignee.name} (프로젝트 미참여)` })
  }
  return options
}

function TaskDetailPanel({ projectId, task, projectMembers, project, onClose, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => ({
    title: task.title,
    description: task.description || '',
    type: task.type,
    grade: task.grade,
    status: task.status,
    assigneeId: task.assigneeId || '',
    startAt: toDateInputValue(task.startAt),
    endAt: toDateInputValue(task.endAt),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const assigneeOptions = useMemo(() => buildAssigneeOptions(projectMembers, task), [projectMembers, task])

  const isDirty = useMemo(
    () =>
      draft.title !== task.title ||
      draft.description !== (task.description || '') ||
      draft.type !== task.type ||
      draft.grade !== task.grade ||
      draft.status !== task.status ||
      draft.assigneeId !== (task.assigneeId || '') ||
      draft.startAt !== toDateInputValue(task.startAt) ||
      draft.endAt !== toDateInputValue(task.endAt),
    [draft, task],
  )

  const dateOutOfProjectRange = useMemo(() => {
    if (!project) return false
    const start = draft.startAt && project.startAt && draft.startAt < toDateInputValue(project.startAt)
    const end = draft.endAt && project.endAt && draft.endAt > toDateInputValue(project.endAt)
    return Boolean(start || end)
  }, [draft, project])

  const requestClose = () => {
    if (editing && isDirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return
    onClose()
  }

  const cancelEdit = () => {
    setDraft({
      title: task.title,
      description: task.description || '',
      type: task.type,
      grade: task.grade,
      status: task.status,
      assigneeId: task.assigneeId || '',
      startAt: toDateInputValue(task.startAt),
      endAt: toDateInputValue(task.endAt),
    })
    setEditing(false)
    setError('')
  }

  const save = async () => {
    if (draft.startAt && draft.endAt && draft.startAt > draft.endAt) {
      setError('시작일은 종료일보다 늦을 수 없습니다')
      return
    }
    setSaving(true)
    try {
      const updated = await apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        body: {
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          type: draft.type,
          grade: draft.grade,
          status: draft.status,
          assigneeId: draft.assigneeId || null,
          startAt: draft.startAt || null,
          endAt: draft.endAt || null,
        },
      })
      onSaved(updated)
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('일감을 삭제할까요? 첨부파일과 댓글도 함께 삭제됩니다.')) return
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' })
      onDeleted(task.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">일감 상세</h3>
        <button
          type="button"
          onClick={requestClose}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
        >
          닫기
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {editing ? (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <MarkdownEditor
              value={draft.description}
              onChange={(md) => setDraft((d) => ({ ...d, description: md }))}
              placeholder="본문을 입력하세요"
            />
            <div className="grid grid-cols-3 gap-2">
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
            </div>
            {dateOutOfProjectRange && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                프로젝트 기간을 벗어난 날짜예요. 저장은 막지 않지만 확인해 주세요.
              </p>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.title.trim()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h2>
              <div className="flex shrink-0 gap-2">
                {task.canModify && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
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
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {TASK_STATUSES.find((s) => s.value === task.status)?.label}
              </span>
            </div>

            {task.description && <MarkdownContent text={task.description} />}

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

        <hr className="my-4 border-gray-100 dark:border-gray-800" />
        <div className="mb-4">
          <TaskAttachments projectId={projectId} taskId={task.id} canModify={task.canModify} />
        </div>
        <TaskComments projectId={projectId} taskId={task.id} members={projectMembers} />
      </div>
    </div>
  )
}

export default TaskDetailPanel
