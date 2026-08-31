import { Router } from 'express'
import { prisma } from '../db.js'
import { countPublishedPages } from '../lib/bookstack.js'
import { expandOccurrences } from '../lib/scheduleRecurrence.js'

const router = Router()

const STATUSES = ['todo', 'doing', 'review', 'done']

function startOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

// 홈 화면 전용 — 소속 프로젝트나 할당된 일감이 하나도 없는 사용자도 서비스
// 전체 규모를 볼 수 있어야 한다는 취지라, 프로젝트별 접근 제어
// (requireProjectRole)와 무관하게 로그인한 모든 사용자에게 항상 같은
// 숫자를 돌려준다. 건수만 집계할 뿐 프로젝트명·일감 내용 등 상세는
// 포함하지 않는다.
router.get('/stats', async (req, res) => {
  const weekStart = startOfWeek(new Date())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const [projectCount, publishedPageCount, tasksByStatus, schedules] = await Promise.all([
    prisma.project.count(),
    countPublishedPages(),
    prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
    // 반복 일정은 규칙만 저장되고 회차는 조회 시점에 계산되므로(scheduleRecurrence.js),
    // "이번 주" 여부도 회차를 펼쳐본 뒤에야 알 수 있다 — 이번 주 것만 골라내려고
    // 사전 필터링하기보다, 이 규모(사내 도구)에서는 무리 없는 전체 조회 후
    // 펼쳐서 걸러내는 쪽을 택했다.
    prisma.schedule.findMany({
      select: { startAt: true, endAt: true, recurrenceIntervalWeeks: true, recurrenceEndAt: true, overrides: true },
    }),
  ])

  const tasksByStatusMap = Object.fromEntries(STATUSES.map((status) => [status, 0]))
  for (const row of tasksByStatus) {
    if (row.status in tasksByStatusMap) tasksByStatusMap[row.status] = row._count._all
  }

  const thisWeekScheduleCount = schedules
    .flatMap(expandOccurrences)
    .filter((occ) => occ.startAt >= weekStart && occ.startAt < weekEnd).length

  res.json({
    projectCount,
    publishedPageCount,
    taskTotal: STATUSES.reduce((sum, status) => sum + tasksByStatusMap[status], 0),
    tasksByStatus: tasksByStatusMap,
    thisWeekScheduleCount,
  })
})

export default router
