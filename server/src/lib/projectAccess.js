import { prisma } from '../db.js'

// viewer reads; member also writes tasks/schedules; admin also edits the
// project and manages members. Ranked so a check can ask for a minimum.
export const ROLES = ['viewer', 'member', 'admin']
const RANK = { viewer: 1, member: 2, admin: 3 }

export function isValidRole(role) {
  return ROLES.includes(role)
}

// Membership is the single source of truth — the owner gets an 'admin' row
// when the project is created, so nothing here special-cases them. isOwner
// still matters for the two things only an owner may do: delete the project,
// and avoid being removed or demoted by another admin.
export async function getProjectAccess(projectId, userId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { where: { userId }, select: { role: true } } },
  })
  if (!project) return null

  const membership = project.members[0]
  if (!membership) return null

  return {
    project,
    role: membership.role,
    isOwner: project.ownerId === userId,
  }
}

// Non-members get 404 rather than 403, so the API doesn't confirm that a
// project id exists to someone with no access to it.
export function requireProjectRole(minRole) {
  return async (req, res, next) => {
    const projectId = req.params.projectId || req.params.id
    const access = await getProjectAccess(projectId, req.user.id)
    if (!access) return res.status(404).json({ error: 'Not found' })
    if (RANK[access.role] < RANK[minRole]) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    req.projectAccess = access
    next()
  }
}
