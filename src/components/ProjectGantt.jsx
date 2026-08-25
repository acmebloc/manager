import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { ROW_HEIGHT, ZOOM_LEVELS, buildTicks, computeRange, totalWidth, todayX, barGeometry, zoomIn, zoomOut } from '../lib/ganttDates'
import ScheduleItemDialog from './ScheduleItemDialog'

const LABEL_WIDTH = 200

const ZOOM_LABEL = { day: '일', week: '주', month: '월' }

// 일감에서 가져온 행(인디고)과 별도로 등록한 "기타" 행(앰버)을 색으로 구분
// (스펙 요구사항).
const BAR_CLASS = {
  task: 'bg-indigo-500 hover:bg-indigo-400',
  other: 'bg-amber-500 hover:bg-amber-400',
}

// 프로젝트 하나의 간트차트 — X축은 day 단위로 길게 뻗고(줌에 따라 day/week/month
// 간격으로 넓어지거나 좁아짐), Y축은 일정 항목(행)이며 줌을 바꿔도 행 순서/세로
// 위치는 그대로다. 일감 행은 Task 테이블에서 직접 계산해 보여주므로 별도
// 저장이 없고, 날짜를 고치면 바로 해당 일감이 갱신된다.
function ProjectGantt({ projectId }) {
  const [items, setItems] = useState([])
  const [members, setMembers] = useState([])
  const [zoom, setZoom] = useState('week')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogTarget, setDialogTarget] = useState(null) // null=닫힘, 'new'=생성, item=수정

  const load = useCallback(async () => {
    try {
      const [scheduleItems, projectMembers] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/schedule`),
        apiFetch(`/api/projects/${projectId}/members`),
      ])
      setItems(scheduleItems)
      setMembers(projectMembers.map((m) => m.user))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    setError('')
    load()
  }, [load])

  // Ctrl/Cmd + '+'/'-' — 브라우저 자체 확대/축소를 막고 간트차트 줌으로 대체.
  useEffect(() => {
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom((z) => zoomIn(z))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom((z) => zoomOut(z))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const range = useMemo(() => computeRange(items), [items])
  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom])
  const chartWidth = useMemo(() => totalWidth(range, zoom), [range, zoom])
  const todayLeft = useMemo(() => todayX(range, zoom), [range, zoom])

  const onDialogDone = () => {
    setDialogTarget(null)
    load()
  }

  if (loading) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> 일감
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> 기타
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
            <button
              type="button"
              onClick={() => setZoom((z) => zoomOut(z))}
              disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              −
            </button>
            <span className="w-10 text-center text-xs text-gray-500 dark:text-gray-400">{ZOOM_LABEL[zoom]}</span>
            <button
              type="button"
              onClick={() => setZoom((z) => zoomIn(z))}
              disabled={zoom === ZOOM_LEVELS[0]}
              className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDialogTarget('new')}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            새 일정
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          표시할 일정이 없습니다. 일감에 시작/종료일을 등록하거나 새 일정을 추가해 보세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="relative" style={{ width: LABEL_WIDTH + chartWidth }}>
            {/* 오늘 표시선 — 헤더+모든 행에 걸쳐 세로로 이어진다 */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-[3] w-px bg-red-400"
              style={{ left: LABEL_WIDTH + todayLeft }}
            />

            {/* 헤더 */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <div className="sticky left-0 z-[2] w-[200px] shrink-0 border-r border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                일정
              </div>
              <div className="relative h-8" style={{ width: chartWidth }}>
                {ticks.map((tick) => (
                  <div
                    key={tick.key}
                    className={`absolute top-0 flex h-8 items-center justify-center border-r border-gray-100 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400 ${
                      tick.isWeekend ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                    }`}
                    style={{ left: tick.x, width: tick.width }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 행 */}
            {items.map((item) => {
              const bar = barGeometry(item, range, zoom)
              return (
                <div key={item.id} className="flex border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                  <div
                    className="sticky left-0 z-[2] w-[200px] shrink-0 truncate border-r border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
                    title={item.title}
                  >
                    {item.title}
                  </div>
                  <div className="relative" style={{ width: chartWidth, height: ROW_HEIGHT }}>
                    <button
                      type="button"
                      onClick={() => setDialogTarget(item)}
                      title={item.title}
                      className={`absolute top-1.5 truncate rounded px-2 text-left text-xs font-medium text-white ${BAR_CLASS[item.source]}`}
                      style={{ left: bar.left, width: Math.max(bar.width, 8), height: ROW_HEIGHT - 12 }}
                    >
                      {item.title}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {dialogTarget && (
        <ScheduleItemDialog
          projectId={projectId}
          item={dialogTarget === 'new' ? null : dialogTarget}
          members={members}
          onClose={() => setDialogTarget(null)}
          onDone={onDialogDone}
        />
      )}
    </div>
  )
}

export default ProjectGantt
