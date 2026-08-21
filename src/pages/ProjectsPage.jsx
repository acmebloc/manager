import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import ProjectMembers from '../components/ProjectMembers'

const ROLE_LABELS = { admin: '관리자', member: '멤버', viewer: '뷰어' }

function NewProjectForm({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const project = await apiFetch('/api/projects', {
        method: 'POST',
        body: { name: trimmed, description: description.trim() || null },
      })
      onCreated(project)
      setName('')
      setDescription('')
      setOpen(false)
      setError('')
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
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? '만드는 중...' : '만들기'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError('')
          }}
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
        >
          취소
        </button>
      </div>
    </form>
  )
}

function ProjectCard({ project, onChanged, onDeleted }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [error, setError] = useState('')

  const isAdmin = project.myRole === 'admin'
  const canDelete = isAdmin && project.isOwner

  const save = async () => {
    try {
      const updated = await apiFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), description: description.trim() || null },
      })
      onChanged(updated)
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async () => {
    if (!window.confirm(`"${project.name}" 프로젝트를 삭제할까요? 하위 일감도 함께 삭제됩니다.`)) {
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
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {ROLE_LABELS[project.myRole] || project.myRole}
              </span>
            </div>
            {project.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.description}</p>
            )}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              멤버 {project.members?.length ?? 0}명 · 일감 {project._count?.tasks ?? 0}개
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              {expanded ? '닫기' : '멤버'}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              >
                수정
              </button>
            )}
            {canDelete && (
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
          project={project}
          canManage={isAdmin}
          onMembersChanged={(members) => onChanged({ ...project, members })}
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
          아직 참여 중인 프로젝트가 없습니다.
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
