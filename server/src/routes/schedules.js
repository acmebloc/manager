import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { getProjectAccess } from '../lib/projectAccess.js'
import { assertDateOrder } from '../lib/taskFields.js'

const router = Router()

const userSelect = { id: true, name: true, email: true, picture: true }

const scheduleInclude = {
  owner: { select: userSelect },
  project: { select: { id: true, name: true } },
  followers: { select: { user: { select: userSelect } } },
}

function decryptSchedule(schedule) {
  return {
    ...schedule,
    owner: decryptUser(schedule.owner),
    followers: schedule.followers.map((f) => decryptUser(f.user)),
  }
}

// A project-tied schedule is shared with the whole project (spec: "일정표는
// 프로젝트 참여자 모두 추가/수정/삭제 가능") — any member may edit or delete it,
// not just whoever created it. A personal schedule (no project) stays private
// to its owner, same as before.
async function canModifySchedule(schedule, user) {
  if (user.isSiteAdmin) return true
  if (!schedule.projectId) return schedule.ownerId === user.id
  const access = await getProjectAccess(schedule.projectId, user)
  return Boolean(access)
}

// Followers ("참조자") on a project schedule only make sense among people who
// can actually see it, same reasoning as assignee-must-be-member for tasks
// (tasks.js's assertAssigneeIsMember).
async function assertFollowersAreMembers(projectId, followerIds) {
  if (!Array.isArray(followerIds) || followerIds.length === 0) return null
  const members = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: followerIds } },
    select: { userId: true },
  })
  return members.length === followerIds.length ? null : 'Followers must be members of this project'
}

// A personal schedule has no project to scope followers to — any registered
// user can be tagged (picked via /api/users search, not a member list) — so
// this only checks the ids are real.
async function assertFollowersExist(followerIds) {
  if (!Array.isArray(followerIds) || followerIds.length === 0) return null
  const users = await prisma.user.findMany({
    where: { id: { in: followerIds } },
    select: { id: true },
  })
  return users.length === followerIds.length ? null : 'Followers must be existing users'
}

async function setFollowers(scheduleId, followerIds) {
  await prisma.$transaction([
    prisma.scheduleFollower.deleteMany({ where: { scheduleId } }),
    ...(followerIds.length > 0
      ? [
          prisma.scheduleFollower.createMany({
            data: followerIds.map((userId) => ({ scheduleId, userId })),
          }),
        ]
      : []),
  ])
}

// A schedule is visible if you own it, or if it belongs to a project you're
// on — a project milestone is no use if only its author can see it. Personal
// schedules (no project) stay private to their owner.
function visibleToUser(userId, memberProjectIds) {
  return {
    OR: [{ ownerId: userId }, { projectId: { in: memberProjectIds } }],
  }
}

async function memberProjectIds(userId) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  })
  return memberships.map((m) => m.projectId)
}

router.get('/', async (req, res) => {
  const { projectId, personalOnly } = req.query

  // Backs the /schedule page's 개인 일정 chart — schedules the caller owns,
  // plus ones someone else made and tagged them as a follower on (spec: "참조된
  // 사람이 있을 경우, 참조자 일정표에도 같은 일정이 등록"). Not scoped to
  // site-admin status — that reach is about *other people's* project
  // schedules, not everyone's personal ones. `canModify` tells the client
  // whether this is a personal schedule of mine (fully editable) or one I'm
  // just following (read-only) — see canModifySchedule for why only the
  // owner may edit a personal schedule.
  if (personalOnly === 'true') {
    const schedules = await prisma.schedule.findMany({
      where: {
        projectId: null,
        OR: [{ ownerId: req.user.id }, { followers: { some: { userId: req.user.id } } }],
      },
      orderBy: { startAt: 'asc' },
      include: scheduleInclude,
    })
    return res.json(
      schedules.map((s) => ({ ...decryptSchedule(s), canModify: s.ownerId === req.user.id })),
    )
  }

  // The site admin sees every project's schedules, not just ones they
  // belong to — same site-wide reach as the project list.
  if (req.user.isSiteAdmin) {
    const schedules = await prisma.schedule.findMany({
      where: { ...(projectId && { projectId }) },
      orderBy: { startAt: 'asc' },
      include: scheduleInclude,
    })
    return res.json(schedules.map(decryptSchedule))
  }

  const projectIds = await memberProjectIds(req.user.id)
  if (projectId && !projectIds.includes(projectId)) {
    return res.status(404).json({ error: 'Project not found' })
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      ...visibleToUser(req.user.id, projectIds),
      ...(projectId && { projectId }),
    },
    orderBy: { startAt: 'asc' },
    include: scheduleInclude,
  })
  res.json(schedules.map(decryptSchedule))
})

