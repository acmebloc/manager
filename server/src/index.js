import 'dotenv/config'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './middleware/auth.js'
import authRouter from './routes/auth.js'
import avatarRouter from './routes/avatar.js'
import dashboardRouter from './routes/dashboard.js'
import meRouter from './routes/me.js'
import myTasksRouter from './routes/myTasks.js'
import oidcRouter from './routes/oidc.js'
import projectCommentsRouter from './routes/projectComments.js'
import projectScheduleRouter from './routes/projectSchedule.js'
import projectsRouter from './routes/projects.js'
import publicProfileRouter from './routes/publicProfile.js'
import schedulesRouter from './routes/schedules.js'
import taskAttachmentsRouter from './routes/taskAttachments.js'
import taskCommentsRouter from './routes/taskComments.js'
import tasksRouter from './routes/tasks.js'
import usersRouter from './routes/users.js'

// Express 4 doesn't await route handlers, so a promise rejected inside one
// never reaches an error handler — it surfaces here instead, and Node's
// default for an unhandled rejection is to terminate. That means one
// transient DB hiccup takes the whole API down and kills every other
// in-flight request with it. The request that caused it is already lost
// (it never gets a response), but nobody else's has to be.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

// An uncaught exception is different: we're outside any promise chain and
// the process state can't be reasoned about any more. Log it and let pm2
// restart us — the one case where going down beats carrying on.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  process.exit(1)
})

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
// 홈 화면 전용 집계 — 프로젝트별 접근 제어와 무관하게 로그인한 모두에게 같은
// 숫자를 보여준다(dashboard.js 주석 참고).
app.use('/api/dashboard', requireAuth, dashboardRouter)
// Cross-project view of the caller's own tasks, grouped by project. Mounted
// before the nested task routes since it isn't scoped to one project.
app.use('/api/my-tasks', requireAuth, myTasksRouter)
app.use('/api/projects/:projectId/tasks/:taskId/attachments', requireAuth, taskAttachmentsRouter)
app.use('/api/projects/:projectId/tasks/:taskId/comments', requireAuth, taskCommentsRouter)
app.use('/api/projects/:projectId/tasks', requireAuth, tasksRouter)
app.use('/api/projects/:projectId/schedule', requireAuth, projectScheduleRouter)
app.use('/api/projects/:projectId/comments', requireAuth, projectCommentsRouter)
app.use('/api/projects', requireAuth, projectsRouter)
app.use('/api/schedules', requireAuth, schedulesRouter)
// No requireAuth here — the OIDC endpoints authenticate themselves (session
// cookie for /authorize, client_id/secret for /token, access token for
// /userinfo), since they're called by external parties (browser redirects,
// BookStack's own server), not our SPA's Bearer-token API calls.
app.use('/oidc', oidcRouter)

// Catches whatever a route throws synchronously or hands to next(err).
// Without it Express falls back to its own handler, which answers with the
// stack trace whenever NODE_ENV isn't 'production' — and nothing in the
// deploy sets NODE_ENV. Note this does not see async rejections: Express 4
// never awaits handlers, so those go to the process listener above instead.
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: '서버 오류가 발생했습니다' })
})

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`API listening on port ${port}`)
})
