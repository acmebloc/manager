# 배포 가이드 (EC2 + RDS, manager.acmebloc.com 서브도메인)

이 저장소는 프론트엔드(Vite + React)와 `server/`(Node + Express + Prisma API)로 구성돼 있고,
`manager.acmebloc.com` 서브도메인 하나에 이 앱 전체(프론트+API)를 통째로 서빙하는 걸 기준으로
작성함. `acmebloc.com` 메인 도메인은 나중에 다른 사이트용으로 남겨둠.

**확인된 서버 환경** (2026-08-20 기준)

- 퍼블릭 IP: `15.164.69.195`, 메인 도메인: `https://acmebloc.com/` (이미 SSL 적용됨, 다른 사이트용으로 보존)
- OS/웹서버: **Ubuntu + Apache 2.4.66**
- 현재 Apache 기본 페이지만 떠 있음, Node.js 미설치, `mod_proxy`/`mod_proxy_http` 미활성화 확인됨
- 같은 서버에 다른 사이트도 추가 예정 → 이 앱은 전용 리눅스 사용자·디렉터리·DB로 분리
- **`manager.acmebloc.com`** 서브도메인으로 배포 (메인 도메인은 건드리지 않음)

## 0. 사전 확인

- RDS 콘솔에서 확인할 것: 엔드포인트 주소, 포트, 엔진(Postgres/MySQL), 마스터 계정
- EC2가 RDS와 같은 VPC(또는 피어링된 VPC)에 있는지 확인
- Google Cloud Console (OAuth 클라이언트 설정)에서 "승인된 자바스크립트 원본"에
  `https://manager.acmebloc.com` 추가 — 이거 빠뜨리면 로그인 팝업에서 `origin_mismatch` 에러 남
  (이전에 `http://localhost:5173`에서 겪었던 것과 같은 에러)

## 1. DNS 설정 (서버 작업 전에 먼저)

사용 중인 DNS 관리 콘솔(Route 53 등)에서:

```
manager.acmebloc.com   A   15.164.69.195
```

레코드 추가 후 전파 확인:

```bash
dig +short manager.acmebloc.com
# 15.164.69.195 나오면 OK (전파에 몇 분~몇십 분 걸릴 수 있음)
```

## 2. 격리된 공간 만들기 (전용 사용자 + 디렉터리 + DB)

다른 사이트와 코드·프로세스·DB 자격증명이 서로 섞이지 않도록, 이 앱만의 전용 공간을 먼저 만든다.

### 2-1. 전용 리눅스 사용자 + 디렉터리

```bash
sudo useradd -r -m -d /var/www/manager -s /usr/sbin/nologin manager
sudo chown manager:manager /var/www/manager
```

- `manager` 계정으로 SSH 직접 로그인은 안 되지만, `sudo -u manager <명령어>`로 그 계정 권한으로
  명령 실행 가능 (프로세스/파일 소유자 분리 목적)
- 나중에 다른 사이트 추가할 땐 `manager` 대신 그 사이트 이름으로 동일 패턴 반복 (예: `/var/www/blog` + `blog` 계정)

### 2-2. RDS에 전용 데이터베이스 + 전용 계정 생성

**확인된 RDS 정보**

- 엔드포인트: `database-1.c9qa8wsawth3.ap-northeast-2.rds.amazonaws.com`
- 포트: `5432` (Postgres)
- 마스터 사용자: `postgres`
- `manager` 데이터베이스는 생성 마법사에서 "초기 데이터베이스 이름"으로 이미 만들어둠 → `CREATE DATABASE` 불필요

RDS는 퍼블릭 액세스가 꺼져 있어서 **EC2에 SSH로 접속한 상태에서** 진행해야 함:

```bash
ssh -i /path/to/key.pem ubuntu@15.164.69.195

# psql 클라이언트가 없으면 설치
sudo apt-get update
sudo apt-get install -y postgresql-client

psql "postgresql://postgres:마스터_비밀번호@database-1.c9qa8wsawth3.ap-northeast-2.rds.amazonaws.com:5432/manager"
```

접속되면 아래 SQL 실행:

