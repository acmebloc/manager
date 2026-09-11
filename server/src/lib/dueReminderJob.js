import { prisma } from '../db.js'
import { decryptUser } from './fieldCrypto.js'
import { notifyDueSoon, notifyOverdue } from './mailer.js'
import { createNotification } from './notifications.js'
import { wantsEmailNotifications } from './notificationPrefs.js'

// 고정 상수 — 마감 D-3부터 D-day까지 매일, 마감이 지난 뒤에는 D+1/D+3/D+7과
// 그 뒤 주 1회(shouldRemindOverdue). 하루 1회 한국시간 오전 10시 스캔.
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

// 마감이 지난 뒤에는 **D+1, D+3, D+7에 보내고 그 뒤로는 주 1회**다(사용자 결정).
//
// 매일 보내면 오래 밀린 일감이 메일함을 잠기게 하고, 그러면 곧 통째로 무시당해
// 알림 자체가 무의미해진다. 반대로 한 번만 보내면 그 메일을 놓쳤을 때 다시
// 알릴 방법이 없다. 초반에 촘촘하고 뒤로 갈수록 성기게 두는 이유다.
function shouldRemindOverdue(daysPast) {
  if (daysPast === 1 || daysPast === 3) return true
  return daysPast >= 7 && daysPast % 7 === 0
}

// 마감이 D+3 이내로 다가왔거나 **이미 지난** 일감 중, 완료되지 않았고 받을
// 사람이 있는 것을 매일 훑는다.
//
// 중복 발송은 `dueReminderLastDaysLeft` 하나로 막는다 — "마지막으로 보낸 날의
// 남은 일수"를 넣어두고 오늘 계산한 값과 다를 때만 보낸다. 마감이 지난 뒤에는
// 이 값이 **음수**(D+3이면 -3)라 같은 비교가 그대로 통한다. 그래서 컬럼을 새로
// 만들지 않았다. 같은 날 스캔이 두 번 돌아도(재시작 등) 값이 같아 다시 보내지
// 않고, endAt이 바뀌면(tasks.js) null로 리셋돼 새 마감일 기준으로 다시 돈다.
//
// 보내는 시점: 마감 전 D-3/D-2/D-1/D-day 각 1회, 마감 후 D+1/D+3/D+7과 그 뒤
// 주 1회. 마감 전에는 공을 들고 있는 사람만, 마감 후에는 PM도 함께 받는다.
export async function runDueReminderScan(now = new Date()) {
  const todayIndex = kstDayIndex(now)
  const rangeEnd = new Date(kstDayStart(todayIndex + REMINDER_MAX_DAYS_BEFORE).getTime() + DAY_MS - 1)

  const tasks = await prisma.task.findMany({
    where: {
      // 아래 경계(rangeEnd = D+3의 끝)까지만 본다 — 그보다 먼 미래는 아직 알릴
      // 때가 아니다. **과거 쪽은 열어둔다**: 마감이 지난 일감도 알려야 하기
      // 때문이다(shouldRemindOverdue가 보낼 날인지 가린다). 완료됐거나 받을
      // 사람이 없거나 보관된 프로젝트는 아래 조건에서 빠지므로, 오래된 행이
      // 무한정 쌓여 스캔이 무거워지지는 않는다.
      endAt: { not: null, lte: rangeEnd },
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

  // 마감이 지난 알림은 PM도 함께 받는다(사용자 결정). 일감마다 조회하지 않고
  // 이번 스캔에 걸린 프로젝트의 PM을 한 번에 읽어 프로젝트별로 묶어둔다.
  const pmsByProject = new Map()
  const overdueProjectIds = [
    ...new Set(tasks.filter((t) => kstDayIndex(t.endAt) - todayIndex < 0).map((t) => t.projectId)),
  ]
  if (overdueProjectIds.length > 0) {
    const rows = await prisma.projectMember.findMany({
      where: { projectId: { in: overdueProjectIds }, role: 'pm' },
      select: { projectId: true, userId: true, user: { select: personSelect } },
    })
    for (const row of rows) {
      if (!pmsByProject.has(row.projectId)) pmsByProject.set(row.projectId, [])
      pmsByProject.get(row.projectId).push({ userId: row.userId, user: row.user })
    }
  }

  for (const task of tasks) {
    const daysLeft = kstDayIndex(task.endAt) - todayIndex
    if (daysLeft === task.dueReminderLastDaysLeft) continue
    const overdue = daysLeft < 0
    if (overdue && !shouldRemindOverdue(-daysLeft)) continue
    const holder = reminderRecipient(task)
    // 위 where와 이 함수가 같은 집합을 보므로 여기서 걸릴 일은 없지만, 둘이
    // 어긋나면 decryptUser(null)로 스캔 전체가 죽으니 방어는 남겨둔다.
    if (!holder.userId) continue

    // 마감 전에는 공을 들고 있는 사람에게만 간다(기존 동작). 마감이 지난 뒤에만
    // PM이 더해진다 — PM이 곧 담당자·검수자면 두 번 보내지 않는다.
    const recipients = [holder]
    if (overdue) {
      for (const pm of pmsByProject.get(task.projectId) || []) {
        if (!recipients.some((r) => r.userId === pm.userId)) recipients.push(pm)
      }
    }

    try {
      const link = `/tasks/${task.projectId}/${task.id}`
      const message = overdue
        ? `"${task.project.name}", "${task.title}" 일감이 마감일에서 ${-daysLeft}일 지났어요. 확인 부탁드려요.`
        : `"${task.project.name}", "${task.title}" 일감이 마감일까지 ${daysLeft}일 남았어요. 꼭 확인 부탁드려요.`

      for (const { userId, user } of recipients) {
        await createNotification({
          userId,
          type: overdue ? 'task_overdue' : 'task_due_soon',
          title: message,
          link,
        })
        if (!(await wantsEmailNotifications(userId))) continue
        const mail = { to: decryptUser(user).email, projectName: task.project.name, taskTitle: task.title, link }
        if (overdue) await notifyOverdue({ ...mail, daysPast: -daysLeft })
        else await notifyDueSoon({ ...mail, daysLeft })
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
