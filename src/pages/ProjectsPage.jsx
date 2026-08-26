import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { roleLabel } from '../components/ProjectMembers'

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

// Pure summary card — editing, deleting and member management all live on
// the detail page now (docs/project-menu-upgrade-spec.md 4.1).
function ProjectCard({ project }) {
  const pm = project.members?.find((m) => m.role === 'pm')

  return (
    <li className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <Link to={`/projects/${project.id}`} className="block">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-medium text-gray-900 hover:underline dark:text-white">
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
          {pm && `${pm.user?.name} · `}
          멤버 {project.members?.length ?? 0}명 · 일감 {project._count?.tasks ?? 0}개
        </p>
      </Link>
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

  if (loading) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">프로젝트</h2>
        <Link
          to="/projects/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          새 프로젝트
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {projects.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">
          확인 가능한 프로젝트가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectsPage
