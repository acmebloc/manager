# 프로젝트 메뉴 고도화 명세

> **상태**: 배포완료
> **최종 확인**: 2026-09-18 · `785c733`
> **미진행**: 없음

프로젝트 섹션과 권한 체계(`ProjectMember.role`, `User.isSiteAdmin`) 위에 얹는 기능.

## 1. 범위

| 항목 | 설계 |
| --- | --- |
| 프로젝트 등록을 별도 페이지로 분리 (`/projects/new`) | 4.1 |
| 참여 인원 역할 세분화 — PM/PL 외 전원을 기획·디자인·개발·기타로 구분 | 2.1, 3장 |
| 프로젝트 상세 페이지 신설 (`/projects/:id`) | 4.2~4.6 |
| 프로젝트 댓글 | 4.7 |
| 일감/일정 바로가기가 해당 프로젝트를 자동 선택 | 4.4 |
| 게시판 바로가기 | 4.6 |

## 2. 데이터 모델

### 2.1 `ProjectMember.role` 확장

현재는 `member`/`pl`/`pm` 세 값이다. PM·PL은 그대로 두고, "멤버"를 4개 직무로
세분화한다. `Task.type`이 이미 `plan`/`dev`/`design`/`qa`를 쓰고 있으니
기획/디자인/개발 세 값은 그대로 재사용해 이름을 맞춘다.

| DB 값 | 라벨 | 비고 |
| --- | --- | --- |
| `pm` | PM | 기존 유지 |
| `pl` | PL | 기존 유지 |
| `plan` | 기획 | 신규. `Task.type`의 `plan`과 이름 통일 |
| `design` | 디자인 | 신규. `Task.type`의 `design`과 이름 통일 |
| `dev` | 개발 | 신규. `Task.type`의 `dev`와 이름 통일 |
| `other` | 기타 | 신규 |

새 컬럼을 추가하는 대신 기존 `role` 컬럼의 허용값만 넓힌다 — 상세 페이지의
"멤버 : 닉네임 - 역할"이 이 값을 그대로 라벨링하면 되고, PM/PL은 별도 섹션이라
멤버 목록에는 애초에 안 나온다.

**기존 `role='member'` 행은 건드리지 않는다** — 일괄
데이터 마이그레이션은 영향도가 크다고 판단해 하지 않는다. 대신 **읽기 시점
정규화**로 처리한다: `server/src/routes/projects.js`의 `decryptMember()`가 응답을
만들 때 `role === 'member' ? 'other' : role`로 치환해서 내려준다. 그러면:

- API는 프런트에 절대 `'member'`를 노출하지 않는다 — 프런트의 `ROLES`/`roleLabel`은
  6개 값만 알면 되고 별도 분기가 필요 없다.
- DB에 저장된 값 자체는 그 멤버의 역할이 실제로 다시 저장되기 전까지 `'member'`
  그대로 남는다 — 화면에는 "기타"로 보이다가, PM이 그 사람 역할을 뭐로든
  바꿔서 저장하는 순간 자연스럽게 6개 값 중 하나로 갱신된다(지연 마이그레이션).
  일괄 스크립트도, 스키마 마이그레이션 SQL도 필요 없다.

### 2.2 신규 테이블 — `ProjectComment` / `ProjectCommentMention`

`TaskComment`/`TaskCommentMention`과 동일한 구조를 프로젝트 레벨로 옮긴다.

```prisma
model ProjectComment {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation("ProjectCommentAuthor", fields: [authorId], references: [id])
  body      String                          // 마크다운 원문, 평문 저장
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  mentions  ProjectCommentMention[]

  @@index([projectId])
}

model ProjectCommentMention {
  id        String         @id @default(cuid())
  commentId String
  comment   ProjectComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  userId    String
  user      User           @relation("ProjectCommentMentionedUser", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId])
}
```

`User`에 `projectComments ProjectComment[] @relation("ProjectCommentAuthor")`,
`projectCommentMentions ProjectCommentMention[] @relation("ProjectCommentMentionedUser")`,
`Project`에 `comments ProjectComment[]` 추가.

