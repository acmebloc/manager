import 'dotenv/config'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { installAsyncErrorHandling } from './lib/expressAsyncErrors.js'
import { assertEnv } from './lib/envCheck.js'
import { startDueReminderJob } from './lib/dueReminderJob.js'
import { requireAuth } from './middleware/auth.js'
import authRouter from './routes/auth.js'
import avatarRouter from './routes/avatar.js'
import dashboardRouter from './routes/dashboard.js'
import meRouter from './routes/me.js'
import myTasksRouter from './routes/myTasks.js'
import notificationsRouter from './routes/notifications.js'
import oidcRouter from './routes/oidc.js'
import projectCommentsRouter from './routes/projectComments.js'
import projectExportRouter from './routes/projectExport.js'
import projectScheduleRouter from './routes/projectSchedule.js'
import projectsRouter from './routes/projects.js'
import publicProfileRouter from './routes/publicProfile.js'
import schedulesRouter from './routes/schedules.js'
import searchRouter from './routes/search.js'
import taskActivityRouter from './routes/taskActivity.js'
import taskAttachmentsRouter from './routes/taskAttachments.js'
import taskChecklistRouter from './routes/taskChecklist.js'
import taskCommentsRouter from './routes/taskComments.js'
import taskReviewsRouter from './routes/taskReviews.js'
import tasksRouter from './routes/tasks.js'
import usersRouter from './routes/users.js'

// 라우트를 하나라도 세우기 전에 확인한다 — 설정이 틀렸으면 반쯤 동작하는
// 서버로 뜨는 것보다 여기서 멈추는 편이 낫다.
assertEnv()

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

// URL에 널바이트(%00)가 섞이면 그 값이 그대로 Prisma로 들어가고 Postgres가
// 22021(invalid byte sequence for encoding "UTF8")로 거부한다. 그 예외는 async
// 라우트 핸들러 안에서 던져지는데 Express 4는 async 거부를 보지 않으므로(아래
// 에러 핸들러 주석 참고) **응답이 아예 안 나가고 요청이 매달린다** — 500도
// 아니고, 클라이언트가 스스로 포기할 때까지 소켓이 열려 있다.
//
// 라우트마다 try/catch를 다는 대신 입구에서 잘라낸다. 널바이트가 정당하게
// 들어올 경로는 이 API에 없으므로 통째로 400이 맞다.
app.use((req, res, next) => {
  if (req.originalUrl.includes('%00') || req.originalUrl.includes('\0')) {
    return res.status(400).json({ error: '잘못된 요청입니다' })
  }
  next()
})

app.use('/api/auth', authRouter)
// Public — serves the current profile picture by user id, no auth required
// (an <img src> can't send a Bearer header). See avatar.js for why.
app.use('/api/avatar', avatarRouter)
// Public — same reasoning as /api/avatar, but for the display name.
app.use('/api/public-profile', publicProfileRouter)
app.use('/api/me', requireAuth, meRouter)
app.use('/api/users', requireAuth, usersRouter)
app.use('/api/notifications', requireAuth, notificationsRouter)
// 홈 화면 전용 집계 — 프로젝트별 접근 제어와 무관하게 로그인한 모두에게 같은
// 숫자를 보여준다(dashboard.js 주석 참고).
app.use('/api/dashboard', requireAuth, dashboardRouter)
// Cross-project view of the caller's own tasks, grouped by project. Mounted
// before the nested task routes since it isn't scoped to one project.
app.use('/api/my-tasks', requireAuth, myTasksRouter)
app.use('/api/projects/:projectId/tasks/:taskId/attachments', requireAuth, taskAttachmentsRouter)
app.use('/api/projects/:projectId/tasks/:taskId/comments', requireAuth, taskCommentsRouter)
app.use('/api/projects/:projectId/tasks/:taskId/activity', requireAuth, taskActivityRouter)
app.use('/api/projects/:projectId/tasks/:taskId/checklist', requireAuth, taskChecklistRouter)
app.use('/api/projects/:projectId/tasks/:taskId/reviews', requireAuth, taskReviewsRouter)
app.use('/api/projects/:projectId/tasks', requireAuth, tasksRouter)
app.use('/api/projects/:projectId/schedule', requireAuth, projectScheduleRouter)
app.use('/api/projects/:projectId/comments', requireAuth, projectCommentsRouter)
app.use('/api/projects/:projectId/export', requireAuth, projectExportRouter)
app.use('/api/projects', requireAuth, projectsRouter)
app.use('/api/schedules', requireAuth, schedulesRouter)
app.use('/api/search', requireAuth, searchRouter)
// No requireAuth here — the OIDC endpoints authenticate themselves (session
// cookie for /authorize, client_id/secret for /token, access token for
// /userinfo), since they're called by external parties (browser redirects,
// BookStack's own server), not our SPA's Bearer-token API calls.
app.use('/oidc', oidcRouter)

