import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import PersonalGantt from '../components/PersonalGantt'
import ProjectGantt from '../components/ProjectGantt'
import ProjectPicker from '../components/ProjectPicker'

function SchedulePage() {
  const [searchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestedNotFound, setRequestedNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/projects')
        if (cancelled) return
        setProjects(data)
        // 프로젝트 상세 페이지의 "일정 바로가기"(?projectId=)로 들어왔으면 그
        // 프로젝트를 우선 선택 — 없거나 내가 못 보는 프로젝트면 기존처럼 첫
        // 번째(최신 프로젝트, /api/projects가 createdAt desc)로 폴백
        // (docs/project-menu-upgrade-spec.md 4.4). 다만 /api/projects는 보관된
        // 프로젝트를 기본적으로 빼고 내려주므로(archivedAt: null), 보관된
        // 프로젝트로의 바로가기는 이 find가 항상 실패한다 — 그 경우 조용히 다른
        // 프로젝트 일정을 보여주면 "내가 요청한 프로젝트 일정이네" 하고
        // 착각하기 쉬워서, 폴백은 하되 별도로 안내 배지를 띄운다.
        const requested = searchParams.get('projectId')
        const found = data.find((p) => p.id === requested)
        setRequestedNotFound(Boolean(requested) && !found)
        const initial = found?.id || data[0]?.id
        if (initial) setSelectedProjectId(initial)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  if (loading) return null

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-8">
      <section>
        <h2 className="mb-6 text-2xl font-semibold text-gray-900 dark:text-white">일정</h2>

        <ProjectPicker projects={projects} selectedId={selectedProjectId} onSelect={setSelectedProjectId} />

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {requestedNotFound && (
          <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
            요청한 프로젝트의 일정을 찾을 수 없어요(보관되었거나 접근 권한이 없는 프로젝트일 수 있어요). 다른
            프로젝트 일정을 대신 보여드릴게요.
          </p>
        )}

        {projects.length === 0 ? (
          <p className="py-12 text-center text-gray-500 dark:text-gray-400">확인 가능한 일정이 없습니다.</p>
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
