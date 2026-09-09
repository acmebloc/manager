// 검수 이력(TaskReview)의 값 검증·가공. 라우트(routes/taskReviews.js, tasks.js의
// 상태 전이)와 검색(search.js)이 공유한다. DB에는 접근하지 않는다.

// 검색 결과 뱃지 문구 — 화면에 뜨는 이력 종류 라벨(src/lib/taskReview.js)과 달리
// "무엇이 검색됐는지"를 가리키므로 reject는 '반려'가 아니라 '반려사유'다(사용자
// 확인). approve는 본문이 없어 검색 대상이 아니다.
export const REVIEW_SEARCH_LABELS = { request: '검수요청', reject: '반려사유' }

export const MAX_REVIEW_LINKS = 5

// 산출물 링크는 사용자가 입력한 문자열을 그대로 저장하되(정규화된 URL로 바꿔
// 저장하면 'example.com/a' 가 'https://example.com/a' 로 보이는 게 아니라
// 'https://example.com/a' 로 되돌아오지 않아 헷갈린다) 다음만 손본다:
//   - 스킴이 없으면 https:// 를 붙인다
//   - http/https 외의 스킴은 거부한다 (javascript: 등이 링크로 렌더되면 XSS)
//   - 호스트가 없는 주소는 거부한다
function normalizeReviewLinks(input) {
  if (input === undefined || input === null) return { links: [] }
  if (!Array.isArray(input)) return { error: '산출물 링크 형식이 올바르지 않습니다' }

  const links = []
  for (const raw of input) {
    if (typeof raw !== 'string') return { error: '산출물 링크 형식이 올바르지 않습니다' }
    const trimmed = raw.trim()
    if (!trimmed) continue

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    let url
    try {
      url = new URL(withScheme)
    } catch {
      return { error: `링크 형식이 올바르지 않습니다: ${trimmed}` }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: `링크는 http 또는 https 주소만 등록할 수 있습니다: ${trimmed}` }
    }
    if (!url.hostname) return { error: `링크 형식이 올바르지 않습니다: ${trimmed}` }
    links.push(withScheme)
  }

  const unique = [...new Set(links)]
  if (unique.length > MAX_REVIEW_LINKS) {
    return { error: `산출물 링크는 최대 ${MAX_REVIEW_LINKS}개까지 등록할 수 있습니다` }
  }
  return { links: unique }
}

// 차수는 저장하지 않고 이력 순서에서 계산한다(스키마 주석 참고) — 검수요청이
// 나올 때마다 1 올라가고, 그 뒤의 반려/최종완료는 같은 차수에 속한다. 검수요청
// 없이 반려/최종완료만 있는 경우(기존 데이터나 PM의 예외적 조작)는 1차로 본다.
//
// 입력은 createdAt 오름차순이어야 한다.
export function assignReviewRounds(reviewsAsc) {
  let round = 0
  return reviewsAsc.map((review) => {
    if (review.kind === 'request') round += 1
    return { ...review, round: Math.max(round, 1) }
  })
}

// 전이가 요구하는 이력(taskTransitions.js의 requires)에 맞춰 본문을 검증한다.
// request/reject는 본문이 필수 — PM·등록자도 예외가 아니다(권한이 있을 뿐 절차는
// 지킨다, docs/task-review-spec.md 4장).
const BODY_REQUIRED_MESSAGES = {
  request: '검수 내용을 입력해주세요',
  reject: '반려 사유를 입력해주세요',
}

export function buildReviewPayload(requires, { body, links }) {
  if (requires === 'approve') return { data: { kind: 'approve', body: null, links: [] } }

  const text = typeof body === 'string' ? body.trim() : ''
  if (!text) return { error: BODY_REQUIRED_MESSAGES[requires] }

  // 산출물(링크/파일)은 검수요청 이력에만 붙는다 — 반려 이력은 사유 텍스트만
  // 남긴다(docs/task-review-spec.md 3장).
  if (requires === 'reject') return { data: { kind: 'reject', body: text, links: [] } }

  const normalized = normalizeReviewLinks(links)
  if (normalized.error) return { error: normalized.error }
  return { data: { kind: 'request', body: text, links: normalized.links } }
}
