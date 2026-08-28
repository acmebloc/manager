# BookStack 서버 커스터마이징

게시판(`manager.acmebloc.com/board`)은 BookStack을 그대로 쓰지 않고, Manager와 하나의
서비스처럼 보이도록 손댄 부분이 있다. BookStack은 이 저장소가 아니라 서버의
`/var/www/bookstack/app`에 별도로 clone되어 있어서, 그 내용은 여기에 커밋되지 않는다.

**커스터마이징은 가능한 한 업그레이드에 살아남는 곳에 둔다.** BookStack에는 그런 자리가
세 군데 있고, 아래 순서로 우선 검토한다.

1. **설정 UI / `.env`** — DB나 `.env`에 저장되므로 코드와 무관하다. 제일 안전하다.
2. **`themes/acmebloc/`** — BookStack이 추적하지 않는 디렉터리라 `git pull`에도 남는다.
   로직 훅(`functions.php`)과 뷰 오버라이드를 모두 넣을 수 있다.
3. **코어 파일 직접 수정** — 위 둘로 안 될 때만. 업그레이드 때마다 재적용해야 한다.

현재 3번에 해당하는 건 `app/Users/Models/User.php` **하나뿐**이다. 모델은 테마로
덮어쓸 수 없어서 어쩔 수 없다.

| # | 대상 | 내용 | 업그레이드 시 |
|---|---|---|---|
| 1 | `.env` | 아래 설정값들 | 유지 |
| 2 | 설정 DB (커스텀 head) | 스크롤바 CSS | 유지 |
| 3 | 설정 DB + `.env` | 다크모드 끄기 | 유지 |
| 4 | `themes/acmebloc/functions.php` | Manager 로그아웃 동기화 | 유지 |
| 5 | `themes/acmebloc/layouts/parts/header.blade.php` | Manager 메뉴바 | 유지 (※ 아래 주의) |
| 6 | `themes/acmebloc/layouts/parts/header-user-menu.blade.php` | 계정 메뉴 축소 | 유지 (※ 아래 주의) |
| 7 | `app/Users/Models/User.php` | 아바타·이름 실시간 연동 | **재적용 필요** |
| 8 | Apache vhost | 계정/로그아웃 경로 차단 | 유지 |
| 9 | `lang/ko/entities.php` | 엔티티 명칭(공간/문서함/섹션/문서) | **재적용 필요** |
| 10 | 설정 DB (`app-color`) + 커스텀 head | 디자인 톤(색상·폰트) + 로고 숨김 | 유지 |
| 11 | `themes/acmebloc/layouts/parts/header.blade.php` (5번 갱신) | 게시판 서브메뉴 고정 노출 + 라벨 동기화 | 유지 (※ 아래 주의) |

> **※ 뷰 오버라이드 주의** — 5·6번은 삭제되지는 않지만 **낡을 수 있다.** 테마의 복사본이
> 원본을 완전히 대체하므로, 업그레이드로 원본에 새 마크업이 추가돼도 우리 복사본은 옛날
> 화면을 계속 그린다. 업그레이드 후에는 아래 "업그레이드 후 점검"의 diff를 꼭 돌려볼 것.
>
> 같은 이유로 `layouts/base.blade.php`(루트 레이아웃)는 **일부러 테마에 두지 않았다.**
> 스크립트·메타태그가 모두 거기 있어서, 고정해두면 업그레이드 때 사이트가 미묘하게 깨진다.
> 다크모드 제거는 3번처럼 설정으로 처리했다.

디렉터리 소유자가 `bookstack` 계정이라 `ubuntu`로는 `cd`조차 안 된다. 모든 명령은
`sudo` 또는 `sudo -u bookstack`으로 실행한다. 아래에서 `$BS`는
`/var/www/bookstack/app`를 가리킨다.

---

## Manager 쪽 의존성

7번은 Manager 백엔드의 두 엔드포인트에 의존한다. 이건 이 저장소에 있으니 따로 재적용할
필요는 없지만, 지우면 게시판의 아바타와 이름이 깨진다.

