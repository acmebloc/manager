import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { taskPermissionFlags } from '../lib/taskPermissions.js'

const router = Router()

// Backs the 일감관리 screen: every task published to a project the caller
// belongs to (not just ones assigned to them — "내 일감만 보기" is a
// client-side toggle instead, see spec §4.1/§9), grouped by project so the
// UI doesn't have to stitch the two lists together. Projects with no tasks
// are still included, so the screen shows every project you're on.
router.get('/', async (req, res) => {
  // Same isSiteAdmin bypass as projects.js's GET / — the site admin sees
  // every project's board site-wide, membership or not.
  const projects = await prisma.project.findMany({
    where: req.user.isSiteAdmin ? {} : { members: { some: { userId: req.user.id } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      members: { select: { userId: true, role: true } },
      tasks: {
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          type: true,
          grade: true,
          status: true,
          createdById: true,
          assigneeId: true,
          endAt: true,
          createdAt: true,
          assignee: { select: { id: true, name: true, email: true, picture: true, deactivatedAt: true } },
          _count: { select: { attachments: true, comments: true } },
        },
      },
    },
  })

  res.json(
    projects.map((project) => {
      const memberIds = new Set(project.members.map((m) => m.userId))
      const myMembership = project.members.find((m) => m.userId === req.user.id)
      // Same synthetic-'pm' rule as getProjectAccess (projectAccess.js) — the
      // site admin counts as admin everywhere without needing a real row.
      const projectAccess = { role: req.user.isSiteAdmin ? 'pm' : myMembership?.role }
      return {
        projectId: project.id,
        projectName: project.name,
        tasks: project.tasks.map((task) => ({
          ...task,
          assignee: task.assignee ? decryptUser(task.assignee) : null,
          assigneeIsMember: task.assigneeId ? memberIds.has(task.assigneeId) : true,
          ...taskPermissionFlags(task, req.user, projectAccess),
        })),
      }
    }),
  )
})

export default router
