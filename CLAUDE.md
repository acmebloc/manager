# CLAUDE.md

이 저장소에서 작업할 때 지킬 것.

## 이 프로젝트

사내 프로젝트 관리 도구(manager). React + Vite 프런트(`src/`), Express + Prisma
백엔드(`server/`), 게시판은 같은 도메인 `/board`에 붙인 BookStack이다.
프로덕션은 `https://manager.acmebloc.com`.

설계 근거는 `docs/`에, 배포 절차는 `server/DEPLOY.md`에 있다.

## 배포와 커밋

- **커밋·푸시·배포는 매번 사용자 확인을 받고 한다.** 그 턴에 명시적으로 지시받았을
  때만 진행한다.
- **프로덕션 서버에 SSH로 직접 들어가지 않는다.** 서버에서 실행할 것은 명령과 절차로
  정리해 사용자에게 넘긴다.
- 배포 순서를 임의로 줄이지 않는다:

  ```
  git pull → npm ci → npm run build           # 프런트 변경 시
  npm ci → npx prisma migrate deploy → npx prisma generate   # 서버/스키마 변경 시
  ```

  `prisma generate`를 빠뜨리면 마이그레이션은 됐는데 클라이언트가 옛 스키마를 들고
  있는 상태가 된다. `npm install`이 아니라 `npm ci`다.

## 문서 규칙

`docs/`의 설계 문서는 **상태 블록 규칙**을 따른다. 전문은
[`docs/README.md`](docs/README.md)에 있고, 요점만 옮기면:

- 문서 상태는 제목 바로 아래 상태 블록 **한 곳에만** 적는다. 범위 표의 상태 열,
  `(확정)` 도장, 취소선, "본문과 다르면 N장이 맞다" 같은 우선순위 규칙은 쓰지 않는다.
- `미룸`·`범위 밖`·`남은 작업`·`미확정`은 `## 하지 않는 것` 절 안에서만 쓴다.
  구현되면 **그 줄을 지우고** 상태 블록의 날짜·커밋을 갱신한다.
- **기능을 배포하면 관련 문서의 상태 블록을 같은 커밋에서 고친다.** 나중으로 미루면
  안 하게 되고, 실제로 그렇게 여러 문서가 코드와 어긋난 채 남아 있었다.
- 문서를 고쳤으면 `npm run docs:check`를 돌린다.

## 값의 단일 출처

문서나 다른 파일에 옮겨 적지 말고 여기를 가리킬 것:

| 값 | 출처 |
|---|---|
| 일감 상태·유형·등급 라벨 | `src/lib/taskFields.js` (서버 사본: `server/src/lib/taskFields.js`) |
| 상태 전이 규칙 | `server/src/lib/taskTransitions.js` |
| 일감 권한 판정 | `server/src/lib/taskPermissions.js` |
| 프로젝트 접근·역할 | `server/src/lib/projectAccess.js` |

## 로컬 개발

```bash
npm run dev                      # 프런트 (5173)
cd server && npm run dev         # API (4000)
```

로컬 Postgres와 `server/.env`는 이미 준비돼 있다. `server/.env.example`에 모든 값의
설명이 있다. 프로덕션 RDS는 퍼블릭 액세스가 막혀 있어 로컬에서 붙을 수 없다 —
스키마 변경은 마이그레이션 파일만 만들고 배포 절차에 맡긴다.

`node --watch`로 서버를 띄워둔 채 `prisma migrate dev`를 돌리면 이후 요청이 멈출 수
있다. 마이그레이션은 서버를 내리고 돌린다.

### 로그인 없이 API를 검증할 때

로그인 수단이 Google OAuth뿐이라 브라우저 없이는 세션을 만들 수 없다. 검증용
스크립트에서 토큰을 직접 발급해 `Authorization: Bearer <token>`으로 쓴다.

```bash
cd server
set -a && . ./.env && set +a          # dotenv에 기대지 말 것
NODE_PATH=$PWD/node_modules node -e "
Promise.all([import('./src/db.js'), import('./src/lib/appToken.js')]).then(async ([{prisma},{signAppToken}]) => {
  const user = await prisma.user.findFirst()
  console.log(signAppToken(user))
  await prisma.\$disconnect()
})"
```

`cd`만으로는 모듈 해석이 안 돼서 `NODE_PATH`가 필요하다. 테스트로 만든 데이터는
검증이 끝나면 지운다.

## 코드 관례

- 주석은 한국어로, **무엇을 하는지가 아니라 왜 그렇게 했는지**를 적는다. 특히 버려진
  대안과 그 이유. 기존 주석의 밀도와 톤을 따른다.
- Express 4라서 async 핸들러의 거부를 기본으로는 못 잡는다 —
  `server/src/lib/expressAsyncErrors.js`가 처리한다. 요청 본문의 타입 검증은
  `server/src/lib/requestShapes.js`를 쓴다(안 하면 500이 아니라 응답 없는 멈춤이 된다).
- 같은 프로젝트 안의 일감 **관계**를 쓰는 경로는 `withProjectRelationLock`
  (`server/src/routes/tasks.js`)을 통과해야 한다. 관계를 건드리지 않는 수정은 락을
  타지 않는다.
- `npm run lint`(oxlint)를 통과시킨다.
