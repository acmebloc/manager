import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptField } from '../lib/fieldCrypto.js'

const router = Router()

// 사진이 없을 때 대신 내보내는 회색 실루엣. 404를 주면 이걸 <img>로 걸어둔
// 게시판에 깨진 이미지 아이콘이 뜬다 — publicProfile.js가 탈퇴자에게 빈 이름
// 대신 "비활성화된 사용자"를 명시적으로 돌려주는 것과 같은 이유로, 여기서도
// "없음"을 그림으로 표현해서 돌려준다.
const PLACEHOLDER_AVATAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" fill="#e5e7eb"/>
  <circle cx="32" cy="25" r="11" fill="#9ca3af"/>
  <path d="M8 64c0-13.3 10.7-24 24-24s24 10.7 24 24z" fill="#9ca3af"/>
</svg>`

function sendPlaceholder(res) {
  res.set('Content-Type', 'image/svg+xml')
  return res.send(PLACEHOLDER_AVATAR)
}

// Public (no requireAuth) — an <img src> request can't carry a Bearer
// header. This is what BookStack's User::getAvatar() points at for OIDC
// users, so its avatar always reflects whatever picture is currently set
// here, instead of a one-time copy.
router.get('/:userId', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { picture: true, deactivatedAt: true },
  })
  // 없는 사용자는 그대로 404 — 그건 정말 없는 것이고, 자리표시자를 주면
  // 아무 id에나 그럴듯한 아바타가 생긴다.
  if (!user) return res.status(404).end()

  res.set('Cache-Control', 'no-cache')

  // 탈퇴자는 사진을 실제로 지우므로(me.js) 아래 !picture에도 걸리지만,
  // 명시적으로 먼저 처리한다 — 나중에 탈퇴 처리가 사진을 남기게 바뀌더라도
  // 게시판에 탈퇴자 얼굴이 다시 뜨지 않도록.
  if (user.deactivatedAt) return sendPlaceholder(res)

  const picture = decryptField(user.picture)
  if (!picture) return sendPlaceholder(res)

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/.exec(picture)
  if (dataUrlMatch) {
    const [, contentType, base64Data] = dataUrlMatch
    res.set('Content-Type', contentType)
    return res.send(Buffer.from(base64Data, 'base64'))
  }

  // A real external URL (e.g. Google's default profile picture).
  res.redirect(picture)
})

export default router
