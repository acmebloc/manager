import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { matchesKoreanQuery } from '../lib/korean'
import { Avatar } from './ProjectMembers'

// '@' 태그 입력 — 일감 댓글의 멘션 드롭다운과 시각적으로 통일하되, 마크다운에
// 박아넣지 않고 선택된 사용자를 칩 목록으로 들고 있는 별도 구현.
// `members`가 주어지면(프로젝트 일정, 일감 참조자) 그 목록 안에서만 로컬
// 검색하고, 없으면(개인 일정 — 프로젝트 멤버라는 범위가 없음) `/api/users`로
// 전체 사용자를 서버 검색한다.
//
// 원래 ScheduleItemDialog.jsx 안에 있었는데, 일감의 참조자
// (docs/task-review-spec.md 5장)도 정확히 같은 입력이라 여기로 옮겨 공유한다.
export function FollowerPicker({ members, followers, onChange }) {
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

export function FollowerList({ followers }) {
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