## 3. 권한 규칙

프로젝트 접근 자체는 기존 `requireProjectRole(minRole)`가 그대로 담당한다
(`server/src/lib/projectAccess.js`).

> **주의 — 랭크 테이블에서 `member`를 지우면 안 된다.** `requireProjectRole('member')`는
> 지금 `tasks.js`/`taskComments.js`/`taskAttachments.js`/`schedules.js`/
> `projectSchedule.js`/`projects.js` 등 전 라우트에서 "최소 등급"이라는 *이름*으로
> 호출된다. `role` 컬럼의 실제 저장값에서는 `member`가 사라지지만, `RANK` 테이블의
> `member` 키(랭크 1)는 문턱값 이름으로 계속 존재해야 한다. 즉:
>
> ```js
> export const ROLES = ['pm', 'pl', 'plan', 'design', 'dev', 'other'] // 실제 대입 가능한 값
> const RANK = { pm: 3, pl: 2, plan: 1, design: 1, dev: 1, other: 1, member: 1 } // 문턱값 이름 member 존속
> ```
>
> 이걸 놓치면 `RANK['member']`가 `undefined`가 되고 모든 `requireProjectRole('member')`
> 호출이 항상 403을 반환한다 — 로그인 후 프로젝트 관련 화면이 전부 깨지는 회귀.

- `isValidRole(role)`는 `ROLES`(대입 가능한 6개 값) 기준으로 검사 — `member`는 더 이상
  대입 대상이 아니다.
- **PL의 초대 제한 문구/조건 수정** — `server/src/routes/projects.js:153`
  (`if (req.projectAccess.role === 'pl' && role !== 'member')`)은 "PL은 멤버 등급으로만
  초대 가능"을 `role !== 'member'`로 판별하고 있어 지금 그대로 두면 PL이 PM/PL을
  포함해 아무 등급으로나 초대할 수 있게 깨진다. 조건을 `role === 'pm' || role === 'pl'`
  로 바꿔야 한다.
- 댓글 권한은 `TaskComment`와 동일 패턴: 조회·작성 =
  프로젝트 멤버 전원(+사이트 어드민), 수정·삭제 = **작성자 본인만** (어드민 예외 없음).

## 4. 화면 구성

### 4.1 `/projects` 목록 페이지 — 축소

`src/pages/ProjectsPage.jsx`의 `NewProjectForm`(인라인 등록 폼)과 `ProjectCard`의
인라인 수정/멤버 패널(`editing`/`expanded` 상태), 그리고 "수정"/"삭제"/"멤버"
버튼을 **전부 걷어내 `/projects/:id` 상세 페이지로 옮긴다.** 카드를 클릭하면
상세 페이지로 이동하는 순수 요약 목록으로 줄인다. "새 프로젝트" 버튼은 폼을 펼치는
대신 `/projects/new`로 네비게이트.

**카드에 PM 닉네임 추가** — 기존 `멤버 {count}명 · 일감 {count}개` 한 줄
(`ProjectsPage.jsx:398-400`) 앞에 `PM : {PM 닉네임}`을 같은 줄에 붙인다:

```
PM : 닉네임    멤버 2명 · 일감 0개
```

카드가 보여주는 요약 정보는 최종적으로: 제목 + `myRole` 뱃지(기존 유지) / 설명 /
시작~종료일 / `PM : 닉네임    멤버 N명 · 일감 N개`. 이 PM 닉네임은 4.5의 호버+복사
팝오버까지 갈 필요는 없다 — 목록에서는 텍스트로만, 상세 페이지에서만 호버+복사를
붙인다(과설계 방지).

### 4.2 `/projects/new` — 등록 페이지 (신규)

`NewProjectForm`의 내용을 그대로 옮기되 페이지 단위로: 이름/설명/시작~종료일 +
참여 인원. 참여 인원 등록 UI는 그대로 두되 역할 선택 옵션만 6개로 교체:

