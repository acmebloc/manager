import { allowedTransitions } from './taskTransitions.js'

// Row-level rules on top of requireProjectRole('member'). "어드민" is defined
// (tentatively — see docs/task-management-spec.md §8.1) as project PM + site
// admin, which getProjectAccess already collapses into role: 'pm' (site admin
// gets a synthetic pm without a real ProjectMember row), so there's nothing
// extra to check beyond the role itself.
export function isProjectAdmin(projectAccess) {
  return projectAccess.role === 'pm'
}

// 이 일감에 대한 사용자의 역할 — 전이 규칙(taskTransitions.js)과 아래 권한
// 함수들이 공통으로 쓰는 유일한 입력이다.
export function taskRoles(task, user, projectAccess) {
  return {
    isAdmin: isProjectAdmin(projectAccess),
    isCreator: Boolean(task.createdById) && task.createdById === user.id,
    isAssignee: Boolean(task.assigneeId) && task.assigneeId === user.id,
    isReviewer: Boolean(task.reviewerId) && task.reviewerId === user.id,
  }
}

// 역할만 본다 — 완료 잠금(아래 canEditTaskFields)은 여기 섞지 않는다. 상태 전이는
// 완료된 일감에서도 재오픈이 가능해야 해서, "역할이 되는가"와 "지금 고칠 수
// 있는가"를 분리해두어야 한다.
//
// 검수자도 포함한다 — 검수자는 그 일감의 당사자라서 반려/최종완료뿐 아니라
// 담당자 교체나 첨부 확인도 할 수 있어야 한다(docs/task-review-spec.md 2장).
export function canModifyTask(task, user, projectAccess) {
  const roles = taskRoles(task, user, projectAccess)
  return roles.isAdmin || roles.isCreator || roles.isAssignee || roles.isReviewer
}

// 필드/체크리스트/첨부/산출물을 실제로 고칠 수 있는가. 완료된 일감은 통째로
// 잠긴다(docs/task-review-spec.md 8장) — 예외는 댓글(별도 권한 체계라 이 함수를
// 거치지 않는다)과 PM·등록자의 재오픈(전이 규칙 쪽에서 따로 허용)뿐이다.
export function canEditTaskFields(task, user, projectAccess) {
  if (task.status === 'done') return false
  return canModifyTask(task, user, projectAccess)
}

export function canDeleteTask(task, user, projectAccess) {
  if (isProjectAdmin(projectAccess)) return true
  if (task.createdById && task.createdById === user.id) return true
  return false
}

// Shared by tasks.js and myTasks.js so the two task listings never derive
// these flags differently — the client never learns its own user id (see
// decryptTask in tasks.js), so this is computed once, here, for both.
//
// canModify와 allowedTransitions를 따로 내려주는 게 핵심이다: 완료된 일감은
// canModify=false(수정 버튼·체크리스트·첨부 UI가 사라짐)이지만
// allowedTransitions에는 재오픈이 남아 있어야 한다. 그래서 화면의 상태
// 드롭다운/드래그는 canModify가 아니라 allowedTransitions로 그린다.
export function taskPermissionFlags(task, user, projectAccess) {
  const roles = taskRoles(task, user, projectAccess)
  return {
    // "내 일감만 보기"의 기준 — 담당자 또는 검수자. 참조자는 포함하지 않는다
    // (진행 상황만 따라가는 사람이라 내 할 일 목록에 끼면 노이즈가 된다).
    isMine: roles.isAssignee || roles.isReviewer,
    canModify: canEditTaskFields(task, user, projectAccess),
    canDelete: canDeleteTask(task, user, projectAccess),
    allowedTransitions: allowedTransitions(task.status, roles),
  }
}