// 미들웨어가 4xx로 던진 것은 그 상태 그대로 돌려준다. Express 관례대로
// err.status(또는 statusCode)를 보는데, body-parser처럼 http-errors를 쓰는
// 미들웨어가 이 규약을 따른다 — 깨진 JSON은 400, 본문이 100kb(express.json
// 기본값)를 넘으면 413이다. 전부 500으로 덮으면 **클라이언트가 고칠 수 있는
// 문제가 서버 장애로 보인다**: 실측으로 깨진 JSON이 500 "서버 오류가
// 발생했습니다"로 나갔고, 5xx 기준으로 보는 로그·알림에도 섞여 들어간다.
// lib/requestShapes.js가 잘못된 타입을 400으로 돌려주기로 한 것과 같은 방향이다.
//
// **메시지는 우리 문구로 덮는다.** http-errors의 message는 영문 기술 문구라
// ("Unexpected token } in JSON at position 5") 화면에 그대로 띄우면 깨져 보인다.
// 우리 코드에서 사용자에게 보일 문구가 필요하면 지금처럼 라우트가 직접
// res.status().json()으로 답한다 — 이 핸들러는 미들웨어가 던진 것만 다룬다.
//
// 5xx와 status 없는 에러는 그대로 500 + 일반 문구다. 내부 메시지를 흘리면
// 쿼리나 경로 같은 게 새어나간다.
const CLIENT_ERROR_MESSAGES = {
  400: '요청 형식이 올바르지 않습니다',
  413: '보낸 내용이 너무 큽니다',
  415: '지원하지 않는 형식입니다',
}

// Catches whatever a route throws synchronously or hands to next(err).
// Without it Express falls back to its own handler, which answers with the
// stack trace whenever NODE_ENV isn't 'production' — and nothing in the
// deploy sets NODE_ENV. Note this does not see async rejections: Express 4
// never awaits handlers, so those go to the process listener above instead.
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err)
  if (res.headersSent) return next(err)
  const status = Number(err?.status ?? err?.statusCode)
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: CLIENT_ERROR_MESSAGES[status] || '잘못된 요청입니다' })
  }
  res.status(500).json({ error: '서버 오류가 발생했습니다' })
})

// 별도 cron 인프라 없이 이 단일 pm2 프로세스 안에서 도는 주기 작업 — 부팅 시
// 1회 실행 후 자체 setInterval로 반복(dueReminderJob.js).
startDueReminderJob()

// 요청을 받기 시작하기 전에 붙인다. 라우트 등록 시점이 아니라 요청 처리 시점을
// 감싸는 패치라 라우터 import 순서와는 무관하다 — listen보다 앞이기만 하면 된다.
const asyncErrorsPatched = await installAsyncErrorHandling()

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`API listening on port ${port} (async 거부 패치: ${asyncErrorsPatched ? 'on' : 'OFF'})`)
})
