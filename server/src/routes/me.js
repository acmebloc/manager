import { Router } from 'express'
import { prisma } from '../db.js'
import { syncMemberRole } from '../lib/bookstack.js'
import { decryptUser, encryptField } from '../lib/fieldCrypto.js'

const router = Router()

// mypage의 이미지 피커(resizeImageFile)는 항상 data URL만 보낸다 — 로그인 때
// Google이 채워준 최초 picture(실제 외부 URL)는 auth.js가 직접 DB에 쓰기 때문에
// 이 라우트를 거치지 않는다. 그래서 여기서 임의의 외부 URL을 받아줄 이유가
// 없고, 받아주면 avatar.js의 res.redirect(picture) 경로가 그대로 오픈
// 리다이렉트가 된다(누구든 자기 picture를 아무 URL로나 바꾸면, 인증도 안 거는
// 공개 /api/avatar/:userId가 그리로 튕겨준다).
const DATA_URL_PICTURE_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/

// Lets the signed-in user update their own display name and/or profile
// picture, persisting the mypage edit to the DB instead of just the
// browser's local cache.
router.patch('/', async (req, res) => {
  const { name, picture, emailNotificationsEnabled } = req.body
  if (picture !== undefined && picture !== null && !DATA_URL_PICTURE_PATTERN.test(picture)) {
    return res.status(400).json({ error: 'picture must be an uploaded image' })
  }
  const data = {}
  if (name !== undefined) data.name = encryptField(name)
  if (picture !== undefined) data.picture = encryptField(picture)
  if (emailNotificationsEnabled !== undefined) data.emailNotificationsEnabled = Boolean(emailNotificationsEnabled)
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'name, picture, or emailNotificationsEnabled is required' })
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data })
  res.json(decryptUser(user))
})

// 회원탈퇴. 행을 지우지 않고 개인정보만 비운다 — 자세한 이유는 schema.prisma의
// User.deactivatedAt 주석 참고(작성물 FK가 RESTRICT/SET NULL이라 삭제하면
// 아예 막히거나 작성자·담당자가 날아간다).
//
// 남는 것: 프로젝트·일감·일정·댓글·첨부와 그 작성자/담당자 연결.
// 지우는 것: 이름·이메일·사진(실제 삭제), 프로젝트 멤버십, 일정 참조자 등록.
router.delete('/', async (req, res) => {
  // 사이트 관리자는 유일하고(파샬 유니크 인덱스) 관리자 없는 서비스를 만들 수
  // 없으므로 탈퇴를 막는다. 넘기려면 DB에서 직접 다른 사람에게 옮겨야 한다.
  if (req.user.isSiteAdmin) {
    return res.status(400).json({ error: '사이트 관리자는 탈퇴할 수 없습니다' })
  }

  // 내가 유일한 PM인 프로젝트가 있으면 막는다 — 나가고 나면 그 프로젝트를
  // 수정·삭제하거나 멤버를 관리할 사람이 아무도 없어진다(사이트 관리자 제외).
  const myPmProjects = await prisma.projectMember.findMany({
    where: { userId: req.user.id, role: 'pm' },
    select: { projectId: true, project: { select: { name: true } } },
  })
  if (myPmProjects.length > 0) {
    const counts = await prisma.projectMember.groupBy({
      by: ['projectId'],
      where: { projectId: { in: myPmProjects.map((m) => m.projectId) }, role: 'pm' },
      _count: { projectId: true },
    })
    const solePmOf = myPmProjects
      .filter((m) => counts.find((c) => c.projectId === m.projectId)?._count.projectId === 1)
      .map((m) => m.project.name)

    if (solePmOf.length > 0) {
      return res.status(409).json({
        error: `${solePmOf.join(', ')} 프로젝트의 유일한 PM입니다. 다른 PM을 지정한 뒤 탈퇴해주세요.`,
        solePmProjects: solePmOf,
      })
    }
  }

  const memberships = await prisma.projectMember.findMany({
    where: { userId: req.user.id },
    select: { projectId: true },
  })

  await prisma.$transaction([
    prisma.projectMember.deleteMany({ where: { userId: req.user.id } }),
    prisma.scheduleFollower.deleteMany({ where: { userId: req.user.id } }),
    prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: encryptField(''),
        email: encryptField(''),
        picture: null,
        deactivatedAt: new Date(),
      },
    }),
  ])

  // 게시판 쪽 프로젝트 역할도 회수 — fire-and-forget(projects.js의 멤버 제외와
  // 같은 방식). 실패해도 Manager 쪽 탈퇴는 이미 끝난 상태다.
  for (const m of memberships) syncMemberRole(m.projectId, req.user.id, 'remove')

  // 로그아웃과 같은 쿠키 정리 — 이게 없으면 /oidc/authorize가 여전히 유효한
  // 쿠키를 보고 게시판에 다시 로그인시켜준다.
  res.clearCookie('manager_session', { path: '/' })
  res.status(204).end()
})

export default router