```
PM, PL, 기획, 디자인, 개발, 기타
```

"멤버"라는 라벨은 선택지에 없다 — `ProjectMembers.jsx`의 `ROLES`가 2.1의 6개 값을
그대로 쓰면 등록 폼과 상세 페이지 양쪽에 자동 반영된다. `AddMember`의 기본 선택값
(`useState('member')`)도 새 기본값(예: `'plan'`)으로 바꿔야 한다.

### 4.3 `/projects/:id` — 상세 페이지 (신규)

`ProjectDetailPage.jsx`. 구성 순서:

1. 프로젝트 제목
2. 프로젝트 설명
3. 시작일 ~ 종료일
4. **PM** — 닉네임 (호버 시 이메일 + 복사 버튼, 4.5)
5. **PL** — 닉네임. **등록된 PL이 없으면 섹션 자체를 렌더링하지 않는다.**
6. **멤버** — 닉네임 - 역할(기획/디자인/개발/기타), PM·PL은 제외. 항상 섹션은
   노출하되 멤버가 0명이면 "등록된 멤버가 없습니다." 안내 문구.
7. 바로가기 3개: 일감 / 일정 / 게시판(4.6, 대상 URL만 비어있음)
8. 댓글 (4.7)

권한: 조회는 `requireProjectRole('member')` — 비멤버는 404. 수정/삭제/멤버 관리는
4.1에서 옮겨온 대로 이 페이지 안에서 `myRole`에 따라 노출(PM만 수정/삭제, PM·PL만
멤버 관리) — 기존 `ProjectCard`/`ProjectMembers.jsx`의 조건을 그대로 재사용.

### 4.4 일감/일정 바로가기 — 프로젝트 자동 선택

`/tasks`, `/schedule` 모두 프로젝트별 URL이 없다 (`/tasks`는 내 프로젝트 전체를
한 페이지에 나열, `/schedule`은 `SchedulePage`가 내부 `selectedProjectId` 상태로
프로젝트를 고른다). 새 라우트를 만들지 않고 쿼리 파라미터로 가볍게 연결한다:

- **일감**: `/tasks?projectId=<id>` — `TasksPage`가 마운트 시 해당
  `section.projectId`를 가진 섹션으로 스크롤(`scrollIntoView`). 각 `ProjectBoard`
  섹션에 `id={`project-${section.projectId}`}` 부여 필요.
- **일정**: `/schedule?projectId=<id>` — `SchedulePage`가 지금은 항상
  `data[0].id`로 `selectedProjectId`를 초기화하는데(`SchedulePage.jsx:19`),
  쿼리에 `projectId`가 있으면 그 값으로 우선 초기화.

둘 다 `react-router-dom`의 `useSearchParams`로 처리, 새 백엔드 변경 없음.

### 4.5 이메일 호버 + 복사

PM/PL/멤버 닉네임에 마우스를 올리면 이메일과 복사 버튼이 뜨는 작은 팝오버가
필요하다 — 네이티브 `title` 툴팁은 버튼을 못 담아서 못 쓴다. 새 컴포넌트
(예: `MemberIdentity`, `ProjectMembers.jsx`의 `Avatar` 옆에 추가)로 만들고
`navigator.clipboard.writeText(email)` 사용. 지금 코드베이스에 클립보드 복사
유틸이 없어 이번에 처음 추가.

### 4.6 게시판 바로가기

일감/일정 바로가기와 똑같은 모양·상호작용의 링크형 버튼이다. 처음 만들 때는
BookStack 프로젝트별 책장 연동이 아직이라 대상 URL만 비워뒀는데, 그 연동이
붙으면서([[per-project-access-control-planned]]) 지금은 `Project.bookstackShelfSlug`로
`/board/shelves/:slug`를 가리킨다.

