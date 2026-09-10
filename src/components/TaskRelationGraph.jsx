import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import { apiFetch } from '../lib/api'
import { taskStatusLabel } from '../lib/taskFields'

// 일감 관계도(docs/task-relations-spec.md). 계층·선행/후행·연결 세 관계를 좌→우
// 방향 그래프로 그린다.
//
// **좌→우 계층 레이아웃(dagre)을 쓰는 이유**: 선행/후행에서 사용자가 묻는 건
// "무엇을 먼저 해야 하나"인데, force-directed(물리 기반 산개)는 그 답을 위치로
// 주지 못한다 — 노드 위치가 시뮬레이션 결과일 뿐이라 열 때마다 배치가 달라지고
// 화살표 방향을 하나하나 따라가야 한다. 좌→우로 놓으면 위치 자체가 순서다.

// 노드 수가 이만큼 넘으면 뷰포트 밖 노드를 렌더하지 않는다. 항상 켜지 않는
// 이유는 React Flow 문서가 명시하듯 이 최적화 자체에 오버헤드가 있어서다 —
// 화면을 움직일 때마다 무엇이 보이는지 계산하므로, 노드가 적으면 오히려 손해다.
const VIEWPORT_CULLING_THRESHOLD = 100

// 화면에 맞출 때의 여백과 확대 상한. **maxZoom을 0.5로 두는 이유**: 기본값(2)
// 이면 일감이 몇 개뿐인 프로젝트에서 fitView가 화면을 채우려고 최대까지 당겨서,
// 관계도를 열자마자 노드 세 개가 화면을 가득 메운다. 관계도를 보는 목적은
// "전체 모양을 한눈에 보는 것"이라 절반 크기에서 시작하는 게 맞다.
// 일감이 많은 프로젝트는 어차피 이보다 더 축소되어 맞춰진다.
// 사용자가 직접 확대하는 것은 막지 않는다 — 이 값은 fitView에만 적용된다.
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 0.5 }

// 노드 크기를 상수로 고정하고 React Flow에도 그대로 넘긴다(dagre 배치와 같은
// 값). 크기를 안 주면 React Flow가 DOM을 재어서 알아내는데, 재기 전까지 그
// 노드는 "크기 없음" 상태라 미니맵에 아예 그려지지 않는다.
// NODE_HEIGHT는 실제 내용 높이(테두리 2 + 상하 여백 12 + 제목 16 + 상태 16)다 —
// 테두리 두께를 바꾸면 이 값도 같이 고쳐야 노드 상자와 어긋나지 않는다.
const NODE_WIDTH = 190
const NODE_HEIGHT = 46

// 노드 테두리로 상태를 알린다 — 채우기까지 색으로 바꾸면 선(관계)이 묻힌다.
const STATUS_NODE_CLASS = {
  todo: 'border-gray-300 dark:border-gray-600',
  doing: 'border-blue-400 dark:border-blue-500',
  review: 'border-amber-400 dark:border-amber-500',
  done: 'border-emerald-400 dark:border-emerald-600',
}

// 관계 종류별 선 모양. 색까지 다르게 하면 상태 색과 경쟁하므로 선 스타일로만
// 구분한다: 선행은 실선 화살표(순서), 계층은 파선(포함), 연결은 점선(그냥 관련).
const EDGE_STYLE = {
  blocks: { stroke: '#6366f1', strokeWidth: 1.5 },
  parent: { stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '6 3' },
  related: { stroke: '#cbd5e1', strokeWidth: 1.5, strokeDasharray: '2 3' },
}

// 미니맵 노드 색. 라이트/다크 어느 쪽에서도 배경과 구분되는 중간 회색 하나로
// 둔다 — 상태색까지 미니맵에 넣으면 축소된 크기에서 구분이 안 된다.
const MINIMAP_NODE_COLOR = '#94a3b8'

