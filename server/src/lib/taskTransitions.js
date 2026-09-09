import { taskStatusLabel } from './taskFields.js'

// 일감 상태 전이 규칙 — docs/task-review-spec.md 4장의 표를 그대로 옮긴 것이
// 아래 TRANSITIONS다. 여기 없는 from→to 조합은 전부 거부된다.
//
// 핵심은 "동작(검수요청/반려/최종완료)"과 "저장되는 상태"가 다르다는 것이다.
// 상태값은 여전히 4개(todo/doing/review/done)뿐이고 칸반도 4단 그대로인데,
// 그 사이를 오가는 각 전이에 동작 이름과 필수 입력이 붙는다.
//
// 이 모듈은 taskPermissions.js가 계산해준 역할 플래그(roles)만 보고 판단하며,
// prisma나 req 객체를 전혀 모른다 — 그래서 taskPermissions.js가 이 파일을
// 단방향으로 import할 수 있다(순환 참조 없음).

// requires: 이 전이를 하려면 함께 등록해야 하는 검수 이력의 종류.
//   'request' — 검수 내용 + 검수자(산출물 첨부/링크는 선택)
//   'reject'  — 반려 사유
//   'approve' — 승인 기록만 남긴다(사용자 입력 없음, 팝업도 없음)
//   null      — 이력을 남기지 않는 단순 전이
const TRANSITIONS = [
  { from: 'todo', to: 'doing', action: 'start', role: 'modify', requires: null },
  { from: 'doing', to: 'todo', action: 'revert', role: 'modify', requires: null },
  // 대기에서 바로 검수요청하는 것도 허용한다 — 칸반에서 두 칸 건너 끌었을 때
  // 굳이 막을 이유가 없고, "검수중에 들어갈 때는 검수요청 팝업"이라는 규칙도
  // 그대로 지켜진다.
  { from: 'todo', to: 'review', action: 'request', role: 'requester', requires: 'request' },
  { from: 'doing', to: 'review', action: 'request', role: 'requester', requires: 'request' },
  { from: 'review', to: 'doing', action: 'reject', role: 'approver', requires: 'reject' },
  { from: 'review', to: 'todo', action: 'reject', role: 'admin', requires: 'reject' },
  { from: 'review', to: 'done', action: 'approve', role: 'approver', requires: 'approve' },
  // 완료 잠금(spec 8장)의 유일한 탈출구. 이게 없으면 지금 전부 완료 처리된
  // 운영 일감이 영구히 손댈 수 없는 상태가 된다.
  { from: 'done', to: 'doing', action: 'reopen', role: 'admin', requires: null },
]

const ROLE_RULES = {
  // 일감을 수정할 수 있는 사람 전부 — PM(사이트 어드민 포함)·등록자·담당자·검수자.
  modify: (r) => r.isAdmin || r.isCreator || r.isAssignee || r.isReviewer,
  // 검수를 요청하는 쪽. 검수자는 여기 없다 — 담당자와 검수자는 같은 사람일 수
  // 없으므로(스키마 주석 참고) 검수자가 자기 검수 대상을 스스로 올리는 상황은
  // 애초에 성립하지 않는다.
  requester: (r) => r.isAdmin || r.isCreator || r.isAssignee,
  // 검수 결과(반려/최종완료)를 내리는 쪽.
  approver: (r) => r.isAdmin || r.isCreator || r.isReviewer,
  // PM·등록자만.
  admin: (r) => r.isAdmin || r.isCreator,
}

const DENY_MESSAGES = {
  modify: '이 일감의 상태를 바꿀 권한이 없습니다',
  requester: '검수요청은 담당자 또는 PM·등록자만 할 수 있습니다',
  approver: '검수 결과 등록은 검수자 또는 PM·등록자만 할 수 있습니다',
  admin: 'PM 또는 등록자만 할 수 있습니다',
}

function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) || null
}

// 클라이언트에 내려주는 목록 — 상태 드롭다운의 선택지와 칸반 드래그 허용 여부를
// 전부 이걸로 만든다. 서버가 계산해서 넘기는 이유는 클라이언트가 자기 user id도
// 모르기 때문(tasks.js의 decryptTask 주석 참고)이고, 무엇보다 옵션을 숨기는
// 것만으로는 권한 강제가 되지 않아 어차피 서버가 같은 판단을 해야 하기 때문이다.
export function allowedTransitions(currentStatus, roles) {
  return TRANSITIONS.filter((t) => t.from === currentStatus && ROLE_RULES[t.role](roles)).map((t) => ({
    to: t.to,
    action: t.action,
    requires: t.requires,
  }))
}

// 문제가 없으면 전이 정의를, 있으면 { error, status } 를 돌려준다. 상태 409는
// "규칙상 불가능한 전이"(대개 화면이 낡아서 이미 다른 사람이 처리한 경우)를,
// 403은 "규칙은 되지만 권한이 없음"을 뜻한다.
export function resolveTransition(currentStatus, nextStatus, roles) {
  const transition = findTransition(currentStatus, nextStatus)
  if (!transition) {
    return {
      error: `${taskStatusLabel(currentStatus)} 상태에서 ${taskStatusLabel(nextStatus)}(으)로는 바꿀 수 없습니다`,
      httpStatus: 409,
    }
  }
  if (!ROLE_RULES[transition.role](roles)) {
    return { error: DENY_MESSAGES[transition.role], httpStatus: 403 }
  }
  return { transition }
}
