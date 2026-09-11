import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import {
  isOutsideProjectPeriod,
  projectPeriodLabel,
  statusOptions,
  TASK_GRADES,
  TASK_TYPES,
  taskStatusLabel,
} from '../lib/taskFields'
import { submitStatusChange } from '../lib/taskReview'
import { FollowerList, FollowerPicker } from '../components/FollowerPicker'
import { Avatar } from '../components/ProjectMembers'
import MarkdownContent from '../components/MarkdownContent'
import MarkdownEditor from '../components/MarkdownEditor'
import TaskActivityLog from '../components/TaskActivityLog'
import TaskAttachments from '../components/TaskAttachments'
import TaskChecklist from '../components/TaskChecklist'
import TaskComments from '../components/TaskComments'
import TaskLinks from '../components/TaskLinks'
import TaskReviewHistory from '../components/TaskReviewHistory'
import TaskStatusDialog from '../components/TaskStatusDialog'
import TaskSubtasks from '../components/TaskSubtasks'

// GET .../links가 돌려주는 모양. blocking(후행)은 상대 일감이 나를 선행으로
// 가리키는 역방향 관계지만 하위 작업과 마찬가지로 여기서 편집할 수 있다
// (docs/task-relations-spec.md 2장).
const EMPTY_LINKS = { related: [], blockedBy: [], blocking: [] }

// status는 draft에 없다 — 상태는 폼에 담아 저장하는 값이 아니라 그 자리에서
// 바꾸는 값이고, 수정 폼에 두면 검수요청/반려 팝업 절차를 우회하는 경로가 된다
// (docs/task-review-spec.md 4장).
const EMPTY_DRAFT = {
  title: '',
  description: '',
  type: 'plan',
  grade: 'minor',
  assigneeId: '',
  reviewerId: '',
  startAt: '',
  endAt: '',
  parentTask: null,
  relatedTasks: [],
  blockedByTasks: [],
  // draftFromTask가 채우는 필드와 **키가 완전히 같아야 한다.** 하나라도 빠지면
  // task가 아직 로드되지 않은 첫 렌더에서 그 배열을 훑는 코드가 터진다
  // (실측: subtasks/blockingTasks를 빠뜨려 상세 화면이 통째로 흰 화면이 됐다).
  subtasks: [],
  blockingTasks: [],
  followers: [],
}

function toDateInputValue(value) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR')
}

// links는 마지막으로 불러오거나 저장된 연결 일감 — 편집 중 선택을 취소했을 때
// 되돌아갈 기준점이라 draft와 분리해서 들고 있는다(TaskFormPage 참고).
// parentTask/followers는 연결 일감과 달리 task 자체에 실려온다(GET /:id).
function draftFromTask(task, links = EMPTY_LINKS) {
  return {
    title: task.title,
    description: task.description || '',
    type: task.type,
    grade: task.grade,
    assigneeId: task.assigneeId || '',
    reviewerId: task.reviewerId || '',
    startAt: toDateInputValue(task.startAt),
    endAt: toDateInputValue(task.endAt),
    parentTask: task.parentTask || null,
    relatedTasks: links.related,
    blockedByTasks: links.blockedBy,
    // 하위 작업과 후행 일감은 **상대 일감이 가진 값**이지만 여기 draft에 담는다.
    // 예전에는 이 둘만 즉시 PATCH로 저장돼서, 같은 상자 안에서 어떤 관계는
    // 취소가 통하고 어떤 관계는 안 통했다. 더 나쁘게는 상위를 화면에서 지운
    // 뒤 하위를 추가하면 서버가 아직 옛 상위를 보고 거절했다.
    // 이제 다섯 관계 모두 저장 버튼을 눌러야 반영된다(save의 순서 주석 참고).
    subtasks: task.subtasks || [],
    blockingTasks: links.blocking,
    followers: task.followers || [],
  }
}

