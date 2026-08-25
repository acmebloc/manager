// Pure date/geometry math for the project Gantt chart (ProjectGantt.jsx) —
// kept separate from rendering so zoom/scale logic can be reasoned about
// without JSX in the way.

export const ZOOM_LEVELS = ['day', 'week', 'month']
const PX_PER_DAY = { day: 40, week: 14, month: 5 }
export const ROW_HEIGHT = 40

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

export function pxPerDayFor(zoom) {
  return PX_PER_DAY[zoom] ?? PX_PER_DAY.week
}

// 확대(Ctrl/Cmd +) → day 쪽으로, 축소(Ctrl/Cmd -) → month 쪽으로.
export function zoomIn(zoom) {
  const i = ZOOM_LEVELS.indexOf(zoom)
  return ZOOM_LEVELS[Math.max(0, i - 1)]
}

export function zoomOut(zoom) {
  const i = ZOOM_LEVELS.indexOf(zoom)
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, i + 1)]
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = startOfDay(date)
  d.setDate(d.getDate() + n)
  return d
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / MS_PER_DAY)
}

// A personal schedule can be created without an end date (endAt stays
// optional there — only a project bar requires one). Treated as a one-day
// bar for every date/geometry calculation below, without touching the
// stored value.
function effectiveEnd(item) {
  return item.endAt || item.startAt
}

// Always spans today (padded a couple weeks either side so an empty or
// just-started project doesn't render a razor-thin chart), and grows to fit
// whatever items actually exist, with a little breathing room past them.
export function computeRange(items) {
  const today = startOfDay(new Date())
  let min = addDays(today, -14)
  let max = addDays(today, 30)
  for (const item of items) {
    const s = startOfDay(item.startAt)
    const e = startOfDay(effectiveEnd(item))
    if (s < min) min = s
    if (e > max) max = e
  }
  return { start: addDays(min, -3), end: addDays(max, 3) }
}

// 개인 일정표 전용 — 항상 올해 1/1~12/31을 다 채워서 보여주고, 그 범위를 벗어난
// 항목이 있으면 그만큼만 넓힌다.
export function computeYearRange(items, referenceDate = new Date()) {
  const year = referenceDate.getFullYear()
  let min = new Date(year, 0, 1)
  let max = new Date(year, 11, 31)
  for (const item of items) {
    const s = startOfDay(item.startAt)
    const e = startOfDay(effectiveEnd(item))
    if (s < min) min = s
    if (e > max) max = e
  }
  return { start: min, end: max }
}

export function totalWidth(range, zoom) {
  return (daysBetween(range.start, range.end) + 1) * pxPerDayFor(zoom)
}

export function todayX(range, zoom) {
  return daysBetween(range.start, new Date()) * pxPerDayFor(zoom)
}

// left/width for one item's bar. Only these change with zoom — which row an
// item sits in never does (spec requirement: 세로값 변화 없이 가로값만 변화).
export function barGeometry(item, range, zoom) {
  const px = pxPerDayFor(zoom)
  const left = daysBetween(range.start, item.startAt) * px
  const width = (daysBetween(item.startAt, effectiveEnd(item)) + 1) * px
  return { left, width }
}

// Header tick marks, grouped to match the current zoom level.
export function buildTicks(range, zoom) {
  const px = pxPerDayFor(zoom)
  const ticks = []

  if (zoom === 'day') {
    let d = range.start
    while (d <= range.end) {
      ticks.push({
        key: d.toISOString(),
        x: daysBetween(range.start, d) * px,
        width: px,
        label: `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_LABELS[d.getDay()]})`,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      })
      d = addDays(d, 1)
    }
    return ticks
  }

  if (zoom === 'week') {
    let d = addDays(range.start, -((range.start.getDay() + 6) % 7)) // 월요일 시작
    // 각 주(월요일 기준)가 속한 달이 바뀔 때마다 "N주차"를 1부터 다시 센다 —
    // 그 달에 걸친 주가 몇 개든 "8월 1주차, 8월 2주차, ..." 순서로 보이게.
    let currentMonth = null
    let weekOfMonth = 0
    while (d <= range.end) {
      const spanStart = d < range.start ? range.start : d
      const weekEnd = addDays(d, 6)
      const spanEnd = weekEnd < range.end ? weekEnd : range.end
      const month = d.getMonth()
      weekOfMonth = month === currentMonth ? weekOfMonth + 1 : 1
      currentMonth = month
      ticks.push({
        key: d.toISOString(),
        x: daysBetween(range.start, spanStart) * px,
        width: (daysBetween(spanStart, spanEnd) + 1) * px,
        label: `${month + 1}월 ${weekOfMonth}주차`,
      })
      d = addDays(d, 7)
    }
    return ticks
  }

  let d = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
  while (d <= range.end) {
    const spanStart = d < range.start ? range.start : d
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const spanEnd = monthEnd < range.end ? monthEnd : range.end
    ticks.push({
      key: d.toISOString(),
      x: daysBetween(range.start, spanStart) * px,
      width: (daysBetween(spanStart, spanEnd) + 1) * px,
      label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    })
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  }
  return ticks
}
