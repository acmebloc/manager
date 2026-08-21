# BookStack 서버 패치 목록

게시판(`manager.acmebloc.com/board`)은 BookStack을 그대로 쓰지 않고, Manager와 하나의
서비스처럼 보이도록 서버에서 직접 수정한 부분이 있다. BookStack은 이 저장소가 아니라
서버의 `/var/www/bookstack/app`에 별도로 clone되어 있어서, 그 수정들은 여기에 커밋되지
않는다. **BookStack을 업그레이드(`git pull`)하면 아래 5개 파일 패치가 사라진다.**

업그레이드 후에는 이 문서의 명령을 위에서부터 순서대로 다시 실행하면 된다. 모든 스크립트는
같은 패치가 이미 적용돼 있으면 "already patched"를 출력하고 아무것도 바꾸지 않으며,
파일 구조가 예상과 다르면 중단한다.

| # | 대상 | 내용 | 업그레이드 시 |
|---|---|---|---|
| 1 | `.env` | 아래 설정값들 | 유지됨 |
| 2 | `themes/acmebloc/functions.php` | Manager 로그아웃 동기화 | 유지됨 (새 파일) |
| 3 | `app/Users/Models/User.php` | 아바타·이름 실시간 연동 | **재적용 필요** |
| 4 | `resources/views/layouts/parts/header-user-menu.blade.php` | 계정 메뉴 축소 | **재적용 필요** |
| 5 | `resources/views/layouts/parts/header.blade.php` | Manager 메뉴바 삽입 | **재적용 필요** |
| 6 | `resources/views/layouts/base.blade.php` | `dark-mode` 클래스 제거 | **재적용 필요** |
| 7 | `public/dist/styles.css` | `html`의 `overflow-y: scroll` 해제 | **재적용 필요** |
| 8 | Apache vhost | 계정/로그아웃 경로 차단 | 유지됨 |

디렉터리 소유자가 `bookstack` 계정이라 `ubuntu`로는 `cd`조차 안 된다. 모든 명령은
`sudo` 또는 `sudo -u bookstack`으로 실행한다.

---

## Manager 쪽 의존성

3번 패치는 Manager 백엔드의 두 엔드포인트에 의존한다. 이건 이 저장소에 있으니
따로 재적용할 필요는 없지만, 지우면 게시판 아바타/이름이 깨진다.

- `GET /api/avatar/:userId` — [server/src/routes/avatar.js](../server/src/routes/avatar.js)
- `GET /api/public-profile/:userId` — [server/src/routes/publicProfile.js](../server/src/routes/publicProfile.js)

두 엔드포인트 모두 인증이 없다. `<img src>`는 `Authorization` 헤더를 못 보내기 때문이다.
노출되는 정보는 프로필 사진과 표시 이름뿐이고, 알아내려면 사용자 ID(cuid)를 이미 알아야 한다.

OIDC의 `picture` 클레임도 원본 값이 아니라 위 아바타 URL을 내보낸다
([server/src/routes/oidc.js](../server/src/routes/oidc.js)의 `avatarUrl()`).

---

## 1. `.env` 설정

BookStack의 `.env`는 git이 추적하지 않으므로 업그레이드해도 유지된다. 새로 설치하는
경우에만 필요하다.

```bash
sudo grep -E '^(APP_LANG|APP_THEME|SESSION_LIFETIME|AUTH_METHOD|AUTH_AUTO_INITIATE|MANAGER_ORIGIN|OIDC_)' /var/www/bookstack/app/.env
```

기대값:

| 키 | 값 | 이유 |
|---|---|---|
| `APP_URL` | `https://manager.acmebloc.com/board` | 서브디렉터리 설치 |
| `APP_LANG` | `ko` | 한국어 UI |
| `APP_THEME` | `acmebloc` | 2번 테마 활성화 |
| `SESSION_LIFETIME` | `120` | 기본값. 2번 테마가 로그아웃을 즉시 동기화하므로 짧게 둘 필요가 없다 |
| `AUTH_METHOD` | `oidc` | Manager 로그인만 사용 |
| `AUTH_AUTO_INITIATE` | `true` | BookStack 자체 로그인 화면을 건너뛰고 바로 Manager로 |
| `OIDC_ISSUER` | `https://manager.acmebloc.com/oidc` | Manager의 OIDC 프로바이더 |
| `OIDC_ISSUER_DISCOVER` | `true` | discovery 문서로 엔드포인트 자동 탐색 |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | (Manager `.env`와 동일) | |
| `OIDC_DISPLAY_NAME_CLAIMS` | `name` | |
| `MANAGER_ORIGIN` | `https://manager.acmebloc.com` | 3번 패치가 참조 |

`SESSION_LIFETIME`을 짧게(예: `2`) 두면 안 된다. 문서를 그 시간 이상 편집한 뒤 저장하면
세션이 끊겨 CSRF 오류(419)로 작성 내용이 날아간다.

변경 후에는 항상:

```bash
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

---

## 2. Manager 로그아웃 동기화 (테마)

BookStack은 OIDC로 로그인한 뒤 자체 Laravel 세션을 유지하기 때문에, Manager에서
로그아웃해도 게시판은 계속 로그인 상태로 남는다. BookStack의 공식 확장 지점인
**논리 테마 시스템**으로 매 요청마다 Manager의 세션 쿠키를 확인해 즉시 동기화한다.

`themes/`는 BookStack이 추적하지 않는 디렉터리라 업그레이드해도 유지된다.
코어 파일을 건드리지 않는 이 방식이 다른 패치들보다 안전하니, 앞으로 BookStack 동작을
바꿔야 할 때는 여기에 훅을 추가할 수 있는지부터 확인할 것.

```bash
sudo mkdir -p /var/www/bookstack/app/themes/acmebloc
sudo tee /var/www/bookstack/app/themes/acmebloc/functions.php > /dev/null <<'EOF'
<?php

use BookStack\Facades\Theme;
use BookStack\Theming\ThemeEvents;

// Manager (the SPA at the site root) owns login for every service on this
// domain. BookStack starts its own Laravel session once OIDC hands the user
// over, so on its own it stays logged in even after the user logs out of
// Manager. Re-checking Manager's session cookie on each request keeps the
// two in step immediately, instead of leaning on a short session lifetime
// (which would drop long edits mid-write).
Theme::listen(ThemeEvents::WEB_MIDDLEWARE_BEFORE, function ($request) {
    $user = auth()->user();

    // Only applies to users who came in through Manager. Local accounts
    // (the built-in admin) must stay usable even with no Manager session.
    if (!$user || empty($user->external_auth_id)) {
        return null;
    }

    // Read the raw superglobal on purpose: EncryptCookies has already
    // blanked this out of the request object, because Manager sets it and
    // it isn't encrypted with BookStack's app key.
    if (!empty($_COOKIE['manager_session'])) {
        return null;
    }

    auth()->logout();
    $request->session()->invalidate();
    $request->session()->regenerateToken();

    // Resolves to the board root (APP_URL already includes /board), which
    // re-triggers auto-initiate and lands on Manager's login screen.
    return redirect('/');
});
EOF
sudo chown -R bookstack:bookstack /var/www/bookstack/app/themes/acmebloc
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

---

## 3. 아바타·이름 실시간 연동

BookStack은 OIDC 최초 로그인 때만 이름과 아바타를 복사해두고 이후엔 갱신하지 않는다.
그래서 Manager에서 프로필을 바꿔도 게시판에는 반영되지 않는다. 두 값 모두 Manager를
실시간으로 바라보게 바꾼다.

- **아바타**: `getAvatar()`가 BookStack의 이미지 저장소 대신 Manager의 URL을 그대로 반환한다.
  이미지를 복사하지 않으므로 Manager에서 사진을 바꾸면 즉시 반영된다.
- **이름**: `name` 접근자가 Manager를 조회한다. 매 요청마다 호출하지 않도록 30초 캐시를
  두고, Manager가 응답하지 않으면 저장된 값으로 조용히 넘어간다.

둘 다 `external_auth_id`가 있는 OIDC 사용자에게만 적용되므로 로컬 관리자 계정은 영향받지 않는다.

```bash
sudo cp /var/www/bookstack/app/app/Users/Models/User.php /tmp/User.php.bak

# 3-1. 아바타
sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/app/Users/Models/User.php"
with open(path) as f:
    content = f.read()

if "config('auth.method') === 'oidc'" in content:
    print("avatar: already patched, skipping")
else:
    old = "$default = url('/user_avatar.png');\n"
    if old not in content:
        raise SystemExit("avatar: anchor line not found — file differs from expected, aborting")

    new = old + """
        if (!empty($this->external_auth_id) && config('auth.method') === 'oidc') {
            return rtrim(env('MANAGER_ORIGIN'), '/') . '/api/avatar/' . $this->external_auth_id;
        }
"""
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)
    print("avatar: patched")
PYEOF

# 3-2. 이름
sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/app/Users/Models/User.php"
with open(path) as f:
    content = f.read()

if "function getNameAttribute" in content:
    print("name: already patched, skipping")
else:
    anchor = "    public function avatar(): BelongsTo\n"
    if anchor not in content:
        raise SystemExit("name: anchor not found — file differs from expected, aborting")

    patch = '''    public function getNameAttribute($value)
    {
        if (empty($this->external_auth_id) || config('auth.method') !== 'oidc') {
            return $value;
        }

        return \\Illuminate\\Support\\Facades\\Cache::remember(
            'manager_name_' . $this->external_auth_id,
            30,
            function () use ($value) {
                try {
                    $response = \\Illuminate\\Support\\Facades\\Http::timeout(2)
                        ->get(rtrim(env('MANAGER_ORIGIN'), '/') . '/api/public-profile/' . $this->external_auth_id);
                    if ($response->successful() && $response->json('name')) {
                        return $response->json('name');
                    }
                } catch (Exception $e) {
                    // fall through to the stored value
                }
                return $value;
            }
        );
    }

'''
    content = content.replace(anchor, patch + anchor, 1)
    with open(path, "w") as f:
        f.write(content)
    print("name: patched")
PYEOF
```

---

## 4. 계정 메뉴 축소

우측 상단 계정 드롭다운에서 **내 계정 / 밝은 테마 / 로그아웃**을 없앤다.

- **내 계정**: 여기서 이름·사진을 바꿔도 Manager에는 반영되지 않는다. 프로필 수정은
  Manager 마이페이지 한 곳에서만 해야 한다.
- **로그아웃**: BookStack 세션만 끊길 뿐 Manager 로그인은 살아있어서, 바로 다시
  자동 로그인된다.

기능 자체를 제거하는 게 아니라 화면에 노출되는 `<li>`만 지운다. 경로 차단은 8번에서
Apache가 따로 처리한다.

남길 항목(즐겨찾기, 프로필 보기)만 골라 유지하는 방식이라, 업그레이드로 다른 항목이
추가돼도 그대로 걸러진다.

```bash
sudo cp /var/www/bookstack/app/resources/views/layouts/parts/header-user-menu.blade.php /tmp/header-user-menu.blade.php.bak
sudo python3 - <<'PYEOF'
import re
path = "/var/www/bookstack/app/resources/views/layouts/parts/header-user-menu.blade.php"
with open(path) as f:
    content = f.read()

if "ACMEBLOC-MENU-TRIMMED" in content:
    print("already patched, skipping")
    raise SystemExit(0)

m = re.search(r'(<ul\b[^>]*role="menu"[^>]*>)(.*?)(</ul>)', content, re.S)
if not m:
    raise SystemExit("menu <ul> not found — aborting")

open_tag, body, close_tag = m.group(1), m.group(2), m.group(3)

items = re.findall(r'<li\b.*?</li>', body, re.S)
kept = [li for li in items if 'favourites' in li or 'getProfileUrl' in li]
if len(kept) != 2:
    raise SystemExit(f"expected to keep exactly 2 items (favourites, profile), found {len(kept)} — aborting")

new_body = (
    "\n        {{-- ACMEBLOC-MENU-TRIMMED: my-account / theme / logout removed --}}\n"
    + "\n".join("        " + li for li in kept)
    + "\n    "
)
content = content[:m.start()] + open_tag + new_body + close_tag + content[m.end():]
with open(path, "w") as f:
    f.write(content)
print(f"patched (kept {len(kept)} items, removed {len(items) - len(kept)})")
PYEOF
```

---

## 5. Manager 메뉴바 삽입

게시판에서도 Manager와 같은 상단 메뉴가 보이도록, BookStack 헤더 **위쪽**에 메뉴바를
넣는다. BookStack은 Tailwind를 쓰지 않으므로 스타일은 인라인 CSS로 재현했다.

메뉴 항목은 [src/components/Layout.jsx](../src/components/Layout.jsx)의 `MENU_ITEMS`와
같은 순서여야 한다. **Manager 쪽 메뉴를 바꾸면 여기도 같이 고쳐야 한다.**

```bash
sudo cp /var/www/bookstack/app/resources/views/layouts/parts/header.blade.php /tmp/header.blade.php.bak
sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/resources/views/layouts/parts/header.blade.php"
with open(path) as f:
    content = f.read()

if "MANAGER-NAV" in content:
    print("already patched, skipping")
    raise SystemExit(0)

idx = content.find("<header")
if idx == -1:
    raise SystemExit("<header> tag not found — aborting")

snippet = """<!-- MANAGER-NAV -->
<nav class="acmebloc-topnav" aria-label="Manager 메뉴">
    <a href="/dashboard">홈</a>
    <a href="/projects">프로젝트</a>
    <a href="/tasks">일감관리</a>
    <a href="/schedule">일정관리</a>
    <a href="/board" class="active">게시판</a>
    <a href="/mypage">마이페이지</a>
</nav>
<style>
.acmebloc-topnav { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #e5e7eb; padding: 0 16px; background: #fff; }
.acmebloc-topnav a { display: inline-block; padding: 12px 16px; font-size: 14px; font-weight: 500; color: #6b7280; text-decoration: none; border-bottom: 2px solid transparent; }
.acmebloc-topnav a:hover { color: #111827; }
.acmebloc-topnav a.active { color: #4f46e5; border-bottom-color: #4f46e5; }
</style>
"""

content = content[:idx] + snippet + content[idx:]
with open(path, "w") as f:
    f.write(content)
print("patched")
PYEOF
```