// **POST/PATCH 응답에는 하위 작업의 제목·id가 없다.** 쓰기 응답은 목록·보드와
// 같은 include를 쓰는데(taskWriteInclude → taskInclude) 거기서 subtasks는
// 진행률 배지용 `{ status }`만 뽑는 가벼운 조인이다. 제목까지 실린 형태는
// 상세 조회(GET /:id)에서만 온다.
//
// 그래서 쓰기 응답으로 task state를 갈아끼울 때는 하위 작업 목록을 지금 화면이
// 들고 있는 것으로 되돌려놔야 한다. 실측한 증상: 상세에서 상태만 바꾸면 하위
// 작업 칩이 제목과 링크를 잃고(React key 중복 경고까지) 남았고, 그 칩을
// 제거하면 id가 undefined라 `filter(t => t.id !== id)`가 목록을 통째로 지웠다.
function withSubtasks(updated, subtasks) {
  return { ...updated, subtasks }
}

// 하위 작업과 후행 일감은 **상대 일감**을 고쳐야 반영된다. 내 필드 하나로 담을
// 수 없으므로 저장할 때 상대마다 요청을 따로 보낸다.
//
// **순서가 중요하다 — 제거를 먼저, 추가를 나중에.** 서버는 계층을 1단계로
// 제한하므로(assertValidParent) 순서를 뒤집으면 정당한 편집도 거절된다:
//
//   상위 A를 지우고 하위 B를 추가  → 내 상위를 먼저 비워야 B의 상위가 될 수 있다
//   하위 B를 지우고 상위 A를 등록  → B를 먼저 떼어내야 내가 A의 하위가 될 수 있다
//
// 그래서 [상대 제거] → [내 필드] → [상대 추가] 순으로 흐른다.
async function applyRelationChanges(projectId, taskId, before, after, patchSelf) {
  const setParent = (child, parentTaskId) =>
    apiFetch(`/api/projects/${projectId}/tasks/${child.id}`, { method: 'PATCH', body: { parentTaskId } })
  // 후행은 상대의 선행 목록에서 나 하나만 붙이거나 뗀다 — 목록 전체를 보내면
  // 그 사이 남이 추가한 선행이 사라진다(서버의 blocked-by 경로 주석 참고).
  const setBlocking = (successor, method) =>
    apiFetch(`/api/projects/${projectId}/tasks/${successor.id}/blocked-by/${taskId}`, { method })

  // 이 요청들은 **한 트랜잭션이 아니다.** 중간에 실패하면 앞의 요청은 이미
  // 반영된 채 멈추므로, 몇 개가 반영됐는지를 에러에 실어 호출자가 서버 상태를
  // 다시 읽게 한다. 실측: 하위 하나를 제거하고 완료된 일감을 하위로 추가하면
  // 제거는 반영되고 추가만 409였는데 화면은 제거 전 목록을 그대로 보여줬고,
  // 취소를 눌러도 서버엔 없는 하위가 다시 나타났다.
  //
  // 실패한 요청이 **어느 일감 것인지도 붙인다.** 완료 잠금·권한 거절은 상대
  // 일감 때문에 나는데 서버 메시지만 그대로 띄우면 지금 편집하던 일감이 잠긴
  // 것처럼 읽힌다.
  let applied = 0
  const step = async (label, fn) => {
    const result = await fn().catch((err) => {
      err.appliedRelations = applied
      if (label) err.message = `${label}: ${err.message}`
      throw err
    })
    applied += 1
    return result
  }
  // 관계 변화는 목록의 차집합이다 — 제거는 before∖after, 추가는 after∖before.
  const missingFrom = (list, other) => {
    const otherIds = new Set(other.map((t) => t.id))
    return list.filter((t) => !otherIds.has(t.id))
  }

  for (const child of missingFrom(before.subtasks, after.subtasks)) {
    await step(`하위 작업 제거 실패(${child.title})`, () => setParent(child, null))
  }
  for (const successor of missingFrom(before.blockingTasks, after.blockingTasks)) {
    await step(`후행 일감 제거 실패(${successor.title})`, () => setBlocking(successor, 'DELETE'))
  }

  const updated = await step(null, patchSelf)

  for (const child of missingFrom(after.subtasks, before.subtasks)) {
    await step(`하위 작업 추가 실패(${child.title})`, () => setParent(child, taskId))
  }
  for (const successor of missingFrom(after.blockingTasks, before.blockingTasks)) {
    await step(`후행 일감 추가 실패(${successor.title})`, () => setBlocking(successor, 'POST'))
  }

  return updated
}

