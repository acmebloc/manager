// 선행/후행 일감(TaskLink type='blocks')의 순환 검사. DB에는 접근하지 않는다 —
// 라우트가 프로젝트의 blocks 링크를 조회해서 넘기고, 여기서는 그래프만 본다
// (taskReview.js와 같은 방침: 순수 로직은 분리해둔다).
//
// 간선 방향: { fromTaskId: A, toTaskId: B } = "A가 B의 선행"(A가 먼저 끝나야 B).

// 이 일감의 **선행 목록을 새 값으로 교체할 때** 순환이 생기는지 본다.
//
// 바뀌는 간선은 이 일감으로 들어오는 것(to === taskId)뿐이므로, 새로 생기는
// 순환은 반드시 이 일감을 지나간다. 따라서 taskId에서 후행 방향(from → to)으로
// 따라가다 새 선행 후보 중 하나에 닿는지만 보면 충분하다 — 닿는다면 그 후보는
// 이미 이 일감을 (직접 또는 간접으로) 기다리고 있다는 뜻이고, 그걸 선행으로
// 삼으면 서로를 기다리는 고리가 완성된다.
//
// 순환을 만드는 첫 후보 id를 돌려주고, 없으면 null.
export function findBlockingCycle(links, taskId, blockedByIds) {
  const candidates = new Set(blockedByIds.filter((id) => id !== taskId))
  if (candidates.size === 0) return null

  // from → [to...] 인접 리스트. 이 일감으로 들어오는 간선은 지금 교체되는
  // 대상이라 그래프에서 뺀다(남겨두면 이미 있던 선행 때문에 오탐이 난다).
  const successors = new Map()
  for (const link of links) {
    if (link.toTaskId === taskId) continue
    const list = successors.get(link.fromTaskId)
    if (list) list.push(link.toTaskId)
    else successors.set(link.fromTaskId, [link.toTaskId])
  }

  const visited = new Set([taskId])
  const queue = [taskId]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const next of successors.get(current) || []) {
      if (candidates.has(next)) return next
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return null
}
