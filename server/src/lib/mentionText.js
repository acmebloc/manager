const MENTION_RE = /:mention\[([^\]]+)\]/g

// `:mention[<userId>]` 마커(src/lib/mentions.js의 서버 쪽 대응)를 "@이름"
// 읽을 수 있는 텍스트로 바꾼다. 댓글에 이미 딸려오는 mentions 관계(각 라우트의
// commentInclude)를 그대로 쓰므로 별도 사용자 조회가 없다 — 클라이언트가
// 렌더링 시점에 항상 최신 이름을 다시 찾아 보여주는 것과 같은 이유로, 검색
// 결과도 개명이 반영된 현재 이름을 보여준다.
export function resolveMentionText(body, mentions) {
  const nameById = new Map(mentions.map((m) => [m.user.id, m.user.name]))
  return body.replace(MENTION_RE, (_, userId) => `@${nameById.get(userId) || '알 수 없음'}`)
}