function TaskNode({ data }) {
  return (
    <div
      className={`h-full rounded-md border bg-white px-2.5 py-1.5 dark:bg-gray-800 ${
        STATUS_NODE_CLASS[data.status] || STATUS_NODE_CLASS.todo
      } ${data.dimmed ? 'opacity-25' : ''}`}
    >
      {/* 화살표가 붙는 지점. 좌→우 레이아웃이라 왼쪽으로 들어와 오른쪽으로 나간다. */}
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-gray-300" />
      <p className="truncate text-xs leading-4 font-medium text-gray-900 dark:text-white">{data.title}</p>
      <p className="text-[10px] leading-4 text-gray-400 dark:text-gray-500">{taskStatusLabel(data.status)}</p>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-gray-300" />
    </div>
  )
}

const nodeTypes = { task: TaskNode }

const NODE_GAP_X = 24
const NODE_GAP_Y = 24
const CELL_WIDTH = NODE_WIDTH + NODE_GAP_X
const CELL_HEIGHT = NODE_HEIGHT + NODE_GAP_Y

// 연결 그래프와 고립 격자 사이 간격. 한 덩어리로 붙어 보이지 않을 만큼만 띈다.
const ISOLATED_BLOCK_GAP = 72

// 고립 격자를 이 비율(폭:높이)에 가깝게 만든다. 캔버스가 가로로 넓으므로
// 격자도 가로로 눕히는 게 같은 줌에서 더 크게 보인다.
const ISOLATED_GRID_ASPECT = 2

// 관계가 없는 일감을 몇 열로 깔지. 세로로 쌓으면(dagre가 그렇게 한다) 일감이
// 수십 개인 프로젝트에서 그래프가 폭 750 × 높이 2000의 띠가 되고, fitView가
// 그걸 맞추려 계속 축소해 글씨를 못 읽는다(실측). 격자로 눕히면 같은 개수를
// 훨씬 납작하게 담을 수 있다.
function isolatedColumns(count) {
  return Math.max(1, Math.ceil(Math.sqrt((count * ISOLATED_GRID_ASPECT * CELL_HEIGHT) / CELL_WIDTH)))
}

// dagre는 노드 중심 좌표를 주는데 React Flow는 좌상단을 기대한다 — 절반씩 빼서
// 맞춘다(이걸 빠뜨리면 노드가 반 칸씩 밀린다).
//
// 관계가 있는 노드만 dagre에 넘기고(그래야 좌→우 순서가 뜻을 가진다), 관계가
// 없는 노드는 그 아래에 격자로 깐다. isolatedIds가 비어 있으면(관계 없는 일감
// 숨기기가 켜진 경우) 예전과 완전히 같은 동작이다.
function layout(nodes, edges, isolatedIds) {
  const connected = nodes.filter((n) => !isolatedIds.has(n.id))
  const isolated = nodes.filter((n) => isolatedIds.has(n.id))
  const placed = []

  let gridTop = 0
  let gridLeft = 0

  if (connected.length > 0) {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: NODE_GAP_X, ranksep: 90 })
    for (const node of connected) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    for (const edge of edges) g.setEdge(edge.source, edge.target)
    dagre.layout(g)
    // 격자를 연결 그래프 바로 아래, 같은 왼쪽 끝에서 시작하게 맞춘다. 좌표를
    // 옮기는 김에 한 번에 구한다 — Math.max(...배열)로 따로 구하면 노드가 아주
    // 많을 때 인수 개수 한계에 걸려 터진다(RangeError).
    let maxY = -Infinity
    let minX = Infinity
    for (const node of connected) {
      const { x, y } = g.node(node.id)
      const position = { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }
      placed.push({ ...node, position })
      if (position.y > maxY) maxY = position.y
      if (position.x < minX) minX = position.x
    }
    gridTop = maxY + NODE_HEIGHT + ISOLATED_BLOCK_GAP
    gridLeft = minX
  }

  const columns = isolatedColumns(isolated.length)
  isolated.forEach((node, i) => {
    placed.push({
      ...node,
      position: {
        x: gridLeft + (i % columns) * CELL_WIDTH,
        y: gridTop + Math.floor(i / columns) * CELL_HEIGHT,
      },
    })
  })

  return placed
}

