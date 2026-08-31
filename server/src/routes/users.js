import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'

const router = Router()

// The company directory, for member and assignee pickers. Everyone signed in
// can see it — this is an internal tool where knowing your colleagues exist
// is the point.
//
// Filtering happens here rather than in the query because email and name are
// encrypted with a random IV per row, so the same text encrypts differently
// every time and SQL can't match on it. Fine at company headcount; if the
// directory ever gets large this needs a searchable hash column instead.
router.get('/', async (req, res) => {
  // 탈퇴한 사람은 목록에서 제외 — 이 디렉터리는 멤버 초대·담당자 지정·멘션
  // 피커의 후보 목록이라, 탈퇴자가 뜨면 다시 배정할 수 있게 돼버린다. 이미
  // 배정돼 있던 건은 그대로 두고 "비활성화된 사용자"로 보인다(§decryptUser).
  const users = await prisma.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, name: true, email: true, picture: true, deactivatedAt: true },
  })

  const decrypted = users.map(decryptUser)
  const query = (req.query.q || '').trim().toLowerCase()
  const matches = query
    ? decrypted.filter(
        (user) =>
          user.name?.toLowerCase().includes(query) || user.email?.toLowerCase().includes(query),
      )
    : decrypted

  matches.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  res.json(matches)
})

export default router