- `GET /api/avatar/:userId` — [server/src/routes/avatar.js](../server/src/routes/avatar.js)
- `GET /api/public-profile/:userId` — [server/src/routes/publicProfile.js](../server/src/routes/publicProfile.js)

두 엔드포인트 모두 인증이 없다. `<img src>`는 `Authorization` 헤더를 보낼 수 없기
때문이다. 노출되는 정보는 프로필 사진과 표시 이름뿐이고, 그마저도 사용자 ID(cuid)를
이미 알아야 조회할 수 있다.

OIDC의 `picture` 클레임도 원본 값이 아니라 위 아바타 URL을 내보낸다
([server/src/routes/oidc.js](../server/src/routes/oidc.js)의 `avatarUrl()`).

---

## 1. `.env` 설정

`.env`는 git이 추적하지 않으므로 업그레이드해도 유지된다. 새로 설치할 때만 필요하다.

```bash
sudo grep -E '^(APP_LANG|APP_THEME|APP_DEFAULT_DARK_MODE|SESSION_LIFETIME|AUTH_METHOD|AUTH_AUTO_INITIATE|MANAGER_ORIGIN|OIDC_)' /var/www/bookstack/app/.env
```

| 키 | 값 | 이유 |
|---|---|---|
| `APP_URL` | `https://manager.acmebloc.com/board` | 서브디렉터리 설치 |
| `APP_LANG` | `ko` | 한국어 UI |
| `APP_THEME` | `acmebloc` | 아래 테마 활성화 |
| `APP_DEFAULT_DARK_MODE` | `false` | 테마 토글을 메뉴에서 없앴으므로 켜지면 되돌릴 방법이 없다 |
| `SESSION_LIFETIME` | `120` | 기본값 |
| `AUTH_METHOD` | `oidc` | Manager 로그인만 사용 |
| `AUTH_AUTO_INITIATE` | `true` | BookStack 자체 로그인 화면을 건너뛰고 바로 Manager로 |
| `OIDC_ISSUER` | `https://manager.acmebloc.com/oidc` | Manager의 OIDC 프로바이더 |
| `OIDC_ISSUER_DISCOVER` | `true` | discovery 문서로 엔드포인트 자동 탐색 |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | (Manager `.env`와 동일) | |
| `OIDC_DISPLAY_NAME_CLAIMS` | `name` | |
| `MANAGER_ORIGIN` | `https://manager.acmebloc.com` | 7번이 참조 |

`SESSION_LIFETIME`을 짧게(예: `2`) 두면 안 된다. 문서를 그 시간 이상 편집한 뒤 저장하면
세션이 끊겨 CSRF 오류(419)로 작성 내용이 날아간다. 로그아웃 동기화는 4번이 즉시
처리하므로 세션 수명을 줄일 이유가 없다.

`.env`를 바꾼 뒤에는 항상:

```bash
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

---

## 2·3. 설정 DB — 스크롤바 CSS와 다크모드

둘 다 예전에는 코어 파일을 고쳐서 처리했지만(각각 `public/dist/styles.css`와
`layouts/base.blade.php`), 설정으로 옮겨서 업그레이드 영향을 없앴다.

- **스크롤바**: `dist/styles.css`의 `html { overflow-y: scroll }` 때문에 내용이 짧아도
  스크롤바가 자리를 차지해 Manager 화면과 폭이 어긋났다. 커스텀 head에서 덮어쓴다.
- **다크모드**: `<html>`의 `dark-mode` 클래스는 사용자별 설정에서 온다. 저장된 값을
  지우고 앱 기본값을 `false`로 두면 클래스가 붙지 않는다.

```bash
sudo tee /tmp/acmebloc-settings.php > /dev/null <<'EOF'
<?php
require '/var/www/bookstack/app/vendor/autoload.php';
$app = require '/var/www/bookstack/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$svc = app(\BookStack\Settings\SettingService::class);

$marker = 'ACMEBLOC-CUSTOM-HEAD';
$head = (string) $svc->get('app-custom-head', '');
if (str_contains($head, $marker)) {
    echo "custom head: already set, skipping\n";
} else {
    $css = "\n<!-- {$marker} -->\n<style>\n"
         . "  /* Manager 화면과 폭을 맞추기 위해, 내용이 짧아도 항상 자리를 차지하는\n"
         . "     스크롤바를 끈다. dist/styles.css의 html 규칙을 덮어쓴다. */\n"
         . "  html { overflow-y: auto; }\n"
         . "</style>\n";
    $svc->put('app-custom-head', $head . $css);
    echo "custom head: appended\n";
}

