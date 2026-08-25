import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { computeRange } from '../lib/ganttDates'
import GanttChart from './GanttChart'
import ScheduleItemDialog from './ScheduleItemDialog'

// 일감에서 가져온 행(인디고)과 별도로 등록한 "기타" 행(앰버)을 색으로 구분
// (스펙 요구사항). 시작/종료일이 없는 일감(등록일로 임시 표시된 행)은
// 출처와 무관하게 회색(Disable 느낌)으로 덮어써서 구분한다.
const BAR_CLASS = {
  task: 'bg-indigo-500 hover:bg-indigo-400',
  other: 'bg-amber-500 hover:bg-amber-400',
}
const NO_DATES_BAR_CLASS = 'bg-gray-400 hover:bg-gray-400'

const LEGEND = [
  { key: 'task', label: '일감', className: 'bg-indigo-500' },
  { key: 'other', label: '기타', className: 'bg-amber-500' },
  { key: 'noDates', label: '날짜없음', className: 'bg-gray-400' },
]

// 프로젝트 하나의 간트차트. 일감 행은 Task 테이블에서 직접 계산해 보여주므로
// 별도 저장이 없고, 날짜를 고치면 바로 해당 일감이 갱신된다.
function ProjectGantt({ projectId }) {
  const [items, setItems] = useState([])
  const [members, setMembers] = useState([])
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

  const range = useMemo(() => computeRange(items), [items])

  const onDialogDone = () => {
    setDialogTarget(null)
    load()
  }

  if (loading) return null

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <GanttChart
        items={items}
        range={range}
        legend={LEGEND}
        barClassFor={(item) => (item.hasDates === false ? NO_DATES_BAR_CLASS : BAR_CLASS[item.source])}
        barTitleFor={(item) => (item.hasDates === false ? `${item.title} — 시작일, 종료일이 없습니다` : item.title)}
        onBarClick={(item) => setDialogTarget(item)}
        onNewClick={() => setDialogTarget('new')}
        emptyMessage="표시할 일정이 없습니다. 일감에 시작/종료일을 등록하거나 새 일정을 추가해 보세요."
      />

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
