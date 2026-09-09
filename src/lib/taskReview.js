import { apiFetch, apiUpload } from './api'

// Mirrors server/src/lib/taskReview.js — 손으로 동기화한다(taskFields.js의
// 라벨 복제와 같은 이유). 이 사본은 즉각적인 입력 피드백만 담당하고, 실제
// 제약은 서버가 다시 검증한다.
export const MAX_REVIEW_LINKS = 5

export const REVIEW_KIND_LABELS = { request: '검수요청', reject: '반려', approve: '최종완료' }

// 검수 이력 종류별 색. 검수요청은 중립, 반려는 붉게, 최종완료는 초록 — 이력을
// 훑을 때 "어디서 막혔나"가 먼저 눈에 들어와야 한다.
export const REVIEW_KIND_CLASS = {
  request: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  reject: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  approve: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}

// 서버(normalizeReviewLinks)와 같은 규칙: 스킴이 없으면 https://를 붙이고,
// http/https 외의 스킴과 호스트 없는 주소는 거부한다.
export function normalizeReviewLink(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { error: '링크를 입력해주세요' }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return { error: '링크 형식이 올바르지 않습니다' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: '링크는 http 또는 https 주소만 등록할 수 있습니다' }
  }
  if (!url.hostname) return { error: '링크 형식이 올바르지 않습니다' }
  return { link: withScheme }
}

// 상태 변경 + (필요하면) 검수 이력 등록 + 산출물 파일 업로드를 한 흐름으로 묶는다.
// 파일이 2단계인 이유는 이력이 먼저 존재해야 붙일 수 있기 때문이다 — 서버가
// PATCH 응답에 createdReviewId를 실어주므로 곧바로 이어서 올린다.
//
// 파일만 실패한 경우를 예외로 던지지 않고 uploadError로 돌려주는 게 중요하다:
// 상태 변경 자체는 이미 커밋됐으므로, 호출부가 낙관적 업데이트를 되돌려버리면
// 화면이 서버와 어긋난다. 사용자는 검수 이력에서 파일만 다시 첨부하면 된다.
export async function submitStatusChange(projectId, taskId, { status, review, reviewerId, file }) {
  const body = {
    status,
    ...(review && { review }),
    ...(reviewerId !== undefined && { reviewerId }),
  }
  const task = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body })

  let uploadError = ''
  if (file && task.createdReviewId) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      await apiUpload(
        `/api/projects/${projectId}/tasks/${taskId}/reviews/${task.createdReviewId}/attachment`,
        formData,
      )
    } catch (err) {
      uploadError = `상태는 변경됐지만 산출물 파일 업로드에 실패했어요(${err.message}). 검수 이력에서 다시 첨부해주세요`
    }
  }
  return { task, uploadError }
}
