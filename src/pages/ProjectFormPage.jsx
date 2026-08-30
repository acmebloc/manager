import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Avatar, ROLES, UserSearch } from '../components/ProjectMembers'

// Creating a project doesn't make you a member of it — a PM has to be
// chosen up front, or the project would be created and immediately
// invisible to everyone, including whoever just made it.
function ProjectFormPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const hasPm = members.some((m) => m.role === 'pm')
  const dateProblem = startAt && endAt && startAt > endAt ? '시작일은 종료일보다 늦을 수 없습니다' : ''

  // Added at the 'other' tier by default; the exact role (PM/PL/기획/디자인/
  // 개발/기타) is picked afterward from the row's own dropdown.
  const addMember = (user) => setMembers((current) => [...current, { userId: user.id, user, role: 'other' }])
  const removeMember = (userId) => setMembers((current) => current.filter((m) => m.userId !== userId))
  const setMemberRole = (userId, role) =>
    setMembers((current) => current.map((m) => (m.userId === userId ? { ...m, role } : m)))

  const submit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !hasPm || dateProblem) return
    setSaving(true)
    try {
      const project = await apiFetch('/api/projects', {
        method: 'POST',
        body: {
          name: trimmed,
          description: description.trim() || null,
          startAt: startAt || null,
          endAt: endAt || null,
          members: members.map((m) => ({ userId: m.userId, role: m.role })),
        },
      })
      navigate(`/projects/${project.id}`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      <h2 className="mb-6 text-2xl font-semibold text-gray-900 dark:text-white">새 프로젝트</h2>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="프로젝트 이름"
          autoFocus
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="설명 (선택)"
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
            시작일 (선택)
            <input
              type="date"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>
          <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
            종료일 (선택)
            <input
              type="date"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>
        </div>

        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            참여 인원 — PM은 필수예요
          </p>

          {members.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1.5">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2">
                  <Avatar user={m.user} />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">
                    {m.user.name}
                  </span>
                  <select
                    value={m.role}
                    onChange={(event) => setMemberRole(m.userId, event.target.value)}
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
                    onClick={() => removeMember(m.userId)}
                    className="text-xs text-red-600 hover:text-red-500 dark:text-red-400"
                  >
                    제외
                  </button>
                </li>
              ))}
            </ul>
          )}

          <UserSearch excludeUserIds={new Set(members.map((m) => m.userId))} onPick={addMember} />
          {!hasPm && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              최소 1명은 PM으로 지정해야 프로젝트를 만들 수 있어요.
            </p>
          )}
        </div>

        {(error || dateProblem) && (
          <p className="text-sm text-red-600 dark:text-red-400">{error || dateProblem}</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || !name.trim() || !hasPm || Boolean(dateProblem)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? '만드는 중...' : '만들기'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="rounded-md px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  )
}

export default ProjectFormPage
