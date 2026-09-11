import { prisma } from '../db.js'

// 관계 다섯 가지의 **공존 규칙**을 한곳에서 판정한다(docs/task-relations-spec.md).
//
//   연결(related)  — 상위/하위/선행/후행 어느 것과도 같은 상대에게 **함께 걸 수 없다**.
//                    양방향이다: 이미 상위인 일감을 연결로 걸 수도, 이미 연결인
//                    일감을 상위로 올릴 수도 없다.
//   상위 + 선행    — 같은 상대에게 **함께 걸 수 있다**. 뜻이 다르기 때문이다
//                    (상위=포함, 선행=순서). 관계도에서 두 선을 따로 그린다.
//
// **왜 연결만 배타인가**: 연결은 "순서도 계층도 아닌 그냥 관련"이라는 가장 약한
// 관계다. 더 구체적인 관계가 이미 있으면 연결을 덧붙여도 정보가 늘지 않고, 상세
// 화면 한 상자에 같은 제목이 두 번 뜨고 관계도에는 선이 겹친다.
//
// **왜 화면 제외만으로는 부족한가**: 후보 목록에서 빼는 것은 실수를 줄이지만
// API 직접 호출을 막지 못한다. 실제로 이 검증을 넣기 전에는 선행으로 걸린 일감을
// 연결로도 걸 수 있었다(화면은 막고 있었는데도). 검수 전이표 스펙도 같은 이유로
// "드롭다운 옵션을 숨기는 것만으로는 부족하다"고 못박아뒀다.

// 이번 요청이 끝난 뒤의 관계 상태를 모아온다. undefined인 필드는 "이 요청에서
// 건드리지 않음"이므로 현재 값을 그대로 쓴다(PATCH의 부분 수정 규약).
async function resolveFinalRelations(taskId, patch, existing, db) {
  // 신규 생성(POST)에는 아직 일감이 없으니 상대가 가진 관계도 없다.
  if (!taskId) {
    return {
      parentId: patch.parentTaskId ?? null,
      childIds: [],
      relatedIds: patch.relatedTaskIds ?? [],
      blockedByIds: patch.blockedByTaskIds ?? [],
      blockingIds: [],
    }
  }

  const [children, links] = await Promise.all([
    // 하위·후행은 상대 일감이 가진 값이라 이 PATCH로는 바뀌지 않는다.
    db.task.findMany({ where: { parentTaskId: taskId }, select: { id: true } }),
    db.taskLink.findMany({
      where: { OR: [{ fromTaskId: taskId }, { toTaskId: taskId }] },
      select: { fromTaskId: true, toTaskId: true, type: true },
    }),
  ])

  const currentRelated = links
    .filter((l) => l.type === 'related')
    .map((l) => (l.fromTaskId === taskId ? l.toTaskId : l.fromTaskId))
  const currentBlockedBy = links.filter((l) => l.type === 'blocks' && l.toTaskId === taskId).map((l) => l.fromTaskId)
  const blocking = links.filter((l) => l.type === 'blocks' && l.fromTaskId === taskId).map((l) => l.toTaskId)

  return {
    parentId: patch.parentTaskId !== undefined ? patch.parentTaskId : (existing?.parentTaskId ?? null),
    childIds: children.map((c) => c.id),
    relatedIds: patch.relatedTaskIds !== undefined ? patch.relatedTaskIds : currentRelated,
    blockedByIds: patch.blockedByTaskIds !== undefined ? patch.blockedByTaskIds : currentBlockedBy,
    blockingIds: blocking,
  }
}

// 문제가 있으면 메시지를, 없으면 null을 돌려준다(assertDateOrder 등과 같은 규약).
//
// patch에는 이번 요청이 보낸 parentTaskId / relatedTaskIds / blockedByTaskIds가
// 들어온다(보내지 않은 것은 undefined). existing은 수정 전 일감 행이다.
// db로 트랜잭션 클라이언트를 넘기면 그 트랜잭션 안에서 읽는다(기본은 공용 클라이언트).
export async function assertRelationExclusivity(taskId, patch, existing, db = prisma) {
  const touchesRelations =
    patch.parentTaskId !== undefined || patch.relatedTaskIds !== undefined || patch.blockedByTaskIds !== undefined
  if (!touchesRelations) return null

  // 연결이 하나도 안 남을 게 확실하면 충돌도 있을 수 없다 — 아래 조회를 아예
  // 건너뛴다. 수정 폼은 저장할 때마다 relatedTaskIds를 보내므로(대부분 빈 배열)
  // 이 지름길이 가장 흔한 경로다.
  if (patch.relatedTaskIds !== undefined && patch.relatedTaskIds.length === 0) return null

  const final = await resolveFinalRelations(taskId, patch, existing, db)
  // 자기 자신을 가리키는 id는 다른 검증들이 모두 무의미한 값으로 걸러내므로
  // (sameProjectTaskIds·findBlockingCycle) 여기서도 충돌로 세지 않는다 —
  // 안 그러면 {relatedTaskIds:[나], blockedByTaskIds:[나]}가 "연결과 선행에
  // 동시에 등록"으로 잘못 거절된다.
  const related = new Set(final.relatedIds.filter((id) => id !== taskId))
  if (related.size === 0) return null

  // 연결과 겹치면 안 되는 관계들. 라벨은 사용자가 화면에서 보는 이름 그대로 쓴다.
  const conflicts = [
    { ids: final.parentId ? [final.parentId] : [], label: '상위 일감' },
    { ids: final.childIds, label: '하위 작업' },
    { ids: final.blockedByIds, label: '선행 일감' },
    { ids: final.blockingIds, label: '후행 일감' },
  ]

  // **어느 쪽이 먼저였는지 단정하지 않는다.** 같은 검사가 양방향에서 걸리기
  // 때문이다 — 연결을 추가하다 걸릴 수도 있고(기존이 상위), 상위를 추가하다
  // 걸릴 수도 있다(기존이 연결). "이미 ○○인 일감은…"으로 쓰면 후자에서 문장이
  // 거꾸로 읽힌다. 그래서 두 관계를 나열하고 하나를 지우라고만 말한다.
  for (const { ids, label } of conflicts) {
    if (ids.some((id) => related.has(id))) {
      return `같은 일감을 연결 일감과 ${label}으로 동시에 등록할 수 없습니다. 둘 중 하나를 제거해주세요`
    }
  }

  return null
}
