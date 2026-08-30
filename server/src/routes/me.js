import { Router } from 'express'
import { prisma } from '../db.js'
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

export default router