```sql
CREATE USER manager_app WITH PASSWORD '무작위로_생성한_긴_비밀번호';
ALTER DATABASE manager OWNER TO manager_app;
ALTER SCHEMA public OWNER TO manager_app;
\q
```

- `ALTER DATABASE ... OWNER TO` + `ALTER SCHEMA public OWNER TO` — Postgres 15부터는 `public` 스키마에
  테이블 생성 권한이 소유자에게만 있어서, 단순 `GRANT ALL PRIVILEGES ON DATABASE`만으로는 나중에
  `prisma migrate deploy`가 테이블을 못 만듦. 소유자를 아예 `manager_app`으로 바꿔주면 이 문제가 없음
- 비밀번호는 `openssl rand -hex 24`로 생성해서 안전하게 보관 — 6단계 `.env`에 그대로 들어감
- 마스터 비밀번호는 나한테 공유할 필요 없음, 직접 서버에서만 입력하면 됨

## 3. 보안그룹 설정

- **RDS 보안그룹** 인바운드에 EC2 보안그룹을 소스로 추가 (Postgres 5432 / MySQL 3306)
- **EC2 보안그룹**: 80/443/22 이미 열려 있음 확인함. 4000번(Node 앱 포트)은 외부에 열지 않기

## 4. EC2에 Node.js 설치 (Ubuntu)

```bash
ssh -i /path/to/key.pem ubuntu@15.164.69.195

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v20.x 확인
```

(전역에 한 번만 설치하면 됨, 사이트별로 따로 설치할 필요 없음)

## 5. 코드 배포 + 빌드

```bash
sudo -u manager git clone <이 저장소 주소> /var/www/manager/app
cd /var/www/manager/app

# 프론트엔드 빌드 (정적 파일이 dist/ 에 생성됨 — Apache가 이걸 직접 서빙)
sudo -u manager npm install
sudo -u manager cp .env.example .env   # 프론트엔드용 .env
sudo -u manager vi .env
```

프론트엔드 `.env`에 채울 값:

```
VITE_GOOGLE_CLIENT_ID=240689976296-931102cla566kf3serovkqtqotm2d09t.apps.googleusercontent.com
```

```bash
sudo -u manager npm run build   # dist/ 생성

cd server
sudo -u manager npm install
```

## 6. 백엔드 환경변수 설정

```bash
sudo -u manager cp .env.example .env
sudo -u manager vi .env
sudo chmod 600 .env
```

- `DATABASE_URL` — 2-2에서 만든 전용 계정으로:
  `postgresql://manager_app:그_비밀번호@database-1.c9qa8wsawth3.ap-northeast-2.rds.amazonaws.com:5432/manager`
- `GOOGLE_CLIENT_ID` — 프론트엔드 `.env`와 동일한 값
- `JWT_SECRET` — `openssl rand -hex 32`로 생성
- `FIELD_ENCRYPTION_KEY` — `openssl rand -hex 32`로 생성. **기존 배포를 복구하는
  중이라면 새로 만들면 안 된다** — 이름·이메일·사진이 이 키로 암호화되어 있어서
  키가 바뀌면 전부 복호화 불가가 된다
- `FRONTEND_ORIGIN` — `https://manager.acmebloc.com`

### OIDC (게시판 통합 로그인)

이 네 개가 없으면 게시판 로그인이 **조용히** 동작하지 않는다 — Manager 자체는
멀쩡히 뜨기 때문에 배포 직후에는 알아채기 어렵다. 게시판을 쓸 거라면 반드시 채운다.

- `OIDC_ISSUER` — `https://manager.acmebloc.com/oidc`
- `OIDC_CLIENT_ID` — `openssl rand -hex 32`
- `OIDC_CLIENT_SECRET` — `openssl rand -hex 32`
- `OIDC_REDIRECT_URI` — `https://manager.acmebloc.com/board/oidc/callback`
  (BookStack이 서브디렉터리 `/board`에 설치된다는 전제의 고정 경로)

`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`은 BookStack `.env`의 같은 이름 값과 **정확히
같아야** 한다 (`docs/bookstack-patches.md` 1번). 기존 배포를 복구하는 중이라면 새로
만들지 말고 BookStack 쪽 값을 그대로 가져온다.

