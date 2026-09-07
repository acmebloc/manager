import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// TaskAttachments.jsx와 동일한 패턴 — 자체 fetch, 로컬 state, 텍스트 수정
// 개념은 없이 추가/토글/삭제만(서브태스크와 무관한 완전히 별개 기능).
function TaskChecklist({ projectId, taskId, canModify }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newText, setNewText] = useState('')
  const [adding, setAdding] = useState(false)

  const basePath = `/api/projects/${projectId}/tasks/${taskId}/checklist`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(basePath)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath])

  const addItem = async (event) => {
    event.preventDefault()
    if (!newText.trim()) return
    setAdding(true)
    setError('')
    try {
      const item = await apiFetch(basePath, { method: 'POST', body: { text: newText.trim() } })
      setItems((current) => [...current, item])
      setNewText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  // 낙관적 업데이트 — 실패하면 되돌린다.
  const toggleDone = async (item) => {
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
    try {
      await apiFetch(`${basePath}/${item.id}`, { method: 'PATCH', body: { done: !item.done } })
    } catch (err) {
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)))
      setError(err.message)
    }
  }

  const remove = async (item) => {
    try {
      await apiFetch(`${basePath}/${item.id}`, { method: 'DELETE' })
      setItems((current) => current.filter((i) => i.id !== item.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const doneCount = items.filter((i) => i.done).length

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        체크리스트 {items.length > 0 && `(${doneCount}/${items.length})`}
      </h4>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">체크리스트가 없습니다.</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.done} onChange={() => toggleDone(item)} disabled={!canModify} />
              <span
                className={`min-w-0 flex-1 ${
                  item.done ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-white'
                }`}
              >
                {item.text}
              </span>
              {canModify && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="shrink-0 text-xs text-red-600 hover:text-red-500 dark:text-red-400"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canModify && (
        <form onSubmit={addItem} className="flex gap-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="항목 추가"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="submit"
            disabled={adding || !newText.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            추가
          </button>
        </form>
      )}
    </div>
  )
}

export default TaskChecklist
