import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import ProjectComments from '../components/ProjectComments'
import ProjectMembers, { MemberIdentity, membersDiff, roleLabel } from '../components/ProjectMembers'

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

const shortcutLinkClassName =
  'inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400'

// 버튼이 아니라 링크로 보이게 — MarkdownContent.jsx의 본문 링크와 같은 색/밑줄
// 규칙을 재사용. 세 바로가기는 전부 같은 모양·상호작용으로 만든다 — 게시판은
// BookStack 프로젝트별 연동 전이라 대상 URL만 없을 뿐, 별도 비활성 스타일을
// 두지 않는다 (docs/project-menu-upgrade-spec.md 4.6).
function ShortcutLink({ to, label }) {
  if (!to) return <a className={shortcutLinkClassName}>{label}</a>
  return (
    <Link to={to} className={shortcutLinkClassName}>
      {label}
    </Link>
  )
}

function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')

  const [membersOpen, setMembersOpen] = useState(false)
  const [draftMembers, setDraftMembers] = useState([])
  const [savingMembers, setSavingMembers] = useState(false)
  const [memberError, setMemberError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const data = await apiFetch(`/api/projects/${id}`)
        if (cancelled) return
        setProject(data)
        setDraftMembers(data.members || [])
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(err.message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const savedMembers = project?.members || []
  const diff = useMemo(() => membersDiff(savedMembers, draftMembers), [savedMembers, draftMembers])
  const pending = useMemo(() => {
    const map = new Map()
    const byId = new Map(savedMembers.map((m) => [m.id, m.userId]))
    diff.added.forEach((m) => map.set(m.userId, '추가 예정'))
    diff.changed.forEach((m) => map.set(byId.get(m.id), '역할 변경'))
    return map
  }, [diff, savedMembers])

  const memberUsers = useMemo(() => savedMembers.map((m) => m.user), [savedMembers])
  const pm = savedMembers.find((m) => m.role === 'pm')
  const pl = savedMembers.find((m) => m.role === 'pl')
  const otherMembers = savedMembers.filter((m) => m.role !== 'pm' && m.role !== 'pl')

  const isPm = project?.myRole === 'pm'
  const isPmOrPl = project?.myRole === 'pm' || project?.myRole === 'pl'

  const startEditing = () => {
    setName(project.name)
    setDescription(project.description || '')
    setStartAt(project.startAt?.slice(0, 10) || '')
    setEndAt(project.endAt?.slice(0, 10) || '')
    setEditing(true)
  }

  const save = async (event) => {
    event.preventDefault()
    try {
      const updated = await apiFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        body: {
          name: name.trim(),
          description: description.trim() || null,
          startAt: startAt || null,
          endAt: endAt || null,
        },
      })
      setProject((current) => ({ ...current, ...updated }))
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async () => {
    if (
      !window.confirm('프로젝트 삭제시 프로젝트에 연결된 모든 일감/일정/게시판도 같이 삭제됩니다. 그래도 삭제 하시겠습니까?')
    ) {
      return
    }
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
      navigate('/projects')
    } catch (err) {
      setError(err.message)
    }
  }

  const openMembers = () => {
    setDraftMembers(savedMembers)
    setMemberError('')
    setMembersOpen(true)
  }

  const discardMembers = () => {
    setDraftMembers(savedMembers)
    setMemberError('')
  }

  const closeMembers = () => {
    if (diff.count > 0 && !window.confirm('저장하지 않은 멤버 변경이 있습니다. 닫을까요?')) return
    setDraftMembers(savedMembers)
    setMemberError('')
    setMembersOpen(false)
  }

  const saveMembers = async () => {
    setSavingMembers(true)
    try {
      for (const m of diff.removed) {
        await apiFetch(`/api/projects/${id}/members/${m.id}`, { method: 'DELETE' })
      }
      for (const m of diff.changed) {
        await apiFetch(`/api/projects/${id}/members/${m.id}`, { method: 'PATCH', body: { role: m.role } })
      }
      for (const m of diff.added) {
        await apiFetch(`/api/projects/${id}/members`, {
          method: 'POST',
          body: { userId: m.userId, role: m.role },
        })
      }
      setMemberError('')
    } catch (err) {
      setMemberError(err.message)
    } finally {
      try {
        const fresh = await apiFetch(`/api/projects/${id}/members`)
        setDraftMembers(fresh)
        setProject((current) => ({ ...current, members: fresh }))
      } catch {
        // leave the draft as-is; the error above already explains the failure
      }
      setSavingMembers(false)
    }
  }

  if (loading) return null

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">프로젝트를 찾을 수 없습니다.</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-lg font-semibold dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
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
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">{project.name}</h2>
            {project.description && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{project.description}</p>
            )}
            {(project.startAt || project.endAt) && (
              <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                {formatDate(project.startAt) || '?'} ~ {formatDate(project.endAt) || '?'}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-gray-300 dark:text-gray-600">
              <ShortcutLink to={`/tasks?projectId=${id}`} label="일감" />
              <span aria-hidden="true">·</span>
              <ShortcutLink to={`/schedule?projectId=${id}`} label="일정" />
              <span aria-hidden="true">·</span>
              <ShortcutLink to={null} label="게시판" />
            </div>
          </div>
          {isPm && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={startEditing}
                className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              >
                수정
              </button>
              <button
                type="button"
                onClick={remove}
                className="text-sm text-red-600 hover:text-red-500 dark:text-red-400"
              >
                삭제
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 flex flex-col gap-4">
        <div className="relative flex flex-col gap-4 border-t border-gray-100 pt-6 dark:border-gray-700">
          {isPmOrPl && (
            <button
              type="button"
              onClick={membersOpen ? closeMembers : openMembers}
              className="absolute right-0 top-6 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              {membersOpen ? '멤버 관리 닫기' : '멤버 관리'}
            </button>
          )}

          {pm && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">PM</h3>
              <MemberIdentity user={pm.user} />
            </section>
          )}

          {pl && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">PL</h3>
              <MemberIdentity user={pl.user} />
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">멤버</h3>
            {otherMembers.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">등록된 멤버가 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {otherMembers.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2">
                    <MemberIdentity user={m.user} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">{roleLabel(m.role)}</span>
                  </li>
                ))}
              </ul>
            )}
            {membersOpen && (
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
          </section>
        </div>

        <section className="border-t border-gray-100 pt-4 dark:border-gray-700">
          <ProjectComments projectId={id} members={memberUsers} />
        </section>
      </div>
    </div>
  )
}

export default ProjectDetailPage