### OIDC 서명키 (`server/keys/`)

`server/keys/oidc-private.pem`은 게시판에 넘기는 ID 토큰을 서명하는 RSA 키다.
`.gitignore`에 있어서 **git에 없고, 없으면 서버가 알아서 새로 만든다** — 로그도
남기지 않는다. 문제는 새 키가 이전과 같은 `kid`(`main`)로 게시되기 때문에,
BookStack이 캐시해둔 공개키와 조용히 어긋나 로그인만 깨진다는 점이다.

- **기존 배포를 복구하는 중이면** 이 디렉터리를 백업에서 먼저 복원한 뒤 서버를 띄운다
- **처음 배포라면** 그냥 두면 된다. 첫 기동 때 자동 생성된다
- 정기 백업 대상에 `server/keys/`를 포함시킬 것 (DB 백업만으로는 복구되지 않는다)

## 7. 데이터베이스 스키마 적용

```bash
cd /var/www/manager/app/server
sudo -u manager npx prisma migrate deploy
```

(`prisma/migrations` 폴더가 없으면 로컬에서 먼저 `npx prisma migrate dev --name init`으로 만들어서
커밋한 뒤, EC2에서는 `migrate deploy`만 실행)

## 8. 프로세스 실행 (pm2, manager 계정으로)

```bash
sudo npm install -g pm2   # 전역 설치 1회

cd /var/www/manager/app/server
sudo -u manager pm2 start src/index.js --name manager-api
sudo -u manager pm2 save

pm2 startup systemd -u manager --hp /var/www/manager
# 출력되는 sudo env PATH=... 명령어를 그대로 한 번 더 실행
```

정상 기동 확인:

```bash
curl http://localhost:4000/health   # {"ok":true}
```

## 9. Apache 설정 — manager.acmebloc.com 전용 신규 vhost

필요한 모듈 활성화 (`rewrite`는 아래 게시판 설정에서 쓴다):

```bash
sudo a2enmod proxy proxy_http rewrite
```

`/etc/apache2/sites-available/manager.acmebloc.com.conf` 새로 생성:

```apache
<VirtualHost *:80>
    LimitRequestBody 26214400
    ServerName manager.acmebloc.com

    DocumentRoot /var/www/manager/app/dist

    <Directory /var/www/manager/app/dist>
        Options -Indexes
        AllowOverride None
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyPass /api/ http://localhost:4000/api/
    ProxyPassReverse /api/ http://localhost:4000/api/
    ProxyPass /oidc/ http://localhost:4000/oidc/
    ProxyPassReverse /oidc/ http://localhost:4000/oidc/
</VirtualHost>
```

- `LimitRequestBody 26214400` — 일감 첨부 업로드 상한(25MB). 없으면 Apache 기본값에
  걸려 큰 첨부가 413으로 막힌다
- `FallbackResource /index.html` — React Router가 클라이언트 사이드에서 라우팅하는
  `/dashboard`, `/mypage` 같은 경로를 새로고침해도 404 안 나고 index.html이 응답하도록 함
  (mod_dir 기능이라 추가 모듈 설치 불필요)
- `/oidc/` 프록시 — **게시판 통합 로그인의 필수 조건.** 이게 없으면 브라우저가
  `/oidc/authorize`로 갔을 때 Node가 아니라 `FallbackResource`에 걸려 index.html이
  돌아오고, 로그인이 조용히 실패한다. `/api/`만 넣고 이걸 빠뜨리기 쉽다