$setting = \BookStack\Settings\Setting::query()
    ->where('setting_key', 'like', 'user:%:dark-mode-enabled');
foreach ((clone $setting)->get(['setting_key', 'value']) as $row) {
    echo "  found {$row->setting_key} = {$row->value}\n";
}
echo "dark-mode user settings deleted: " . $setting->delete() . "\n";
EOF

sudo -u bookstack php /tmp/acmebloc-settings.php
sudo rm /tmp/acmebloc-settings.php
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

---

## 4. 로그아웃 동기화 (테마 로직 훅)

BookStack은 OIDC로 로그인한 뒤 자체 Laravel 세션을 유지하기 때문에, Manager에서
로그아웃해도 게시판은 계속 로그인 상태로 남는다. 매 요청마다 Manager의 세션 쿠키를
확인해 즉시 동기화한다.

```bash
BS=/var/www/bookstack/app
sudo mkdir -p $BS/themes/acmebloc
sudo tee $BS/themes/acmebloc/functions.php > /dev/null <<'EOF'
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
sudo chown -R bookstack:bookstack $BS/themes/acmebloc
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

---

## 5·6. 뷰 오버라이드 (테마)

테마 폴더는 `resources/views`의 구조를 그대로 미러링한다.
`themes/acmebloc/layouts/parts/header.blade.php`를 두면 원본 대신 그게 렌더링된다.

두 파일 모두 **원본을 복사한 뒤 편집하는** 방식이다. 아래 스크립트는 원본에서 새로
만들어내므로, 업그레이드로 원본이 바뀌었을 때 최신 원본 기준으로 다시 생성할 때도
그대로 쓸 수 있다.

### 5. Manager 메뉴바

게시판에서도 Manager와 같은 상단 메뉴가 보이도록 BookStack 헤더 **위쪽**에 넣는다.
BookStack은 Tailwind를 쓰지 않으므로 스타일은 인라인 CSS로 재현했다.

메뉴 항목은 [src/components/Layout.jsx](../src/components/Layout.jsx)의 `MENU_ITEMS`와
같아야 한다. **Manager 쪽 메뉴를 바꾸면 여기도 같이 고쳐야 한다.**

```bash
BS=/var/www/bookstack/app
sudo mkdir -p $BS/themes/acmebloc/layouts/parts
sudo cp $BS/resources/views/layouts/parts/header.blade.php \
        $BS/themes/acmebloc/layouts/parts/header.blade.php

sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/themes/acmebloc/layouts/parts/header.blade.php"
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

sudo chown -R bookstack:bookstack $BS/themes/acmebloc
```

### 6. 계정 메뉴 축소

우측 상단 계정 드롭다운에서 **내 계정 / 밝은 테마 / 로그아웃**을 없앤다.

- **내 계정**: 여기서 이름·사진을 바꿔도 Manager에는 반영되지 않는다. 프로필 수정은
  Manager 마이페이지 한 곳에서만 해야 한다.
- **로그아웃**: BookStack 세션만 끊길 뿐 Manager 로그인은 살아있어서, 곧바로 다시
  자동 로그인된다.
- **밝은 테마**: 다크모드를 3번에서 껐으므로 토글이 남아 있으면 되살릴 수 있다.

기능 자체를 제거하는 게 아니라 화면에 노출되는 `<li>`만 지운다. 경로 차단은 8번에서
Apache가 따로 처리한다.

지울 항목을 찾는 대신 **남길 항목(즐겨찾기, 프로필 보기)만 골라 유지**하므로,
업그레이드로 다른 항목이 추가돼도 그대로 걸러진다.

```bash
BS=/var/www/bookstack/app
sudo mkdir -p $BS/themes/acmebloc/layouts/parts
sudo cp $BS/resources/views/layouts/parts/header-user-menu.blade.php \
        $BS/themes/acmebloc/layouts/parts/header-user-menu.blade.php

