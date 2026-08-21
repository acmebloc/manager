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
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, picture: true },
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
