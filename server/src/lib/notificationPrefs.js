import { prisma } from '../db.js'

// MyPage's 알림 설정 토글 (User.emailNotificationsEnabled) — checked before
// every notification email in taskComments.js/projectComments.js/tasks.js/
// schedules.js. Missing/true means enabled, matching the column's default.
export async function wantsEmailNotifications(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailNotificationsEnabled: true },
  })
  return user?.emailNotificationsEnabled !== false
}
