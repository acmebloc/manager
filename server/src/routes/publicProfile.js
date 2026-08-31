import { Router } from 'express'
import { prisma } from '../db.js'
import { DEACTIVATED_USER_NAME, decryptField } from '../lib/fieldCrypto.js'

const router = Router()

// Public (no requireAuth) — lets external services (BookStack) read a
// user's current display name live, the same way /api/avatar mirrors the
// current picture, instead of a one-time copy taken at OIDC login time.
router.get('/:userId', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { name: true, deactivatedAt: true },
  })
  if (!user) return res.status(404).end()

  res.set('Cache-Control', 'no-cache')
  // 탈퇴자에게 빈 이름을 돌려주면 안 된다 — BookStack 쪽 패치가 falsy 응답을
  // 받으면 자기가 저장해둔 이름으로 폴백해서(docs/bookstack-patches.md §7),
  // 게시판에 탈퇴자의 실명이 그대로 남는다. 대체 이름을 명시적으로 내보낸다.
  res.json({ name: user.deactivatedAt ? DEACTIVATED_USER_NAME : decryptField(user.name) })
})

export default router
