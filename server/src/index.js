import 'dotenv/config'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './middleware/auth.js'
import authRouter from './routes/auth.js'
import avatarRouter from './routes/avatar.js'
import meRouter from './routes/me.js'
import myTasksRouter from './routes/myTasks.js'
import oidcRouter from './routes/oidc.js'
import projectsRouter from './routes/projects.js'
import publicProfileRouter from './routes/publicProfile.js'
import schedulesRouter from './routes/schedules.js'
import tasksRouter from './routes/tasks.js'
import usersRouter from './routes/users.js'

const app = express()

app.use(cors({ origin: process.env.FRONTEND_ORIGIN }))
app.use(express.json())
app.use(cookieParser())

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/api/auth', authRouter)
// Public — serves the current profile picture by user id, no auth required
// (an <img src> can't send a Bearer header). See avatar.js for why.
app.use('/api/avatar', avatarRouter)
// Public — same reasoning as /api/avatar, but for the display name.
app.use('/api/public-profile', publicProfileRouter)
app.use('/api/me', requireAuth, meRouter)
app.use('/api/users', requireAuth, usersRouter)
// Cross-project view of the caller's own tasks, grouped by project. Mounted
// before the nested task routes since it isn't scoped to one project.
app.use('/api/my-tasks', requireAuth, myTasksRouter)
app.use('/api/projects/:projectId/tasks', requireAuth, tasksRouter)
app.use('/api/projects', requireAuth, projectsRouter)
app.use('/api/schedules', requireAuth, schedulesRouter)
// No requireAuth here — the OIDC endpoints authenticate themselves (session
// cookie for /authorize, client_id/secret for /token, access token for
// /userinfo), since they're called by external parties (browser redirects,
// BookStack's own server), not our SPA's Bearer-token API calls.
app.use('/oidc', oidcRouter)

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`API listening on port ${port}`)
})
