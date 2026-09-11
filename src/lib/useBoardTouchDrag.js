import { useCallback, useEffect, useRef, useState } from 'react'

// 칸반 보드의 **터치 드래그**. 데스크톱은 HTML5 드래그(draggable + dataTransfer)를
// 그대로 쓰고, 이 훅은 `pointerType === 'touch'`인 입력만 가져간다. 두 경로를
// 합치지 않은 이유: HTML5 쪽은 잘 동작하고 있고, 하나로 합치려면 잘 되는 쪽까지
// 새로 짜야 한다.
//
// **왜 길게 누르기로 시작하나.** 터치에서 카드를 세로로 쓸어내리는 동작은
// "페이지 스크롤"과 "카드 끌기"가 똑같이 생겼다. 눌러서 잠깐 머무는 것으로만
// 끌기를 시작하면 스크롤을 빼앗지 않는다 — iOS/안드로이드의 목록 재정렬과 같은
// 규칙이라 따로 배울 것도 없다.
const LONG_PRESS_MS = 350
// 길게 누르기가 완성되기 전에 이만큼 움직이면 "스크롤하려던 것"으로 보고 포기한다.
const MOVE_CANCEL_PX = 10
// 화면(또는 보드 가로 스크롤) 가장자리에서 이 안쪽으로 들어오면 자동으로 스크롤한다.
const EDGE_PX = 64
const EDGE_STEP_PX = 14

// 손가락 아래에 있는 열을 찾는다. 드래그 중에는 미리보기 카드가 손가락을 따라
// 다니므로 그 요소가 먼저 잡히는데, pointer-events: none이라 hit test에서 빠진다.
function statusUnder(x, y) {
  const el = document.elementFromPoint(x, y)
  return el?.closest('[data-board-status]')?.dataset.boardStatus ?? null
}

// scroller는 **드래그를 시작한 카드가 속한** 보드다. 손가락 아래에서 찾지 않는
// 이유: 가장자리로 갈수록 손가락이 보드 바깥(페이지 여백)을 가리켜 못 찾는데,
// 하필 그때가 스크롤이 가장 필요한 순간이다(실측으로 걸렸다 — 오른쪽 끝까지
// 끌어도 scrollLeft가 0에서 움직이지 않았다).
function autoScroll(scroller, x, y) {
  // 세로는 페이지 전체, 가로는 보드. 모바일에서 열이 가로로 늘어서기 때문에
  // (TasksPage) 옆 열로 옮기려면 가로 스크롤이 따라와야 한다.
  if (y < EDGE_PX) window.scrollBy(0, -EDGE_STEP_PX)
  else if (y > window.innerHeight - EDGE_PX) window.scrollBy(0, EDGE_STEP_PX)

  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  if (x < box.left + EDGE_PX) scroller.scrollLeft -= EDGE_STEP_PX
  else if (x > box.right - EDGE_PX) scroller.scrollLeft += EDGE_STEP_PX
}

// onDrop(taskId, status) — 손을 뗀 자리의 열로 옮긴다. 제자리에 놓으면 부르지 않는다.
export function useBoardTouchDrag(onDrop) {
  // 렌더에 쓰는 값만 state로 둔다. 좌표는 pointermove마다 바뀌므로 같이 넣지만,
  // 판정에 쓰는 값(타이머·시작 좌표 등)은 ref에 둬서 리스너가 낡은 값을 붙잡지
  // 않게 한다.
  const [drag, setDrag] = useState(null)
  const ref = useRef(null)

  const finish = useCallback(() => {
    if (ref.current?.timer) clearTimeout(ref.current.timer)
    ref.current = null
    setDrag(null)
  }, [])

  // 끌기가 시작된 뒤에는 브라우저의 기본 스크롤을 막아야 한다. touch-action만으로는
  // 부족하다 — 그 값은 제스처가 **시작되기 전에** 정해져 있어야 효력이 있는데,
  // 여기서는 길게 누른 뒤에야 끌기인 줄 알게 된다. 그래서 passive가 아닌
  // touchmove 리스너로 그 순간부터 막는다.
  useEffect(() => {
    if (!drag) return undefined
    const block = (event) => event.preventDefault()
    document.addEventListener('touchmove', block, { passive: false })
    return () => document.removeEventListener('touchmove', block)
  }, [drag])

  const start = useCallback(
    (event, task) => {
      if (event.pointerType !== 'touch') return
      const { clientX: x, clientY: y } = event
      // 손가락이 카드 밖으로 나가도 pointermove/up이 이 카드로 계속 오게 한다.
      // 터치는 브라우저가 알아서 잡아주지만(implicit capture) 명시해두는 편이 안전하다.
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const timer = setTimeout(() => {
        if (!ref.current) return
        ref.current.active = true
        // 끌기가 시작됐다는 걸 손끝으로 알린다. 지원하지 않는 기기는 그냥 넘어간다.
        navigator.vibrate?.(20)
        setDrag({ task, x: ref.current.x, y: ref.current.y, status: statusUnder(ref.current.x, ref.current.y) })
      }, LONG_PRESS_MS)
      ref.current = {
        task,
        startX: x,
        startY: y,
        x,
        y,
        active: false,
        timer,
        scroller: event.currentTarget.closest('[data-board-scroller]'),
      }
    },
    [],
  )

  const move = useCallback((event) => {
    const state = ref.current
    if (!state) return
    const { clientX: x, clientY: y } = event
    state.x = x
    state.y = y
    if (!state.active) {
      // 아직 길게 누르기가 완성되지 않았는데 움직였다 = 스크롤하려는 것.
      if (Math.abs(x - state.startX) > MOVE_CANCEL_PX || Math.abs(y - state.startY) > MOVE_CANCEL_PX) {
        clearTimeout(state.timer)
        ref.current = null
      }
      return
    }
    autoScroll(state.scroller, x, y)
    setDrag((d) => (d ? { ...d, x, y, status: statusUnder(x, y) } : d))
  }, [])

  const end = useCallback(() => {
    const state = ref.current
    if (state?.active) {
      const status = statusUnder(state.x, state.y)
      if (status && status !== state.task.status) onDrop(state.task.id, status)
    }
    finish()
  }, [finish, onDrop])

  // 드래그로 끝난 제스처는 클릭(=상세로 이동)으로 이어지면 안 된다. 끌어서 옮긴
  // 직후 화면이 그 일감으로 넘어가버리기 때문이다.
  const wasDragRef = useRef(false)
  const endAndRemember = useCallback(() => {
    wasDragRef.current = Boolean(ref.current?.active)
    end()
  }, [end])
  const consumeClickAfterDrag = useCallback(() => {
    if (!wasDragRef.current) return false
    wasDragRef.current = false
    return true
  }, [])

  // 카드에 그대로 펼쳐 넣는 핸들러. 옮길 수 없는 일감(enabled=false)은 붙이지 않는다.
  const cardHandlers = useCallback(
    (task, enabled) =>
      enabled
        ? {
            onPointerDown: (e) => start(e, task),
            onPointerMove: move,
            onPointerUp: endAndRemember,
            onPointerCancel: finish,
          }
        : {},
    [start, move, endAndRemember, finish],
  )

  return { drag, cardHandlers, consumeClickAfterDrag }
}
