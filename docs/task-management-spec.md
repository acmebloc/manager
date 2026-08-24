# 일감관리(칸반) 기능 명세

프로젝트 섹션과 권한 체계(`ProjectMember.role` = pm/pl/member, `User.isSiteAdmin`) 위에
얹는 기능. 이 문서는 구현 전 합의된 내용과 아직 정하지 못한 항목을 함께 담는다.

## 1. 범위

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 1 | Task 필드 확장, 권한 규칙, 칸반 보드, 일감 상세 | 이번 작업 |
| 1 | 댓글 + @멘션 | 이번 작업 |
| 1 | 첨부파일 | 이번 작업 (설계는 5장) |
| 2 | 멘션 알림 | 미룸 — 알림 시스템 자체가 없음 |
| 3 | 프로젝트별 BookStack 책장 자동 생성 | 미룸 |
| 마지막 | 통합 검색 | 스키마가 굳고 데이터가 쌓인 뒤 |

마크다운 에디터는 사용자가 재검토 중 — 7장 참고. 그 결정 전까지 본문/댓글은
평문 textarea로 두고, 저장 형식은 마크다운 원문 그대로라 나중에 렌더러만 얹으면 된다.

## 2. 데이터 모델

### 2.1 Task 변경

```prisma
model Task {
  id          String    @id @default(cuid())
  projectId   String
  title       String
  description String?   // 마크다운 원문, 평문 저장
  type        String    @default("dev")    // plan | dev | design | qa | (미정)
  grade       String    @default("minor")  // urgent | major | minor
  status      String    @default("todo")   // todo | doing | review | done
  createdById String?                      // 등록자. 기존 행 backfill 때문에 nullable
  assigneeId  String?                      // 미배정 허용
  startAt     DateTime?                    // 신규
  endAt       DateTime?                    // 기존 dueDate 를 rename
  createdAt   DateTime  @default(now())    // = 등록일
  updatedAt   DateTime  @updatedAt
}
```

- 유형/등급/상태는 Prisma enum이 아니라 **문자열 + 코드 레벨 검증**. 기존
  `ProjectMember.role`, `Task.status`가 이미 그 관례다.
- 상태 키는 `todo`를 그대로 살려 "등록"에 매핑한다. 덕분에 기존 행의 status
  마이그레이션이 필요 없다. 표시 라벨은 등록 / 진행 / 검수 / 완료.
- `dueDate` → `endAt` rename은 프로젝트(`startAt`/`endAt`)와 이름을 맞추기 위한 것.
  Prisma `@map`으로 컬럼명만 유지하는 대신 실제 rename 마이그레이션으로 간다.
- `createdById` backfill: 기존 행은 소속 프로젝트의 `ownerId`(= 프로젝트를 만든 사람)로
  채운다. 그래도 nullable을 유지해 이후 데이터 사고에 대비하고, null이면 UI에
  "등록자 미상"으로 표시한다. null이면 삭제 권한이 어드민만 남는다.
- 인덱스: `@@index([projectId, status])`, `@@index([assigneeId])`.

### 2.2 신규 테이블

```prisma
model TaskAttachment {
  id           String   @id @default(cuid())
  taskId       String                  // onDelete: Cascade
  fileName     String                  // 사용자에게 보여줄 원본 파일명
  mimeType     String
  size         Int
  storageKey   String   @unique        // 디스크상의 이름. 확장자 없음 (5장)
  uploadedById String?
  createdAt    DateTime @default(now())
}

model TaskComment {
  id        String   @id @default(cuid())
  taskId    String                     // onDelete: Cascade
  authorId  String
  body      String                     // 마크다운 원문, 평문 저장
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model TaskCommentMention {
  id        String @id @default(cuid())
  commentId String                     // onDelete: Cascade
  userId    String
  @@unique([commentId, userId])
}
```

- 세 테이블 모두 `taskId` → `projectId` 로 거슬러 올라갈 수 있어, 통합 검색을 붙일 때
  프로젝트 멤버십으로 권한 스코핑이 가능하다.
- 본문·파일명은 **평문**. `User.email/name/picture`만 AES-GCM 암호화 대상이고,
  응답에 사용자 정보를 실을 때는 반드시 `decryptUser()`를 통과시킨다.
- `TaskCommentMention`은 지금은 렌더링/역참조용이고, 2단계 알림에서 그대로 쓴다.