// 새 담당자를 지정할 때는 프로젝트 멤버여야 하지만(서버가 강제), 이미 나간
// 담당자를 그대로 유지하는 경우까지 select에서 사라지면 안 되므로(스펙 4.4)
// 현재 담당자가 멤버 목록에 없어도 옵션에 끼워 넣는다.
//
// `excludeUserId`로 상대 역할(담당자↔검수자)에 이미 배정된 사람을 목록에서
// 뺀다 — 담당자와 검수자는 같은 사람일 수 없고(서버도 막는다), 애초에 고를 수
// 없게 하는 쪽이 저장 후 에러를 보는 것보다 낫다.
function buildPersonOptions(members, current, emptyLabel, excludeUserId) {
  const options = [
    { value: '', label: emptyLabel },
    ...members.filter((m) => m.id !== excludeUserId).map((m) => ({ value: m.id, label: m.name })),
  ]
  if (current?.id && current.id !== excludeUserId && !members.some((m) => m.id === current.id)) {
    options.push({ value: current.id, label: `${current.name} (프로젝트 미참여)` })
  }
  return options
}

function TaskFormPage() {
  const { projectId, taskId } = useParams()
  const navigate = useNavigate()
  const isNew = !taskId

  const [project, setProject] = useState(null)
  const [members, setMembers] = useState([])
  const [allTasks, setAllTasks] = useState([])
  const [task, setTask] = useState(null)
  const [links, setLinks] = useState(EMPTY_LINKS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  // 관계를 **가장 최근에 삭제한 섹션** 하나. 그 섹션의 입력창 아래에만 저장
  // 안내를 띄운다 — 삭제할 때마다 안내가 쌓이면 상자가 안내문구로 도배된다.
  // 추가는 이 값을 건드리지 않는다(안내는 다음 삭제 때 옮겨간다).
  const [lastRemoved, setLastRemoved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 상태가 바뀌면 검수 이력과 활동 로그를 새로 불러와야 한다 — 둘 다 자체
  // fetch를 하는 컴포넌트라 이 키를 올려 다시 읽게 한다.
  const [reloadKey, setReloadKey] = useState(0)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [pendingTransition, setPendingTransition] = useState(null)

  // 일감 A에서 B로 이동해도 /tasks/:projectId/:taskId 는 같은 라우트라 React
  // Router가 이 컴포넌트를 재사용한다(params만 바뀐다). editing은 지역 state라
  // 그대로 남아서 **B도 수정모드로 열린다** — 브라우저 뒤로/앞으로 가기로도
  // 같은 일이 생긴다. 일감이 바뀌면 조회 모드로 되돌린다.
  useEffect(() => {
    if (!isNew) setEditing(false)
  }, [taskId, isNew])

  // 저장·취소·다른 일감으로 이동 — 수정모드를 벗어나는 모든 경로에서 안내를 끈다.
  useEffect(() => {
    if (!editing) setLastRemoved(null)
  }, [editing])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const requests = [
          apiFetch(`/api/projects/${projectId}`),
          apiFetch(`/api/projects/${projectId}/members`),
          apiFetch(`/api/projects/${projectId}/tasks`),
        ]
        if (!isNew) {
          requests.push(apiFetch(`/api/projects/${projectId}/tasks/${taskId}`))
          requests.push(apiFetch(`/api/projects/${projectId}/tasks/${taskId}/links`))
        }
        const [projectData, memberData, taskListData, taskData, linksData] = await Promise.all(requests)
        if (cancelled) return
        setProject(projectData)
        setMembers(memberData)
        setAllTasks(taskListData)
        if (taskData) {
          setTask(taskData)
          setLinks(linksData)
          setDraft(draftFromTask(taskData, linksData))
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId, isNew])

  // 저장이 중간에 실패했을 때 화면을 서버 상태로 되돌린다. 로드 이펙트와 달리
  // 프로젝트·멤버·일감 목록은 다시 읽지 않는다 — 그건 바뀌지 않았다.
  const reloadTask = async () => {
    const [taskData, linksData] = await Promise.all([
      apiFetch(`/api/projects/${projectId}/tasks/${taskId}`),
      apiFetch(`/api/projects/${projectId}/tasks/${taskId}/links`),
    ])
    setTask(taskData)
    setLinks(linksData)
    setDraft(draftFromTask(taskData, linksData))
  }

  // 자기 자신은 스스로의 부모/자식/연결로 고를 수 없다. GET .../tasks(목록)의
  // 풍부한 형태가 아니라 GET .../links가 돌려주는 것과 같은 가벼운 형태로
  // 맞춰둔다 — 그래야 isDirty 비교(JSON.stringify)가 "같은 일감인데 다른
  // 모양"으로 어긋나지 않는다.
  const linkCandidates = useMemo(
    () =>
      allTasks
        .filter((t) => t.id !== taskId)
        .map((t) => ({ id: t.id, title: t.title, type: t.type, grade: t.grade, status: t.status })),
    [allTasks, taskId],
  )

  const setRelatedTasks = (tasks) => setDraft((d) => ({ ...d, relatedTasks: tasks }))
  const setBlockedByTasks = (tasks) => setDraft((d) => ({ ...d, blockedByTasks: tasks }))
  const setParentTask = (parentTask) => setDraft((d) => ({ ...d, parentTask }))
  // 함수형 업데이트를 받는다 — 피커에서 연달아 빠르게 추가/제거하면 두 핸들러가
  // 같은 렌더 시점의 오래된 배열을 각자 붙잡아 나중 것이 앞 것을 덮어쓴다.
  const setSubtasks = (updater) => setDraft((d) => ({ ...d, subtasks: updater(d.subtasks) }))
  const setBlockingTasks = (updater) => setDraft((d) => ({ ...d, blockingTasks: updater(d.blockingTasks) }))

  const memberUsers = useMemo(() => members.map((m) => m.user), [members])
  const mentionUsersById = useMemo(() => new Map(memberUsers.map((m) => [m.id, m])), [memberUsers])
  const assigneeOptions = useMemo(
    () => buildPersonOptions(memberUsers, task?.assignee, '미배정', draft.reviewerId || null),
    [memberUsers, task, draft.reviewerId],
  )
  const reviewerOptions = useMemo(
    () => buildPersonOptions(memberUsers, task?.reviewer, '미지정', draft.assigneeId || null),
    [memberUsers, task, draft.assigneeId],
  )

  const dateProblem = draft.startAt && draft.endAt && draft.startAt > draft.endAt ? '시작일은 종료일보다 늦을 수 없습니다' : ''

  // 프로젝트 기간 검사는 엑셀 일괄등록 검수 화면과 규칙이 같아야 해서
  // taskFields.js에 모아두고 여기서는 쓰기만 한다(서버도 같은 규칙을 강제한다).
  const periodLabel = useMemo(() => projectPeriodLabel(project), [project])
  const dateOutOfProjectRange = useMemo(
    () => isOutsideProjectPeriod(project, [draft.startAt, draft.endAt]),
    [draft.startAt, draft.endAt, project],
  )

  const isDirty = useMemo(() => {
    if (!editing) return false
    const baseline = task ? draftFromTask(task, links) : EMPTY_DRAFT
    return JSON.stringify(draft) !== JSON.stringify(baseline)
  }, [editing, task, links, draft])

  const goToTasks = () => navigate('/tasks')

  const requestGoToTasks = () => {
    if (isDirty && !window.confirm('저장하지 않은 변경이 있습니다. 나갈까요?')) return
    goToTasks()
  }

  const cancelEdit = () => {
    if (isNew) {
      goToTasks()
      return
    }
    setDraft(draftFromTask(task, links))
    setEditing(false)
    setError('')
  }

  const save = async (event) => {
    event.preventDefault()
    // 프로젝트 기간을 벗어난 날짜는 저장하지 않는다(사용자 확인) — 버튼도
    // 비활성이지만, Enter 키로 폼이 제출되는 경로가 따로 있어 여기서도 막는다.
    if (dateProblem || dateOutOfProjectRange) return
    setSaving(true)
    try {
      const newLinks = {
        related: draft.relatedTasks,
        blockedBy: draft.blockedByTasks,
        blocking: draft.blockingTasks,
      }
      const body = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        type: draft.type,
        grade: draft.grade,
        assigneeId: draft.assigneeId || null,
        reviewerId: draft.reviewerId || null,
        startAt: draft.startAt || null,
        endAt: draft.endAt || null,
        parentTaskId: draft.parentTask?.id || null,
        relatedTaskIds: newLinks.related.map((t) => t.id),
        blockedByTaskIds: newLinks.blockedBy.map((t) => t.id),
        followerIds: draft.followers.map((f) => f.id),
      }
      if (isNew) {
        const created = await apiFetch(`/api/projects/${projectId}/tasks`, { method: 'POST', body })
        // 신규 일감은 방금 id가 생겼으므로 상대에게 보낼 요청을 이제야 만들 수
        // 있다. 아직 아무 관계도 없는 상태에서 시작하니 제거 단계는 비어 있다.
        //
        // **관계가 실패해도 일감은 이미 만들어졌다.** 그래서 여기서 던지게 두면
        // 안 된다 — 등록 화면에 그대로 머물면 사용자가 저장을 다시 눌러 같은
        // 일감을 한 번 더 만든다(실측: 완료된 일감을 하위로 걸면 409가 나고
        // 만들기를 다시 누를 때 사본이 생겼다). 상세로 옮긴 뒤 무엇이 안 됐는지만
        // 알린다. 옮기고 나면 taskId가 생겨 로드 이펙트가 관계를 다시 읽어온다.
        let relationError = ''
        try {
          await applyRelationChanges(projectId, created.id, { subtasks: [], blockingTasks: [] }, draft, async () => created)
        } catch (err) {
          relationError = `일감은 등록됐지만 일부 관계를 반영하지 못했습니다: ${err.message}`
        }
        // /tasks/new and /tasks/:taskId render the same component — set state
        // before navigating so the transition never renders with `task` still
        // null (isNew flips to false as soon as the URL changes, regardless
        // of whether the navigation actually remounts this component).
        const createdWithSubtasks = withSubtasks(created, draft.subtasks)
        setTask(createdWithSubtasks)
        setLinks(newLinks)
        setDraft(draftFromTask(createdWithSubtasks, newLinks))
        setEditing(false)
        setError(relationError)
        navigate(`/tasks/${projectId}/${created.id}`, { replace: true })
      } else {
        // 상대 일감을 고치는 관계(하위·후행)까지 함께 반영한다. 편집을 시작할
        // 때의 상태(task/links에서 만든 baseline)와 지금 draft를 비교해 달라진
        // 것만 보낸다 — 순서는 applyRelationChanges의 주석 참고.
        const baseline = draftFromTask(task, links)
        const updated = await applyRelationChanges(projectId, taskId, baseline, draft, () =>
          apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body }),
        )
        setTask(withSubtasks(updated, draft.subtasks))
        setLinks(newLinks)
        setEditing(false)
        setError('')
      }
    } catch (err) {
      // 앞선 요청이 이미 반영된 채로 멈췄으면 화면이 서버와 어긋난다 —
      // 저장 전 draft를 계속 보여주다가 취소를 누르면 서버엔 없는 관계가
      // 다시 나타난다. 그때만 서버에서 다시 읽어온다(반영된 게 없으면
      // 사용자가 입력한 것을 지우지 않는 쪽이 낫다).
      if (err.appliedRelations > 0) {
        setError(`${err.message} — 앞선 변경 일부가 이미 반영되어 최신 상태를 다시 불러왔습니다`)
        await reloadTask().catch(() => {})
      } else {
        setError(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  // 상태는 조회 화면에서만 바꾼다(수정 폼에는 상태 필드가 없다) — 칸반의
  // 드래그와 같은 흐름이고, 어떤 전이가 가능한지는 서버가 계산해준
  // task.allowedTransitions가 정한다.
  const applyUpdatedTask = (updated) => {
    // withSubtasks — 상태 전이 응답에도 하위 작업의 제목이 실려오지 않는다.
    const next = withSubtasks(updated, task.subtasks || [])
    setTask(next)
    // 검수요청은 검수자까지 함께 바꾸므로 draft도 다시 맞춘다. 이 경로는 조회
    // 모드에서만 도달하므로 편집 중인 입력을 덮어쓸 일은 없다.
    setDraft(draftFromTask(next, links))
    setReloadKey((k) => k + 1)
  }

  const requestStatusChange = async (nextStatus) => {
    const transition = task.allowedTransitions?.find((t) => t.to === nextStatus)
    if (!transition) return
    // 검수중으로 들어갈 때는 검수요청 팝업, 검수중에서 뒤로 나올 때는 반려사유
    // 팝업. 그 외(진행 시작·최종완료·재오픈)는 확인 없이 바로 처리한다.
    if (transition.requires === 'request' || transition.requires === 'reject') {
      setPendingTransition(transition)
      return
    }
    setStatusUpdating(true)
    try {
      const { task: updated, uploadError } = await submitStatusChange(projectId, taskId, { status: nextStatus })
      applyUpdatedTask(updated)
      setError(uploadError)
    } catch (err) {
      setError(err.message)
    } finally {
      setStatusUpdating(false)
    }
  }

  // 팝업에서 온 제출은 에러를 삼키지 않고 그대로 던진다 — 팝업이 스스로 잡아
  // 자기 안에 표시하고 열린 채로 남는다(입력한 내용을 잃지 않게).
  const submitPendingTransition = async (payload) => {
    const { task: updated, uploadError } = await submitStatusChange(projectId, taskId, {
      status: pendingTransition.to,
      ...payload,
    })
    applyUpdatedTask(updated)
    setError(uploadError)
    setPendingTransition(null)
  }

  const remove = async () => {
    if (!window.confirm('일감을 삭제할까요? 첨부파일과 댓글도 함께 삭제됩니다.')) return
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
      goToTasks()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      </div>
    )
  }

  // 계층(상위/하위)과 관계(선행/후행/연결)를 **테두리 하나**로 묶는다. 두
  // 컴포넌트가 각자 상자를 그리면 상세페이지에 같은 테두리가 두 개 겹쳐 보인다
  // (사용자 요청 2026-09-10).
  //
  // 대신 "보여줄 게 하나도 없으면 상자를 아예 그리지 않는다"는 판단이 부모 몫이
  // 됐다 — 자식이 아무것도 렌더하지 않아도 부모는 렌더 전에 그걸 알 수 없으므로,
  // 두 컴포넌트에 넘기는 것과 같은 데이터를 여기서 직접 본다.
  const hasAnyRelation =
    Boolean(draft.parentTask) ||
    draft.subtasks.length > 0 ||
    draft.blockedByTasks.length > 0 ||
    draft.blockingTasks.length > 0 ||
    draft.relatedTasks.length > 0

  // 조회·편집 양쪽에서 완전히 같은 모양이라 한 번만 만들어 두고, 편집 중에는 폼
  // 안(저장 버튼 위)에, 조회 중에는 체크리스트 다음 자리에 끼워 넣는다 —
  // 상세페이지의 배치 순서가 스펙 9장에 정해져 있다.
  const relationSections = (editing || hasAnyRelation) && (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <TaskSubtasks
        projectId={projectId}
        editing={editing}
        candidates={linkCandidates}
        parentTask={draft.parentTask}
        onParentChange={setParentTask}
        subtasks={draft.subtasks}
        onSubtasksChange={setSubtasks}
        related={draft.relatedTasks}
        lastRemoved={lastRemoved}
        onRemoved={setLastRemoved}
      />
      <TaskLinks
        projectId={projectId}
        editing={editing}
        candidates={linkCandidates}
        related={draft.relatedTasks}
        onRelatedChange={setRelatedTasks}
        blockedBy={draft.blockedByTasks}
        onBlockedByChange={setBlockedByTasks}
        blocking={draft.blockingTasks}
        onBlockingChange={setBlockingTasks}
        parentTask={draft.parentTask}
        subtasks={draft.subtasks}
        lastRemoved={lastRemoved}
        onRemoved={setLastRemoved}
      />
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      <button
        type="button"
        onClick={requestGoToTasks}
        className="mb-4 inline-block text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white"
      >
        ← 일감 ({project?.name})
      </button>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {isNew ? '새 일감' : '일감 수정'}
          </h2>

          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="제목"
            autoFocus
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              유형
              <select
                value={draft.type}
                onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              등급
              <select
                value={draft.grade}
                onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {TASK_GRADES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              담당자
              <select
                value={draft.assigneeId}
                onChange={(e) => setDraft((d) => ({ ...d, assigneeId: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {assigneeOptions.map((o) => (
                  <option key={o.value || 'none'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              검수자
              <select
                value={draft.reviewerId}
                onChange={(e) => setDraft((d) => ({ ...d, reviewerId: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {reviewerOptions.map((o) => (
                  <option key={o.value || 'none'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            담당자와 검수자는 같은 사람으로 지정할 수 없어요 — 한쪽에 배정된 사람은 다른 쪽 목록에서 빠집니다.
          </p>

          <div className="flex gap-2">
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              시작일
              <input
                type="date"
                value={draft.startAt}
                onChange={(e) => setDraft((d) => ({ ...d, startAt: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              종료일
              <input
                type="date"
                value={draft.endAt}
                onChange={(e) => setDraft((d) => ({ ...d, endAt: e.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <div className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              등록일
              <p className="mt-1 rounded-md border border-transparent px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                {isNew ? formatDate(new Date().toISOString()) : formatDate(task.createdAt)}
              </p>
            </div>
          </div>
          {dateProblem && <p className="text-sm text-red-600 dark:text-red-400">{dateProblem}</p>}
          {dateOutOfProjectRange && (
            <p className="text-sm text-red-600 dark:text-red-400">
              프로젝트 기간을 벗어난 날짜예요. 프로젝트 기간을 확인하세요. ({periodLabel})
            </p>
          )}

          {/* 참조자는 전체 폭을 쓰는 별도의 줄 — 여러 명이 칩으로 쌓여 옆 필드와
              나란히 두면 줄 높이가 들쭉날쭉해진다. */}
          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">참조자</p>
            <FollowerPicker
              members={memberUsers}
              followers={draft.followers}
              onChange={(followers) => setDraft((d) => ({ ...d, followers }))}
            />
          </div>

          <div>
            {/* Not a <label> — it would wrap the editor's own toolbar buttons,
                and a label's click-forwarding to its first focusable control
                can steal focus/activate that button on an unrelated click. */}
            <p className="text-xs text-gray-500 dark:text-gray-400">본문</p>
            <div className="mt-1">
              <MarkdownEditor
                value={draft.description}
                onChange={(md) => setDraft((d) => ({ ...d, description: md }))}
                mentionMembers={memberUsers}
                mentionUsersById={mentionUsersById}
                placeholder="본문을 입력하세요"
              />
            </div>
          </div>

          {relationSections}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !draft.title.trim() || Boolean(dateProblem) || dateOutOfProjectRange}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? '저장 중...' : isNew ? '만들기' : '저장'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{task.title}</h2>
            <div className="flex shrink-0 gap-2">
              {task.canModify && (
                <button
                  type="button"
                  onClick={() => {
                    // Re-sync from the latest task — a quick status change
                    // via the select just below can otherwise land between
                    // this click and load, and the stale draft would then
                    // overwrite it back on save.
                    setDraft(draftFromTask(task, links))
                    setEditing(true)
                  }}
                  className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                >
                  수정
                </button>
              )}
              {task.canDelete && (
                <button type="button" onClick={remove} className="text-sm text-red-600 hover:text-red-500 dark:text-red-400">
                  삭제
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {TASK_TYPES.find((t) => t.value === task.type)?.label}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {TASK_GRADES.find((g) => g.value === task.grade)?.label}
            </span>
            {/* 갈 수 있는 상태만 옵션으로 뜬다 — 어떤 전이가 가능한지는 역할과
                현재 상태에 따라 서버가 계산해서 내려준다(allowedTransitions). */}
            {task.allowedTransitions?.length > 0 ? (
              <select
                value={task.status}
                onChange={(e) => requestStatusChange(e.target.value)}
                disabled={statusUpdating}
                className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {statusOptions(task.status, task.allowedTransitions).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {taskStatusLabel(task.status)}
              </span>
            )}
          </div>

          {/* 완료된 일감은 통째로 잠긴다 — 수정 버튼이 사라지는 이유를 알려주지
              않으면 버그로 읽힌다(docs/task-review-spec.md 8장). */}
          {task.status === 'done' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              완료된 일감은 수정할 수 없어요. 내용을 고쳐야 하면 PM 또는 등록자가 상태를 진행중으로 되돌려주세요(댓글은 계속
              쓸 수 있어요).
            </p>
          )}

          {task.description && <MarkdownContent text={task.description} mentionUsersById={mentionUsersById} />}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
            <div>
              <dt className="mb-1">담당자</dt>
              <dd className="flex items-center gap-1.5">
                {task.assignee ? (
                  <span className={`flex items-center gap-1.5 ${!task.assigneeIsMember ? 'opacity-50' : ''}`}>
                    <Avatar user={task.assignee} />
                    {task.assignee.name}
                    {!task.assigneeIsMember && ' (프로젝트 미참여)'}
                  </span>
                ) : (
                  '미배정'
                )}
              </dd>
            </div>
            <div>
              <dt className="mb-1">검수자</dt>
              <dd className="flex items-center gap-1.5">
                {task.reviewer ? (
                  <span className={`flex items-center gap-1.5 ${!task.reviewerIsMember ? 'opacity-50' : ''}`}>
                    <Avatar user={task.reviewer} />
                    {task.reviewer.name}
                    {!task.reviewerIsMember && ' (프로젝트 미참여)'}
                  </span>
                ) : (
                  '미지정'
                )}
              </dd>
            </div>
            <div>
              <dt className="mb-1">등록자</dt>
              <dd>{task.createdBy?.name || '등록자 미상'}</dd>
            </div>
            <div>
              <dt className="mb-1">시작일 ~ 종료일</dt>
              <dd>
                {formatDate(task.startAt) || '?'} ~ {formatDate(task.endAt) || '?'}
              </dd>
            </div>
            <div>
              <dt className="mb-1">등록일</dt>
              <dd>{formatDate(task.createdAt)}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">참조자</p>
            <FollowerList followers={task.followers || []} />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      {!isNew && (
        <>
          <hr className="my-4 border-gray-100 dark:border-gray-800" />
          <div className="mb-4">
            <TaskReviewHistory projectId={projectId} taskId={taskId} reloadKey={reloadKey} />
          </div>
          <div className="mb-4">
            <TaskChecklist projectId={projectId} taskId={taskId} canModify={task.canModify} />
          </div>
          {!editing && relationSections && <div className="mb-4">{relationSections}</div>}
          <div className="mb-4">
            <TaskAttachments projectId={projectId} taskId={taskId} canModify={task.canModify} />
          </div>
          <hr className="my-4 border-gray-100 dark:border-gray-800" />
          <TaskComments projectId={projectId} taskId={taskId} members={memberUsers} />
          <hr className="my-4 border-gray-100 dark:border-gray-800" />
          <TaskActivityLog projectId={projectId} taskId={taskId} reloadKey={reloadKey} />
        </>
      )}

      {pendingTransition && (
        <TaskStatusDialog
          projectId={projectId}
          task={task}
          members={memberUsers}
          requires={pendingTransition.requires}
          toStatus={pendingTransition.to}
          onCancel={() => setPendingTransition(null)}
          onSubmit={submitPendingTransition}
        />
      )}
    </div>
  )
}

export default TaskFormPage
