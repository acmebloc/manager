import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import { expandOccurrences } from '../lib/scheduleRecurrence.js'

// Mounted at /api/projects/:projectId/schedule — backs the project Gantt
// chart (일정 메뉴). Merges two sources into one row list:
//  - "task" rows are computed live from Task.startAt/endAt, never stored
//    separately — so there's nothing to keep in sync when a task's dates
//    change (see schedule feature plan, "핵심 설계 결정"). A task with no
//    dates at all still gets a row — `hasDates: false`, with the raw (null)
//    startAt/endAt passed through as-is; the client falls back to
//    `createdAt` for a one-day placeholder bar purely for display (규칙 1/2/4)
//    — nothing here ever writes that placeholder date back to the task.
//  - "other" rows are real Schedule records tied to this project, which
//    always carry real dates (`endAt` is required for a project schedule).
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }

router.get('/', requireProjectRole('member'), async (req, res) => {
  const [tasks, schedules] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: req.params.projectId },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        createdBy: { select: userSelect },
        assignee: { select: userSelect },
      },
    }),
    prisma.schedule.findMany({
      where: { projectId: req.params.projectId },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        recurrenceIntervalWeeks: true,
        recurrenceEndAt: true,
        overrides: true,
        owner: { select: userSelect },
        followers: { select: { user: { select: userSelect } } },
      },
    }),
  ])

  const taskItems = tasks.map((t) => {
    const followers = []
    const seen = new Set()
    for (const u of [t.createdBy, t.assignee]) {
      if (u && !seen.has(u.id)) {
        seen.add(u.id)
        followers.push(decryptUser(u))
      }
    }
    return {
      source: 'task',
      id: t.id,
      taskId: t.id,
      title: t.title,
      startAt: t.startAt,
      endAt: t.endAt,
      createdAt: t.createdAt,
      hasDates: Boolean(t.startAt && t.endAt),
      followers,
    }
  })

  const otherItems = schedules.flatMap((s) =>
    expandOccurrences({
      source: 'other',
      id: s.id,
      title: s.title,
      startAt: s.startAt,
      endAt: s.endAt,
      hasDates: true,
      recurrenceIntervalWeeks: s.recurrenceIntervalWeeks,
      recurrenceEndAt: s.recurrenceEndAt,
      overrides: s.overrides,
      owner: decryptUser(s.owner),
      followers: s.followers.map((f) => decryptUser(f.user)),
    }),
  )

  // 날짜 있는 항목 먼저(실제 시작일 오름차순), 없는 항목은 전부 맨 아래에
  // 등록일 오름차순으로 (스펙 규칙 6/7 — 날짜가 생기는 순간 다음 조회에서
  // 자연히 제자리로 재배치된다, 별도 상태 불필요).
  const items = [...taskItems, ...otherItems].sort((a, b) => {
    if (a.hasDates !== b.hasDates) return a.hasDates ? -1 : 1
    return new Date(a.startAt || a.createdAt) - new Date(b.startAt || b.createdAt)
  })
  res.json(items)
})

export default router