```bash
sudo a2ensite manager.acmebloc.com.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

이제 인증서 발급 (certbot이 위 파일을 자동으로 HTTPS용으로 확장해줌):

```bash
sudo certbot --apache -d manager.acmebloc.com
```

완료되면 `/etc/apache2/sites-available/manager.acmebloc.com-le-ssl.conf` 파일이 자동 생성되고,
80번 포트는 443으로 리다이렉트되도록 certbot이 처리함.

### 9-1. 게시판(BookStack) 경로 설정

`docs/bookstack-patches.md`의 8·14번에 해당하는 Apache 쪽 절반. BookStack을 설치한
뒤에 적용한다(설치 자체는 그 문서 참고).

**certbot이 만든 `manager.acmebloc.com-le-ssl.conf`의 `<VirtualHost *:443>` 안에**
넣어야 한다 — 80번 파일에만 넣으면 실제 트래픽이 타는 443 vhost에는 반영되지 않는다.

```apache
    # BookStack Configuration
    Alias "/board" "/var/www/bookstack/app/public"

    <Directory "/var/www/bookstack/app/public">
      Options FollowSymlinks
      AllowOverride None
      Require all granted

      RewriteEngine On

      # Handle Authorization Header — Apache strips this by default; without
      # it BookStack's API token auth always fails with "no authorization
      # found" even when the token itself is correct. Mirrors BookStack's own
      # public/.htaccess, which AllowOverride None means we can't just rely on.
      RewriteCond %{HTTP:Authorization} .
      RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
      RewriteCond %{REQUEST_FILENAME} !-d
      RewriteRule ^(.*)/$ /$1 [L,R=301]

      RewriteCond %{REQUEST_FILENAME} !-d
      RewriteCond %{REQUEST_FILENAME} !-f
      RewriteRule ^ index.php [L]
    </Directory>

    <Directory "/var/www/bookstack">
      AllowOverride None
      Require all denied
    </Directory>

    # Block profile editing and logout — BookStack's own account changes
    # never sync back to Manager, and logging out here only ends the
    # BookStack-side session, not the real Manager login.
    <Location "/board/my-account">
        Require all denied
    </Location>
    <Location "/board/logout">
        Require all denied
    </Location>
    <Location "/board/oidc/logout">
        Require all denied
    </Location>
    # End BookStack Configuration
```

각 블록이 하는 일:

- `Alias "/board"` — 같은 도메인 아래에 BookStack을 붙인다. **이 동일 출처 구성이
  전체 통합 로그인의 전제다** — 다른 도메인이면 BookStack이 Manager의
  `manager_session` 쿠키를 읽지 못해서 로그아웃 동기화 훅이 아예 동작하지 않는다
- Authorization 재작성 — 없으면 Manager의 모든 BookStack API 호출이
  `요청에서 인증 토큰을 찾을 수 없습니다`로 실패한다. 토큰이 멀쩡해도 그렇고,
  홈 화면 "게시판 문서" 수가 조용히 0으로 나오는 증상으로 먼저 드러난다
- `<Directory "/var/www/bookstack">` 거부 — `public/` 위쪽(`.env`, `storage/` 등)이
  웹으로 노출되지 않게 막는다. **빠뜨리면 안 된다**
- `<Location>` 3개 — 8번 항목. `/board/oidc/logout`은 419를 돌려주는데, 나머지 둘과
  같은 형태인데도 그렇다(원인 미상, 차단 자체는 동작함)

적용:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://manager.acmebloc.com/board/      # 302 (로그인으로)
curl -s -o /dev/null -w "%{http_code}\n" https://manager.acmebloc.com/board/logout # 403
curl -s -o /dev/null -w "%{http_code}\n" https://manager.acmebloc.com/.env         # 404
```

## 10. 배포 후 확인

```bash
curl -I https://manager.acmebloc.com/                     # 200, 프론트엔드 index.html
curl -X POST -H "Content-Type: application/json" -d '{}' \
  https://manager.acmebloc.com/api/auth/login
# {"error":"idToken is required"} 나오면 API 연결 정상
```

브라우저로 `https://manager.acmebloc.com` 접속해서 실제 Gmail 로그인 팝업까지 떠야 함 (0단계에서
Google Cloud Console에 이 origin을 등록해뒀는지가 핵심).

### OIDC (게시판을 쓴다면)

`/health`는 `{"ok":true}` 고정값이라 SSO가 깨져 있어도 초록으로 나온다 — 아래를
따로 확인해야 한다. 게시판 로그인은 실패해도 Manager 본체는 멀쩡히 동작하기 때문에,
확인하지 않으면 사용자가 게시판을 눌러볼 때까지 모른다.