// 관계 체크박스에 그 관계의 선 모양을 그대로 붙인다. 별도 범례 상자를 띄우면
// 같은 라벨이 화면에 두 번 나오고, 캔버스 위 어디에 놓아도 확대/축소 버튼이나
// 미니맵과 자리를 다툰다 — 켜고 끄는 자리에서 바로 보여주는 편이 낫다.
function Toggle({ checked, onChange, kind, children }) {
  const line = kind && EDGE_STYLE[kind]
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {line && (
        <svg width="22" height="6" aria-hidden="true" className="shrink-0">
          <line
            x1="0"
            y1="3"
            x2="22"
            y2="3"
            stroke={line.stroke}
            strokeWidth={line.strokeWidth}
            strokeDasharray={line.strokeDasharray}
          />
        </svg>
      )}
      {children}
    </label>
  )
}

function Graph({ projectId }) {
  const navigate = useNavigate()
  const { fitView } = useReactFlow()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [hoveredId, setHoveredId] = useState(null)
  const [filters, setFilters] = useState({
    blocks: true,
    parent: true,
    related: true,
    // 처음 열었을 때 프로젝트의 일감을 빠짐없이 보여준다(사용자 결정) —
    // 완료도 같이 보이고, 관계가 없는 일감도 자리를 잡는다. 숨기고 싶으면
    // 위 체크박스로 끈다.
    hideDone: false,
    showIsolated: true,
  })

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError('')
    ;(async () => {
      try {
        const result = await apiFetch(`/api/projects/${projectId}/tasks/relations`)
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // 배치 계산(dagre)은 데이터·필터에만 의존한다. hover는 흐리기만 바꾸므로
  // 아래 두 번째 useMemo로 분리했다 — 같이 묶으면 마우스가 노드를 스칠 때마다
  // 그래프 전체를 다시 배치하게 된다.
  const { base, adjacency, hiddenDone, isolatedCount } = useMemo(() => {
    if (!data) {
      return {
        base: { nodes: [], links: [], ids: new Set() },
        adjacency: new Map(),
        hiddenDone: 0,
        isolatedCount: 0,
      }
    }

    const visibleTasks = filters.hideDone ? data.tasks.filter((t) => t.status !== 'done') : data.tasks
    const visibleIds = new Set(visibleTasks.map((t) => t.id))

    // 양쪽 끝이 다 보이는 관계만 그린다 — 한쪽이 필터로 빠졌는데 선만 남으면
    // 어디로 가는 선인지 알 수 없다.
    const shownLinks = []
    if (filters.parent) {
      for (const task of visibleTasks) {
        if (task.parentTaskId && visibleIds.has(task.parentTaskId)) {
          shownLinks.push({ source: task.parentTaskId, target: task.id, kind: 'parent' })
        }
      }
    }
    for (const link of data.links) {
      if (!filters[link.type]) continue
      if (!visibleIds.has(link.fromTaskId) || !visibleIds.has(link.toTaskId)) continue
      shownLinks.push({ source: link.fromTaskId, target: link.toTaskId, kind: link.type })
    }

    const neighboursOf = new Map()
    const link = (a, b) => {
      if (!neighboursOf.has(a)) neighboursOf.set(a, new Set([a]))
      neighboursOf.get(a).add(b)
    }
    for (const e of shownLinks) {
      link(e.source, e.target)
      link(e.target, e.source)
    }

    const shown = filters.showIsolated ? visibleTasks : visibleTasks.filter((t) => neighboursOf.has(t.id))
    // neighboursOf에 없으면 이 화면에서 아무것과도 이어지지 않은 일감이다.
    const isolatedIds = new Set(shown.filter((t) => !neighboursOf.has(t.id)).map((t) => t.id))

    return {
      base: {
        nodes: layout(
          shown.map((task) => ({
            id: task.id,
            type: 'task',
            position: { x: 0, y: 0 },
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            data: { title: task.title, status: task.status, dimmed: false },
          })),
          shownLinks,
          isolatedIds,
        ),
        links: shownLinks,
        // hover 대상이 아직 화면에 있는지 확인하는 데 쓴다(아래 두 번째 memo).
        ids: new Set(shown.map((t) => t.id)),
      },
      adjacency: neighboursOf,
      hiddenDone: data.tasks.length - visibleTasks.length,
      isolatedCount: visibleTasks.length - shown.length,
    }
  }, [data, filters])

  // hover한 노드와 직접 이어진 것만 남기고 나머지를 흐리게 — 관계가 늘어도
  // "지금 보고 있는 하나"의 주변은 읽힌다.
  const { nodes, edges } = useMemo(() => {
    // hover 중인 노드가 지금 화면에 없으면(마우스를 안 움직인 채 키보드로 필터를
    // 끄면 이렇게 된다) hover 자체를 무시한다. 그냥 두면 이웃이 하나도 안 잡혀
    // 화면 전체가 흐려진 채로 멈춘다 — 마우스를 다시 올릴 때까지 안 풀린다.
    // adjacency에 없는 노드도 화면에는 있을 수 있어서(관계 없는 일감을 켠 경우)
    // adjacency가 아니라 base.ids로 판정해야 한다.
    const near = hoveredId && base.ids.has(hoveredId) ? (adjacency.get(hoveredId) ?? new Set([hoveredId])) : null

    return {
      nodes: near
        ? base.nodes.map((n) => (near.has(n.id) ? n : { ...n, data: { ...n.data, dimmed: true } }))
        : base.nodes,
      edges: base.links.map((e, i) => ({
        id: `${e.kind}-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        // 연결 일감은 방향이 없는 대칭 관계라 화살촉을 붙이지 않는다.
        markerEnd: e.kind === 'related' ? undefined : { type: 'arrowclosed', color: EDGE_STYLE[e.kind].stroke },
        style: {
          ...EDGE_STYLE[e.kind],
          opacity: near && !(near.has(e.source) && near.has(e.target)) ? 0.15 : 1,
        },
      })),
    }
  }, [base, adjacency, hoveredId])

  // 필터를 바꾸면 그래프 크기가 달라지므로 화면에 다시 맞춘다. base가 바뀔
  // 때만 — hover로 흐려지는 것까지 화면을 다시 맞추면 눈이 어지럽다.
  useEffect(() => {
    if (base.nodes.length === 0) return undefined
    const id = setTimeout(() => fitView({ ...FIT_VIEW_OPTIONS, duration: 200 }), 0)
    return () => clearTimeout(id)
  }, [base, fitView])

  const setFilter = useCallback((key) => (value) => setFilters((f) => ({ ...f, [key]: value })), [])

  if (error) return <p className="py-12 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!data) return <p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>

  return (
    // 캔버스가 남은 높이를 전부 차지하도록 이 화면을 세로 flex로 둔다. 부모
    // 체인이 이미 그렇게 되어 있다: Layout의 min-h-screen > main flex-1 >
    // TasksPage의 flex-1(관계도일 때만).
    <div className="flex flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle checked={filters.blocks} onChange={setFilter('blocks')} kind="blocks">
          선행/후행
        </Toggle>
        <Toggle checked={filters.parent} onChange={setFilter('parent')} kind="parent">
          상위/하위
        </Toggle>
        <Toggle checked={filters.related} onChange={setFilter('related')} kind="related">
          연결
        </Toggle>
        <span className="h-3 w-px bg-gray-200 dark:bg-gray-700" />
        <Toggle checked={filters.hideDone} onChange={setFilter('hideDone')}>
          완료 숨기기
        </Toggle>
        <Toggle checked={filters.showIsolated} onChange={setFilter('showIsolated')}>
          관계 없는 일감도 보기
        </Toggle>
      </div>

      {/* 캔버스는 남은 높이를 전부 쓰고(flex-1 + min-h-0), 페이지 컨테이너
          (max-w-[1400px] px-4)를 뚫고 화면 폭 전체를 쓴다.
          - min-h-0이 없으면 flex 자식의 기본 min-height:auto 때문에 내용보다
            작아지지 못해 페이지가 넘친다.
          - 폭: margin-left calc(50% - 50vw)에서 50%는 부모 컨텐츠 폭의 절반,
            50vw는 화면 폭의 절반이므로 그 차이만큼 왼쪽으로 밀면 정확히 화면
            왼쪽 끝에 닿는다(부모가 mx-auto로 가운데 정렬돼 있어 성립한다).
          좌우로 꽉 차므로 테두리는 위쪽만 남긴다 — 둥근 모서리도 의미가 없다. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden border-t border-gray-200 dark:border-gray-700"
        style={{ width: '100vw', marginLeft: 'calc(50% - 50vw)' }}
      >
        {/* absolute inset-0 래퍼가 꼭 필요하다. React Flow 자체 CSS가
            height:100%인데 위 flex-1은 height가 auto라, 퍼센트가 auto로 해석돼
            .react-flow가 높이 0이 된다(실측: 부모는 711인데 0). 그러면 그래프가
            보이지 않고 확대 버튼이 캔버스 밖 페이지 상단으로 튀어나간다.
            inset-0은 확정 높이를 주므로 100%가 제대로 해석된다. */}
        <div className="absolute inset-0">
          {nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-gray-400 dark:text-gray-500">
              <p>표시할 관계가 없어요.</p>
              {(hiddenDone > 0 || isolatedCount > 0) && (
                <p className="text-xs">
                  {[
                    hiddenDone > 0 && `완료 ${hiddenDone}건 숨김`,
                    isolatedCount > 0 && `관계 없는 일감 ${isolatedCount}건 숨김`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {' — 위 필터를 켜보세요.'}
                </p>
              )}
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onlyRenderVisibleElements={nodes.length > VIEWPORT_CULLING_THRESHOLD}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
              onNodeMouseLeave={() => setHoveredId(null)}
              onNodeClick={(_, node) => navigate(`/tasks/${projectId}/${node.id}`)}
              fitView
              fitViewOptions={FIT_VIEW_OPTIONS}
              // React Flow 표기는 숨긴다(사용자 요청). @xyflow/react는 MIT라
              // 제거가 라이선스 위반이 아니다 — 표기 유지는 xyflow의 권유 사항이다.
              proOptions={{ hideAttribution: true }}
              // 기본 minZoom(0.5)으로는 일감이 수십 개만 넘어도 "전체 보기"가
              // 화면에 안 들어온다 — 축소가 0.5에서 멈춰 그래프가 잘린 채 열린다.
              minZoom={0.05}
              // 앱의 dark: 변형이 Tailwind v4 기본값(prefers-color-scheme)이라
              // React Flow도 같은 기준을 쓰는 'system'으로 맞춘다. 이걸 안 주면
              // 확대 버튼·미니맵이 다크에서 흰색으로 남는다.
              colorMode="system"
            >
              {/* 점무늬는 아주 흐리게만 남긴다. 관계선 자체가 실선·파선·점선으로
                  구분되는데 배경 점이 진하면 그 점선과 섞여 어느 게 선인지 헷갈린다
                  (사용자 지적). 그래도 완전히 없애지는 않았다 — 옅은 질감이라도
                  있어야 "여기는 끌어 옮길 수 있는 캔버스"로 읽힌다.
                  색은 className으로 투명도만 낮춰 React Flow의 테마별 기본색
                  (colorMode="system")을 그대로 쓴다. 간격·크기를 기본값의 2배로 둔
                  것은 초기 줌 0.5에서 기본값이면 점 반지름이 0.25px가 되어 아예
                  사라지기 때문이다(실측). */}
              <Background gap={32} size={2} className="opacity-25" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={MINIMAP_NODE_COLOR} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  )
}

// useReactFlow()를 쓰려면 Provider 안이어야 한다.
function TaskRelationGraph({ projectId }) {
  return (
    <ReactFlowProvider>
      <Graph projectId={projectId} />
    </ReactFlowProvider>
  )
}

export default TaskRelationGraph