## 3. 권한 규칙

프로젝트 접근 자체는 기존 `requireProjectRole('member')`가 그대로 담당한다
(비멤버는 403이 아니라 404). 그 안에서 행 단위 권한을 추가로 검사한다.

| 동작 | 허용 대상 |
| --- | --- |
| 일감 조회 | 프로젝트 멤버 전원 (pm/pl/member) + 사이트 어드민 |
| 일감 발행 | 프로젝트 멤버 전원 + 사이트 어드민 |
| 일감 수정 | 어드민 / 등록자 / 담당자 |
| 일감 삭제 | 어드민 / 등록자 |
| 첨부 추가·삭제 | 일감 수정과 동일 |
| 댓글 작성 | 프로젝트 멤버 전원 + 사이트 어드민 |
| 댓글 수정·삭제 | 작성자 본인 (어드민 삭제 허용 여부 미정 — 8장) |

- **"어드민" 정의 (미확정, 8장)**: 이 문서는 잠정적으로 *프로젝트 PM + 사이트 어드민*으로
  본다. 사이트 어드민만으로 좁히면 PM이 자기 프로젝트의 잘못 만들어진 일감을 정리할
  수 없다. PL은 어드민이 아니다 (PL의 권한은 멤버 초대/제거까지).
- **담당자의 수정 범위**: 담당자에게도 전체 필드 수정을 허용하면 담당자를 제3자로
  넘기는 것까지 가능해진다. 담당자 변경만 어드민/등록자로 제한할지는 미정 (8장).
- **칸반 드래그 = 상태 변경 = 수정**이므로, 위 규칙대로면 **자기가 등록하거나 배정받지
  않은 카드는 드래그로 옮길 수 없다.** 권한 없는 카드는 드래그 핸들을 비활성화하고,
  서버도 동일하게 거부한다. (의도가 맞는지 8장에서 확인)
- 서버 검증은 UI 비활성화와 별개로 항상 수행한다.

## 4. 화면 구성

### 4.1 `/tasks` — 일감관리 메뉴

**프로젝트 단위로, 내가 속한 각 프로젝트에 발행된 전체 일감을 보여준다.**
(초기 요구는 "내게 배정된 일감"이었으나 "프로젝트에 발행된 전체 일감"으로 변경됨 —
9장의 기존 코드 영향 참고.)

- 내가 멤버인 프로젝트를 섹션으로 나열, 일감이 없는 프로젝트도 표시.
- 각 섹션에서 상태/담당자로 필터, "내 일감만 보기" 토글 제공.
- 섹션 제목에서 해당 프로젝트의 칸반 보드로 이동.

### 4.2 칸반 보드

진입 경로 미확정 (8장). 후보: `/projects/:id` 상세 페이지 안, 또는
`/projects/:id/board` 별도 라우트.

- 등록 / 진행 / 검수 / 완료 4개 컬럼 고정. 프로젝트별 커스텀 컬럼 없음.
- 카드: 제목, 유형·등급 배지, 담당자 아바타, 종료일, 첨부/댓글 개수.
- 컬럼 내 정렬은 자동(등급 → 종료일 → 생성일). 사용자 지정 순서(`order` 필드) 없음.
- 드래그로 상태 변경, 권한 없으면 비활성.

### 4.3 일감 상세

사이드 패널 또는 모달. 제목/본문/유형/등급/상태/담당자/시작일/종료일/등록자/등록일,
첨부 목록, 댓글 목록.

### 4.4 담당자가 프로젝트에서 제거된 경우

- 일감의 `assigneeId`는 **그대로 남는다.** 일감이 깨지거나 미배정으로 바뀌지 않는다.
- UI에는 해당 담당자를 **비활성 상태**로 표시한다 (회색 처리 + "프로젝트 미참여" 표기).
- 그 사람은 이미 멤버가 아니므로 프로젝트의 어떤 콘텐츠에도 접근할 수 없다
  (`requireProjectRole`이 404를 반환). 별도 처리 불필요.
- **주의**: 담당자 재배정 시에는 여전히 "새 담당자는 프로젝트 멤버여야 한다"를 강제한다.
  단, 기존의 비멤버 담당자를 **그대로 유지하는 수정**은 통과해야 한다 (9장 참고).

## 5. 첨부파일 설계

요구: 문서(엑셀/워드 등), zip, 이미지. 일반적인 크기. 등록된 형태가 보이고 다운로드 가능.

