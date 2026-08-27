import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { notifyScheduleFollower } from '../lib/mailer.js'
import { wantsEmailNotifications } from '../lib/notificationPrefs.js'
import { getProjectAccess } from '../lib/projectAccess.js'
import { clampRecurrenceEndAt, expandOccurrences, isValidRecurrenceInterval } from '../lib/scheduleRecurrence.js'
import { assertDateOrder } from '../lib/taskFields.js'

const router = Router()

const userSelect = { id: true, name: true, email: true, picture: true }

const scheduleInclude = {
  owner: { select: userSelect },
  project: { select: { id: true, name: true } },
  followers: { select: { user: { select: userSelect } } },
  overrides: true,
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

// 새로 참조자로 등록된 사람에게만 메일 — 기존 참조자를 그대로 둔 수정에는
// 다시 보내지 않는다. 본인을 참조자로 등록한 경우도 스킵.
async function notifyNewFollowers({ schedule, actor, newUserIds }) {
  if (newUserIds.size === 0) return
  const link = schedule.projectId ? `/schedule?projectId=${schedule.projectId}` : '/schedule'
  for (const follower of schedule.followers) {
    if (!newUserIds.has(follower.user.id) || follower.user.id === actor.id) continue
    if (!(await wantsEmailNotifications(follower.user.id))) continue
    const recipient = decryptUser(follower.user)
    notifyScheduleFollower({
      to: recipient.email,
      actorName: actor.name,
      scheduleTitle: schedule.title,
      link,
    })
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
      schedules
        .map((s) => ({ ...decryptSchedule(s), canModify: s.ownerId === req.user.id }))
        .flatMap(expandOccurrences),
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
    return res.json(schedules.map(decryptSchedule).flatMap(expandOccurrences))
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
  res.json(schedules.map(decryptSchedule).flatMap(expandOccurrences))
})

// recurrence: { intervalWeeks: 1|2|3|4, endAt } — validates the interval and
// clamps endAt to the 52-week safety cap (clampRecurrenceEndAt). Returns
// null (not recurring) or { recurrenceIntervalWeeks, recurrenceEndAt } to
// spread into the create/update data, or a string error message.
function parseRecurrence(recurrence, startAt) {
  if (!recurrence) return { data: { recurrenceIntervalWeeks: null, recurrenceEndAt: null } }
  if (!isValidRecurrenceInterval(recurrence.intervalWeeks)) {
    return { error: 'recurrence.intervalWeeks must be 1, 2, 3, or 4' }
  }
  if (!recurrence.endAt) return { error: 'recurrence.endAt is required' }
  const dateProblem = assertDateOrder(startAt, recurrence.endAt)
  if (dateProblem) return { error: dateProblem }
  return {
    data: {
      recurrenceIntervalWeeks: recurrence.intervalWeeks,
      recurrenceEndAt: clampRecurrenceEndAt(startAt, recurrence.endAt),
    },
  }
}

router.post('/', async (req, res) => {
  const { title, startAt, endAt, projectId, followerIds = [], recurrence } = req.body
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

  const recurrenceResult = parseRecurrence(recurrence, startAt)
  if (recurrenceResult.error) return res.status(400).json({ error: recurrenceResult.error })

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
      ...recurrenceResult.data,
    },
  })
  if (followerIds.length > 0) await setFollowers(schedule.id, followerIds)

  const withIncludes = await prisma.schedule.findUnique({ where: { id: schedule.id }, include: scheduleInclude })
  notifyNewFollowers({ schedule: withIncludes, actor: req.user, newUserIds: new Set(followerIds) })
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

  const { title, startAt, endAt, projectId, followerIds, recurrence } = req.body
  const nextProjectId = projectId !== undefined ? projectId || null : existing.projectId
  const nextStartAt = startAt !== undefined ? startAt : existing.startAt
  const nextEndAt = endAt !== undefined ? endAt : existing.endAt
  if (nextProjectId && !nextEndAt) {
    return res.status(400).json({ error: 'endAt is required for a project schedule' })
  }
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  // "전체 반복 일정 수정" — 시리즈 규칙 자체를 바꾼다(또는 recurrence:null로
  // 반복을 해제한다). 이미 개별적으로 수정/삭제된 회차(override)는 그대로
  // 유지된다 — 다음 조회에서도 override가 우선하므로 여기서 손댈 필요 없음.
  let recurrenceData
  if (recurrence !== undefined) {
    const recurrenceResult = parseRecurrence(recurrence, nextStartAt)
    if (recurrenceResult.error) return res.status(400).json({ error: recurrenceResult.error })
    recurrenceData = recurrenceResult.data
  }

  if (nextProjectId) {
    const access = await getProjectAccess(nextProjectId, req.user)
    if (!access) return res.status(404).json({ error: 'Project not found' })
  }
  let oldFollowerIds = new Set()
  if (followerIds !== undefined) {
    const followerProblem = nextProjectId
      ? await assertFollowersAreMembers(nextProjectId, followerIds)
      : await assertFollowersExist(followerIds)
    if (followerProblem) return res.status(400).json({ error: followerProblem })

    const oldFollowers = await prisma.scheduleFollower.findMany({
      where: { scheduleId: req.params.id },
      select: { userId: true },
    })
    oldFollowerIds = new Set(oldFollowers.map((f) => f.userId))
  }

  await prisma.schedule.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(startAt !== undefined && { startAt: new Date(startAt) }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
      ...(projectId !== undefined && { projectId: projectId || null }),
      ...recurrenceData,
    },
  })
  if (followerIds !== undefined) await setFollowers(req.params.id, followerIds)

  const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id }, include: scheduleInclude })
  if (followerIds !== undefined) {
    const newUserIds = new Set(followerIds.filter((id) => !oldFollowerIds.has(id)))
    notifyNewFollowers({ schedule, actor: req.user, newUserIds })
  }
  res.json(decryptSchedule(schedule))
})

