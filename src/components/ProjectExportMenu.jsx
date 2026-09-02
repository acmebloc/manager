import { useEffect, useRef, useState } from 'react'
import { apiDownload } from '../lib/api'

const SCOPES = [
  { value: 'all', label: '전체' },
  { value: 'tasks', label: '일감' },
  { value: 'schedules', label: '일정' },
]

const FORMATS = [
  { value: 'xlsx', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
]

// 서버(routes/projectExport.js)가 실제로 내려주는 파일명과 같은 규칙으로
// 미리 계산해둔다 — apiDownload는 Content-Disposition을 파싱하지 않고 이
// 이름을 그대로 저장에 쓴다(TaskAttachments.jsx와 같은 패턴).
function buildFileName(projectName, scope, format) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const scopeLabel = SCOPES.find((s) => s.value === scope)?.label ?? scope
  const ext = scope === 'all' ? 'zip' : format
  return `${projectName}_${scopeLabel}_${stamp}.${ext}`
}

// 프로젝트 상세페이지 바로가기 줄에 붙는 다운로드 메뉴. 조회 권한과 동일하게
// 프로젝트 참여자 전원에게 노출한다(docs/project-export-spec.md §1) — 엑셀
// 업로드(TaskExcelImport)와 달리 PM 전용이 아니다.
function ProjectExportMenu({ projectId, projectName }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState('all')
  const [format, setFormat] = useState('xlsx')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const download = async () => {
    setDownloading(true)
    setError('')
    try {
      await apiDownload(
        `/api/projects/${projectId}/export?scope=${scope}&format=${format}`,
        buildFileName(projectName, scope, format),
      )
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium leading-none text-white hover:bg-indigo-500"
      >
        다운로드
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">받을 내용</p>
          <div className="mb-3 flex gap-1">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setScope(s.value)}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  scope === s.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">파일 형식</p>
          <div className="mb-3 grid grid-cols-4 gap-1">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={`rounded px-2 py-1 text-xs ${
                  format === f.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {downloading ? '다운로드 중…' : '다운로드'}
          </button>
        </div>
      )}
    </div>
  )
}

export default ProjectExportMenu