### 5.1 저장 방식 — 서버 디스크 + DB 메타데이터

DB `Bytes` 컬럼(아바타가 쓰는 base64 data URL 방식)은 수 MB 첨부에는 부적절하다.
DB 크기·백업 시간·메모리 사용이 모두 파일 크기에 비례해 늘어난다. 반대로 S3 호환
스토리지는 현재 인프라에 없다. 따라서:

- 저장 경로: `/var/www/manager/uploads/tasks/<storageKey>`
- `storageKey`는 랜덤 값이며 **확장자를 붙이지 않는다.** 웹서버가 실수로
  직접 서빙하거나 MIME을 sniff할 여지를 없앤다.
- 원본 파일명·MIME·크기는 DB(`TaskAttachment`)에만 둔다.
- nginx는 이 디렉터리를 **서빙하지 않는다.** 권한 검사가 필요하므로 Express가 스트리밍한다.
- 업로드 디렉터리는 DB와 별개의 백업 대상이 된다 — 운영 문서에 명시할 것.

### 5.2 업로드

- `multer` diskStorage. 새 의존성 1개 추가.
- 제한: 파일당 **20MB**, 일감당 **10개**.
- nginx `client_max_body_size 25m;` 필요 (현재 기본값이면 1MB에서 막힌다).
- 검증: 확장자 allowlist **와** MIME allowlist를 모두 통과해야 한다.
  - 문서: `xlsx xls csv docx doc pptx ppt pdf hwp hwpx txt`
  - 압축: `zip`
  - 이미지: `png jpg jpeg gif webp`
  - **`svg`는 제외** — 같은 도메인에서 열리면 XSS 벡터가 된다.

### 5.3 다운로드

- `GET /api/projects/:projectId/tasks/:taskId/attachments/:id`
- 기존 `apiFetch` 흐름과 같은 Bearer 인증을 쓰고, 프론트에서 blob으로 받아 저장한다.
  `<a href>`는 Bearer 헤더를 실을 수 없어서 이렇게 간다. 서명 URL 같은 새 메커니즘을
  도입하지 않아도 되고, 아바타처럼 공개로 풀 필요도 없다(첨부는 권한 스코핑이 필수).
- 응답 헤더에 `Content-Disposition: attachment; filename*=UTF-8''...` 와
  `X-Content-Type-Options: nosniff` 를 항상 붙인다. 브라우저 내에서 렌더되지 않게 한다.

### 5.4 삭제와 고아 파일

- 첨부 행을 지울 때 디스크 파일도 함께 지운다.
- Task/Project가 cascade로 삭제되면 DB 행은 사라지지만 **파일은 남는다.** 일감·프로젝트
  삭제 경로에서 첨부를 먼저 조회해 파일을 지우고 나서 삭제하도록 명시적으로 처리한다.

## 6. 댓글과 @멘션