sudo python3 - <<'PYEOF'
import re
path = "/var/www/bookstack/app/themes/acmebloc/layouts/parts/header-user-menu.blade.php"
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

sudo chown -R bookstack:bookstack $BS/themes/acmebloc
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan view:clear'
```

---

## 7. 아바타·이름 실시간 연동 (유일한 코어 수정)

BookStack은 OIDC 최초 로그인 때만 이름과 아바타를 복사해두고 이후엔 갱신하지 않는다.
그래서 Manager에서 프로필을 바꿔도 게시판에는 반영되지 않는다. 두 값 모두 Manager를
실시간으로 바라보게 바꾼다.

- **아바타**: `getAvatar()`가 BookStack의 이미지 저장소 대신 Manager의 URL을 그대로
  반환한다. 이미지를 복사하지 않으므로 Manager에서 사진을 바꾸면 즉시 반영된다.
- **이름**: `name` 접근자가 Manager를 조회한다. 매 요청마다 호출하지 않도록 30초 캐시를
  두고, Manager가 응답하지 않으면 저장된 값으로 조용히 넘어간다.

둘 다 `external_auth_id`가 있는 OIDC 사용자에게만 적용되므로 로컬 관리자 계정은
영향받지 않는다.

**모델은 테마로 덮어쓸 수 없어서, 이것만은 업그레이드 때마다 다시 적용해야 한다.**

```bash
BS=/var/www/bookstack/app
sudo cp $BS/app/Users/Models/User.php /tmp/User.php.bak

# 7-1. 아바타
sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/app/Users/Models/User.php"
with open(path) as f:
    content = f.read()

if "config('auth.method') === 'oidc'" in content:
    print("avatar: already patched, skipping")
else:
    old = "$default = url('/user_avatar.png');\n"
    if old not in content:
        raise SystemExit("avatar: anchor line not found — aborting")

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

# 7-2. 이름
sudo python3 - <<'PYEOF'
path = "/var/www/bookstack/app/app/Users/Models/User.php"
with open(path) as f:
    content = f.read()

if "function getNameAttribute" in content:
    print("name: already patched, skipping")
else:
    anchor = "    public function avatar(): BelongsTo\n"
    if anchor not in content:
        raise SystemExit("name: anchor not found — aborting")

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

## 8. Apache 경로 차단

6번이 메뉴를 화면에서 없앨 뿐이라, URL을 직접 입력하는 경우를 vhost에서 막는다.
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
원인은 규명되지 않았다. 해당 버튼이 이미 메뉴에서 제거됐고, 로그아웃되더라도 4번이
Manager 세션을 기준으로 다시 로그인시키므로 실질적인 위험은 없어 그대로 두었다.

---

## 9. 엔티티 명칭 변경 (책꽂이/책/챕터/페이지 → 공간/문서함/섹션/문서)

BookStack의 4단 구조(Shelf > Book > Chapter > Page) 자체는 그대로 두고, 화면에 보이는
한국어 명칭만 바꾼다: **공간 > 문서함 > 섹션 > 문서**. 문서함 안에서 섹션·문서가
필수로 연결되지 않는 것(섹션 없이 문서함에 문서를 바로 넣을 수 있는 것)은 BookStack
기본 동작 그대로 유지한다 — 구조 변경 없음, 표시 문구만 변경.

번역 파일 위치는 BookStack 버전에 따라 `lang/ko/entities.php`(최신, Laravel 9+ 구조)
또는 `resources/lang/ko/entities.php`(구버전) 중 하나다. 아래 스크립트가 둘 다 찾아본다.

**값 문자열이 아니라 키 이름으로 치환**하므로, 지금 값이 정상(챕터)이든 화면에 보이는
알려진 오역(새창)이든 상관없이 안전하게 덮어쓴다. 각 키를 찾았는지 결과로 출력하니,
"NOT FOUND"로 나온 키가 있으면 그 부분만 캡처해서 알려줄 것 — 다음 라운드에서 마저 고친다.