**갈 곳이 없을 때의 표시는 이후에 바뀌었다.** 원래는 "별도 비활성 스타일을 두지
않는다"였는데, 그 결과 링크 색 그대로인데 눌러도 아무 일이 없는 요소가 됐다. 지금은
흐린 색 `<span>`으로 렌더하고 `title`로 이유를 알려준다(`ProjectDetailPage.jsx`의
`ShortcutLink`). 같은 처리가 보관된 프로젝트의 일감·일정 바로가기에도 적용된다.

### 4.7 댓글 — 컴포넌트 재사용 + `@` 멘션

`TaskComments.jsx`는 지금 `taskId`에 강하게 묶여 있다
(`/api/projects/:projectId/tasks/:taskId/comments`). 프로젝트 댓글은 경로가
`/api/projects/:projectId/comments`로 한 단계 얕다. 로직(목록 로드, 작성,
수정, 삭제, 멘션 처리)은 사실상 동일하므로 **`apiPath`를 prop으로 받는 공용
`Comments` 컴포넌트로 일반화**하고, `TaskComments`/`ProjectComments`를 그 위의
얇은 래퍼로 만드는 걸 권장한다 — 지금 붙이면 실사용처가 2곳이라 과설계가 아니다.
백엔드는 `loadTask` 단계가 없다는 점이 달라 `taskComments.js`를 그대로 복붙하기보다
새 `projectComments.js`를 짧게 새로 쓰는 편이 낫다(무리해서 공유 모듈로 뽑을
정도로 크지 않음).

**`@` 프로젝트 멤버 태그** — 일감 댓글과 동일하게 동작한다.
`docs/task-management-spec.md` 6.1/6.2의 규칙을 그대로 따른다:

- 대상은 **해당 프로젝트 멤버로 한정** (전사 디렉토리 아님) — `ProjectDetailPage`가
  이미 들고 있는 프로젝트 멤버 목록을 `MarkdownEditor`의 `mentionMembers`로 그대로
  넘기면 된다. 서버에 새 검색 엔드포인트 불필요.
- 본문에 `@`를 입력하면 캐럿 아래 인라인 드롭다운, 한글 초성 매칭(`matchesKoreanQuery`)
  + 이메일 매칭 모두 지원.
- 저장 형식은 `@[이름](user:<cuid>)` 마커 — 렌더 시 userId로 최신 이름을 다시 조회해
  개명을 반영. `ProjectCommentMention` 행은 역참조용(2.2)이자, 이후 붙은 멘션 알림의
  발송 근거다(`docs/email-notifications-spec.md`, `projectComments.js`).
- 즉 `MarkdownEditor.jsx`/`MarkdownContent.jsx`/`src/lib/mentions.js`/`src/lib/korean.js`는
  **변경 없이 그대로 재사용** — `Comments` 공용 컴포넌트가 이 넷을 그대로 감싸면 된다.

## 5. 기존 코드에 미치는 영향

- **`server/prisma/schema.prisma`** — 2장의 스키마 변경. `ProjectMember.role`
  자체는 마이그레이션 없이 허용값 주석만 갱신(2.1).
- **`server/src/lib/projectAccess.js`** — `ROLES`/`RANK` 교체 (3장 주의사항, `member`는
  RANK에서 유지).
- **`server/src/routes/projects.js:153-155`** — PL 초대 제한 조건 수정.
- **`server/src/routes/projects.js`의 `decryptMember()`** — 응답 직전
  `role === 'member' ? 'other' : role`로 정규화(2.1의 읽기 시점 정규화). 이 함수를
  거치는 모든 응답(목록/상세/멤버 목록/생성/수정)에 자동 적용된다.
- **`server/src/index.js`** — `app.use('/api/projects/:projectId/comments', requireAuth, projectCommentsRouter)`를
  기존 관례대로 `app.use('/api/projects', ...)`보다 **먼저** 등록(지금
  `taskAttachments`/`taskComments`도 `tasks`보다 먼저 마운트되어 있는 순서를 따름,
  `server/src/index.js:39-43`).
- **`src/components/ProjectMembers.jsx`** — `ROLES` 배열 6개로 교체, `AddMember`
  기본 role 값 변경.
