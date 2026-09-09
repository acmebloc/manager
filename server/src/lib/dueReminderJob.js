import { prisma } from '../db.js'
import { decryptUser } from './fieldCrypto.js'
import { notifyDueSoon } from './mailer.js'
import { createNotification } from './notifications.js'
import { wantsEmailNotifications } from './notificationPrefs.js'

// 고정 상수 — 마감 D-3부터 D-day까지 매일, 하루 1회 한국시간 오전 10시 스캔.
// 설정 UI/환경변수는 두지 않는다.
const REMINDER_MAX_DAYS_BEFORE = 3
const SCAN_HOUR_KST = 10
const DAY_MS = 24 * 60 * 60 * 1000
// 서버 OS의 로컬 타임존이 무엇이든(배포 환경이 UTC일 수도 있다) "한국 시간
// 기준 하루/오전 10시"가 되도록, Date의 로컬 타임존 의존 메서드
// (setHours/getHours 등) 대신 UTC 오프셋을 직접 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 어떤 시각이 한국시간으로 몇 번째 "날"인지 — 자정 기준 날짜 경계 비교와
// 남은 일수 계산에 그대로 뺄셈으로 쓸 수 있는 정수.
function kstDayIndex(date) {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS)
}

function kstDayStart(dayIndex) {
  return new Date(dayIndex * DAY_MS - KST_OFFSET_MS)
}

function nextScanAt(now = new Date()) {
  const todayIndex = kstDayIndex(now)
  const scanInstant = new Date(kstDayStart(todayIndex).getTime() + SCAN_HOUR_KST * 60 * 60 * 1000)
  return scanInstant > now ? scanInstant : new Date(scanInstant.getTime() + DAY_MS)
}

const personSelect = { id: true, name: true, email: true, picture: true, deactivatedAt: true }

// 리마인더는 지금 "공을 들고 있는 사람"에게 간다 — 검수중이면 검수자, 그 외에는
// 담당자다(docs/task-review-spec.md 5장). 검수중인데 검수자가 없는 옛 데이터는
// 담당자에게 그대로 보낸다(아무에게도 안 가는 것보다 낫다).
function reminderRecipient(task) {
  if (task.status === 'review' && task.reviewerId) return { userId: task.reviewerId, user: task.reviewer }
  return { userId: task.assigneeId, user: task.assignee }
}

// endAt이 "오늘부터 +3일"(D-3~D-day) 사이에 들어오고, 완료되지 않았고 받을 사람이
// 있는 일감을 매일 훑는다. `dueReminderLastDaysLeft`에 "마지막으로 보낸 날의
// 남은 일수"를 저장해두고, 오늘 계산한 남은 일수와 다르면(=오늘 치를 아직 안
// 보냈으면) 보낸다 — 그래서 D-3/D-2/D-1/D-day에 각각 한 번씩, 한 일감당 최대
// 4번 보낸다. 같은 날 스캔이 두 번 돌아도(재시작 등) 값이 같으므로 중복 발송은
// 안 된다. endAt이 바뀌면(tasks.js) 이 값이 null로 리셋돼 새 마감일 기준으로
// 사이클이 처음부터 다시 돈다.
export async function runDueReminderScan(now = new Date()) {
  const todayIndex = kstDayIndex(now)
  const rangeStart = kstDayStart(todayIndex)
  const rangeEnd = new Date(kstDayStart(todayIndex + REMINDER_MAX_DAYS_BEFORE).getTime() + DAY_MS - 1)

  const tasks = await prisma.task.findMany({
    where: {
      endAt: { gte: rangeStart, lte: rangeEnd },
      status: { not: 'done' },
      // 아래 reminderRecipient가 받을 사람을 찾아내는 경우와 정확히 같은
      // 집합이다 — 담당자가 있거나, 검수중이면서 검수자가 있는 일감. 조건을
      // 느슨하게 잡으면(예: reviewerId만 있는 대기 일감) 읽어온 뒤 그냥 버리는
      // 행이 생기고, 조건과 recipient 함수가 서로 어긋나기 쉬워진다.
      OR: [{ assigneeId: { not: null } }, { status: 'review', reviewerId: { not: null } }],
      // 프로젝트가 보관되면 리마인더도 멈춘다 — 대시보드/일정 목록과 동일하게
      // 취급(archivedAt: null 필터 없이는 보관 후에도 계속 메일이 나감).
      project: { archivedAt: null },
    },
    select: {
      id: true,
      projectId: true,
      title: true,
      status: true,
      assigneeId: true,
      reviewerId: true,
      endAt: true,
      dueReminderLastDaysLeft: true,
      project: { select: { name: true } },
      assignee: { select: personSelect },
      reviewer: { select: personSelect },
    },
  })

  for (const task of tasks) {
    const daysLeft = kstDayIndex(task.endAt) - todayIndex
    if (daysLeft === task.dueReminderLastDaysLeft) continue
    const { userId, user } = reminderRecipient(task)
    // 위 where와 이 함수가 같은 집합을 보므로 여기서 걸릴 일은 없지만, 둘이
    // 어긋나면 decryptUser(null)로 스캔 전체가 죽으니 방어는 남겨둔다.
    if (!userId) continue
    try {
      const link = `/tasks/${task.projectId}/${task.id}`
      const message = `"${task.project.name}", "${task.title}" 일감이 마감일까지 ${daysLeft}일 남았어요. 꼭 확인 부탁드려요.`
      await createNotification({
        userId,
        type: 'task_due_soon',
        title: message,
        link,
      })
      if (await wantsEmailNotifications(userId)) {
        await notifyDueSoon({
          to: decryptUser(user).email,
          projectName: task.project.name,
          taskTitle: task.title,
          link,
          daysLeft,
        })
      }
      await prisma.task.update({ where: { id: task.id }, data: { dueReminderLastDaysLeft: daysLeft } })
    } catch (err) {
      console.error('[dueReminderJob] failed for task', { taskId: task.id, error: err.message })
    }
  }
}

// 하루 1회, 한국시간 오전 10시에만 스캔한다. 이 배포엔 다른 백그라운드 작업
// 인프라(cron 등)가 전혀 없어, 단일 pm2 프로세스 안에서 다음 오전 10시까지
// setTimeout으로 기다렸다가(부팅 시점엔 즉시 실행하지 않는다 — 배포/재시작마다
// 매번 스캔이 도는 걸 막기 위해서다), 그 뒤로는 24시간 주기 setInterval로
// 반복한다. 한국은 서머타임이 없어 24시간 고정 주기로도 계속 오전 10시에
// 맞아떨어진다.
export function startDueReminderJob() {
  const delay = nextScanAt().getTime() - Date.now()
  setTimeout(() => {
    runDueReminderScan().catch((err) => console.error('[dueReminderJob] scan failed', err))
    setInterval(() => {
      runDueReminderScan().catch((err) => console.error('[dueReminderJob] scan failed', err))
    }, DAY_MS)
  }, delay)
}