```bash
BS=/var/www/bookstack/app
LANG_FILE=""
for candidate in "$BS/lang/ko/entities.php" "$BS/resources/lang/ko/entities.php"; do
  if sudo test -f "$candidate"; then LANG_FILE="$candidate"; break; fi
done
if [ -z "$LANG_FILE" ]; then
  echo "entities.php를 못 찾았습니다 — 경로를 확인해주세요"; exit 1
fi
echo "대상 파일: $LANG_FILE"

sudo python3 - "$LANG_FILE" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

MAPPING = {
    'shelf': '공간',
    'shelves': '공간',
    'x_shelves': '공간 :count개|총 :count개',
    'shelves_empty': '만든 공간이 없습니다.',
    'shelves_create': '공간 만들기',
    'shelves_popular': '많이 읽은 공간',
    'shelves_new': '새로운 공간',
    'shelves_books': '이 공간에 있는 문서함들',
    'shelves_add_books': '이 공간에 문서함 추가',
    'shelves_edit_named': '공간 편집 :name',
    'shelves_delete': '공간 삭제',
    'shelves_permissions': '공간 권한',
    'book': '문서함',
    'books': '문서함',
    'x_books': '문서함 :count개|총 :count개',
    'books_empty': '만든 문서함이 없습니다.',
    'books_popular': '많이 읽은 문서함',
    'books_create': '문서함 만들기',
    'books_delete': '문서함 삭제하기',
    'books_edit': '문서함 바꾸기',
    'books_permissions': '문서함 권한',
    'books_sort': '문서함 내용 정렬',
    'chapter': '섹션',
    'chapters': '섹션',
    'x_chapters': '섹션 :count개|총 :count개',
    'chapters_create': '섹션 만들기',
    'chapters_delete': '섹션 삭제하기',
    'chapters_edit': '섹션 수정하기',
    'chapters_permissions': '섹션 권한',
    'page': '문서',
    'pages': '문서',
    'x_pages': '문서 :count개|총 :count개',
    'pages_delete': '문서 삭제하기',
    'pages_permissions': '문서 권한',
}

found, missing = [], []
for key, value in MAPPING.items():
    pattern = re.compile(r"(['\"])" + re.escape(key) + r"\1\s*=>\s*(['\"]).*?\2\s*,")
    replacement = f"'{key}' => '{value}',"
    content, count = pattern.subn(replacement, content, count=1)
    (found if count else missing).append(key)

with open(path, 'w') as f:
    f.write(content)

print(f"치환됨 ({len(found)}): {', '.join(found)}")
if missing:
    print(f"NOT FOUND ({len(missing)}) — 이 키들은 확인 필요: {', '.join(missing)}")
PYEOF

sudo -u bookstack bash -c "cd $BS && php artisan config:clear && php artisan view:clear"
```

**업그레이드 때마다 재적용 필요** — 코어 언어 파일 직접 수정이라 `git pull`로 되돌아간다.

---

## 10. 디자인 톤 통일 (색상·폰트) + 로고 숨김

Manager의 톤(인디고 `#4f46e5` 포인트 컬러, 시스템 기본 폰트, 톤 다운된 그레이 배경)을
게시판에도 입힌다. BookStack은 브랜드 컬러를 코어 수정 없이 설정으로 바꿀 수 있는
`app-color`/`app-color-light` 값을 지원하므로(1번 카테고리, 제일 안전함) 이걸 우선
쓰고, 폰트·로고만 커스텀 head CSS로 보완한다.

