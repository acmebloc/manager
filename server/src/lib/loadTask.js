import { prisma } from '../db.js'

// 일감 하위 리소스 라우터(체크리스트·댓글·첨부·검수)가 공통으로 하던 일 —
// :projectId 안에서 :taskId를 찾고, 없으면 404를 보내고 null을 돌려준다.
//
// 네 라우터가 각자 같은 함수를 갖고 있었고 where와 404 응답까지 완전히 같았다.
// 다른 건 select뿐이었는데, 그 차이가 조용한 버그의 원인이 된 적이 있다:
// taskReviews.js는 { id, status }만 뽑아서, 권한 헬퍼를 부르면 createdById 등이
// undefined라 판정이 항상 거짓 쪽으로 기울었다. 그래서 기본값을 "권한 판정에
// 필요한 필드 전부"로 두고, 더 필요한 곳만 명시적으로 넓히게 했다.

// taskPermissions.js의 canModifyTask/canEditTaskFields/canDeleteTask가 읽는
// 필드 전부. 여기서 뭔가를 빼면 그 헬퍼들이 undefined를 비교하며 조용히 틀린다.
export const TASK_PERMISSION_SELECT = {
  id: true,
  status: true,
  createdById: true,
  assigneeId: true,
  reviewerId: true,
}

// options.select에 null을 주면 행 전체를 읽는다 — 댓글·첨부 라우터처럼 일감 행의
// 다른 필드(제목 등)까지 쓰는 곳이 그렇게 부른다.
export async function loadTask(req, res, { select = TASK_PERMISSION_SELECT } = {}) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId, projectId: req.params.projectId },
    ...(select ? { select } : {}),
  })
  if (!task) {
    res.status(404).json({ error: 'Not found' })
    return null
  }
  return task
}
