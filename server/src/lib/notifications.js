import { prisma } from '../db.js'

// 이메일(mailer.js)과 별개로 항상 적재되는 인앱 알림 — emailNotificationsEnabled와
// 무관하다. 호출부(담당자 지정/멘션/일정 참조자/마감 리마인더)가 대부분
// fire-and-forget으로 부르므로, 실패해도 그 요청의 응답을 막지 않도록 여기서
// 삼킨다(mailer.js의 sendMail과 동일한 이유).
export async function createNotification({ userId, actorId, type, title, link }) {
  if (!userId || userId === actorId) return
  try {
    await prisma.notification.create({
      data: { userId, actorId: actorId || null, type, title, link },
    })
  } catch (err) {
    console.error('[notify:inapp] createNotification failed', { userId, type, error: err.message })
  }
}
