import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { assertNotLastPm, isValidRole, normalizeRole, requireProjectRole } from '../lib/projectAccess.js'
import { assertDateOrder } from '../lib/taskFields.js'
import { deleteAttachmentFiles } from '../lib/uploads.js'
import { deleteProjectSpace, provisionProjectSpace, retryProjectSpace, syncMemberRole } from '../lib/bookstack.js'

const router = Router()

const memberSelect = {
  id: true,
  role: true,
  userId: true,
  user: { select: { id: true, name: true, email: true, picture: true, deactivatedAt: true } },
}

function decryptMember(member) {
  return { ...member, role: normalizeRole(member.role), user: decryptUser(member.user) }
}

function myRoleFor(project, user) {
  if (user.isSiteAdmin) return 'pm'
  const role = project.members.find((m) => m.userId === user.id)?.role
  return role ? normalizeRole(role) : null
}

// The site admin sees every project site-wide; everyone else only sees
// projects they're a member of.
router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: req.user.isSiteAdmin ? {} : { members: { some: { userId: req.user.id } } },
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: memberSelect },
      _count: { select: { tasks: true } },
    },
  })
  res.json(
    projects.map((project) => ({
      ...project,
      members: project.members.map(decryptMember),
      myRole: myRoleFor(project, req.user),
    })),
  )
})

// Any signed-in user can create a project, but creating it doesn't make you
// a member of it — the creator is only tracked for audit purposes (ownerId).
// A project needs at least one PM to be usable at all, so that's required
// up front rather than left to a follow-up step.
router.post('/', async (req, res) => {
  const { name, description, startAt, endAt, members = [] } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const dateProblem = assertDateOrder(startAt, endAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  if (!Array.isArray(members) || members.some((m) => !m?.userId || !isValidRole(m.role))) {
    return res.status(400).json({ error: 'members must be [{ userId, role }]' })
  }
  const userIds = members.map((m) => m.userId)
  if (new Set(userIds).size !== userIds.length) {
    return res.status(400).json({ error: 'Duplicate member userId' })
  }
  if (!members.some((m) => m.role === 'pm')) {
    return res.status(400).json({ error: 'At least one PM is required' })
  }

  const existingCount = await prisma.user.count({ where: { id: { in: userIds } } })
  if (existingCount !== userIds.length) {
    return res.status(400).json({ error: 'One or more members are not registered users' })
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      ownerId: req.user.id,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role })) },
    },
    include: { members: { select: memberSelect } },
  })

  // fire-and-forget — BookStack 공간 생성은 별도 프로세스라, 응답을 그 왕복
  // 시간에 묶어두지 않는다. 실패해도 project.bookstackSyncError에만 남는다.
  provisionProjectSpace(project.id)

  res.status(201).json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: myRoleFor(project, req.user),
  })
})

// PM이 누르는 "게시판 연동 재시도" — 아직 연동 전이면 처음부터, 이미 있으면
// 현재 멤버 전원의 역할 부여만 다시 맞춘다. 이번엔 결과를 바로 보여줘야 하므로
// (버튼 누른 사람이 성공/실패를 알아야 함) await한다.
router.post('/:id/bookstack-sync', requireProjectRole('pm'), async (req, res) => {
  try {
    const project = await retryProjectSpace(req.params.id)
    res.json({
      bookstackShelfId: project.bookstackShelfId,
      bookstackShelfSlug: project.bookstackShelfSlug,
      bookstackSyncedAt: project.bookstackSyncedAt,
      bookstackSyncError: project.bookstackSyncError,
    })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/:id', requireProjectRole('member'), async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      members: { select: memberSelect },
      _count: { select: { tasks: true } },
    },
  })
  res.json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: req.projectAccess.role,
  })
})

router.patch('/:id', requireProjectRole('pm'), async (req, res) => {
  const { name, description, startAt, endAt } = req.body

  // PATCH는 부분 수정이라, 이번 요청에서 안 건드리는 쪽은 req.projectAccess에
  // 이미 실려있는 현재 값으로 채워서 순서를 검사한다(tasks.js PATCH와 동일한
  // nextStartAt/nextEndAt 패턴) — 그래야 시작일만 바꿔서 기존 종료일보다
  // 뒤로 넘기는 것도 걸러진다.
  const nextStartAt = startAt !== undefined ? startAt : req.projectAccess.project.startAt
  const nextEndAt = endAt !== undefined ? endAt : req.projectAccess.project.endAt
  const dateProblem = assertDateOrder(nextStartAt, nextEndAt)
  if (dateProblem) return res.status(400).json({ error: dateProblem })

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
      ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
    },
    include: { members: { select: memberSelect } },
  })
  res.json({
    ...project,
    members: project.members.map(decryptMember),
    myRole: req.projectAccess.role,
  })
})

