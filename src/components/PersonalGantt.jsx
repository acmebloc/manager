import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { computeYearRange } from '../lib/ganttDates'
import GanttChart from './GanttChart'
import ScheduleItemDialog from './ScheduleItemDialog'

// 내가 만든 일정(인디고)과 남이 만들고 나를 참조자로 태그한 일정(앰버)을
// 색으로 구분 — 프로젝트 간트차트의 일감/기타 색 구분과 같은 언어. 반복
// 일정 회차는(누구 소유든) 보라색으로 덮어써서, 프로젝트 간트차트와 같은
// 시각 언어("보라색=반복")를 유지한다.
const BAR_CLASS = {
  mine: 'bg-indigo-500 hover:bg-indigo-400',
  other: 'bg-amber-500 hover:bg-amber-400',
}
const RECURRING_BAR_CLASS = 'bg-purple-500 hover:bg-purple-400'

const LEGEND = [
  { key: 'mine', label: '내 일정', className: 'bg-indigo-500' },
  { key: 'other', label: '참조된 일정', className: 'bg-amber-500' },
  { key: 'recurring', label: '반복 일정', className: 'bg-purple-500' },
]

function barClassFor(item) {
  if (item.isRecurring) return RECURRING_BAR_CLASS
  return BAR_CLASS[item.canModify ? 'mine' : 'other']
}

function barTitleFor(item) {
  return item.isRecurring ? `${item.title} (반복 일정)` : item.title
}

// 프로젝트에 속하지 않는 개인 일정표 — 프로젝트 간트차트(ProjectGantt)와
// 같은 GanttChart를 쓰되, 표시 범위는 항상 올해 1/1~12/31이고 항목은
// 내가 만든 일정 + 참조자로 등록된(남이 만든) 일정을 합친 것이다.
function PersonalGantt() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogTarget, setDialogTarget] = useState(null) // null=닫힘, 'new'=생성, item=수정

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/schedules?personalOnly=true')
      setItems(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const range = useMemo(() => computeYearRange(items), [items])

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
        barClassFor={barClassFor}
        barTitleFor={barTitleFor}
        onBarClick={(item) => setDialogTarget(item)}
        onNewClick={() => setDialogTarget('new')}
        emptyMessage="등록된 개인 일정이 없습니다. 새 일정을 추가해 보세요."
      />

      {dialogTarget && (
        <ScheduleItemDialog
          projectId={null}
          item={dialogTarget === 'new' ? null : dialogTarget}
          onClose={() => setDialogTarget(null)}
          onDone={onDialogDone}
        />
      )}
    </div>
  )
}

export default PersonalGantt
