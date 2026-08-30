import { prisma } from '../db.js'

// 프로젝트별 BookStack 공간(Shelf) 자동 생성 + 권한 동기화. docs/bookstack-patches.md의
// BookStack 쪽 커스터마이징과 짝을 이루는 Manager 쪽 절반 — 명칭은 항상 공간/문서함/
// 섹션/문서로 통일해서 로그·에러 메시지에 쓴다.
//
// 느슨한 결합이 설계 원칙이다: 이 파일의 모든 공개 함수는 절대 throw하지 않고
// 실패를 삼켜서(mailer.js와 같은 패턴) 호출부(프로젝트/멤버 라우트)의 API 응답을
// 절대 막지 않는다. 대신 Project.bookstackSyncError에 마지막 실패 사유를 남겨서
// PM이 나중에 재시도(POST /:id/bookstack-sync)할 수 있게 한다.
//
// BookStack은 권한을 "역할(Role)" 단위로만 부여한다 — 개별 사용자에게 직접 권한을
// 줄 방법이 없다. 그래서 프로젝트 하나당 BookStack 역할을 하나 만들고, 그 공간·
// 문서함 3개에 "이 역할만 허용, 나머지는 거부"로 제한한 뒤, 프로젝트 멤버가 추가/
// 제외될 때마다 그 역할을 해당 사용자의 BookStack 계정에 붙이거나 뗀다.
const BOOK_NAMES = ['공지사항', 'Weekly', '자료실']

function bookstackConfigured() {
  return Boolean(
    process.env.BOOKSTACK_API_URL &&
      process.env.BOOKSTACK_API_TOKEN_ID &&
      process.env.BOOKSTACK_API_TOKEN_SECRET,
  )
}

async function bookstackRequest(method, path, body) {
  const base = process.env.BOOKSTACK_API_URL.replace(/\/+$/, '')
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Token ${process.env.BOOKSTACK_API_TOKEN_ID}:${process.env.BOOKSTACK_API_TOKEN_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  // 응답 바디가 JSON이 아닐 수 있다(장애/타임아웃 중엔 리버스 프록시의 HTML
  // 에러 페이지가 오기도 함) — res.ok보다 먼저 파싱하면 그런 경우 진짜 원인
  // 대신 JSON.parse 자체의 SyntaxError가 bookstackSyncError에 남는다.
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const message = data?.error?.message || `BookStack API ${res.status} on ${method} ${path}`
    throw new Error(message)
  }
  return data
}

async function createBook(name) {
  return bookstackRequest('POST', '/books', { name })
}

async function createShelf(name, bookIds) {
  return bookstackRequest('POST', '/shelves', { name, books: bookIds })
}

async function createProjectRole(name) {
  return bookstackRequest('POST', '/roles', { display_name: name, permissions: [] })
}

// 공간/문서함 각각에 "이 프로젝트 역할만 보임, 나머지는 전부 거부"를 건다 —
// role_permissions는 기존 걸 덮어쓰지 않고 항목을 통째로 교체하는 방식이라(BookStack
// API 사양), 지금은 프로젝트 역할 하나만 주면 되는 새 엔티티에서만 쓴다.
async function restrictToRole(contentType, contentId, roleId) {
  await bookstackRequest('PUT', `/content-permissions/${contentType}/${contentId}`, {
    role_permissions: [{ role_id: roleId, view: true, create: true, update: true, delete: true }],
    fallback_permissions: { inheriting: false, view: false, create: false, update: false, delete: false },
  })
}

async function findBookstackUserId(managerUserId) {
  const result = await bookstackRequest(
    'GET',
    `/users?filter[external_auth_id]=${encodeURIComponent(managerUserId)}`,
  )
  return result?.data?.[0]?.id ?? null
}

// 같은 BookStack 사용자에 대한 역할 갱신을 이 프로세스 안에서 순서대로만
// 실행되게 직렬화한다 — 아래 GET→PUT이 read-modify-write라서, 한 사람이 거의
// 동시에 두 프로젝트에 추가/제외되면 두 호출이 서로의 갱신을 밟고 지나가며
// 한쪽 역할 부여가 조용히 사라질 수 있다(둘 다 같은 옛 목록을 읽어버림).
const userRoleLocks = new Map()

function withUserRoleLock(key, run) {
  const previous = userRoleLocks.get(key) || Promise.resolve()
  const result = previous.then(run, run)
  // 다음 대기자를 위해 체인을 이어가되, 이번 호출이 실패해도(reject) 체인
  // 자체가 끊기지 않도록 여기서만 따로 삼킨다 — result는 그대로 호출자에게
  // 자신의 성공/실패를 돌려준다.
  userRoleLocks.set(key, result.catch(() => {}))
  return result
}