router.delete('/:id', requireProjectRole('pm'), async (req, res) => {
  // Cascade deletes the TaskAttachment rows, but not their disk files — clean
  // those up first (spec §5.4) since the project + its tasks are about to go.
  const attachments = await prisma.taskAttachment.findMany({
    where: { task: { projectId: req.params.id } },
    select: { storageKey: true },
  })
  await deleteAttachmentFiles(attachments.map((a) => a.storageKey))

  // BookStack 공간/문서함/역할도 정리 — 삭제 후엔 프로젝트 행이 없어져 재시도할
  // 대상이 없으므로 fire-and-forget이 아니라 await한다(실패해도 삭제는 진행됨).
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    select: { bookstackShelfId: true, bookstackBookIds: true, bookstackRoleId: true },
  })
  if (project) await deleteProjectSpace(project)

  await prisma.project.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

// --- members ---

router.get('/:id/members', requireProjectRole('member'), async (req, res) => {
  const members = await prisma.projectMember.findMany({
    where: { projectId: req.params.id },
    select: memberSelect,
    orderBy: { createdAt: 'asc' },
  })
  res.json(members.map(decryptMember))
})

// PM 지정 — 마이페이지의 "PM 넘기기" 레이어가 쓴다. 이미 멤버면 등급만
// 올리고 아니면 새로 들이므로, 클라이언트가 "이 사람이 멤버인가"를 먼저
// 확인한 뒤 POST/PATCH를 갈라 부를 필요가 없다(그 사이에 멤버 구성이 바뀌면
// 갈라친 판단이 틀어지기도 한다).
router.post('/:id/pm', requireProjectRole('pm'), async (req, res) => {
  const { userId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, deactivatedAt: true },
  })
  if (!user) return res.status(404).json({ error: 'User not found' })
  if (user.deactivatedAt) return res.status(400).json({ error: '탈퇴한 사용자입니다' })

  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.id, userId } },
    update: { role: 'pm' },
    create: { projectId: req.params.id, userId, role: 'pm' },
    select: memberSelect,
  })
  syncMemberRole(req.params.id, userId, 'add') // fire-and-forget
  res.json(decryptMember(member))
})

router.post('/:id/members', requireProjectRole('pl'), async (req, res) => {
  const { userId, role = 'other' } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

  // Assigning pm/pl ("등급 부여") is a PM-only power — a PL can only invite
  // people in at one of the four member-tier roles (plan/design/dev/other).
  if (req.projectAccess.role === 'pl' && (role === 'pm' || role === 'pl')) {
    return res.status(403).json({ error: 'PL은 PM/PL 등급으로 초대할 수 없습니다' })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) return res.status(404).json({ error: 'User not found' })

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: req.params.id, userId } },
  })
  if (existing) return res.status(409).json({ error: 'Already a member' })

  const member = await prisma.projectMember.create({
    data: { projectId: req.params.id, userId, role },
    select: memberSelect,
  })
  syncMemberRole(req.params.id, userId, 'add') // fire-and-forget
  res.status(201).json(decryptMember(member))
})

router.patch('/:id/members/:memberId', requireProjectRole('pm'), async (req, res) => {
  const { role } = req.body
  if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' })

  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })

  if (role !== 'pm') {
    const problem = await assertNotLastPm(req.params.id, member, req.projectAccess.viaSiteAdmin)
    if (problem) return res.status(400).json({ error: problem })
  }

  const updated = await prisma.projectMember.update({
    where: { id: req.params.memberId },
    data: { role },
    select: memberSelect,
  })
  res.json(decryptMember(updated))
})

router.delete('/:id/members/:memberId', requireProjectRole('pl'), async (req, res) => {
  const member = await prisma.projectMember.findFirst({
    where: { id: req.params.memberId, projectId: req.params.id },
  })
  if (!member) return res.status(404).json({ error: 'Not found' })

  const problem = await assertNotLastPm(req.params.id, member, req.projectAccess.viaSiteAdmin)
  if (problem) return res.status(400).json({ error: problem })

  await prisma.projectMember.delete({ where: { id: req.params.memberId } })
  syncMemberRole(req.params.id, member.userId, 'remove') // fire-and-forget
  res.status(204).end()
})

export default router