```bash
# 1) 디스커버리 — OIDC_ISSUER가 채워져 있고 /oidc/ 프록시가 살아있는지
curl -s https://manager.acmebloc.com/oidc/.well-known/openid-configuration | head -c 200
# {"issuer":"https://manager.acmebloc.com/oidc",...} 형태여야 정상.
# HTML(<!doctype html>)이 오면 /oidc/ 프록시가 없어서 index.html로 폴백된 것 (9단계).

# 2) 서명키 — server/keys/oidc-private.pem 에서 파생된 공개키가 게시되는지
curl -s https://manager.acmebloc.com/oidc/.well-known/jwks.json | grep -o '"kid":"[^"]*"'
# "kid":"main" 이 나와야 정상

# 3) 클라이언트 등록 — client_id가 BookStack .env와 일치하는지
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://manager.acmebloc.com/oidc/authorize?response_type=code&client_id=틀린값&redirect_uri=x"
# 400 이어야 정상 (400이 아니면 OIDC_CLIENT_ID/REDIRECT_URI 검증이 동작하지 않는 것)
```

브라우저에서 게시판 메뉴를 눌렀을 때 **BookStack 로그인 화면을 거치지 않고** 바로
들어가야 정상이다. 로그인 화면이 보이면 BookStack `.env`의 `AUTH_AUTO_INITIATE`나
`OIDC_CLIENT_ID`/`SECRET` 불일치를 의심한다 (`docs/bookstack-patches.md` 1번).

## 11. 로그인 서버 연동 + 필드 암호화 반영 (기존 배포에 추가 적용)

프론트엔드가 이제 `/api/auth/login`을 실제로 호출하고, `User` 테이블의 `email`/`name`/`picture`는
서버에서 AES-256-GCM으로 암호화해서 저장함 (RDS 자체 암호화에 더한 애플리케이션 레벨 암호화).
이미 배포해둔 서버에는 아래 작업을 추가로 해줘야 함:

```bash
sudo -u manager /bin/bash
cd /var/www/manager/app
git pull
npm install && npm run build

cd server
npm install
npx prisma migrate deploy   # email 유니크 제약 제거 마이그레이션 적용
```

새 환경변수 `FIELD_ENCRYPTION_KEY` 추가 (`.env`에 없으면 서버가 기동 시 에러남):

```bash
openssl rand -hex 32
```

나온 값을 `.env`에 추가:

```bash
echo "FIELD_ENCRYPTION_KEY=여기에_생성한_값" >> .env
chmod 600 .env
exit   # manager 셸에서 나가기

sudo systemctl restart pm2-manager
curl http://localhost:4000/health
```

## 12. 이메일 알림 반영 (기존 배포에 추가 적용)

멘션/담당자 배정/일정 참조자 등록 시 이메일을 보내는 기능 추가. Google Workspace
SMTP 릴레이로 발송하며(계정 인증 없이 이 서버의 고정 IP로 인증), 스키마 변경은
없음 — `npm install`로 `nodemailer` 설치와 `.env` 값 추가만 하면 됨.

사전 조건(2026-08-27 완료, Workspace 관리 콘솔): 발신용 그룹
`notifications@acmebloc.com` 생성, SMTP 릴레이 허용 목록에 이 서버의 고정
퍼블릭 IP(`15.164.69.195`) 등록. 자세한 절차는 `docs/email-notifications-spec.md`
2장 참고.

```bash
sudo -u manager /bin/bash
cd /var/www/manager/app
git pull
npm install && npm run build

cd server
npm install   # nodemailer 추가됨
```

`.env`에 SMTP 관련 값 추가 (`.env.example` 참고 — 로컬 개발 `.env`에는 넣지 않음,
`SMTP_HOST`가 없으면 실제 발송 대신 콘솔 로그로 대체되는 걸 이용해 로컬은 그대로 둠):

```bash
cat >> .env <<'EOF'
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
MAIL_FROM=notifications@acmebloc.com
EOF
chmod 600 .env
exit   # manager 셸에서 나가기

sudo systemctl restart pm2-manager
curl http://localhost:4000/health
```

## 13. 프로젝트별 BookStack 공간 자동 연동 반영 (기존 배포에 추가 적용)

