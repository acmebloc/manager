import { Router } from 'express'
import { prisma } from '../db.js'
import { decryptUser } from '../lib/fieldCrypto.js'
import { resolveMentionText } from '../lib/mentionText.js'

// 매니저 자체 데이터(프로젝트/일감/댓글/일정/첨부파일명/사용자)만 대상 —
// 게시판(BookStack)은 별도 시스템·별도 권한 모델이라 이번 범위 밖.
const router = Router()

// 멘션 치환(resolveMentionText)은 id/name만 읽는다 — email/picture까지 선택하면
// 댓글마다·멘션마다 쓰지도 않을 필드를 매번 복호화(fieldCrypto.js의 실제 AES
// 연산)하게 된다. deactivatedAt은 decryptUser가 탈퇴자 이름 마스킹에 쓰므로 필요.
const mentionUserSelect = { id: true, name: true, deactivatedAt: true }
const mentionInclude = { mentions: { select: { user: { select: mentionUserSelect } } } }

const PAGE_SIZE = 30
// 제목/이름(주 필드) 완전 일치 > 부분 일치 > 설명·본문(보조 필드) 부분 일치.
// 동점이면 정렬 단계에서 최신순으로 한 번 더 가른다.
const SCORE_EXACT = 100
const SCORE_PRIMARY = 70
const SCORE_SECONDARY = 40

function containsQuery(text, q) {
  return Boolean(text) && text.toLowerCase().includes(q.toLowerCase())
}

// Postgres의 LIKE/ILIKE는 '%'와 '_'를 와일드카드로, '\'를 그 자체의 이스케이프
// 문자로 해석한다 — 검색어에 그 글자들이 그대로 들어있으면(예: 파일명
// "revenue_90%.xlsx") 사용자가 입력한 적 없는 다른 문자와도 위치상 우연히
// 매치되는 결과가 섞여 나온다. Prisma의 contains는 이걸 대신 이스케이프해주지
// 않으므로 DB에 넘기기 전에 직접 처리한다.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function matchScore(q, primary, secondary) {
  if ((primary || '').toLowerCase() === q.toLowerCase()) return SCORE_EXACT
  if (containsQuery(primary, q)) return SCORE_PRIMARY
  if (containsQuery(secondary, q)) return SCORE_SECONDARY
  return null
}