---

## 6. `dark-mode` 클래스 제거

`<html>`에 붙는 `dark-mode` 클래스를 항상 비운다. 계정 메뉴에서 테마 토글을 없앴으므로
사용자가 이 상태를 되돌릴 방법이 없기 때문이다.

```bash
sudo cp /var/www/bookstack/app/resources/views/layouts/base.blade.php /tmp/base.blade.php.bak
sudo python3 - <<'PYEOF'
import re
path = "/var/www/bookstack/app/resources/views/layouts/base.blade.php"
with open(path) as f:
    content = f.read()

if "dark-mode-enabled" not in content:
    print("already patched, skipping")
    raise SystemExit(0)

pattern = re.compile(r'class="\{\{[^"]*dark-mode-enabled[^"]*\}\}"')
new_content, count = pattern.subn('class=""', content)
if count != 1:
    raise SystemExit(f"expected exactly 1 match, found {count} — aborting")

with open(path, "w") as f:
    f.write(new_content)
print("patched")
PYEOF
```

---

## 7. `html`의 `overflow-y: scroll` 해제

내용이 짧은 페이지에서도 스크롤바가 항상 자리를 차지해 Manager 화면과 폭이 어긋난다.

`styles.css`에는 `overflow-y: scroll`이 여러 군데 있고 대부분은 모달·사이드바 등에
필요하다. **`html { }` 블록 안의 것 하나만** 주석 처리해야 한다.

```bash
sudo cp /var/www/bookstack/app/public/dist/styles.css /tmp/styles.css.bak
sudo python3 - <<'PYEOF'
import re
path = "/var/www/bookstack/app/public/dist/styles.css"
with open(path) as f:
    content = f.read()

if "/*overflow-y" in content:
    print("already patched, skipping")
    raise SystemExit(0)

# Narrow on purpose: only the declaration inside an `html { ... }` block.
# [^}] stops the match from running past the end of that rule.
pattern = re.compile(r'(html\s*\{[^}]*?)overflow-y\s*:\s*scroll\s*;')
if len(pattern.findall(content)) != 1:
    raise SystemExit("expected exactly 1 match inside an html{} block — aborting")

new_content, _ = pattern.subn(lambda m: m.group(1) + "/*overflow-y: scroll;*/", content)
with open(path, "w") as f:
    f.write(new_content)
print("patched")
PYEOF
```

---

## 8. Apache 경로 차단

4번이 메뉴를 화면에서 없앨 뿐이라, URL을 직접 입력하는 경우를 vhost에서 막는다.
`/etc/apache2/sites-available/manager.acmebloc.com-le-ssl.conf`의 BookStack 블록:

```apache
<Location "/board/my-account">
    Require all denied
</Location>
<Location "/board/logout">
    Require all denied
</Location>
<Location "/board/oidc/logout">
    Require all denied
</Location>
```

`/board/my-account`와 `/board/logout`은 403으로 잘 막히지만,
**`/board/oidc/logout`은 같은 설정인데도 403이 아니라 419(Laravel CSRF)를 반환한다.**
원인은 규명되지 않았다. 해당 버튼이 이미 메뉴에서 제거됐고 로그아웃되더라도 2번 테마가
Manager 세션을 기준으로 다시 로그인시키므로 실질적인 위험은 없어 그대로 두었다.

---

## 마무리 및 검증

패치 후 항상:

```bash
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear && php artisan view:clear'
```

브라우저에서 확인할 것:

1. **로그인 흐름** — Manager 로그인 후 게시판 메뉴 클릭 시 로그인 화면 없이 바로 진입.
   게시판 안에서 문서를 열고 이동해도 중간에 튕기지 않아야 한다.
2. **로그아웃 동기화** — Manager 마이페이지에서 회원탈퇴 후 게시판에 접속하면 대기 없이
   Manager 로그인 화면으로 이동.
3. **비로그인 직접 접속** — 로그아웃 상태에서 `/board` URL을 직접 입력해도 Manager
   로그인 화면으로 이동.
4. **프로필 연동** — Manager 마이페이지에서 이름·사진 변경 후 게시판 새로고침 시 반영
   (이름은 30초 캐시).
5. **UI** — 상단에 Manager 메뉴바가 헤더보다 위에 표시되고, 계정 드롭다운에는
   즐겨찾기·프로필 보기만 남아 있어야 한다.

문제가 생기면:

```bash
sudo tail -30 /var/www/bookstack/app/storage/logs/laravel.log
```
