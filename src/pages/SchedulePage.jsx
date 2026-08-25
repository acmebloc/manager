import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import PersonalGantt from '../components/PersonalGantt'
import ProjectGantt from '../components/ProjectGantt'

function SchedulePage() {
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/projects')
        if (cancelled) return
        setProjects(data)
        if (data.length > 0) setSelectedProjectId(data[0].id)
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">일정</h2>
          {projects.length > 0 && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {projects.length === 0 ? (
          <p className="py-12 text-center text-gray-500 dark:text-gray-400">속한 프로젝트가 없습니다.</p>
        ) : (
          selectedProjectId && <ProjectGantt key={selectedProjectId} projectId={selectedProjectId} />
        )}
      </section>

      <section>
        <h3 className="mb-3 text-base font-medium text-gray-900 dark:text-white">개인 일정</h3>
        <PersonalGantt />
      </section>
    </div>
  )
}

export default SchedulePage