// 매치 지점 앞뒤로 일부만 잘라 미리보기를 만든다. 매치를 못 찾으면(제목만
// 매치되고 이 필드는 그냥 보여주기용일 때) 앞부분만 자른다.
function buildSnippet(text, q, radius = 40) {
  if (!text) return ''
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

async function memberProjectIds(userId) {
  const memberships = await prisma.projectMember.findMany({ where: { userId }, select: { projectId: true } })
  return memberships.map((m) => m.projectId)
}

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim()
  const sort = req.query.sort === 'latest' ? 'latest' : 'relevance'
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)

  if (!q) return res.json({ query: q, sort, page: 1, pageSize: PAGE_SIZE, total: 0, results: [] })

  // 사이트 어드민은 프로젝트/일감/댓글/일정 전체가 대상 — projects.js의 GET /
  // 과 동일한 예외. 사용자(전사 디렉토리)는 애초에 프로젝트 소속과 무관하게
  // 전원이 대상이라 이 스코프와 별개.
  const isSiteAdmin = req.user.isSiteAdmin
  const projectIds = isSiteAdmin ? [] : await memberProjectIds(req.user.id)
  const projectScope = isSiteAdmin ? {} : { id: { in: projectIds } }
  const taskProjectScope = isSiteAdmin ? {} : { projectId: { in: projectIds } }
  const textContains = { contains: escapeLikePattern(q), mode: 'insensitive' }

  const [projects, tasks, taskComments, projectComments, schedules, attachments, users] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectScope, OR: [{ name: textContains }, { description: textContains }] },
      select: { id: true, name: true, description: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: { ...taskProjectScope, OR: [{ title: textContains }, { description: textContains }] },
      select: {
        id: true,
        projectId: true,
        title: true,
        description: true,
        updatedAt: true,
        project: { select: { name: true } },
      },
    }),
    // 댓글은 :mention[userId] 마커를 이름으로 치환한 뒤에야 진짜 매치 여부를
    // 알 수 있어(치환 전 원문엔 이름 글자가 아예 없음) DB에서 먼저 걸러낼 수
    // 없다 — 프로젝트 범위로만 좁혀서 전부 가져온 뒤 아래에서 자바스크립트로
    // 매칭한다. myTasks.js가 "내가 속한 프로젝트 전체"를 페이지네이션 없이
    // 읽는 것과 같은 크기의 비용.
    prisma.taskComment.findMany({
      where: { task: taskProjectScope },
      select: {
        id: true,
        body: true,
        updatedAt: true,
        ...mentionInclude,
        task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
      },
    }),
    prisma.projectComment.findMany({
      where: { project: projectScope },
      select: {
        id: true,
        body: true,
        updatedAt: true,
        ...mentionInclude,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.schedule.findMany({
      where: {
        title: textContains,
        // schedules.js의 두 가지 가시성 규칙(전체 목록의 owner-or-project-member,
        // personalOnly의 owner-or-follower)을 합친 것 — 검색은 두 화면 어디서든
        // 보이는 일정을 전부 포함해야 한다. 사이트 어드민은 스케줄 GET /와
        // 동일하게 개인 일정을 포함해 전체를 본다.
        ...(isSiteAdmin
          ? {}
          : {
              OR: [
                { ownerId: req.user.id },
                { projectId: { in: projectIds } },
                { projectId: null, followers: { some: { userId: req.user.id } } },
              ],
            }),
      },
      select: { id: true, title: true, projectId: true, updatedAt: true, project: { select: { name: true } } },
    }),
    prisma.taskAttachment.findMany({
      where: { fileName: textContains, task: taskProjectScope },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
        task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
      },
    }),
    // 이름/이메일은 사용자별로 매번 다른 IV로 암호화돼 있어 SQL로 검색이
    // 안 된다(fieldCrypto.js) — /api/users와 동일하게 전체를 복호화해 메모리에서
    // 비교한다. 사이트 규모에서는 문제없고, 프로젝트 소속과 무관하게 전사
    // 디렉토리 전체가 대상이라 스코프 필터도 없다.
    prisma.user.findMany({
      where: { deactivatedAt: null },
      select: { id: true, name: true, email: true },
    }),
  ])

  const results = []

  for (const p of projects) {
    // DB의 contains는 스코프만 좁혀줄 뿐 진짜 매치 여부는 항상 이 자바스크립트
    // 쪽 결과를 신뢰한다 — 와일드카드 이스케이프를 빠뜨리는 등 DB와 여기가
    // 어긋나는 경우가 생겨도, 실제로는 매치가 아닌 행이 기본 점수를 받아
    // 결과에 섞여 들어가는 대신 조용히 빠진다.
    const score = matchScore(q, p.name, p.description)
    if (score === null) continue
    results.push({
      id: `project:${p.id}`,
      kind: 'project',
      label: '프로젝트',
      title: p.name,
      snippet: containsQuery(p.description, q) ? buildSnippet(p.description, q) : '',
      meta: null,
      link: `/projects/${p.id}`,
      timestamp: p.updatedAt,
      score,
    })
  }

  for (const t of tasks) {
    const score = matchScore(q, t.title, t.description)
    if (score === null) continue
    results.push({
      id: `task:${t.id}`,
      kind: 'task',
      label: '일감',
      title: t.title,
      snippet: containsQuery(t.description, q) ? buildSnippet(t.description, q) : '',
      meta: t.project.name,
      link: `/tasks/${t.projectId}/${t.id}`,
      timestamp: t.updatedAt,
      score,
    })
  }

  // 일감 댓글/프로젝트 댓글 모두 "댓글" 라벨로 통일 — 어디 소속인지는 title/meta로 구분한다.
  for (const c of taskComments) {
    const resolved = resolveMentionText(c.body, c.mentions.map((m) => ({ user: decryptUser(m.user) })))
    const score = matchScore(q, resolved, null)
    if (score === null) continue
    results.push({
      id: `taskComment:${c.id}`,
      kind: 'taskComment',
      label: '댓글',
      title: c.task.title,
      snippet: buildSnippet(resolved, q),
      meta: c.task.project.name,
      link: `/tasks/${c.task.projectId}/${c.task.id}`,
      timestamp: c.updatedAt,
      score,
    })
  }

  for (const c of projectComments) {
    const resolved = resolveMentionText(c.body, c.mentions.map((m) => ({ user: decryptUser(m.user) })))
    const score = matchScore(q, resolved, null)
    if (score === null) continue
    results.push({
      id: `projectComment:${c.id}`,
      kind: 'projectComment',
      label: '댓글',
      title: c.project.name,
      snippet: buildSnippet(resolved, q),
      meta: null,
      link: `/projects/${c.project.id}#comments`,
      timestamp: c.updatedAt,
      score,
    })
  }

  for (const s of schedules) {
    const score = matchScore(q, s.title, null)
    if (score === null) continue
    results.push({
      id: `schedule:${s.id}`,
      kind: 'schedule',
      label: '일정',
      title: s.title,
      snippet: '',
      meta: s.project?.name || '개인 일정',
      link: s.projectId ? `/schedule?projectId=${s.projectId}` : '/schedule',
      timestamp: s.updatedAt,
      score,
    })
  }

  for (const a of attachments) {
    const score = matchScore(q, a.fileName, null)
    if (score === null) continue
    results.push({
      id: `attachment:${a.id}`,
      kind: 'taskAttachment',
      label: '첨부파일',
      title: a.fileName,
      snippet: '',
      meta: `${a.task.project.name} · ${a.task.title}`,
      link: `/tasks/${a.task.projectId}/${a.task.id}`,
      timestamp: a.createdAt,
      score,
    })
  }

  for (const u of users) {
    const decrypted = decryptUser(u)
    const score = matchScore(q, decrypted.name, decrypted.email)
    if (score === null) continue
    results.push({
      id: `user:${u.id}`,
      kind: 'user',
      label: '사용자',
      title: decrypted.name,
      snippet: decrypted.email,
      meta: null,
      link: null,
      avatarUrl: `/api/avatar/${u.id}`,
      // users.js(전사 디렉토리)는 가입일을 아무한테도 안 보여준다 — 이 결과도
      // 맞춰서 join date를 응답에 싣지 않는다. null이면 정렬 비교에서
      // new Date(null) = epoch(1970)로 계산돼 최신순에서 항상 맨 뒤로 밀릴
      // 뿐, 에러는 나지 않는다.
      timestamp: null,
      score,
    })
  }

  results.sort((a, b) => {
    if (sort === 'latest') return new Date(b.timestamp) - new Date(a.timestamp) || a.id.localeCompare(b.id)
    return b.score - a.score || new Date(b.timestamp) - new Date(a.timestamp) || a.id.localeCompare(b.id)
  })

  const total = results.length
  const start = (page - 1) * PAGE_SIZE
  const paged = results.slice(start, start + PAGE_SIZE).map(({ score: _score, ...rest }) => rest)

  res.json({ query: q, sort, page, pageSize: PAGE_SIZE, total, results: paged })
})

export default router
