import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import ProjectGantt from '../components/ProjectGantt'

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

const emptyDraft = { title: '', startAt: '', endAt: '' }

// 프로젝트에 속하지 않는 개인 일정 — 기존 /api/schedules CRUD 그대로 사용하는
// 가벼운 리스트. 간트차트만큼 화려할 필요가 없어 인라인 폼으로 충분하다.
function PersonalSchedules() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(emptyDraft)

  const load = async () => {
    try {
      const data = await apiFetch('/api/schedules?personalOnly=true')
      setItems(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const submitNew = async (e) => {
    e.preventDefault()
    if (!draft.title.trim() || !draft.startAt) return
    setError('')
    try {
      await apiFetch('/api/schedules', {
        method: 'POST',
        body: { title: draft.title.trim(), startAt: draft.startAt, endAt: draft.endAt || null },
      })
      setDraft(emptyDraft)
      setAdding(false)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditDraft({ title: item.title, startAt: toDateInputValue(item.startAt), endAt: toDateInputValue(item.endAt) })
  }

  const saveEdit = async () => {
    if (!editDraft.title.trim() || !editDraft.startAt) return
    setError('')
    try {
      await apiFetch(`/api/schedules/${editingId}`, {
        method: 'PATCH',
        body: { title: editDraft.title.trim(), startAt: editDraft.startAt, endAt: editDraft.endAt || null },
      })
      setEditingId(null)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('이 일정을 삭제하시겠습니까?')) return
    setError('')
    try {
      await apiFetch(`/api/schedules/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-medium text-gray-900 dark:text-white">개인 일정</h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            추가
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {adding && (
        <form
          onSubmit={submitNew}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700"
        >
          <div className="flex-1 min-w-[140px]">
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">일정명</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">시작일</label>
            <input
              type="date"
              value={draft.startAt}
              onChange={(e) => setDraft((d) => ({ ...d, startAt: e.target.value }))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">종료일</label>
            <input
              type="date"
              value={draft.endAt}
              onChange={(e) => setDraft((d) => ({ ...d, endAt: e.target.value }))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            저장
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false)
              setDraft(emptyDraft)
            }}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            취소
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">등록된 개인 일정이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex-1 min-w-[140px]">
                  <input
                    type="text"
                    value={editDraft.title}
                    onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                <input
                  type="date"
                  value={editDraft.startAt}
                  onChange={(e) => setEditDraft((d) => ({ ...d, startAt: e.target.value }))}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <input
                  type="date"
                  value={editDraft.endAt}
                  onChange={(e) => setEditDraft((d) => ({ ...d, endAt: e.target.value }))}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <button type="button" onClick={saveEdit} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  취소
                </button>
              </li>
            ) : (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(item.startAt)}
                    {item.endAt && ` ~ ${formatDate(item.endAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-xs">
                  <button type="button" onClick={() => startEdit(item)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                    수정
                  </button>
                  <button type="button" onClick={() => remove(item.id)} className="text-red-600 hover:text-red-500 dark:text-red-400">
                    삭제
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function SchedulePage() {
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/projects')
        if (cancelled) return
        setProjects(data)
        if (data.length > 0) setSelectedProjectId(data[0].id)
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

  if (loading) return null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">일정</h2>
          {projects.length > 0 && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {projects.length === 0 ? (
          <p className="py-12 text-center text-gray-500 dark:text-gray-400">속한 프로젝트가 없습니다.</p>
        ) : (
          selectedProjectId && <ProjectGantt key={selectedProjectId} projectId={selectedProjectId} />
        )}
      </section>

      <PersonalSchedules />
    </div>
  )
}

export default SchedulePage
