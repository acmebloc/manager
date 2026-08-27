# 이메일 알림 기능 명세

`docs/task-management-spec.md` 2단계 "멘션 알림"이 "알림 시스템 자체가 없음"으로
미뤄졌던 항목의 후속.

**구현 완료 (2026-08-27).** 코드는 6장 참고 — 나머지 장(1~5장)은 설계 당시
기록 그대로라 실제 코드와 다른 부분이 있으면 6장 쪽이 맞다. 남은 건 배포
(`server/DEPLOY.md` 12장) 뿐.

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

### 2.1 필요 설정 — **1단계(그룹 생성)·2단계(SMTP 릴레이) 완료 (2026-08-27)**

구글 공식 문서([그룹 만들기](https://support.google.com/a/answer/9400082),
[SMTP 릴레이 설정](https://support.google.com/a/answer/2956491)) 기준, `admin.google.com`에서:

**A. 발신용 그룹 생성**
1. 디렉토리(Directory) > 그룹(Groups) > "그룹 만들기"
2. 그룹 이메일 주소 입력. **주소명 미정** (예: `notifications@acmebloc.com`)
3. 액세스 유형 "공지 전용(Announcement only)" 선택 — 게시 권한을 관리자/소유자만으로,
   가입을 "초대받은 사용자만"으로 제한. 멤버는 안 넣어도 됨(발신 전용이라 수신자 불필요).

**B. SMTP 릴레이 서비스 설정**
1. Apps > Google Workspace > Gmail > 라우팅(Routing) > "SMTP 릴레이 서비스" 구성
2. 허용된 발신자: **"내 도메인의 모든 주소(Only addresses in my domains)"** 선택
   — "등록된 사용자만" 옵션은 실제 라이선스 있는 계정만 허용하는 더 엄격한 옵션이라
   그룹 주소를 쓰려면 이 옵션이 맞음
3. 인증: "지정된 IP 주소에서만 메일 수신" 체크 → IP 추가: `15.164.69.195/32`
4. 필요시 "TLS 암호화 필요" 체크 후 저장

⚠ 미확인 사항: 구글 문서에 "MAIL FROM 주소가 등록된 Workspace 사용자 주소면
Gmail 라이선스가 있어야 한다"는 조건이 있음 — "내 도메인의 모든 주소" 옵션에도
적용되는지 불확실. 설정 후 테스트 발송으로 확인, 라이선스 에러로 반송되면 그룹
대신 라이선스 있는 실제 계정 주소를 From으로 전환.

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

## 5. 1차 구현 범위에서 제외한 것

- 메일 수신 개인별 on/off 설정 — 나중에 필요해지면 추가 (스키마/UI 추가 비용
  대비 지금은 근거 부족)

## 6. 구현 (2026-08-27)

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
- 남은 작업: `server/DEPLOY.md` 12장대로 배포 서버에 `npm install` +
  `.env`에 `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM` 추가.
