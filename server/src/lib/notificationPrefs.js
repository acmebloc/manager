import { prisma } from '../db.js'

// MyPage's 알림 설정 토글 (User.emailNotificationsEnabled) — checked before
// every notification email in taskComments.js/projectComments.js/tasks.js/
// schedules.js. Missing/true means enabled, matching the column's default.
export async function wantsEmailNotifications(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailNotificationsEnabled: true, deactivatedAt: true },
  })
  // 탈퇴자는 이메일 주소 자체가 비워져 있어 보낼 곳이 없다. 담당자로 남아있는
  // 일감이 수정되는 등으로 여기까지 오는 경로가 실제로 있으므로 명시적으로 막는다.
  if (user?.deactivatedAt) return false
  return user?.emailNotificationsEnabled !== false
}