- **`src/pages/ProjectsPage.jsx`** — `NewProjectForm`/인라인 편집·멤버 패널/
  수정·삭제·멤버 버튼 제거, 카드 클릭 시 상세 페이지 이동으로 축소, `PM : 닉네임`
  줄 추가(4.1).
- **`src/pages/TasksPage.jsx`** — `?projectId=` 쿼리 읽어서 해당 섹션으로 스크롤
  (4.4).
- **`src/pages/SchedulePage.jsx:19`** — `?projectId=` 있으면 초기 선택값으로 사용
  (4.4).
- **`src/main.jsx`** — `/projects/new`, `/projects/:id` 라우트 추가.

## 6. 설계 중 갈렸던 지점

결론만 남긴다. 상세 근거는 각 절에 있다.

- 기존 `role='member'` 행은 **일괄 마이그레이션하지 않는다** — 읽는 시점에 `other`로
  정규화한다(2.1)
- 프로젝트 수정/삭제/멤버 관리는 목록 카드가 아니라 **상세 페이지**에 둔다(4.1)
- 댓글 삭제는 **작성자 본인만**(어드민 예외 없음, 3장)
- 댓글 `@` 멘션 범위는 **프로젝트 멤버**, 규칙은 일감 댓글과 동일(4.7)

## 7. 구현 체크리스트

**DB**
- [x] `schema.prisma`에 `ProjectMember.role` 허용값 주석 갱신, `ProjectComment`/
      `ProjectCommentMention` 모델 + `User`/`Project` 관계 추가
- [x] 마이그레이션 생성(`npx prisma migrate dev`) — `role` 컬럼은 값 자체를 바꾸지
      않으므로 데이터 백필 SQL 불필요(2.1)
- [x] [[deploy-checklist-missing-prisma-generate]] 확인 — 배포 시 `npx prisma generate` 누락 금지

**백엔드**
- [x] `projectAccess.js`의 `ROLES`/`RANK` 교체 (3장 코드 그대로, `RANK.member`는 유지)
- [x] `projects.js`의 PL 초대 제한 조건 수정
- [x] `projects.js`의 `decryptMember()`에 읽기 시점 역할 정규화 추가 (`member` → `other`, 2.1)
- [x] `projectComments.js` 신규 작성 (`taskComments.js` 구조 참고, `loadTask` 단계 없이)
- [x] `index.js`에 라우터 등록 (마운트 순서 주의, 5장)

**프론트 — 라우팅**
- [x] `main.jsx`에 `/projects/new`, `/projects/:id` 라우트 추가

**프론트 — 컴포넌트/페이지**
- [x] `ProjectMembers.jsx`의 `ROLES` 6개로 교체, `AddMember` 기본값 변경
- [x] `MemberIdentity`(호버 이메일 + 복사) 신규 컴포넌트 — 상세 페이지 전용(4.5)
- [x] `Comments` 공용 컴포넌트로 일반화, `TaskComments`/새 `ProjectComments` 래퍼 —
      `MarkdownEditor`/`mentions.js`/`korean.js` 그대로 재사용해 `@` 멘션 지원(4.7)
- [x] `ProjectFormPage.jsx` 신규 (`/projects/new`)
- [x] `ProjectDetailPage.jsx` 신규 (`/projects/:id`) — 4.3 구성 순서대로, 수정/삭제/
      멤버 관리 UI를 목록에서 그대로 옮겨옴
- [x] `ProjectsPage.jsx` 축소 — 인라인 폼/편집/멤버 패널/수정·삭제 버튼 제거, 카드
      클릭 이동, `PM : 닉네임` 줄 추가(4.1)
- [x] 일감/일정/게시판 바로가기 3개를 동일한 링크형 버튼 컴포넌트로 구현, 게시판만
      대상 URL을 비움(4.6)
- [x] `TasksPage.jsx`/`SchedulePage.jsx`에 `?projectId=` 처리 추가 (4.4)

**마무리**
- [x] 로컬 검증은 [[local-dev-database-setup]]의 로컬 DB로
