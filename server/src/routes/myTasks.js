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
    where: {
      archivedAt: null,
      ...(req.user.isSiteAdmin ? {} : { members: { some: { userId: req.user.id } } }),
    },
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
          // 검수자는 화면에 안 보이지만 권한 판정에 필요하다 — taskPermissionFlags가
          // isMine(담당자 또는 검수자)과 allowedTransitions를 이 값으로 계산한다.
          reviewerId: true,
          endAt: true,
          createdAt: true,
          assignee: { select: { id: true, name: true, email: true, picture: true, deactivatedAt: true } },
          // 산출물 파일(reviewId 있음)은 첨부 개수에서 뺀다 — tasks.js의
          // taskInclude와 같은 조건이어야 두 목록의 배지 숫자가 일치한다.
          _count: { select: { attachments: { where: { reviewId: null } }, comments: true } },
          checklistItems: { select: { done: true } },
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
