# 이메일 알림 기능 명세

> **상태**: 배포완료
> **최종 확인**: 2026-09-18 · `785c733`
> **미진행**: 없음

`docs/task-management-spec.md`가 다루지 않았던 멘션 알림의 후속. 프로덕션에서 실제
계정 간 멘션으로 수신까지 확인했다. 구현은 6장 참고.

**배포 당시 있었던 이슈 (둘 다 해결됨):**
- SMTP 릴레이 허용 목록에 IP를 등록해도 Google 쪽 반영에 최대 하루 정도
  걸림 — 설정 직후 테스트 발송이 `421-4.7.0 Try again later, closing
  connection. (EHLO)`로 실패했으나, 다음 날 재시도하니 정상(`250 2.0.0 OK`).
  당장 안 되도 설정 자체가 맞다면 하루 기다렸다가 재시도할 것.
- 자기 자신을 멘션/담당자로 지정하면 의도적으로 메일을 스킵하는 로직(3장 "공통
  규칙") 때문에, 혼자 계정 하나로 테스트하면 "메일이 안 온다"로 오인하기 쉬움
  — 테스트는 반드시 서로 다른 두 계정으로 할 것.

## 1. 배경

- 데이터 모델은 이미 알림을 염두에 두고 준비돼 있음: `TaskCommentMention`,
  `ProjectCommentMention`(댓글 `@`멘션), `ScheduleFollower`(일정 참조자).
- `User.email`은 `fieldCrypto.js`로 애플리케이션 레벨 암호화 저장 — 발송 전
  `decryptUser`로 복호화 필요.
- 배포 환경은 EC2 단일 인스턴스(Apache 리버스프록시 + pm2, 별도 큐/워커 없음) —
  발송 로직은 이벤트 발생 시점에 논블로킹으로 호출하는 정도면 충분한 규모.

## 2. 발송 수단

**확정: Google Workspace SMTP 릴레이.** acmebloc.com이 이미 Google Workspace를
쓰고 있음(MX가 `smtp.google.com`, SPF에 `_spf.google.com` 포함 — DNS로 확인).
AWS SES(도메인 인증 + 프로덕션 액세스 신청 필요)와 비교해서, 이미 쓰고 있는
Workspace 인프라를 그대로 쓰는 쪽으로 결정.

발신 계정을 특정 개인 계정의 비밀번호/앱 비밀번호에 묶지 않기 위해, 계정 인증
방식이 아니라 **서버 IP를 허용 목록에 등록하는 SMTP 릴레이** 방식(안 B)을 채택.

### 2.1 필요 설정

구글 공식 문서([그룹 만들기](https://support.google.com/a/answer/9400082),
[SMTP 릴레이 설정](https://support.google.com/a/answer/2956491)) 기준, `admin.google.com`에서:

**A. 발신용 그룹 생성**
1. 디렉토리(Directory) > 그룹(Groups) > "그룹 만들기"
2. 그룹 이메일 주소 입력 — `notifications@acmebloc.com`으로 정했다(6장).
3. 액세스 유형 "공지 전용(Announcement only)" 선택 — 게시 권한을 관리자/소유자만으로,
   가입을 "초대받은 사용자만"으로 제한. 멤버는 안 넣어도 됨(발신 전용이라 수신자 불필요).

**B. SMTP 릴레이 서비스 설정**
1. Apps > Google Workspace > Gmail > 라우팅(Routing) > "SMTP 릴레이 서비스" 구성
2. 허용된 발신자: **"내 도메인의 모든 주소(Only addresses in my domains)"** 선택
   — "등록된 사용자만" 옵션은 실제 라이선스 있는 계정만 허용하는 더 엄격한 옵션이라
   그룹 주소를 쓰려면 이 옵션이 맞음
3. 인증: "지정된 IP 주소에서만 메일 수신" 체크 → IP 추가: `15.164.69.195/32`
4. 필요시 "TLS 암호화 필요" 체크 후 저장

설정 당시 걸렸던 것: 구글 문서에 "MAIL FROM 주소가 등록된 Workspace 사용자
주소면 Gmail 라이선스가 있어야 한다"는 조건이 있어, "내 도메인의 모든 주소"
옵션에도 적용되는지 불확실했다. 실제로는 그룹 주소 그대로 발송이 되고 있다 —
라이선스 에러로 반송되면 그때 라이선스 있는 실제 계정 주소를 From으로 돌리면 된다.

**C. 서버 연결**
- 서버(`nodemailer`)는 `smtp-relay.gmail.com:587`(TLS)로 연결
- IP 기반 인증이라 SMTP 계정/비밀번호 불필요, From 헤더만 그룹 주소로 세팅해서 발송

### 2.2 서버 퍼블릭 IP — 확정: `15.164.69.195`

- `server/DEPLOY.md`엔 옛 값(`3.39.230.46`, 2026-08-20 기준)이 남아있었으나,
  2026-08-27 기준 실제 퍼블릭 IPv4는 `15.164.69.195` — 사용자가 변경되지 않게
  고정 설정해둔 IP라고 확인함. `server/DEPLOY.md`도 이 값으로 갱신함.
- 릴레이 허용 목록에 이 IP(`15.164.69.195`)를 등록하면 됨.

## 3. 알림 대상 이벤트 — 확정 (2026-08-27)

**최대 범위로 확정**: 멘션 + 담당자 지정/변경 + 일정 참조자 등록.

| 트리거 | 발생 지점 | 수신자 |
| --- | --- | --- |
| 일감/프로젝트 댓글 `@`멘션 | `taskComments.js`/`projectComments.js`의 댓글 생성·수정 | 새로 멘션된 사용자 (기존 멘션 재알림 안 함) |
| 일감 담당자 지정/변경 | `tasks.js`의 `assigneeId` 생성/수정 | 새로 지정된 담당자 (동일인으로 재저장 시 스킵) |
| 일정 참조자 등록 | `schedules.js`(`setFollowers`)의 `ScheduleFollower` 생성 — `projectSchedule.js`는 읽기 전용 조회라 해당 없음 | 새로 등록된 참조자 |

공통 규칙: 본인이 자기 자신에게 트리거되는 액션(자기 자신을 멘션/배정 등)은
알림 스킵. 메일 실패가 API 응답을 막지 않도록 논블로킹 처리.

## 4. 로컬 검증 방법 — 확정 (2026-08-27)

별도 인프라(Mailhog 등) 없이, `server/.env`에 `SMTP_HOST`가 없으면 실제 발송
대신 메일 내용을 콘솔에 로그만 찍는 방식으로 대체. 배포 서버에만 SMTP 관련
env 값을 채워서 실제 발송이 켜지게 함.

## 5. 하지 않는 것

현재 없다. 1차 때 뺐던 "메일 수신 개인별 on/off"는 이후 구현됐다 —
`User.emailNotificationsEnabled`와 `server/src/lib/notificationPrefs.js`의
`wantsEmailNotifications`, MyPage의 토글.

## 6. 구현

- `server/src/lib/mailer.js` (신규) — 발송 저수준(`sendMail`, SMTP_HOST 없으면
  콘솔 로그로 대체)과 알림 3종 템플릿(`notifyMention`/`notifyAssigned`/
  `notifyScheduleFollower`).
- `server/src/routes/taskComments.js`, `projectComments.js` — POST/PATCH에서
  새로 추가된 멘션만 골라 발송 (`notifyNewMentions` — PATCH는 수정 전
  `TaskCommentMention`/`ProjectCommentMention`을 먼저 조회해 기존 멘션과 diff).
- `server/src/routes/tasks.js` — POST/PATCH에서 담당자가 실제로 바뀔 때만
  발송 (`notifyIfNewAssignee` — `previousAssigneeId`와 비교, 자기 자신 배정은
  스킵).
- `server/src/routes/schedules.js` — POST/PATCH에서 새로 추가된 참조자만
  발송 (`notifyNewFollowers` — PATCH는 수정 전 `ScheduleFollower`를 먼저
  조회해 diff).
- 실제 발송은 어디서도 `await` 하지 않음 — 실패해도 API 응답을 막지 않고,
  `mailer.js`의 `sendMail`이 에러를 내부에서 삼켜서 unhandled rejection도 없음.
- 발신 그룹 주소: `notifications@acmebloc.com` — `server/.env.example`의
  `MAIL_FROM`에 반영.
- 링크 대상: 일감/프로젝트 댓글은 `/tasks/:projectId/:taskId` 또는
  `/projects/:projectId`, 일정 참조자는 프로젝트 일정이면
  `/schedule?projectId=:projectId`, 개인 일정이면 `/schedule` (특정 일정으로
  바로 스크롤하는 딥링크는 프론트에 없어서 페이지 단위로만 연결됨).
- 배포 서버 설정(`npm install` + `.env`의 `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM`)은
  `server/DEPLOY.md` 12단계에 있고, 적용 완료됐다. `SMTP_HOST`만 있고 `MAIL_FROM`이
  없으면 서버가 기동을 거부한다(`envCheck.js`) — 예전엔 From 없이 발송을 시도하다
  아무도 메일을 못 받는 상태가 될 수 있었다.
