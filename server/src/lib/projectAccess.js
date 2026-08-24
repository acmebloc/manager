import { prisma } from '../db.js'

// 'member' works tasks/schedules like everyone else; 'pl' can also invite
// and remove members (always as plain 'member'); 'pm' can also edit/delete
// the project and set anyone's role. Ranked so a check can ask for a minimum.
export const ROLES = ['member', 'pl', 'pm']
const RANK = { member: 1, pl: 2, pm: 3 }

export function isValidRole(role) {
  return ROLES.includes(role)
}

// The site admin (exactly one, enforced by a DB partial unique index — see
// User.isSiteAdmin) has full authority over every project whether or not
// they're a member of it, so this returns synthetic 'pm' access rather than
// requiring a ProjectMember row to exist.
export async function getProjectAccess(projectId, user) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { where: { userId: user.id }, select: { role: true } } },
  })
  if (!project) return null

  if (user.isSiteAdmin) {
    return { project, role: 'pm', viaSiteAdmin: true }
  }

  const membership = project.members[0]
  if (!membership) return null

  return { project, role: membership.role, viaSiteAdmin: false }
}

// Non-members get 404 rather than 403, so the API doesn't confirm that a
// project id exists to someone with no access to it.
export function requireProjectRole(minRole) {
  return async (req, res, next) => {
    const projectId = req.params.projectId || req.params.id
    const access = await getProjectAccess(projectId, req.user)
    if (!access) return res.status(404).json({ error: 'Not found' })
    // An unrecognised role ranks as 0, i.e. no access. Without the fallback
    // it would be `undefined < n`, which is false, so a stale or misspelled
    // role string would sail through every check including pm-only ones.
    if ((RANK[access.role] ?? 0) < RANK[minRole]) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    req.projectAccess = access
    next()
  }
}

// A project must always have someone who can manage it. Called before
// removing a member or changing their role away from 'pm' — the site admin
// is exempt, since they can always fix an "orphaned" project themselves.
export async function assertNotLastPm(projectId, member, viaSiteAdmin) {
  if (viaSiteAdmin || member.role !== 'pm') return null
  const otherPmCount = await prisma.projectMember.count({
    where: { projectId, role: 'pm', id: { not: member.id } },
  })
  return otherPmCount === 0 ? '프로젝트에는 최소 1명의 PM이 있어야 합니다' : null
}
