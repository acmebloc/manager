import { Router } from 'express'
import { prisma } from '../db.js'

const router = Router()

// Backs the 일감관리 screen: tasks assigned to the caller across every
// project they belong to, already grouped by project so the UI doesn't have
// to stitch the two lists together. Projects with nothing assigned are
// included, so the screen still shows which projects you're on.
router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: req.user.id } } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tasks: {
        where: { assigneeId: req.user.id },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          createdAt: true,
        },
      },
    },
  })

  res.json(
    projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      tasks: project.tasks,
    })),
  )
})

export default router
