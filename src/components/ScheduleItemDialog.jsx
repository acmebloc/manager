import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { matchesKoreanQuery } from '../lib/korean'
import { Avatar } from './ProjectMembers'

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

// '@' 태그 입력 — 일감 댓글의 멘션 드롭다운과 시각적으로 통일하되, 마크다운에
// 박아넣지 않고 선택된 사용자를 칩 목록(followerIds)으로 들고 있는 별도 구현.
function FollowerPicker({ members, followerIds, onChange }) {
  const [query, setQuery] = useState('')

  const selected = followerIds.map((id) => members.find((m) => m.id === id)).filter(Boolean)
  const candidates =
    query.trim() === ''
      ? []
      : members.filter((m) => !followerIds.includes(m.id) && matchesKoreanQuery(m.name, query)).slice(0, 6)

  const add = (userId) => {
    onChange([...followerIds, userId])
    setQuery('')
  }
  const remove = (userId) => onChange(followerIds.filter((id) => id !== userId))

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((user) => (
            <span
              key={user.id}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pr-1 pl-1.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {user.name}
              <button
                type="button"
                onClick={() => remove(user.id)}
                className="rounded-full px-1 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@ 로 참조자 검색"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        {candidates.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {candidates.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => add(user.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <Avatar user={user} />
                  <span className="truncate text-sm text-gray-900 dark:text-white">{user.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// 일정표의 바를 클릭했을 때(수정) 또는 "새 일정" 버튼을 눌렀을 때(생성) 뜨는
// 다이얼로그. source==='task'인 항목은 일감에서 가져온 행이라 제목/참조자는
// 읽기 전용이고 날짜만 바꿀 수 있다 — 저장하면 일감 자체가 갱신된다
// (PATCH .../tasks/:id/dates). source==='other'는 진짜 Schedule 레코드라 전부
// 수정 가능하고 삭제도 여기서 한다.
function ScheduleItemDialog({ projectId, item, members, onClose, onDone }) {
  const isTaskRow = item?.source === 'task'
  const [title, setTitle] = useState(item?.title || '')
  const [startAt, setStartAt] = useState(toDateInputValue(item?.startAt))
  const [endAt, setEndAt] = useState(toDateInputValue(item?.endAt))
  const [followerIds, setFollowerIds] = useState((item?.followers || []).map((u) => u.id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dateProblem = startAt && endAt && startAt > endAt ? '시작일은 종료일보다 늦을 수 없습니다' : ''

  const save = async () => {
    if (isTaskRow) {
      if (!startAt || !endAt) return setError('시작일과 종료일을 모두 입력해 주세요')
      setSaving(true)
      setError('')
      try {
        await apiFetch(`/api/projects/${projectId}/tasks/${item.taskId}/dates`, {
          method: 'PATCH',
          body: { startAt, endAt },
        })
        onDone()
      } catch (err) {
        setError(err.message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (!title.trim() || !startAt || !endAt) return setError('일정명, 시작일, 종료일을 모두 입력해 주세요')
    setSaving(true)
    setError('')
    try {
      const body = { title: title.trim(), startAt, endAt, projectId, followerIds }
      if (item) {
        await apiFetch(`/api/schedules/${item.id}`, { method: 'PATCH', body })
      } else {
        await apiFetch('/api/schedules', { method: 'POST', body })
      }
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('이 일정을 삭제하시겠습니까?')) return
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/api/schedules/${item.id}`, { method: 'DELETE' })
      onDone()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {isTaskRow ? '일감 일정' : item ? '일정 수정' : '새 일정'}
        </h3>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">일정명</label>
            {isTaskRow ? (
              <p className="text-sm text-gray-900 dark:text-white">{title}</p>
            ) : (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">시작일</label>
              <input
                type="date"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">종료일</label>
              <input
                type="date"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">참조자</label>
            {isTaskRow ? (
              <div className="flex flex-wrap gap-2">
                {(item.followers || []).length === 0 && (
                  <span className="text-sm text-gray-400 dark:text-gray-500">없음</span>
                )}
                {(item.followers || []).map((user) => (
                  <span key={user.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                    <Avatar user={user} />
                    {user.name}
                  </span>
                ))}
              </div>
            ) : (
              <FollowerPicker members={members} followerIds={followerIds} onChange={setFollowerIds} />
            )}
          </div>

          {(error || dateProblem) && (
            <p className="text-sm text-red-600 dark:text-red-400">{error || dateProblem}</p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            {!isTaskRow && item && (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="text-sm text-red-600 hover:text-red-500 disabled:opacity-50 dark:text-red-400"
              >
                삭제
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              취소
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || Boolean(dateProblem)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScheduleItemDialog
