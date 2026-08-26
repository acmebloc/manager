import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

// 'plan'/'design'/'dev'/'other' all work tasks/schedules the same way (the
// old single 'member' tier, split by job function); 'pl' can also invite
// and remove members (always at one of those four); 'pm' can also
// edit/delete the project and set anyone's role. A project must always keep
// at least one 'pm' — the UI disables the controls that would drop the last
// one, the server rejects it either way.
export const ROLES = [
  { value: 'pm', label: 'PM' },
  { value: 'pl', label: 'PL' },
  { value: 'plan', label: '기획' },
  { value: 'design', label: '디자인' },
  { value: 'dev', label: '개발' },
  { value: 'other', label: '기타' },
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

export function Avatar({ user }) {
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
    // <span>, not <div> — Avatar now also renders inline inside <p> markdown
    // content (MarkdownContent's mention chips), where a block element would
    // force the paragraph to close early.
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      {(user?.name || '?').slice(0, 1)}
    </span>
  )
}

// Avatar + name that reveals the person's email (with a copy button) on
// hover — used on the project detail page for PM/PL/멤버 rows (spec 4.5).
// Deliberately not a native `title` tooltip: a copy button has to be
// clickable, which a title tooltip can't host.
export function MemberIdentity({ user, className = '' }) {
  const [copied, setCopied] = useState(false)

  const copyEmail = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!user?.email) return
    try {
      await navigator.clipboard.writeText(user.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied/unavailable — nothing sensible to fall
      // back to, so this just silently doesn't copy.
    }
  }

  return (
    <span className={`group relative inline-flex items-center gap-1.5 ${className}`}>
      <Avatar user={user} />
      <span className="text-sm text-gray-900 dark:text-white">{user?.name}</span>
      {user?.email && (
        <span className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-lg group-hover:pointer-events-auto group-hover:flex dark:border-gray-700 dark:bg-gray-800">
          <span className="text-gray-600 dark:text-gray-300">{user.email}</span>
          <button
            type="button"
            onClick={copyEmail}
            className="shrink-0 rounded px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            {copied ? '복사됨' : '복사'}
          </button>
        </span>
      )}
    </span>
  )
}

// Shared search-as-you-type user picker, used here and by the new-project
// form. The directory is filtered server-side; debounce so typing doesn't
// fire a request per keystroke.
export function UserSearch({ excludeUserIds, onPick, placeholder = '이름 또는 이메일로 검색' }) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) {
      setCandidates([])
      return undefined
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await apiFetch(`/api/users?q=${encodeURIComponent(query.trim())}`)
        setCandidates(users.filter((u) => !excludeUserIds.has(u.id)).slice(0, 5))
      } catch {
        setCandidates([])
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, excludeUserIds])

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      {candidates.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {candidates.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(user)
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

// A PM can invite at any level (PM/PL/기획/디자인/개발/기타); a PL can only
// bring people in at one of the four member-tier roles — assigning pm/pl is
// a 'grade' action reserved for PMs.
function AddMember({ members, myRole, onAdd }) {
  const canAssignRoles = myRole === 'pm'
  const invitableRoles = canAssignRoles ? ROLES : ROLES.filter((r) => r.value !== 'pm' && r.value !== 'pl')
  const [role, setRole] = useState('other')
  const existing = new Set(members.map((m) => m.userId))

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
      <div className="flex gap-2">
        <div className="flex-1">
          <UserSearch excludeUserIds={existing} onPick={(user) => onAdd(user, role)} />
        </div>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="h-fit rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          {invitableRoles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {!canAssignRoles && (
        <p className="text-xs text-gray-400 dark:text-gray-500">PL은 PM/PL 등급으로는 초대할 수 없어요</p>
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
  myRole,
  pending,
  diff,
  saving,
  error,
  onChange,
  onSave,
  onDiscard,
}) {
  const canInviteOrRemove = myRole === 'pm' || myRole === 'pl'
  const canAssignRoles = myRole === 'pm'
  const pmCount = members.filter((m) => m.role === 'pm').length

  const add = (user, role) => onChange([...members, { userId: user.id, role, user, isNew: true }])

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
          const state = pending.get(member.userId)
          // The last remaining PM can't be demoted or removed from here —
          // saving that change would fail server-side anyway, so the
          // controls are disabled instead of letting the user hit an error.
          const isLastPm = member.role === 'pm' && pmCount === 1
          const canEditThisRow = canInviteOrRemove && !isLastPm

          return (
            <li key={member.userId} className="flex items-center gap-2">
              <Avatar user={member.user} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-900 dark:text-white">
                  {member.user?.name}
                  {isLastPm && (
                    <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                      유일한 PM
                    </span>
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

              {canEditThisRow ? (
                <>
                  {canAssignRoles ? (
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
                  ) : (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {roleLabel(member.role)}
                    </span>
                  )}
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

      {canInviteOrRemove && <AddMember members={members} myRole={myRole} onAdd={add} />}
    </div>
  )
}

export default ProjectMembers
