import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './middleware/auth.js'
import authRouter from './routes/auth.js'
import boardRouter from './routes/board.js'
import meRouter from './routes/me.js'
import projectsRouter from './routes/projects.js'
import schedulesRouter from './routes/schedules.js'
import tasksRouter from './routes/tasks.js'

const app = express()

app.use(cors({ origin: process.env.FRONTEND_ORIGIN }))
app.use(express.json())

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/api/auth', authRouter)
app.use('/api/me', requireAuth, meRouter)
app.use('/api/projects/:projectId/tasks', requireAuth, tasksRouter)
app.use('/api/projects', requireAuth, projectsRouter)
app.use('/api/schedules', requireAuth, schedulesRouter)
app.use('/api/board', requireAuth, boardRouter)

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`API listening on port ${port}`)
})
