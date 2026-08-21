import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

const ROLES = [
  { value: 'admin', label: '관리자', hint: '프로젝트 설정과 멤버를 관리' },
  { value: 'member', label: '멤버', hint: '일감과 일정을 만들고 수정' },
  { value: 'viewer', label: '뷰어', hint: '읽기만 가능' },
]

function Avatar({ user }) {
  if (user.picture) {
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
      {(user.name || '?').slice(0, 1)}
    </div>
  )
}

function AddMember({ projectId, members, onAdded }) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [role, setRole] = useState('member')
  const [error, setError] = useState('')
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

  const add = async (user) => {
    try {
      const member = await apiFetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        body: { userId: user.id, role },
      })
      onAdded(member)
      setQuery('')
      setCandidates([])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

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

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {candidates.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {candidates.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => add(user)}
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

function ProjectMembers({ project, canManage, onMembersChanged }) {
  const [members, setMembers] = useState(project.members || [])
  const [error, setError] = useState('')

  const apply = (next) => {
    setMembers(next)
    onMembersChanged(next)
  }

  const changeRole = async (member, role) => {
    try {
      const updated = await apiFetch(`/api/projects/${project.id}/members/${member.id}`, {
        method: 'PATCH',
        body: { role },
      })
      apply(members.map((m) => (m.id === updated.id ? updated : m)))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async (member) => {
    try {
      await apiFetch(`/api/projects/${project.id}/members/${member.id}`, { method: 'DELETE' })
      apply(members.filter((m) => m.id !== member.id))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isOwner = member.userId === project.ownerId
          return (
            <li key={member.id} className="flex items-center gap-2">
              <Avatar user={member.user} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-900 dark:text-white">
                  {member.user.name}
                  {isOwner && (
                    <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">소유자</span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {member.user.email}
                </span>
              </span>

              {canManage && !isOwner ? (
                <>
                  <select
                    value={member.role}
                    onChange={(event) => changeRole(member, event.target.value)}
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
                    onClick={() => remove(member)}
                    className="text-xs text-red-600 hover:text-red-500 dark:text-red-400"
                  >
                    제외
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {ROLES.find((r) => r.value === member.role)?.label || member.role}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {canManage && (
        <AddMember
          projectId={project.id}
          members={members}
          onAdded={(member) => apply([...members, member])}
        />
      )}
    </div>
  )
}

export default ProjectMembers
