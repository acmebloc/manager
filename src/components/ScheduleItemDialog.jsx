import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { matchesKoreanQuery } from '../lib/korean'
import { Avatar } from './ProjectMembers'

const MAX_RECURRENCE_DAYS = 364 // 52주 — server/src/lib/scheduleRecurrence.js의 상한과 맞춰둠
const DEFAULT_RECURRENCE_SPAN_DAYS = 84 // 12주(약 3개월), 반복 종료일 기본값

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

function addDaysToDateInput(value, days) {
  const d = new Date(value)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// '@' 태그 입력 — 일감 댓글의 멘션 드롭다운과 시각적으로 통일하되, 마크다운에
// 박아넣지 않고 선택된 사용자를 칩 목록으로 들고 있는 별도 구현.
// `members`가 주어지면(프로젝트 일정) 그 목록 안에서만 로컬 검색하고,
// 없으면(개인 일정 — 프로젝트 멤버라는 범위가 없음) `/api/users`로 전체
// 사용자를 서버 검색한다.
function FollowerPicker({ members, followers, onChange }) {
  const [query, setQuery] = useState('')
  const [remoteCandidates, setRemoteCandidates] = useState([])
  const debounceRef = useRef(null)
  const followerIds = new Set(followers.map((f) => f.id))
  // 일감 댓글 멘션과 동일하게, '@'를 실제로 타이핑해야 검색이 시작된다 —
  // 트리거 없이 아무 텍스트나 쳐도 뜨면 멘션 경험이 메뉴마다 달라지므로
  // 통일한다. '@' 뒤의 텍스트만 실제 검색어로 쓰고(트리거 문자 자체는
  // 검색어에서 제외), '@'만 입력한 상태(term==='')는 멘션 typeahead와 같이
  // 후보를 전부 보여준다 — matchesKoreanQuery는 빈 문자열 쿼리에 항상
  // true를 주고, /api/users도 q가 비어 있으면 전체를 돌려주므로 로컬/원격
  // 둘 다 자연히 같은 동작이 된다.
  const trimmed = query.trim()
  const hasTrigger = trimmed.startsWith('@')
  const term = hasTrigger ? trimmed.slice(1).trim() : ''

  useEffect(() => {
    if (members) return undefined // 로컬 검색이라 서버 호출 불필요
    if (!hasTrigger) {
      setRemoteCandidates([])
      return undefined
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await apiFetch(`/api/users?q=${encodeURIComponent(term)}`)
        setRemoteCandidates(users.filter((u) => !followerIds.has(u.id)).slice(0, 6))
      } catch {
        setRemoteCandidates([])
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTrigger, term, members])

  // 이름/이메일 둘 다로 찾을 수 있어야 한다 — 일감 댓글 멘션(mentionConfig의
  // searchCallback)과 같은 기준.
  const candidates = members
    ? !hasTrigger
      ? []
      : members
          .filter(
            (m) => !followerIds.has(m.id) && (matchesKoreanQuery(m.name, term) || matchesKoreanQuery(m.email, term)),
          )
          .slice(0, 6)
    : remoteCandidates

  const add = (user) => {
    onChange([...followers, user])
    setQuery('')
    setRemoteCandidates([])
  }
  const remove = (userId) => onChange(followers.filter((f) => f.id !== userId))

  return (
    <div>
      {followers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {followers.map((user) => (
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
                  onClick={() => add(user)}
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

function FollowerList({ followers }) {
  return (
    <div className="flex flex-wrap gap-2">
      {followers.length === 0 && <span className="text-sm text-gray-400 dark:text-gray-500">없음</span>}
      {followers.map((user) => (
        <span key={user.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <Avatar user={user} />
          {user.name}
        </span>
      ))}
    </div>
  )
}

// 반복 주기 + 종료일 입력 — "새 일정"에서 반복 체크박스를 켰을 때, 그리고
// 반복 일정을 "전체 수정" 스코프로 열었을 때 보여준다.
function RecurrenceFields({ intervalWeeks, onIntervalChange, endAt, onEndAtChange, startAt }) {
  const max = startAt ? addDaysToDateInput(startAt, MAX_RECURRENCE_DAYS) : undefined
  return (
    <div className="mt-2 flex gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">반복 주기</label>
        <select
          value={intervalWeeks}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value={1}>매주</option>
          <option value={2}>2주마다</option>
          <option value={3}>3주마다</option>
          <option value={4}>4주마다</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">반복 종료일</label>
        <input
          type="date"
          value={endAt}
          max={max}
          onChange={(e) => onEndAtChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">최대 52주(1년)까지</p>
      </div>
    </div>
  )
}

// 일정표의 바를 클릭했을 때(수정) 또는 "새 일정" 버튼을 눌렀을 때(생성) 뜨는
// 다이얼로그. 몇 가지 경우가 있다:
//  - item.source==='task': 일감에서 가져온 행. 제목/참조자는 읽기 전용이고
//    날짜만 바꿀 수 있다 — 저장하면 일감 자체가 갱신된다
//    (PATCH .../tasks/:id/dates).
//  - projectId가 있는 'other'(기타) 행: 프로젝트 멤버 누구나 전부 수정 가능.
//    참조자는 프로젝트 멤버 중에서만 고른다(members prop).
//  - projectId가 없는 개인 일정: item.canModify===false(참조자로만 등록된
//    남의 일정)면 완전 읽기 전용, 아니면(본인 소유이거나 새로 만드는 중)
//    전부 수정 가능하고 참조자는 전체 사용자 중에서 검색해 고른다.
//  - item.isRecurring===true(반복 시리즈의 한 회차): "이 일정만" / "전체 반복
//    일정" 스코프 토글이 추가로 뜬다. "이 일정만"은 이 회차의 override만
//    건드리고(참조자는 시리즈를 그대로 따르므로 읽기 전용), "전체 반복 일정"은
//    시리즈 자체(root)를 수정 — 폼이 item.series*로 다시 채워진다.
function ScheduleItemDialog({ projectId, item, members, onClose, onDone }) {
  const isTaskRow = item?.source === 'task'
  const isPersonal = !projectId
  const readOnly = isPersonal && item && item.canModify === false
  const isRecurringItem = Boolean(item?.isRecurring)

  const [editScope, setEditScope] = useState('occurrence') // 'occurrence' | 'series' — 반복 회차 수정시에만 의미있음
  const [title, setTitle] = useState(item?.title || '')
  const [startAt, setStartAt] = useState(toDateInputValue(item?.startAt))
  const [endAt, setEndAt] = useState(toDateInputValue(item?.endAt))
  const [followers, setFollowers] = useState(item?.followers || [])
  const [recurring, setRecurring] = useState(isRecurringItem)
  const [recurrenceIntervalWeeks, setRecurrenceIntervalWeeks] = useState(item?.recurrenceIntervalWeeks || 1)
  const [recurrenceEndAtInput, setRecurrenceEndAtInput] = useState(toDateInputValue(item?.recurrenceEndAt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 스코프를 바꾸면(이 일정만 ↔ 전체 반복 일정) 폼을 그 스코프에 맞는
  // 데이터로 다시 채운다 — "전체"는 시리즈(root) 원본값, "이 일정만"은 이
  // 회차의 현재 값.
  useEffect(() => {
    if (!isRecurringItem) return
    if (editScope === 'series') {
      setTitle(item.seriesTitle || '')
      setStartAt(toDateInputValue(item.seriesStartAt))
      setEndAt(toDateInputValue(item.seriesEndAt))
      setRecurring(true)
      setRecurrenceIntervalWeeks(item.recurrenceIntervalWeeks || 1)
      setRecurrenceEndAtInput(toDateInputValue(item.recurrenceEndAt))
    } else {
      setTitle(item.title || '')
      setStartAt(toDateInputValue(item.startAt))
      setEndAt(toDateInputValue(item.endAt))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editScope])

  // 새 일정 생성 중 반복 체크박스를 켰는데 반복 종료일을 아직 안 만졌으면
  // 시작일 기준으로 기본값을 채워준다(12주 뒤) — 사용자가 직접 늘리거나
  // 줄일 수 있음.
  useEffect(() => {
    if (item) return
    if (recurring && !recurrenceEndAtInput && startAt) {
      setRecurrenceEndAtInput(addDaysToDateInput(startAt, DEFAULT_RECURRENCE_SPAN_DAYS))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurring, startAt])

  const dateProblem = startAt && endAt && startAt > endAt ? '시작일은 종료일보다 늦을 수 없습니다' : ''
  const isOccurrenceScope = isRecurringItem && editScope === 'occurrence'
  // 반복 옵션은 새로 만들 때, 또는 반복 시리즈를 "전체" 스코프로 열었을 때만
  // 보여준다 — "이 일정만"에서는 규칙 자체를 못 건드린다.
  const showRecurrenceCheckbox = !isTaskRow && !readOnly && (!item || (isRecurringItem && editScope === 'series'))

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

    if (!title.trim() || !startAt) return setError('일정명과 시작일을 입력해 주세요')
    // 프로젝트 일정은 간트차트 막대라 종료일이 꼭 있어야 한다 — 개인 일정은
    // 기존처럼 종료일 없이도 등록 가능(차트에는 하루짜리로 표시됨).
    if (projectId && !endAt) return setError('종료일을 입력해 주세요')

    let recurrence
    if (showRecurrenceCheckbox && recurring) {
      if (!recurrenceEndAtInput) return setError('반복 종료일을 입력해 주세요')
      if (recurrenceEndAtInput > addDaysToDateInput(startAt, MAX_RECURRENCE_DAYS)) {
        return setError('반복 종료일은 시작일로부터 최대 52주(1년)까지 설정할 수 있습니다')
      }
      recurrence = { intervalWeeks: recurrenceIntervalWeeks, endAt: recurrenceEndAtInput }
    } else if (isRecurringItem && editScope === 'series') {
      recurrence = null // 반복 해제
    }

    setSaving(true)
    setError('')
    try {
      if (isOccurrenceScope) {
        await apiFetch(`/api/schedules/${item.scheduleId}/occurrences/${item.occurrenceIndex}`, {
          method: 'PATCH',
          body: { title: title.trim(), startAt, endAt: endAt || null },
        })
      } else {
        const body = {
          title: title.trim(),
          startAt,
          endAt: endAt || null,
          projectId: projectId || null,
          followerIds: followers.map((f) => f.id),
          ...(recurrence !== undefined && { recurrence }),
        }
        const targetId = isRecurringItem ? item.scheduleId : item?.id
        if (targetId) {
          await apiFetch(`/api/schedules/${targetId}`, { method: 'PATCH', body })
        } else {
          await apiFetch('/api/schedules', { method: 'POST', body })
        }
      }
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const confirmMsg = isOccurrenceScope
      ? '이 일정만 삭제하시겠습니까?'
      : isRecurringItem
        ? '반복 일정 전체를 삭제하시겠습니까? (모든 회차가 삭제됩니다)'
        : '이 일정을 삭제하시겠습니까?'
    if (!window.confirm(confirmMsg)) return
    setSaving(true)
    setError('')
    try {
      if (isOccurrenceScope) {
        await apiFetch(`/api/schedules/${item.scheduleId}/occurrences/${item.occurrenceIndex}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/schedules/${isRecurringItem ? item.scheduleId : item.id}`, { method: 'DELETE' })
      }
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
        <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
          {isTaskRow ? '일감 일정' : item ? (readOnly ? '일정' : '일정 수정') : '새 일정'}
          {isRecurringItem && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              반복 일정
            </span>
          )}
        </h3>

        {isRecurringItem && !readOnly && (
          <div className="mb-3 flex gap-4 text-sm text-gray-700 dark:text-gray-300">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="editScope"
                checked={editScope === 'occurrence'}
                onChange={() => setEditScope('occurrence')}
              />
              이 일정만
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="editScope"
                checked={editScope === 'series'}
                onChange={() => setEditScope('series')}
              />
              전체 반복 일정
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">일정명</label>
            {isTaskRow || readOnly ? (
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
              {readOnly ? (
                <p className="text-sm text-gray-900 dark:text-white">{startAt || '-'}</p>
              ) : (
                <input
                  type="date"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              )}
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">종료일</label>
              {readOnly ? (
                <p className="text-sm text-gray-900 dark:text-white">{endAt || '-'}</p>
              ) : (
                <input
                  type="date"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              )}
            </div>
          </div>
          {dateProblem && <p className="text-sm text-red-600 dark:text-red-400">{dateProblem}</p>}

          {showRecurrenceCheckbox && (
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                  className="rounded border-gray-300"
                />
                반복 일정
              </label>
              {recurring && (
                <RecurrenceFields
                  intervalWeeks={recurrenceIntervalWeeks}
                  onIntervalChange={setRecurrenceIntervalWeeks}
                  endAt={recurrenceEndAtInput}
                  onEndAtChange={setRecurrenceEndAtInput}
                  startAt={startAt}
                />
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">참조자</label>
            {isTaskRow || readOnly || isOccurrenceScope ? (
              <FollowerList followers={followers} />
            ) : (
              <FollowerPicker members={isPersonal ? undefined : members} followers={followers} onChange={setFollowers} />
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            {!isTaskRow && !readOnly && item && (
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
              {readOnly ? '닫기' : '취소'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={save}
                disabled={saving || Boolean(dateProblem)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScheduleItemDialog
