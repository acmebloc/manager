# 배포 가이드 (EC2 + RDS, manager.acmebloc.com 서브도메인)

이 저장소는 프론트엔드(Vite + React)와 `server/`(Node + Express + Prisma API)로 구성돼 있고,
`manager.acmebloc.com` 서브도메인 하나에 이 앱 전체(프론트+API)를 통째로 서빙하는 걸 기준으로
작성함. `acmebloc.com` 메인 도메인은 나중에 다른 사이트용으로 남겨둠.

**확인된 서버 환경** (2026-08-20 기준)

- 퍼블릭 IP: `3.39.230.46`, 메인 도메인: `https://acmebloc.com/` (이미 SSL 적용됨, 다른 사이트용으로 보존)
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
manager.acmebloc.com   A   3.39.230.46
```

레코드 추가 후 전파 확인:

```bash
dig +short manager.acmebloc.com
# 3.39.230.46 나오면 OK (전파에 몇 분~몇십 분 걸릴 수 있음)
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
ssh -i /path/to/key.pem ubuntu@3.39.230.46

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
ssh -i /path/to/key.pem ubuntu@3.39.230.46

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
- `FRONTEND_ORIGIN` — `https://manager.acmebloc.com`

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

프록시 모듈 활성화:

```bash
sudo a2enmod proxy proxy_http
```

`/etc/apache2/sites-available/manager.acmebloc.com.conf` 새로 생성:

```apache
<VirtualHost *:80>
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
</VirtualHost>
```

- `FallbackResource /index.html` — React Router가 클라이언트 사이드에서 라우팅하는
  `/dashboard`, `/mypage` 같은 경로를 새로고침해도 404 안 나고 index.html이 응답하도록 함
  (mod_dir 기능이라 추가 모듈 설치 불필요)

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

## 10. 배포 후 확인

```bash
curl -I https://manager.acmebloc.com/                     # 200, 프론트엔드 index.html
curl -X POST -H "Content-Type: application/json" -d '{}' \
  https://manager.acmebloc.com/api/auth/login
# {"error":"idToken is required"} 나오면 API 연결 정상
```

브라우저로 `https://manager.acmebloc.com` 접속해서 실제 Gmail 로그인 팝업까지 떠야 함 (0단계에서
Google Cloud Console에 이 origin을 등록해뒀는지가 핵심).

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

## 코드 업데이트할 때마다

```bash
cd /var/www/manager/app
sudo -u manager git pull
sudo -u manager npm install && sudo -u manager npm run build   # 프론트 변경 시

cd server
sudo -u manager npm install                     # 의존성 변경 시
sudo -u manager npx prisma migrate deploy       # 스키마 변경 시
sudo -u manager pm2 restart manager-api
```