- 일감 하단에 **단층 목록** (대댓글/스레드 없음).
- 작성/수정/삭제 권한은 3장 표 참고. 삭제는 hard delete (대댓글이 없어 "삭제된
  댓글입니다" placeholder가 필요 없다).

### 6.1 멘션 자동완성

- 대상은 **해당 프로젝트의 멤버로 한정.** 전사 디렉토리가 아니다.
- 기존 `UserSearch`(`src/components/ProjectMembers.jsx`)는 **재사용하지 않는다.** 그건
  `/api/users`로 전사 디렉토리를 서버 필터링하는 컴포넌트다. 프로젝트 멤버 목록은 이미
  프로젝트 API로 복호화되어 오므로 **클라이언트에서 필터**하면 되고 서버 추가는 없다.
- UI는 프로젝트 멤버 등록 폼보다 **가볍게**: 별도 입력창 없이 본문에 `@`를 입력하면
  캐럿 아래에 인라인 드롭다운이 뜨고, 방향키/Enter로 선택. 아바타 + 이름만 한 줄.
- **한글 초성 매칭 필요** (`@ㄱ` → `김김김`, `김너무`). `includes()`로는 안 되므로
  음절→초성 분해 유틸을 만든다. 이름/이메일이 암호화돼 서버 SQL 검색은 애초에 불가하지만,
  멤버 목록은 클라이언트에 이미 복호화된 상태로 있어 문제되지 않는다.
- 이메일로도 매칭 (`@jhwonjh`).

### 6.2 멘션 저장 형식

- 본문에 표시 이름만 남기면 동명이인·개명에서 깨진다. `@[김김김](user:<cuid>)` 형태의
  마커로 저장하고, 렌더 시점에 userId로 현재 이름을 다시 가져온다 → 개명이 반영된다.
- 동시에 `TaskCommentMention` 행을 남긴다. 지금은 역참조용, 2단계 알림에서 사용.
- 렌더링은 하이라이트까지만. **알림은 이번 범위 밖** (알림 시스템 자체가 없음).

## 7. 마크다운 에디터 — 사용자 재검토 중

결정 전이라 보류. 검토에 필요한 사실만 적어둔다.

- 프론트에 마크다운 관련 의존성이 현재 **없다.** 새로 추가해야 한다.
- 렌더러는 `react-markdown` + `remark-gfm` 권장. **raw HTML을 기본적으로 통과시키지
  않아** XSS 대비가 기본값으로 안전하다. `marked` 계열은 `dompurify` 등 sanitize를
  반드시 별도로 붙여야 한다.
- 에디터 형태 선택지: (a) textarea + 미리보기 탭 — 의존성 최소, 나중에 확장 가능.
  (b) 툴바형 WYSIWYG — 의존성이 크고 저장 형식이 마크다운에서 벗어날 위험.
- 어느 쪽이든 **저장은 마크다운 원문 평문**. 통합 검색 계획과 맞고, 결정이 늦어도
  스키마는 바뀌지 않는다. 그래서 이 항목이 1단계 착수를 막지 않는다.

## 8. 미확정 항목

1. **"어드민"의 정의** — 프로젝트 PM + 사이트 어드민(잠정) vs 사이트 어드민만.
2. **담당자의 수정 범위** — 전체 필드 vs 담당자 변경 제외.
3. **칸반 드래그 제한** — 권한 없는 카드는 못 옮기는 것이 의도인지.
4. **댓글 삭제** — 본인만인지, 어드민에게도 열지 (부적절한 댓글 정리 수단).
5. **일감 유형의 마지막 항목** — 원문이 `기획 / 개발 / 디자인 / QA / ` 로 열려 있다.
6. **칸반 보드 진입 경로** — `/projects/:id` 상세 안 vs `/projects/:id/board`.
7. **마크다운 에디터** (7장).
8. **날짜 검증 범위** — 시작일 > 종료일은 막는다. 프로젝트 기간(`startAt`/`endAt`)을
   벗어나는 일감 날짜도 막을지는 미정. (경고만 표시하는 안을 권장)

## 9. 기존 코드에 미치는 영향

- **`server/src/routes/myTasks.js`** — 지금은 `assigneeId: req.user.id`로 필터해
  "내게 배정된 일감"만 반환한다. 4.1의 요구("프로젝트에 발행된 전체 일감")로 바뀌었으니
  이 필터를 제거하고, "내 일감만 보기"는 클라이언트 토글로 옮긴다.
- **`server/src/routes/tasks.js:27`** — GET이 존재하지 않는 역할 `'viewer'`를 요구한다.
  `RANK['viewer']`가 `undefined`라 비교가 항상 false가 되어 우연히 통과하는 상태.
  `'member'`로 바로잡는다.
- **`assertAssigneeIsMember`** — 4.4 때문에 조건을 다듬어야 한다. 새 담당자를 지정할
  때는 멤버십을 강제하되, **기존의 비멤버 담당자를 그대로 유지하는 PATCH는 통과**해야
  한다. 그렇지 않으면 담당자가 프로젝트에서 빠진 일감은 아무도 수정할 수 없게 된다
  (프론트가 폼 전체를 보내면 변경 없는 `assigneeId`가 400을 유발).
- **`src/pages/TasksPage.jsx`** — 현재 빈 페이지. 4.1 화면으로 채운다.
- **프로덕션 데이터** — `createdById` backfill 대상 건수 확인이 필요하다:
  `SELECT status, count(*) FROM "Task" GROUP BY status;`
- **배포 순서** — 스키마가 바뀌므로 `git pull` → `prisma migrate deploy && npx prisma
  generate` (postinstall이 막혀 있어 generate를 반드시 명시적으로) → `npm run build`
  → `pm2 restart manager-api`. 첨부파일 도입 시 nginx `client_max_body_size`와
  uploads 디렉터리 생성·권한도 함께 필요하다.
