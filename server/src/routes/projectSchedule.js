import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { requireProjectRole } from '../lib/projectAccess.js'

// Mounted at /api/projects/:projectId/schedule — backs the project Gantt
// chart (일정 메뉴). Merges two sources into one row list:
//  - "task" rows are computed live from Task.startAt/endAt, never stored
//    separately — so there's nothing to keep in sync when a task's dates
//    change (see schedule feature plan, "핵심 설계 결정").
//  - "other" rows are real Schedule records tied to this project.
const router = Router({ mergeParams: true })

const userSelect = { id: true, name: true, email: true, picture: true }

router.get('/', requireProjectRole('member'), async (req, res) => {
  const [tasks, schedules] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: req.params.projectId, startAt: { not: null }, endAt: { not: null } },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
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
      followers,
    }
  })

  const otherItems = schedules.map((s) => ({
    source: 'other',
    id: s.id,
    title: s.title,
    startAt: s.startAt,
    endAt: s.endAt,
    owner: decryptUser(s.owner),
    followers: s.followers.map((f) => decryptUser(f.user)),
  }))

  const items = [...taskItems, ...otherItems].sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
  res.json(items)
})

export default router
