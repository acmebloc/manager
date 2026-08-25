// Row-level rules on top of requireProjectRole('member'). "어드민" is defined
// (tentatively — see docs/task-management-spec.md §8.1) as project PM + site
// admin, which getProjectAccess already collapses into role: 'pm' (site admin
// gets a synthetic pm without a real ProjectMember row), so there's nothing
// extra to check beyond the role itself.
export function isProjectAdmin(projectAccess) {
  return projectAccess.role === 'pm'
}

export function canModifyTask(task, user, projectAccess) {
  if (isProjectAdmin(projectAccess)) return true
  if (task.createdById && task.createdById === user.id) return true
  if (task.assigneeId && task.assigneeId === user.id) return true
  return false
}

export function canDeleteTask(task, user, projectAccess) {
  if (isProjectAdmin(projectAccess)) return true
  if (task.createdById && task.createdById === user.id) return true
  return false
}

// Shared by tasks.js and myTasks.js so the two task listings never derive
// these flags differently — the client never learns its own user id (see
// decryptTask in tasks.js), so this is computed once, here, for both.
export function taskPermissionFlags(task, user, projectAccess) {
  return {
    isMine: task.assigneeId === user.id,
    canModify: canModifyTask(task, user, projectAccess),
    canDelete: canDeleteTask(task, user, projectAccess),
  }
}
