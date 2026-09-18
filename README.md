# acmebloc manager

사내 프로젝트 관리 도구. 프로젝트 · 일감(칸반/목록/관계도) · 일정(간트) · 검수 흐름 ·
알림 · 검색을 담고, 같은 도메인의 `/board`에 붙인 BookStack을 게시판으로 쓴다.

프로덕션: <https://manager.acmebloc.com>

## 구성

| 경로 | 내용 |
|---|---|
| `src/` | React + Vite 프런트엔드 |
| `server/` | Express + Prisma(PostgreSQL) API |
| `docs/` | 설계 문서 — [`docs/README.md`](docs/README.md)가 색인이자 작성 규칙 |
| `server/DEPLOY.md` | 배포·운영 절차 (EC2 + RDS + Apache) |
| `CLAUDE.md` | 이 저장소에서 작업할 때의 규칙 |

## 로컬 실행

```bash
npm install && npm run dev          # 프런트 (5173)
cd server && npm install && npm run dev   # API (4000)
```

`server/.env.example`에 필요한 환경변수와 설명이 전부 있다. 로컬 개발에서는 SMTP와
BookStack 설정이 없어도 되고, 그 기능만 조용히 꺼진다(부팅 로그에 경고가 뜬다).

## 검사

```bash
npm run lint         # oxlint
npm run docs:check   # docs/ 상태 블록 규칙
```
