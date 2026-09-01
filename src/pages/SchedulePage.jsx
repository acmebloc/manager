import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import PersonalGantt from '../components/PersonalGantt'
import ProjectGantt from '../components/ProjectGantt'

function SchedulePage() {
  const [searchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pickerRef = useRef(null)

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
        // (docs/project-menu-upgrade-spec.md 4.4).
        const requested = searchParams.get('projectId')
        const initial = data.find((p) => p.id === requested)?.id || data[0]?.id
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

  // 레이어 바깥을 클릭하면 닫는다.
  useEffect(() => {
    if (!pickerOpen) return undefined
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  if (loading) return null

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  // 선택 레이어 안 목록만 생성순(오름차순)으로 보여준다 — 기본 선택은 그대로
  // 최신 프로젝트 우선(projects[0], /api/projects가 createdAt desc로 내려줌)
  // 이라 목록 표시 순서와 기본 선택 로직을 서로 분리해뒀다.
  const projectsByCreatedAt = [...projects].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-8">
      <section>
        <h2 className="mb-6 text-2xl font-semibold text-gray-900 dark:text-white">일정</h2>

        {projects.length > 0 && (
          <div className="relative mb-3 inline-block" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              className="flex items-center gap-1 text-base font-medium text-gray-900 dark:text-white"
            >
              {selectedProject?.name}
              <span className="text-[#000000]">▾</span>
            </button>
            {pickerOpen && (
              <ul className="absolute z-10 mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {projectsByCreatedAt.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(p.id)
                        setPickerOpen(false)
                      }}
                      className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        p.id === selectedProjectId
                          ? 'font-medium text-indigo-600 dark:text-indigo-400'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

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