function parseOccurrenceIndex(raw) {
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : null
}

// "이 회차만 수정" — 시리즈 규칙(root)은 그대로 두고, 이 회차 하나만 다른
// 제목/날짜를 쓰도록 예외를 만들거나 갱신한다. 참조자는 회차별로 나뉘지
// 않고 항상 시리즈를 따르므로 여기서 다루지 않는다. 권한은 "전체 수정"과
// 동일 — 시리즈(root)를 고칠 수 있는 사람이면 회차 하나도 고칠 수 있다.
router.patch('/:id/occurrences/:index', async (req, res) => {
  const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
  if (!existing || !existing.recurrenceIntervalWeeks) return res.status(404).json({ error: 'Not found' })
  if (!(await canModifySchedule(existing, req.user))) return res.status(404).json({ error: 'Not found' })

  const occurrenceIndex = parseOccurrenceIndex(req.params.index)
  if (occurrenceIndex === null) return res.status(400).json({ error: 'Invalid occurrence index' })

  const { title, startAt, endAt } = req.body
  if (!title || !startAt) return res.status(400).json({ error: 'title and startAt are required' })
  const dateProblem = assertDateOrder(startAt, endAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  const overrideData = {
    title,
    startAt: new Date(startAt),
    endAt: endAt ? new Date(endAt) : null,
    deleted: false,
  }
  await prisma.scheduleOccurrenceOverride.upsert({
    where: { scheduleId_occurrenceIndex: { scheduleId: req.params.id, occurrenceIndex } },
    create: { scheduleId: req.params.id, occurrenceIndex, ...overrideData },
    update: overrideData,
  })

  const schedule = await prisma.schedule.findUnique({ where: { id: req.params.id }, include: scheduleInclude })
  const item = expandOccurrences(decryptSchedule(schedule)).find((i) => i.occurrenceIndex === occurrenceIndex)
  res.json(item)
})

// "이 회차만 삭제" — override를 deleted=true로 남겨 이 회차만 건너뛴다.
// 시리즈의 다른 회차나 "전체 삭제"(아래, root 자체를 지우는 것)에는
// 영향 없다.
router.delete('/:id/occurrences/:index', async (req, res) => {
  const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } })
  if (!existing || !existing.recurrenceIntervalWeeks) return res.status(404).json({ error: 'Not found' })
  if (!(await canModifySchedule(existing, req.user))) return res.status(404).json({ error: 'Not found' })

  const occurrenceIndex = parseOccurrenceIndex(req.params.index)
  if (occurrenceIndex === null) return res.status(400).json({ error: 'Invalid occurrence index' })

  await prisma.scheduleOccurrenceOverride.upsert({
    where: { scheduleId_occurrenceIndex: { scheduleId: req.params.id, occurrenceIndex } },
    create: { scheduleId: req.params.id, occurrenceIndex, deleted: true },
    update: { deleted: true },
  })
  res.status(204).end()
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
