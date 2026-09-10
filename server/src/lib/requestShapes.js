// 요청 본문 값의 **모양**만 본다. 의미 검증(존재하는 id인지, 프로젝트 멤버인지,
// 날짜 순서가 맞는지)은 각 라우트가 하던 대로 계속 한다.
//
// **왜 필요한가**: 문자열 자리에 객체·배열·숫자가 들어오면 그 값이 그대로
// Prisma까지 흘러간다. 결과는 둘 중 하나인데 어느 쪽도 옳지 않다.
//
//  1. Prisma가 검증 오류를 던져 500이 된다(Express 4에서는
//     lib/expressAsyncErrors.js를 거친다). 서버가 고장난 게 아니라 요청이
//     잘못된 것이므로 400이 맞다.
//  2. 더 나쁜 경우, 조용히 통과해 엉뚱한 값이 저장된다. 실측 두 건:
//     - `PATCH /api/me`에 `{"name":{"a":1}}` → 이름이 `"[object Object]"`로 저장됨
//     - `PATCH .../tasks/:id`에 `{"startAt":[1]}` → `new Date([1])`이 2001년으로
//       해석돼 시작일이 조용히 바뀜
//
// routes/tasks.js의 applyTaskFollowers가 이미 `typeof id === 'string'`으로
// 걸러내고 있었다 — 그 규칙을 한곳에 모아 같은 모양으로 쓰는 것이다.
//
// 메시지를 영어로 두는 이유: 이 오류는 정상 클라이언트에서는 나올 수 없고
// (우리 UI는 항상 문자열을 보낸다) 잘못 만든 클라이언트만 본다. 같은 성격인
// 기존 메시지들(`title is required`, `Invalid type`)과 결을 맞춘다.

// 빈 값은 통과시킨다 — "이 필드를 비운다"는 뜻으로 쓰이는 자리가 많고, 그걸
// 어떻게 해석할지는(무시할지, null로 저장할지) 라우트마다 다르다.
const isBlank = (value) => value === undefined || value === null || value === ''

// 문자열로만 와야 하는 필드들. 문제가 있으면 메시지를, 없으면 null을 돌려준다
// (기존 assertDateOrder·assertWithinProjectPeriod와 같은 규약).
export function assertStringFields(body, keys) {
  for (const key of keys) {
    if (isBlank(body[key])) continue
    if (typeof body[key] !== 'string') return `${key} must be a string`
  }
  return null
}

// 문자열 id 배열로만 와야 하는 필드들. 배열이 아니거나 원소 중 하나라도
// 문자열이 아니면 거절한다 — 원소 하나만 골라 버리면 "3명 중 2명만 저장됐다"가
// 조용히 일어난다.
export function assertStringArrayFields(body, keys) {
  for (const key of keys) {
    const value = body[key]
    if (value === undefined || value === null) continue
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return `${key} must be an array of strings`
    }
  }
  return null
}
