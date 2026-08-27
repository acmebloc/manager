import nodemailer from 'nodemailer'

// docs/email-notifications-spec.md 2장 — Google Workspace SMTP 릴레이(안 B).
// 계정 인증 없이 이 서버의 고정 퍼블릭 IP로 인증되므로 SMTP_USER/PASS는 없다.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
    })
  : null

// SMTP_HOST가 없는 환경(로컬 개발)에서는 실제 발송 대신 콘솔에만 남긴다
// (spec 4장) — 별도 로컬 SMTP catcher 없이 발송 훅을 그대로 개발/확인할 수 있다.
// 실패해도 절대 호출부의 API 응답을 막지 않도록 여기서 에러를 삼킨다.
async function sendMail({ to, subject, text, html }) {
  if (!to) return
  if (!transporter) {
    console.log(`[mail:dev] to=${to} subject=${subject}\n${text}`)
    return
  }
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html })
  } catch (err) {
    console.error('[mail] send failed', { to, subject, error: err.message })
  }
}

function notify({ to, subject, heading, link, linkLabel }) {
  const url = link ? `${process.env.FRONTEND_ORIGIN}${link}` : null
  const text = [heading, url].filter(Boolean).join('\n\n')
  const html = `<p>${heading}</p>${url ? `<p><a href="${url}">${linkLabel}</a></p>` : ''}`
  return sendMail({ to, subject, text, html })
}

export function notifyMention({ to, actorName, contextLabel, link }) {
  return notify({
    to,
    subject: `[Manager] ${actorName}님이 회원님을 멘션했습니다`,
    heading: `${actorName}님이 ${contextLabel}에서 회원님을 멘션했습니다.`,
    link,
    linkLabel: '댓글 보러 가기',
  })
}

export function notifyAssigned({ to, actorName, taskTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 담당자로 지정되었습니다`,
    heading: `${actorName}님이 회원님을 "${taskTitle}" 일감의 담당자로 지정했습니다.`,
    link,
    linkLabel: '일감 보러 가기',
  })
}

export function notifyScheduleFollower({ to, actorName, scheduleTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${scheduleTitle}" 일정 참조자로 등록되었습니다`,
    heading: `${actorName}님이 회원님을 "${scheduleTitle}" 일정의 참조자로 등록했습니다.`,
    link,
    linkLabel: '일정 보러 가기',
  })
}