// roles는 PUT으로 전체 목록을 교체하는 방식이라, 현재 목록을 먼저 읽어와 하나만
// 더하거나 뺀 뒤 다시 통째로 저장해야 한다.
async function updateBookstackUserRoles(bookstackUserId, mutate) {
  return withUserRoleLock(bookstackUserId, async () => {
    const user = await bookstackRequest('GET', `/users/${bookstackUserId}`)
    const currentRoleIds = (user?.roles || []).map((r) => r.id)
    const nextRoleIds = mutate(currentRoleIds)
    await bookstackRequest('PUT', `/users/${bookstackUserId}`, { roles: nextRoleIds })
  })
}

// provisionProjectSpace 시작 전에 반드시 거치는 원자적 "선점" — bookstackShelfId
// null 체크만으로는 check-then-act라서, 생성 직후 자동 프로비저닝이 아직 도는
// 중에 PM이 재시도 버튼을 눌러도 두 호출 다 통과해버려 공간/문서함/역할이
// 중복 생성된다. UPDATE ... WHERE로 한 번에 확인+표시하면 Postgres가 같은 행에
// 대한 동시 UPDATE를 직렬화해주므로, 둘 중 하나만 선점에 성공한다.
const PROVISIONING_STALE_MS = 5 * 60 * 1000 // 정상 프로비저닝은 API 호출 몇 번 — 이보다 오래 걸렸으면 이전 시도가 죽은 것으로 보고 재시도를 허용한다.

async function claimProvisioning(projectId) {
  const staleBefore = new Date(Date.now() - PROVISIONING_STALE_MS)
  const claim = await prisma.project.updateMany({
    where: {
      id: projectId,
      bookstackShelfId: null,
      OR: [{ bookstackProvisioningStartedAt: null }, { bookstackProvisioningStartedAt: { lt: staleBefore } }],
    },
    data: { bookstackProvisioningStartedAt: new Date() },
  })
  return claim.count === 1
}

// 프로젝트 생성 직후 fire-and-forget으로 호출 — 절대 await하지 않는다(호출부 응답을
// BookStack API 왕복 시간에 묶어두지 않기 위해). 공간(Shelf) + 문서함 3개(공지사항/
// Weekly/자료실) + 프로젝트 전용 역할을 만들고, 지금 이 순간의 멤버 전원에게 그
// 역할을 붙인다. 도중에 실패하면 여기까지 만들어진 것(문서함 몇 개, 공간 등)은
// BookStack에 그대로 남는다 — 정리하지 않는다. 재시도(retryProjectSpace)가 다시
// 실행되면 항상 새로 만들기 때문에, 실패한 절반짜리 리소스가 계속 남는 게 이상적이진
// 않지만, 프로젝트 생성 자체를 막지 않는 느슨한 결합 쪽을 우선했다 — 정리는 나중에
// BookStack 관리자 화면에서 수동으로.
//
// 반환값은 실제로 이 호출이 선점에 성공해 작업을 실행했는지 여부 — fire-and-forget
// 호출부는 무시해도 되지만, retryProjectSpace는 이걸로 "이미 다른 시도가 진행
// 중"과 "지금 막 끝냄"을 구분해 사용자에게 다른 안내를 준다.
export async function provisionProjectSpace(projectId) {
  if (!bookstackConfigured()) return { started: false }
  if (!(await claimProvisioning(projectId))) return { started: false }
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { select: { userId: true } } },
    })
    if (!project) return { started: true } // 선점 직후 프로젝트가 삭제됨 — 아직 아무것도 안 만들었으니 그냥 중단

    const books = []
    for (const label of BOOK_NAMES) {
      const book = await createBook(label)
      books.push(book)
    }
    const shelf = await createShelf(project.name, books.map((b) => b.id))
    const role = await createProjectRole(`프로젝트: ${project.name}`)

    await restrictToRole('bookshelf', shelf.id, role.id)
    for (const book of books) {
      await restrictToRole('book', book.id, role.id)
    }

    for (const member of project.members) {
      await syncMemberRole(project.id, member.userId, 'add', { roleId: role.id })
    }

    // update가 아니라 updateMany — 만드는 도중에(여러 번의 API 왕복 사이) 이
    // 프로젝트가 삭제됐으면 던지는 대신 count:0으로 조용히 알려준다. 그래야
    // 아래에서 방금 만든 BookStack 자원을 스스로 정리할 수 있다(안 하면 DB에
    // 기록될 곳이 없어져 영구 고아가 된다).
    const updated = await prisma.project.updateMany({
      where: { id: projectId },
      data: {
        bookstackShelfId: shelf.id,
        bookstackShelfSlug: shelf.slug,
        bookstackBookIds: books.map((b) => b.id),
        bookstackRoleId: role.id,
        bookstackSyncedAt: new Date(),
        bookstackSyncError: null,
        bookstackProvisioningStartedAt: null,
      },
    })
    if (updated.count === 0) {
      await deleteProjectSpace({
        bookstackBookIds: books.map((b) => b.id),
        bookstackShelfId: shelf.id,
        bookstackRoleId: role.id,
      })
    }
    return { started: true }
  } catch (err) {
    console.error('[bookstack] provisionProjectSpace failed', { projectId, error: err.message })
    await prisma.project
      .update({
        where: { id: projectId },
        data: { bookstackSyncError: err.message, bookstackProvisioningStartedAt: null },
      })
      .catch(() => {})
    return { started: true }
  }
}