router.post('/', async (req, res) => {
  const { title, startAt, endAt, projectId, followerIds = [] } = req.body
  if (!title || !startAt) {
    return res.status(400).json({ error: 'title and startAt are required' })
  }
  // A project schedule is a bar on the project's Gantt chart, so it needs
  // an end date to occupy a range — only the personal schedule form leaves
  // this optional.
  if (projectId && !endAt) {
    return res.status(400).json({ error: 'endAt is required for a project schedule' })
  }
  const dateProblem = assertDateOrder(startAt, endAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  // Attaching a schedule to a project shares it with that project's
  // members, so the caller has to be one of them. Every project role can
  // do this now — there's no read-only tier within a project anymore.
  if (projectId) {
    const access = await getProjectAccess(projectId, req.user)
    if (!access) return res.status(404).json({ error: 'Project not found' })
  }
  const followerProblem = projectId
    ? await assertFollowersAreMembers(projectId, followerIds)
    : await assertFollowersExist(followerIds)
  if (followerProblem) return res.status(400).json({ error: followerProblem })

  const schedule = await prisma.schedule.create({
    data: {
      title,
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      projectId: projectId || null,
      ownerId: req.user.id,
    },
  })
  if (followerIds.length > 0) await setFollowers(schedule.id, followerIds)

  const withIncludes = await prisma.schedule.findUnique({ where: { id: schedule.id }, include: scheduleInclude })
  res.status(201).json(decryptSchedule(withIncludes))
})

// Anyone on the schedule's project may edit or delete it (spec: "일정표는
// 프로젝트 참여자 모두 추가/수정/삭제 가능"); a personal (no-project) schedule
// stays owner-only. See canModifySchedule above.
router.patch('/:id', async (req, res) => {
  const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  // 404, not 403 — someone with no access to this schedule (not its owner,
  // not on its project) shouldn't be able to tell it exists at all, same
  // convention as requireProjectRole's null-access branch (projectAccess.js).
  if (!(await canModifySchedule(existing, req.user))) {
    return res.status(404).json({ error: 'Not found' })
  }

  const { title, startAt, endAt, projectId, followerIds } = req.body
  const nextProjectId = projectId !== undefined ? projectId || null : existing.projectId
  const nextStartAt = startAt !== undefined ? startAt : existing.startAt
  const nextEndAt = endAt !== undefined ? endAt : existing.endAt
  if (nextProjectId && !nextEndAt) {
    return res.status(400).json({ error: 'endAt is required for a project schedule' })
  }
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  if (nextProjectId) {
    const access = await getProjectAccess(nextProjectId, req.user)
    if (!access) return res.status(404).json({ error: 'Project not found' })
  }
  if (followerIds !== undefined) {
    const followerProblem = nextProjectId
      ? await assertFollowersAreMembers(nextProjectId, followerIds)
      : await assertFollowersExist(followerIds)
    if (followerProblem) return res.status(400).json({ error: followerProblem })
  }

  await prisma.schedule.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(startAt !== undefined && { startAt: new Date(startAt) }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
      ...(projectId !== undefined && { projectId: projectId || null }),
    },
  })
  if (followerIds !== undefined) await setFollowers(req.params.id, followerIds)

  const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id }, include: scheduleInclude })
  res.json(decryptSchedule(schedule))
})

router.delete('/:id', async (req, res) => {
  const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  // 404, not 403 — someone with no access to this schedule (not its owner,
  // not on its project) shouldn't be able to tell it exists at all, same
  // convention as requireProjectRole's null-access branch (projectAccess.js).
  if (!(await canModifySchedule(existing, req.user))) {
    return res.status(404).json({ error: 'Not found' })
  }
  await prisma.schedule.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