프로젝트 생성 시 BookStack 공간(Shelf) + 문서함 3개(공지사항/Weekly/자료실)를
자동으로 만들고, 프로젝트 멤버만 접근 가능하도록 권한을 동기화하는 기능. 신규
프로젝트에만 적용되고(기존 프로젝트는 소급 적용 안 함), BookStack API가 실패해도
프로젝트 생성 자체는 항상 성공하는 느슨한 결합(`server/src/lib/bookstack.js`) —
BookStack 쪽 API 토큰이 아직 없거나 만료돼도 Manager 나머지 기능은 영향받지 않는다.

스키마 변경 있음(`Project`에 `bookstackShelfId` 등 6개 컬럼 추가) — `migrate deploy`
필요.

```bash
sudo -u manager /bin/bash
cd /var/www/manager/app
git pull
npm install && npm run build

cd server
npm install
npx prisma migrate deploy
npx prisma generate   # migrate deploy 다음에 — 순서 바뀌면 8월 26일 사고 재발
```

`.env`에 BookStack API 토큰 추가 (`.env.example` 참고 — BookStack 관리자 계정
우측 상단 프로필 → 프로필 편집 → API Tokens에서 발급, Token ID/Secret은 발급
시 한 번만 표시됨). 로컬 개발 `.env`에는 넣지 않아도 됨 — 셋 중 하나라도 없으면
조용히 건너뛰도록 만들어져 있다:

```bash
cat >> .env <<'EOF'
BOOKSTACK_API_URL=https://manager.acmebloc.com/board/api
BOOKSTACK_API_TOKEN_ID=여기에_발급받은_Token_ID
BOOKSTACK_API_TOKEN_SECRET=여기에_발급받은_Token_Secret
EOF
chmod 600 .env
exit   # manager 셸에서 나가기

sudo -u manager pm2 restart manager-api
curl http://localhost:4000/health
```

## 코드 업데이트할 때마다

`/var/www/manager/app`은 `manager` 소유에 `drwxr-x---`라, `ubuntu`로는 `cd`조차 안 된다
(`Permission denied`). `cd`를 `sudo -u manager` **안쪽**에서 해야 한다.

```bash
sudo -u manager bash -c 'cd /var/www/manager/app && git pull'
sudo -u manager bash -c 'cd /var/www/manager/app && npm install && npm run build'   # 프론트 변경 시

sudo -u manager bash -c 'cd /var/www/manager/app/server && npm install'                # 의존성 변경 시
sudo -u manager bash -c 'cd /var/www/manager/app/server && npx prisma migrate deploy'  # 스키마 변경 시
sudo -u manager bash -c 'cd /var/www/manager/app/server && npx prisma generate'        # 스키마 변경 시
#   ^ 반드시 migrate deploy 다음에. postinstall이 막혀 있어 npm install만으론 Prisma
#     Client가 새 모델/필드를 모른 채로 남는다 (2026-08-26: 이걸 빠뜨려서 배포 직후
#     API가 전부 조용히 실패한 적 있음)

sudo -u manager pm2 restart manager-api
curl -s http://localhost:4000/health
```

**재시작 전에 환경변수부터 확인**하면 안전하다. 서버는 필수 값이 비었거나
자리표시자면 아예 뜨지 않으므로(`server/src/lib/envCheck.js`), 미리 돌려보면
API가 내려간 상태로 원인을 찾는 일을 피할 수 있다:

```bash
sudo -u manager bash -c 'cd /var/www/manager/app/server && node -e '\''import("dotenv/config").then(() => import("./src/lib/envCheck.js")).then(m => { m.assertEnv(); console.log("환경변수 OK — 재시작해도 안전") }).catch(e => { console.error(e.message); process.exit(1) })'\'''
```

`환경변수 OK`가 나오면 재시작해도 된다. 문제가 있으면 어떤 변수인지 그대로 알려준다.

여러 명령을 이어서 할 거면 셸에 한 번만 들어가는 쪽이 편하다:

```bash
sudo -u manager bash
cd /var/www/manager/app
git pull && npm install && npm run build
cd server && npm install
exit
sudo -u manager pm2 restart manager-api
```
