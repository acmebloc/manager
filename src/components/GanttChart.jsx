import { useEffect, useMemo, useRef, useState } from 'react'
import { ROW_HEIGHT, ZOOM_LEVELS, buildTicks, totalWidth, todayX, barGeometry, zoomIn, zoomOut } from '../lib/ganttDates'

const LABEL_WIDTH = 200
const ZOOM_LABEL = { day: '일', week: '주', month: '월' }

// 프로젝트 간트차트(ProjectGantt)와 개인 일정표(PersonalGantt)가 공유하는
// 렌더링 뼈대 — 무엇을 행으로 보여줄지(items)와 막대 색(barClassFor)만 다르고
// 줌/오늘표시선/가운데 정렬/헤더 눈금은 완전히 동일한 로직이라 여기 하나로
// 모았다. 데이터를 어디서 가져오는지, 클릭했을 때 어떤 다이얼로그를 여는지는
// 각 호출부(ProjectGantt/PersonalGantt) 책임.
function GanttChart({ items, range, legend, barClassFor, onBarClick, onNewClick, newButtonLabel = '새 일정', emptyMessage }) {
  const [zoom, setZoom] = useState('day')
  const scrollRef = useRef(null)
  const hoveredRef = useRef(false)
  // 마지막으로 "오늘 가운데 정렬"을 해준 줌 단계 — 이 값과 현재 zoom이
  // 다르면 다시 정렬해야 한다는 뜻(최초 진입 포함, 초기값이 실제 줌 값과
  // 절대 같을 수 없는 sentinel이라 첫 렌더에도 자연히 한 번 실행된다).
  const centeredForZoomRef = useRef(null)

  // Ctrl/Cmd + '+'/'-' — 브라우저 자체 확대/축소를 막고 간트차트 줌으로
  // 대체한다. 화면에 여러 간트차트가 동시에 떠 있을 수 있어(프로젝트+개인),
  // 마우스가 올라가 있는 차트에만 적용되도록 hover로 스코프를 좁혔다.
  useEffect(() => {
    const handler = (e) => {
      if (!hoveredRef.current) return
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

  const ticks = useMemo(() => buildTicks(range, zoom), [range, zoom])
  const chartWidth = useMemo(() => totalWidth(range, zoom), [range, zoom])
  const todayLeft = useMemo(() => todayX(range, zoom), [range, zoom])

  // 화면 진입 시, 그리고 day/week/month 줌을 바꿀 때마다 오늘이 가로 기준
  // 가운데 오도록 다시 스크롤한다. 전체 기간이 짧아 가운데 정렬할 여백이
  // 없으면(스크롤 가능한 폭보다 화면이 넓으면) 브라우저가 scrollLeft를 0으로
  // 알아서 clamp해줘서 자연히 맨 앞(왼쪽) 기준이 된다 — 별도 분기 불필요.
  // 항목이 없어서(items.length===0) 스크롤 컨테이너가 아직 안 그려졌을
  // 수도 있어 매 렌더마다 다시 시도하되, 이번 줌에 대해 한 번 성공하면
  // centeredForZoomRef로 더는 건드리지 않는다(의존성 배열을 안 두는 이유 —
  // zoom이 바뀌면 ref와 어긋나서 자동으로 다시 실행된다).
  useEffect(() => {
    if (centeredForZoomRef.current === zoom) return
    const el = scrollRef.current
    if (!el || el.clientWidth === 0) return
    centeredForZoomRef.current = zoom
    el.scrollLeft = Math.max(0, LABEL_WIDTH + todayLeft - el.clientWidth / 2)
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          {legend.map((entry) => (
            <span key={entry.key} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${entry.className}`} /> {entry.label}
            </span>
          ))}
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
          {onNewClick && (
            <button
              type="button"
              onClick={onNewClick}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {newButtonLabel}
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {emptyMessage}
        </p>
      ) : (
        <div
          ref={scrollRef}
          onMouseEnter={() => {
            hoveredRef.current = true
          }}
          onMouseLeave={() => {
            hoveredRef.current = false
          }}
          className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"
        >
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
                    className={`absolute top-0 flex h-8 items-center justify-center border-r border-gray-100 text-gray-500 dark:border-gray-800 dark:text-gray-400 ${
                      zoom === 'day' ? 'text-[10px]' : 'text-[11px]'
                    } ${tick.isWeekend ? 'bg-gray-50 dark:bg-gray-800/60' : ''}`}
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
                      onClick={() => onBarClick(item)}
                      title={item.title}
                      className={`absolute top-1.5 truncate rounded px-2 text-left text-xs font-medium text-white ${barClassFor(item)}`}
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
    </div>
  )
}

export default GanttChart