```bash
sudo tee /tmp/acmebloc-design.php > /dev/null <<'EOF'
<?php
require '/var/www/bookstack/app/vendor/autoload.php';
$app = require '/var/www/bookstack/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$svc = app(\BookStack\Settings\SettingService::class);

$svc->put('app-color', '#4f46e5');       // Tailwind indigo-600, Manager 포인트 컬러
$svc->put('app-color-light', '#eef2ff'); // indigo-50, 옅은 배경/hover용

$marker = 'ACMEBLOC-DESIGN-TONE';
$head = (string) $svc->get('app-custom-head', '');
if (str_contains($head, $marker)) {
    echo "design tone css: already set, skipping\n";
} else {
    $css = "\n<!-- {$marker} -->\n<style>\n"
         . "  /* Manager와 같은 시스템 기본 폰트로 통일 (Tailwind 기본 font-sans 스택) */\n"
         . "  body { font-family: ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\"; }\n"
         . "  /* 로고 숨김 — Manager 메뉴바에 이미 브랜딩이 있어 중복 노출 안 함 */\n"
         . "  .logo, header .logo-image, a.logo { display: none !important; }\n"
         . "</style>\n";
    $svc->put('app-custom-head', $head . $css);
    echo "design tone css: appended\n";
}
EOF

sudo -u bookstack php /tmp/acmebloc-design.php
sudo rm /tmp/acmebloc-design.php
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

> **확인 필요** — `app-color`/`app-color-light` 설정 키 이름과 로고 셀렉터(`.logo` 등)는
> BookStack 소스 기준으로 넣은 값이라, 실제 설치본과 미묘하게 다를 수 있다. 적용 후
> 스크린샷으로 확인해서 색이 안 바뀌거나 로고가 안 사라지면 알려줄 것 — 실제 셀렉터·
> 설정 키를 다시 맞춘다.

---

## 11. 게시판 서브메뉴 고정 노출 + Manager 메뉴 라벨 동기화 (5번 갱신)

5번에서 넣은 Manager 메뉴바 라벨이 실제 Manager 쪽([Layout.jsx](../src/components/Layout.jsx))과
어긋나 있었다("일감관리"/"일정관리" vs 실제 "일감"/"일정") — 이번에 맞춘다. 동시에
**Manager 쪽 상단바에는 드롭다운을 넣지 않고**, 게시판 화면에서만 BookStack 자체 섹션
(공간/문서함/검색)을 두 번째 줄에 항상 펼쳐진 상태로(호버 아님) 보여준다. BookStack
자체 상단 메뉴는 중복되므로 숨긴다. 계정 메뉴(내 정보)는 6번 그대로 우측 위치 변경 없음.

```bash
BS=/var/www/bookstack/app
PATCH="$BS/themes/acmebloc/layouts/parts/header.blade.php"

sudo python3 - "$PATCH" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

if "MANAGER-BOARD-SUBNAV" in content:
    print("already patched, skipping")
    raise SystemExit(0)

m = re.search(r'<!-- MANAGER-NAV -->.*?</style>\n', content, re.S)
if not m:
    raise SystemExit("old MANAGER-NAV block not found — aborting")

snippet = """<!-- MANAGER-NAV -->
<nav class="acmebloc-topnav" aria-label="Manager 메뉴">
    <a href="/dashboard">홈</a>
    <a href="/projects">프로젝트</a>
    <a href="/tasks">일감</a>
    <a href="/schedule">일정</a>
    <a href="/board" class="active">게시판</a>
    <a href="/mypage">마이페이지</a>
</nav>
<!-- MANAGER-BOARD-SUBNAV -->
<nav class="acmebloc-board-subnav" aria-label="게시판 메뉴">
    <a href="/board/shelves">공간</a>
    <a href="/board/books">문서함</a>
    <a href="/board/search">검색</a>
</nav>
<style>
.acmebloc-topnav { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #e5e7eb; padding: 0 16px; background: #fff; }
.acmebloc-topnav a { display: inline-block; padding: 12px 16px; font-size: 14px; font-weight: 500; color: #6b7280; text-decoration: none; border-bottom: 2px solid transparent; }
.acmebloc-topnav a:hover { color: #111827; }
.acmebloc-topnav a.active { color: #4f46e5; border-bottom-color: #4f46e5; }
.acmebloc-board-subnav { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #e5e7eb; padding: 0 16px; background: #f9fafb; }
.acmebloc-board-subnav a { display: inline-block; padding: 8px 12px; font-size: 13px; font-weight: 500; color: #4f46e5; text-decoration: none; }
.acmebloc-board-subnav a:hover { text-decoration: underline; }
/* BookStack 자체 상단 메뉴는 위 서브메뉴와 중복되므로 숨김 */
header nav.top-menu, header .top-menu { display: none !important; }
</style>
"""

content = content[:m.start()] + snippet + content[m.end():]
with open(path, 'w') as f:
    f.write(content)
print("patched")
PYEOF

sudo chown -R bookstack:bookstack $BS/themes/acmebloc
sudo -u bookstack bash -c "cd $BS && php artisan view:clear"
```

> **확인 필요** — BookStack 자체 상단 메뉴를 감싸는 실제 클래스(`nav.top-menu` 등)는
> 소스 기준 추정치다. 적용 후에도 BookStack 자체 메뉴가 안 사라지면, 브라우저 개발자
> 도구로 그 메뉴를 감싼 엘리먼트의 class를 확인해서 알려줄 것 — 셀렉터만 좁혀서 다시
> 맞춘다.

---

## 업그레이드 후 점검

BookStack을 `git pull`로 올린 뒤에는 이 순서로 확인한다.

**1) 코어 수정 재적용** — 7번 스크립트를 다시 실행한다. 이미 적용돼 있으면
"already patched"만 출력하고 아무것도 바꾸지 않는다.

**2) 뷰 오버라이드가 낡지 않았는지 대조** — 테마의 복사본은 지워지지 않지만 원본이
바뀌어도 따라가지 않는다. 우리 편집분(메뉴바 추가, 항목 제거) 외에 원본 쪽 변경이
보이면 5·6번 스크립트로 새 원본에서 다시 만든다.

```bash
BS=/var/www/bookstack/app
for f in layouts/parts/header.blade.php layouts/parts/header-user-menu.blade.php; do
  echo "=== $f ==="
  sudo diff "$BS/resources/views/$f" "$BS/themes/acmebloc/$f"
done
```

**3) 캐시 정리**

```bash
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear && php artisan view:clear'
```

**4) 화면 확인**

- **로그인 흐름** — Manager 로그인 후 게시판 메뉴 클릭 시 로그인 화면 없이 바로 진입.
  게시판 안에서 문서를 열고 이동해도 중간에 튕기지 않아야 한다.
- **로그아웃 동기화** — Manager 마이페이지에서 회원탈퇴 후 게시판에 접속하면 대기 없이
  Manager 로그인 화면으로 이동.
- **비로그인 직접 접속** — 로그아웃 상태에서 `/board` URL을 직접 입력해도 Manager
  로그인 화면으로 이동.
- **프로필 연동** — Manager 마이페이지에서 이름·사진 변경 후 게시판 새로고침 시 반영
  (이름은 30초 캐시).
- **UI** — 상단에 Manager 메뉴바가 헤더보다 위에 표시되고, 계정 드롭다운에는
  즐겨찾기·프로필 보기만 있으며, 밝은 테마이고, 내용이 짧은 페이지에 스크롤바가
  나오지 않아야 한다.

문제가 생기면:

```bash
sudo tail -30 /var/www/bookstack/app/storage/logs/laravel.log
```

---

## 현재 상태 확인

지금 서버가 이 문서대로 되어 있는지 한 번에 보는 명령이다.

```bash
BS=/var/www/bookstack/app
echo "=== 테마 파일 ==="
sudo find $BS/themes/acmebloc -type f | sed "s|$BS/||"
echo
echo "=== 코어 수정이 남아 있는 파일 (User.php만 나와야 정상) ==="
sudo -u bookstack git -C $BS status --porcelain
echo
echo "=== .env ==="
sudo grep -E '^(APP_THEME|APP_LANG|APP_DEFAULT_DARK_MODE|AUTH_AUTO_INITIATE|MANAGER_ORIGIN|SESSION_LIFETIME)=' $BS/.env
echo
echo "=== 엔티티 명칭 (공간/문서함/섹션/문서로 바뀌었는지) ==="
sudo grep -E "^\s*'(shelf|book|chapter|page)'\s*=>" $BS/lang/ko/entities.php 2>/dev/null \
  || sudo grep -E "^\s*'(shelf|book|chapter|page)'\s*=>" $BS/resources/lang/ko/entities.php 2>/dev/null
echo
echo "=== 게시판 서브메뉴 마커 (1 이상이어야 정상) ==="
sudo grep -c "MANAGER-BOARD-SUBNAV" $BS/themes/acmebloc/layouts/parts/header.blade.php
```
