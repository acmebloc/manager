import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import ProjectMembers, { Avatar, ROLES, UserSearch, membersDiff, roleLabel } from '../components/ProjectMembers'

// Creating a project doesn't make you a member of it — a PM has to be
// chosen up front, or the project would be created and immediately
// invisible to everyone, including whoever just made it.
function NewProjectForm({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const hasPm = members.some((m) => m.role === 'pm')

  const reset = () => {
    setName('')
    setDescription('')
    setStartAt('')
    setEndAt('')
    setMembers([])
    setError('')
  }

  // Added as a plain member; PM/PL are picked afterward from the row's own
  // dropdown. Most people on a project are members, so that's the default.
  const addMember = (user) => setMembers((current) => [...current, { userId: user.id, user, role: 'member' }])
  const removeMember = (userId) => setMembers((current) => current.filter((m) => m.userId !== userId))
  const setMemberRole = (userId, role) =>
    setMembers((current) => current.map((m) => (m.userId === userId ? { ...m, role } : m)))

  const submit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !hasPm) return
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
      onCreated(project)
      reset()
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        새 프로젝트
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="w-full rounded-lg border border-gray-200 p-4 dark:border-gray-700"
    >
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="프로젝트 이름"
        autoFocus
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="설명 (선택)"
        rows={2}
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      <div className="mb-3 flex gap-2">
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

      <div className="mb-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
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

        <UserSearch
          excludeUserIds={new Set(members.map((m) => m.userId))}
          onPick={addMember}
        />
        {!hasPm && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            최소 1명은 PM으로 지정해야 프로젝트를 만들 수 있어요.
          </p>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !hasPm}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? '만드는 중...' : '만들기'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
          }}
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
        >
          취소
        </button>
      </div>
    </form>
  )
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

function ProjectCard({ project, onChanged, onDeleted }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [startAt, setStartAt] = useState(project.startAt?.slice(0, 10) || '')
  const [endAt, setEndAt] = useState(project.endAt?.slice(0, 10) || '')
  const [error, setError] = useState('')

  // Member edits are held here until saved, so the panel can offer one
  // 저장 for the whole batch instead of firing a request per click.
  const savedMembers = project.members || []
  const [draftMembers, setDraftMembers] = useState(savedMembers)
  const [savingMembers, setSavingMembers] = useState(false)
  const [memberError, setMemberError] = useState('')

  const isPm = project.myRole === 'pm'

  const diff = useMemo(
    () => membersDiff(savedMembers, draftMembers),
    [savedMembers, draftMembers],
  )

  // Marks each row with what will happen to it on save, so the pending state
  // is visible on the row itself and not just in the button.
  const pending = useMemo(() => {
    const map = new Map()
    const byId = new Map(savedMembers.map((m) => [m.id, m.userId]))
    diff.added.forEach((m) => map.set(m.userId, '추가 예정'))
    diff.changed.forEach((m) => map.set(byId.get(m.id), '역할 변경'))
    return map
  }, [diff, savedMembers])

  const openMembers = () => {
    setDraftMembers(savedMembers)
    setMemberError('')
    setExpanded(true)
  }

  // Reverts the edits but keeps the panel open — closing is the separate
  // 닫기 button up in the project's own row.
  const discardMembers = () => {
    setDraftMembers(savedMembers)
    setMemberError('')
  }

  const closeMembers = () => {
    if (diff.count > 0 && !window.confirm('저장하지 않은 멤버 변경이 있습니다. 닫을까요?')) {
      return
    }
    setDraftMembers(savedMembers)
    setMemberError('')
    setExpanded(false)
  }

  const saveMembers = async () => {
    setSavingMembers(true)
    try {
      for (const m of diff.removed) {
        await apiFetch(`/api/projects/${project.id}/members/${m.id}`, { method: 'DELETE' })
      }
      for (const m of diff.changed) {
        await apiFetch(`/api/projects/${project.id}/members/${m.id}`, {
          method: 'PATCH',
          body: { role: m.role },
        })
      }
      for (const m of diff.added) {
        await apiFetch(`/api/projects/${project.id}/members`, {
          method: 'POST',
          body: { userId: m.userId, role: m.role },
        })
      }
      setMemberError('')
    } catch (err) {
      setMemberError(err.message)
    } finally {
      // Re-read either way: on failure some of the batch may already have
      // applied, and the draft must not keep showing changes that landed.
      try {
        const fresh = await apiFetch(`/api/projects/${project.id}/members`)
        setDraftMembers(fresh)
        onChanged({ ...project, members: fresh })
      } catch {
        // leave the draft as-is; the error above already explains the failure
      }
      setSavingMembers(false)
    }
  }

  const save = async () => {
    try {
      const updated = await apiFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim(),
          description: description.trim() || null,
          startAt: startAt || null,
          endAt: endAt || null,
        },
      })
      onChanged(updated)
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async () => {
    if (
      !window.confirm(
        `프로젝트 삭제시 프로젝트에 연결된 모든 일감/일정/게시판도 같이 삭제됩니다. 그래도 삭제 하시겠습니까?`,
      )
    ) {
      return
    }
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      onDeleted(project.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <li className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="설명 (선택)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              시작일
              <input
                type="date"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              종료일
              <input
                type="date"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!name.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setName(project.name)
                setDescription(project.description || '')
                setStartAt(project.startAt?.slice(0, 10) || '')
                setEndAt(project.endAt?.slice(0, 10) || '')
              }}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-medium text-gray-900 dark:text-white">
                {project.name}
              </h3>
              {project.myRole && (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {roleLabel(project.myRole)}
                </span>
              )}
            </div>
            {project.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.description}</p>
            )}
            {(project.startAt || project.endAt) && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {formatDate(project.startAt) || '?'} ~ {formatDate(project.endAt) || '?'}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              멤버 {project.members?.length ?? 0}명 · 일감 {project._count?.tasks ?? 0}개
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={expanded ? closeMembers : openMembers}
              className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              {expanded ? '닫기' : '멤버'}
            </button>
            {isPm && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              >
                수정
              </button>
            )}
            {isPm && (
              <button
                type="button"
                onClick={remove}
                className="text-sm text-red-600 hover:text-red-500 dark:text-red-400"
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {expanded && (
        <ProjectMembers
          members={draftMembers}
          myRole={project.myRole}
          pending={pending}
          diff={diff}
          saving={savingMembers}
          error={memberError}
          onChange={setDraftMembers}
          onSave={saveMembers}
          onDiscard={discardMembers}
        />
      )}
    </li>
  )
}

function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/projects')
        if (!cancelled) setProjects(data)
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

  const replaceProject = useCallback((updated) => {
    setProjects((current) => current.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
  }, [])

  const removeProject = useCallback((id) => {
    setProjects((current) => current.filter((p) => p.id !== id))
  }, [])

  const addProject = useCallback((project) => {
    setProjects((current) => [project, ...current])
  }, [])

  if (loading) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">프로젝트</h2>
        <NewProjectForm onCreated={addProject} />
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {projects.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">
          확인 가능한 프로젝트가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onChanged={replaceProject}
              onDeleted={removeProject}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectsPage
