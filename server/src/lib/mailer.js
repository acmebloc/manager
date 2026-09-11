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

const FOOTER = '본 메일은 발신 전용입니다. 회신되지 않습니다.'

function notify({ to, subject, heading, link, linkLabel }) {
  const url = link ? `${process.env.FRONTEND_ORIGIN}${link}` : null
  const text = [heading, url, FOOTER].filter(Boolean).join('\n\n')
  const html = `<p>${heading}</p>${url ? `<p><a href="${url}">${linkLabel}</a></p>` : ''}<p style="color:#888;font-size:12px">${FOOTER}</p>`
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

export function notifyReviewerAssigned({ to, actorName, taskTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 검수자로 지정되었습니다`,
    heading: `${actorName}님이 회원님을 "${taskTitle}" 일감의 검수자로 지정했습니다.`,
    link,
    linkLabel: '일감 보러 가기',
  })
}

// 검수 흐름의 세 이벤트(docs/task-review-spec.md 5장) — 공을 넘겨받는 쪽에만
// 보낸다. 검수요청은 검수자에게, 반려/최종완료는 담당자에게.
export function notifyReviewRequested({ to, actorName, taskTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 검수를 요청받았습니다`,
    heading: `${actorName}님이 "${taskTitle}" 일감의 검수를 요청했습니다.`,
    link,
    linkLabel: '검수하러 가기',
  })
}

export function notifyReviewRejected({ to, actorName, taskTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 검수가 반려되었습니다`,
    heading: `${actorName}님이 "${taskTitle}" 일감의 검수를 반려했습니다. 반려 사유를 확인해주세요.`,
    link,
    linkLabel: '일감 보러 가기',
  })
}

export function notifyReviewApproved({ to, actorName, taskTitle, link }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 검수가 완료되었습니다`,
    heading: `${actorName}님이 "${taskTitle}" 일감의 검수를 완료 처리했습니다.`,
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

// 사람이 아니라 마감 리마인더 스캔(dueReminderJob.js)이 직접 트리거하는
// 시스템성 알림이라 actorName이 없다.
export function notifyDueSoon({ to, projectName, taskTitle, link, daysLeft }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 마감일까지 ${daysLeft}일 남았습니다`,
    heading: `"${projectName}", "${taskTitle}" 일감이 마감일까지 ${daysLeft}일 남았어요. 꼭 확인 부탁드려요.`,
    link,
    linkLabel: '일감 바로가기',
  })
}

// 마감이 지난 뒤의 알림. 같은 스캔이 보내지만 문구를 나눈다 — "-3일 남았어요"로
// 읽히면 무슨 뜻인지 한 번 더 생각해야 한다.
export function notifyOverdue({ to, projectName, taskTitle, link, daysPast }) {
  return notify({
    to,
    subject: `[Manager] "${taskTitle}" 마감일이 ${daysPast}일 지났습니다`,
    heading: `"${projectName}", "${taskTitle}" 일감이 마감일에서 ${daysPast}일 지났어요. 확인 부탁드려요.`,
    link,
    linkLabel: '일감 바로가기',
  })
}
