import { prisma } from '../db.js'

// 'plan'/'design'/'dev'/'other' all work tasks/schedules the same way (the
// old single 'member' tier, split by job function — see ProjectMember.role
// in schema.prisma); 'pl' can also invite and remove members (always at one
// of those four); 'pm' can also edit/delete the project and set anyone's
// role. Ranked so a check can ask for a minimum.
//
// 'member' is deliberately kept as a RANK entry even though it's no longer
// assignable (excluded from ROLES) — requireProjectRole('member') is called
// all over the route layer as the name of the lowest threshold, not as an
// actual stored role value. Dropping it here would make every one of those
// calls compare against `undefined` and reject everyone.
export const ROLES = ['pm', 'pl', 'plan', 'design', 'dev', 'other']
const RANK = { pm: 3, pl: 2, plan: 1, design: 1, dev: 1, other: 1, member: 1 }

export function isValidRole(role) {
  return ROLES.includes(role)
}

// Legacy ProjectMember rows can still carry the retired 'member' value —
// never bulk-migrated (see the role field's comment in schema.prisma), only
// normalized wherever a role reaches the outside world. Rank-wise it makes
// no difference ('member' and 'other' are both rank 1), but every consumer
// of a role value used for display should go through this so 'member' never
// leaks past this layer.
export function normalizeRole(role) {
  return role === 'member' ? 'other' : role
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

  return { project, role: normalizeRole(membership.role), viaSiteAdmin: false }
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
