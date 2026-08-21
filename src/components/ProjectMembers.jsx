import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

export const ROLES = [
  { value: 'admin', label: '관리자' },
  { value: 'member', label: '멤버' },
  { value: 'viewer', label: '뷰어' },
]

export function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role
}

// Compares the edited list against what the server last returned, keyed by
// user rather than by member row id — so removing someone and adding them
// back in the same session reads as a role change (or as nothing at all)
// instead of a delete followed by a create.
export function membersDiff(original, draft) {
  const byUser = (list) => new Map(list.map((m) => [m.userId, m]))
  const before = byUser(original)
  const after = byUser(draft)

  const removed = [...before.values()]
    .filter((m) => !after.has(m.userId))
    .map((m) => ({ id: m.id, name: m.user?.name }))

  const added = [...after.values()]
    .filter((m) => !before.has(m.userId))
    .map((m) => ({ userId: m.userId, role: m.role, name: m.user?.name }))

  const changed = [...after.values()]
    .filter((m) => before.has(m.userId) && before.get(m.userId).role !== m.role)
    .map((m) => ({ id: before.get(m.userId).id, role: m.role, name: m.user?.name }))

  return {
    removed,
    added,
    changed,
    count: removed.length + added.length + changed.length,
  }
}

function Avatar({ user }) {
  if (user?.picture) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      {(user?.name || '?').slice(0, 1)}
    </div>
  )
}

function AddMember({ members, onAdd }) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [role, setRole] = useState('member')
  const debounceRef = useRef(null)

  // The directory is filtered server-side; debounce so typing doesn't fire a
  // request per keystroke.
  useEffect(() => {
    if (!query.trim()) {
      setCandidates([])
      return undefined
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await apiFetch(`/api/users?q=${encodeURIComponent(query.trim())}`)
        const existing = new Set(members.map((m) => m.userId))
        setCandidates(users.filter((u) => !existing.has(u.id)).slice(0, 5))
      } catch {
        setCandidates([])
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, members])

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름 또는 이메일로 검색"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {candidates.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {candidates.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(user, role)
                  setQuery('')
                  setCandidates([])
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Avatar user={user} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-gray-900 dark:text-white">
                    {user.name}
                  </span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {user.email}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function summarize(diff) {
  const parts = []
  if (diff.added.length) parts.push(`추가 ${diff.added.length}`)
  if (diff.changed.length) parts.push(`역할 변경 ${diff.changed.length}`)
  if (diff.removed.length) parts.push(`제외 ${diff.removed.length}`)
  return parts.join(' · ')
}

// Controlled: edits go to the caller, which holds them until the user saves.
// Nothing here talks to the server except the directory search.
//
// Save and cancel live in this panel rather than in the project's own button
// row, so it's unambiguous that they apply to the member list and not to the
// project itself.
function ProjectMembers({
  members,
  ownerId,
  canManage,
  pending,
  diff,
  saving,
  error,
  onChange,
  onSave,
  onDiscard,
}) {
  const add = (user, role) =>
    onChange([...members, { userId: user.id, role, user, isNew: true }])

  const removeMember = (member) => onChange(members.filter((m) => m.userId !== member.userId))

  const setRole = (member, role) =>
    onChange(members.map((m) => (m.userId === member.userId ? { ...m, role } : m)))

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
      {diff.count > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            저장하지 않은 변경 {diff.count}건 · {summarize(diff)}
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="rounded-md px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:text-white"
            >
              취소
            </button>
          </span>
        </div>
      )}

      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isOwner = member.userId === ownerId
          const state = pending.get(member.userId)
          return (
            <li key={member.userId} className="flex items-center gap-2">
              <Avatar user={member.user} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-900 dark:text-white">
                  {member.user?.name}
                  {isOwner && (
                    <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">소유자</span>
                  )}
                  {state && (
                    <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
                      {state}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {member.user?.email}
                </span>
              </span>

              {canManage && !isOwner ? (
                <>
                  <select
                    value={member.role}
                    onChange={(event) => setRole(member, event.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMember(member)}
                    className="text-xs text-red-600 hover:text-red-500 dark:text-red-400"
                  >
                    제외
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {roleLabel(member.role)}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {canManage && <AddMember members={members} onAdd={add} />}
    </div>
  )
}

export default ProjectMembers