// 멤버 추가/제외 라우트에서 fire-and-forget으로 호출. 프로젝트에 아직 역할이 없거나
// (연동 전/실패 상태) 그 사용자가 BookStack에 로그인한 적이 없어 계정이 없으면
// 조용히 넘어간다 — 다음 재시도(retryProjectSpace)나 그 사용자가 처음 게시판에
// 로그인할 때 다시 시도할 기회가 있다.
export async function syncMemberRole(projectId, userId, action, opts = {}) {
  if (!bookstackConfigured()) return
  try {
    const roleId =
      opts.roleId ??
      (await prisma.project.findUnique({ where: { id: projectId }, select: { bookstackRoleId: true } }))
        ?.bookstackRoleId
    if (!roleId) return

    const bookstackUserId = await findBookstackUserId(userId)
    if (!bookstackUserId) return

    await updateBookstackUserRoles(bookstackUserId, (roleIds) =>
      action === 'add'
        ? Array.from(new Set([...roleIds, roleId]))
        : roleIds.filter((id) => id !== roleId),
    )
  } catch (err) {
    console.error('[bookstack] syncMemberRole failed', { projectId, userId, action, error: err.message })
  }
}

// 프로젝트 삭제 라우트에서 프로젝트 삭제 전에 await로 호출 — fire-and-forget이
// 아니다. 삭제 후엔 Project 행 자체가 사라져서 재시도할 대상이 없어지므로, 지금
// 이 순간 최선을 다해 정리한다. 그래도 실패해도 프로젝트 삭제 자체는 막지
// 않는다(호출부가 항상 이 함수를 무시하고 진행해도 되는 이유 — 여기서 이미
// 모든 실패를 삼킨다). 셋 다 독립적인 자원이라 하나가 실패해도 나머지는 계속
// 시도한다 — BookStack에 고아 자원이 남으면 관리자가 수동으로 정리해야 한다.
export async function deleteProjectSpace(project) {
  if (!bookstackConfigured()) return
  for (const bookId of project.bookstackBookIds || []) {
    await bookstackRequest('DELETE', `/books/${bookId}`).catch((err) =>
      console.error('[bookstack] delete book failed', { bookId, error: err.message }),
    )
  }
  if (project.bookstackShelfId) {
    await bookstackRequest('DELETE', `/shelves/${project.bookstackShelfId}`).catch((err) =>
      console.error('[bookstack] delete shelf failed', {
        shelfId: project.bookstackShelfId,
        error: err.message,
      }),
    )
  }
  if (project.bookstackRoleId) {
    await bookstackRequest('DELETE', `/roles/${project.bookstackRoleId}`).catch((err) =>
      console.error('[bookstack] delete role failed', {
        roleId: project.bookstackRoleId,
        error: err.message,
      }),
    )
  }
}

// PM이 누르는 "게시판 연동 재시도" 버튼에서 호출 — 이번엔 await해서 결과를 바로
// 응답에 반영한다. 아직 공간이 없으면 처음부터 프로비저닝, 이미 있으면 현재 멤버
// 전원의 역할 부여만 다시 맞춘다(중간에 BookStack 로그인 안 한 멤버가 이제 계정이
// 생겼을 수 있으므로).
export async function retryProjectSpace(projectId) {
  if (!bookstackConfigured()) {
    throw new Error('BookStack 연동이 서버에 설정되어 있지 않습니다')
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { select: { userId: true } } },
  })
  if (!project) throw new Error('Project not found')

  if (!project.bookstackShelfId) {
    const result = await provisionProjectSpace(projectId)
    if (!result.started) {
      throw new Error('지금 다른 연동 작업이 진행 중입니다. 잠시 후 다시 시도해주세요')
    }
  } else {
    for (const member of project.members) {
      await syncMemberRole(projectId, member.userId, 'add', { roleId: project.bookstackRoleId })
    }
    await prisma.project.update({
      where: { id: projectId },
      data: { bookstackSyncedAt: new Date(), bookstackSyncError: null },
    })
  }

  return prisma.project.findUnique({ where: { id: projectId } })
}
