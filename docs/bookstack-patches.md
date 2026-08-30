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
| 11 | `themes/acmebloc/layouts/parts/header.blade.php` (5번 갱신) | Manager 메뉴 라벨 동기화 (일감/일정) | 유지 (※ 아래 주의) |
| 12 | `themes/acmebloc/layouts/parts/header-links(-shelves).blade.php`, `header.blade.php` | 로고 삭제 + 공간/문서함 실제 이동 | 유지 (※ 아래 주의) |
| 13 | 설정 DB (커스텀 head) | 파비콘을 Manager와 통일 | 유지 |
| 14 | Apache vhost | Authorization 헤더를 PHP로 전달 (API 토큰 인증 선행조건) | 유지 |

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
.acmebloc-topnav { display: flex; align-items: center; gap: 0.25rem; border-bottom: 1px solid #e5e7eb; padding: 0 1rem; background: #fff; }
.acmebloc-topnav a { display: inline-block; padding: 0.75rem 1rem; font-size: 0.875rem; line-height: 1.25rem; font-weight: 500; color: #6b7280; text-decoration: none; border-bottom: 2px solid transparent; }
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

**전면 재정리(2026-08-30).** 처음엔 WebFetch로 `entities.php`를 가져왔는데, 이게
AI 요약이라 "관련된 키만" 35개 정도만 추출해서 실제로는 훨씬 많은 곳(사이드바 빠른
동작 버튼, 정보 패널의 "N 권한 적용됨" 표시, 태그, 정렬/이동, 변환, 알림 설정 등)에
책꽂이/책/챕터/페이지가 그대로 남아있었다 — 화면을 계속 쓰다가 사용자가 하나씩
발견해서 알려줌. 이번엔 `gh api`로 파일 전체(480줄)를 원본 그대로 받아서 **150개
키 전부**를 정리했다. 그 과정에서 두 가지를 더 발견:
- BookStack 한국어 번역은 "책꽂이"뿐 아니라 "서가"/"책장"도 같은 뜻(Shelf)으로
  섞어 쓰고, "챕터" 대신 "장"이라고만 쓴 곳도 있다(`chapters_new` 등) — 전부
  공간/섹션으로 통일.
- 명사를 바꾸면 뒤따르는 조사(이/가, 을/를, 은/는, 과/와, 으로/로, 나/이나)가 안
  맞게 되는 경우가 있다(책꽂이→공간, 챕터→섹션은 받침 유무가 바뀌어서 조사가
  깨짐 — 책→문서함, 페이지→문서는 받침 유무가 같아서 문제없음). 값 문자열을 통째로
  바꿔서 해결했다.
- `chapters_permissions_active`는 BookStack 원본 자체가 "문서 권한 허용함"이라고
  잘못 번역돼 있던 걸(챕터 섹션인데 페이지 권한 문구가 붙어있음) 새 용어 체계에서
  더 헷갈리길래 같이 고쳤다.

번역 파일 위치는 BookStack 버전에 따라 `lang/ko/entities.php`(최신, Laravel 9+ 구조)
또는 `resources/lang/ko/entities.php`(구버전) 중 하나다. 아래 스크립트가 둘 다 찾아본다.

**값 문자열이 아니라 키 이름으로 치환**하므로, 지금 값이 이전 라운드에서 이미 고쳐진
상태든 원본 그대로든 상관없이 항상 최종 정답으로 덮어쓴다(재실행해도 안전). 각 키를
찾았는지 결과로 출력하니, "NOT FOUND"로 나온 키가 있으면 그 부분만 캡처해서 알려줄 것.

로컬에서 이 스크립트를 실제로 두 가지 상태(원본 그대로 / 예전 35개만 고쳐진 상태)에
돌려보고 최종 결과가 완전히 같은 것까지 확인했고, 문법 오류(작은따옴표가 값 안에
그대로 들어있는 `shelves_delete_explain` 등)도 잡아서 고쳤다.

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
    'recently_created_chapters': "'최근에 만든 섹션'",
    'recently_created_books': "'최근에 만든 문서함'",
    'recently_created_shelves': "'최근에 만든 공간'",
    'no_pages_viewed': "'본 문서가 없습니다.'",
    'no_pages_recently_created': "'최근에 생성된 문서가 없습니다.'",
    'no_pages_recently_updated': "'최근 업데이트된 문서가 없습니다.'",
    'default_template': "'기본 문서 템플릿'",
    'default_template_explain': "'이 항목 내에서 생성되는 모든 문서의 기본 콘텐츠로 사용할 문서 템플릿을 지정합니다. 문서 작성자가 선택한 템플릿 문서를 볼 수 있는 권한이 있는 경우에만 이 항목이 사용된다는 점을 유의하세요.'",
    'default_template_select': "'템플릿 문서 선택'",
    'import_desc': "'같은 인스턴스나 다른 인스턴스에서 휴대용 zip 내보내기를 사용하여 문서함, 섹션 및 문서를 가져옵니다. 진행하려면 ZIP 파일을 선택합니다. 파일을 업로드하고 검증한 후 다음 보기에서 가져오기를 구성하고 확인할 수 있습니다.'",
    'permissions_book_cascade': "'문서함에 설정된 권한은 자체 권한이 정의되어 있지 않은 한 하위 섹션과 문서에 자동으로 계단식으로 적용됩니다.'",
    'permissions_chapter_cascade': "'섹션에 설정된 권한은 하위 문서에 자체 권한이 정의되어 있지 않는 한 자동으로 계단식으로 적용됩니다.'",
    'shelf': "'공간'",
    'shelves': "'공간'",
    'x_shelves': "'공간 :count개|총 :count개'",
    'shelves_empty': "'만든 공간이 없습니다.'",
    'shelves_create': "'공간 만들기'",
    'shelves_popular': "'많이 읽은 공간'",
    'shelves_new': "'새로운 공간'",
    'shelves_new_action': "'새 공간'",
    'shelves_popular_empty': "'많이 읽은 공간 목록'",
    'shelves_new_empty': "'새로운 공간 목록'",
    'shelves_books': "'이 공간에 있는 문서함들'",
    'shelves_add_books': "'이 공간에 문서함 추가'",
    'shelves_drag_books': "'문서함을 이 공간에 추가하려면 아래로 드래그하세요'",
    'shelves_empty_contents': "'이 공간에 문서함이 없습니다.'",
    'shelves_edit_and_assign': "'공간 바꾸기로 문서함을 추가하세요.'",
    'shelves_edit_named': "'공간 편집 :name'",
    'shelves_edit': "'공간 편집'",
    'shelves_delete': "'공간 삭제'",
    'shelves_delete_named': "'공간 삭제 :이름'",
    'shelves_delete_explain': '"그러면 \':name\'이라는 이름의 공간이 삭제됩니다. 포함된 문서함은 삭제되지 않습니다."',
    'shelves_delete_confirmation': "'이 공간을 삭제하시겠습니까?'",
    'shelves_permissions': "'공간 권한'",
    'shelves_permissions_updated': "'공간 권한 업데이트됨'",
    'shelves_permissions_active': "'공간 권한 활성화'",
    'shelves_permissions_cascade_warning': "'공간에 대한 권한은 포함된 문서함에 자동으로 계단식으로 부여되지 않습니다. 한 권의 문서함이 여러 개의 공간에 존재할 수 있기 때문입니다. 그러나 아래 옵션을 사용하여 권한을 하위 문서함으로 복사할 수 있습니다.'",
    'shelves_permissions_create': "'공간 만들기 권한은 아래 작업을 사용하여 하위 문서함에 대한 권한을 복사하는 데만 사용됩니다. 문서함을 만드는 기능은 제어하지 않습니다.'",
    'shelves_copy_permissions_explain': "'그러면 이 공간의 현재 권한 설정이 이 공간에 포함된 모든 문서함에 적용됩니다. 활성화하기 전에 이 공간의 권한에 대한 변경 사항이 모두 저장되었는지 확인하세요.'",
    'shelves_copy_permission_success': "'공간 권한이 복사됨 :count books'",
    'book': "'문서함'",
    'books': "'문서함'",
    'x_books': "'문서함 :count개|총 :count개'",
    'books_empty': "'만든 문서함이 없습니다.'",
    'books_popular': "'많이 읽은 문서함'",
    'books_recent': "'최근에 읽은 문서함'",
    'books_new': "'새로운 문서함'",
    'books_new_action': "'새 문서함'",
    'books_popular_empty': "'많이 읽은 문서함 목록'",
    'books_new_empty': "'새로운 문서함 목록'",
    'books_create': "'문서함 만들기'",
    'books_delete': "'문서함 삭제하기'",
    'books_delete_explain': "':bookName에 있는 모든 섹션과 문서도 지웁니다.'",
    'books_delete_confirmation': "'이 문서함을 지우시겠습니까?'",
    'books_edit': "'문서함 바꾸기'",
    'books_form_book_name': "'문서함 이름'",
    'books_permissions': "'문서함 권한'",
    'books_permissions_updated': "'문서함의 권한이 수정되었습니다.'",
    'books_empty_contents': "'이 문서함에 섹션이나 문서가 없습니다.'",
    'books_empty_sort_current_book': "'현재 문서함 정렬'",
    'books_empty_add_chapter': "'섹션 만들기'",
    'books_permissions_active': "'문서함 권한 적용됨'",
    'books_search_this': "'이 문서함에서 검색'",
    'books_sort': "'문서함 내용 정렬'",
    'books_sort_desc': "'문서함 내의 섹션과 문서를 이동하여 콘텐츠를 재구성할 수 있습니다. 다른 문서함들을 추가하여 문서함 간의 섹션과 문서를 쉽게 이동할 수 있습니다. 선택적으로 자동 정렬 규칙을 설정하여 변경 시 이 문서함의 콘텐츠를 자동으로 정렬할 수 있습니다.'",
    'books_sort_chapters_first': "'섹션 우선'",
    'books_sort_show_other': "'다른 문서함들'",
    'books_sort_show_other_desc': "'여기에 다른 문서함을 추가하여 정렬 작업에 포함시키고 문서함 간 재구성을 쉽게 할 수 있습니다.'",
    'books_sort_move_prev_book': "'이전 문서함으로 이동'",
    'books_sort_move_next_book': "'다음 문서함으로 이동'",
    'books_sort_move_prev_chapter': "'이전 섹션으로 이동'",
    'books_sort_move_next_chapter': "'다음 섹션으로 이동'",
    'books_sort_move_book_start': "'문서함 시작 부분으로 이동'",
    'books_sort_move_book_end': "'문서함의 끝으로 이동'",
    'books_sort_move_before_chapter': "'이전 섹션으로 이동'",
    'books_sort_move_after_chapter': "'섹션 뒤로 이동'",
    'books_copy': "'문서함 복사하기'",
    'books_copy_success': "'문서함을 복사하였습니다.'",
    'chapter': "'섹션'",
    'chapters': "'섹션'",
    'x_chapters': "'섹션 :count개|총 :count개'",
    'chapters_popular': "'많이 읽은 섹션'",
    'chapters_new': "'새 섹션'",
    'chapters_create': "'섹션 만들기'",
    'chapters_delete': "'섹션 삭제하기'",
    'chapters_delete_explain': "'\\':ChapterName\\'에 있는 모든 문서도 지웁니다.'",
    'chapters_delete_confirm': "'이 섹션을 지울 건가요?'",
    'chapters_edit': "'섹션 수정하기'",
    'chapters_move': "'섹션 이동하기'",
    'chapters_copy': "'섹션 복사하기'",
    'chapters_copy_success': "'섹션을 복사하였습니다.'",
    'chapters_permissions': "'섹션 권한'",
    'chapters_empty': "'이 섹션에 문서가 없습니다.'",
    'chapters_permissions_active': "'섹션 권한 적용됨'",
    'chapters_permissions_success': "'섹션의 권한을 수정하였습니다.'",
    'chapters_search_this': "'이 섹션에서 검색'",
    'chapter_sort_book': "'문서함 정렬하기'",
    'page': "'문서'",
    'pages': "'문서'",
    'pages_new': "'새 문서'",
    'pages_delete_warning_template': "'이 문서는 문서함의 기본 문서 템플릿으로 사용 중입니다. 이 문서가 삭제되면 해당하는 문서함에 더 이상 기본 문서 템플릿이 적용되지 않습니다.'",
    'pages_edit_delete_draft_confirm': "'초안 문서 변경 내용을 삭제하시겠습니까? 마지막 전체 저장 이후의 모든 변경 내용이 손실되고 편집기가 최신 문서의 초안 저장 상태가 아닌 상태로 업데이트됩니다.'",
    'pages_editor_switch_are_you_sure': "'이 문서의 편집기를 변경하시겠어요?'",
    'pages_not_in_chapter': "'섹션에 있는 문서가 아닙니다.'",
    'pages_revisions_desc': "'아래는 이 문서의 모든 과거 개정 버전입니다. 권한이 허용하는 경우 이전 문서 버전을 되돌아보고, 비교하고, 복원할 수 있습니다. 시스템 구성에 따라 이전 수정본이 자동으로 삭제될 수 있으므로 문서의 전체 기록이 여기에 완전히 반영되지 않을 수 있습니다.'",
    'pages_pointer_label': "'문서 섹션 옵션'",
    'pages_pointer_permalink': "'문서 섹션 퍼머링크'",
    'pages_pointer_include_tag': "'문서 섹션 포함 태그 포함'",
    'pages_draft_discarded': "'초안 폐기! 편집기가 현재 문서 콘텐츠로 업데이트되었습니다.'",
    'pages_draft_deleted': "'초안이 삭제되었습니다! 편집기가 현재 문서 콘텐츠로 업데이트되었습니다.'",
    'page_tags': "'문서 태그'",
    'chapter_tags': "'섹션 태그'",
    'book_tags': "'문서함 태그'",
    'shelf_tags': "'공간 태그'",
    'tags_assigned_pages': "'| 문서 태그 할당 |'",
    'tags_assigned_chapters': "'| 섹션 태그 할당 |'",
    'tags_assigned_books': "'| 문서함 태그 할당 |'",
    'tags_assigned_shelves': "'| 공간 태그 할당 |'",
    'tags_list_empty_hint': "'태그는 에디터 사이드바나 문서함, 섹션 또는 공간 정보 편집에서 지정할 수 있습니다.'",
    'attachments_insert_link': "'문서에 첨부파일 링크 추가'",
    'templates_set_as_template': "'현재 문서는 템플릿용 문서 입니다.'",
    'profile_not_created_chapters': "':userName(이)가 만든 섹션 없음'",
    'profile_not_created_books': "':userName(이)가 만든 문서함 없음'",
    'profile_not_created_shelves': "':userName(이)가 만든 공간 없음'",
    'comment_editor_explain': "'이 문서에 남겨진 댓글은 다음과 같습니다. 저장된 문서를 볼 때 댓글을 추가하고 관리할 수 있습니다.'",
    'revision_restore_confirm': "'이 버전을 되돌릴 건가요? 현재 문서는 대체됩니다.'",
    'convert_to_shelf': "'공간으로 변환'",
    'convert_to_shelf_contents_desc': "'이 문서함을 동일한 내용의 새 공간으로 변환할 수 있습니다. 이 문서함에 포함된 섹션은 새 문서함으로 변환됩니다. 이 문서함에 섹션에 포함되지 않은 문서가 포함되어 있는 경우, 이 문서함의 이름이 변경되어 해당 문서가 포함되며 이 문서함은 새 공간의 일부가 됩니다.'",
    'convert_to_shelf_permissions_desc': "'이 문서함에 설정된 모든 권한은 새 공간 및 자체 권한이 적용되지 않은 모든 새 문서함에 복사됩니다. 문서함에 대한 권한은 문서함에 대한 권한처럼 그 안의 콘텐츠로 자동 캐스케이드되지 않는다는 점에 유의하세요.'",
    'convert_book': "'문서함 변환'",
    'convert_book_confirm': "'이 문서함을 변환하시겠어요?'",
    'convert_to_book': "'문서함으로 변환'",
    'convert_to_book_desc': "'이 섹션을 동일한 내용의 새 문서함으로 변환할 수 있습니다. 이 섹션에 설정된 모든 권한은 새 문서함에 복사되지만 상위 문서함에서 상속된 권한은 복사되지 않으므로 액세스 제어가 변경될 수 있습니다.'",
    'convert_chapter': "'섹션 변환'",
    'convert_chapter_confirm': "'이 섹션을 변환하시겠어요?'",
    'watch_title_new': "'새로운 문서'",
    'watch_desc_new': "'이 항목에 새 문서가 생성되면 알림을 받습니다.'",
    'watch_title_updates': "'전체 문서 업데이트'",
    'watch_desc_updates': "'모든 새 문서와 문서 변경 시 알림을 보냅니다.'",
    'watch_desc_updates_page': "'모든 문서 변경 시 알림을 보냅니다.'",
    'watch_title_comments': "'모든 문서 업데이트 및 댓글'",
    'watch_desc_comments': "'모든 새 문서, 문서 변경 및 새 댓글에 대해 알림을 보냅니다.'",
    'watch_desc_comments_page': "'문서 변경 및 새 댓글이 있을 때 알림을 보냅니다.'",
    'watch_detail_new': "'새 문서 보기'",
    'watch_detail_updates': "'새 문서 및 업데이트 보기'",
    'watch_detail_comments': "'새 문서, 업데이트 및 댓글 보기'",
    'watch_detail_parent_book': "'상위 문서함을 통해 보기'",
    'watch_detail_parent_book_ignore': "'상위 문서함을 통한 무시하기'",
    'watch_detail_parent_chapter': "'상위 섹션을 통해 보기'",
    'watch_detail_parent_chapter_ignore': "'상위 섹션을 통해 무시하기'",
}

found, missing = [], []
for key, value_literal in MAPPING.items():
    pattern = re.compile(
        r"(['\"])" + re.escape(key) + r"\1\s*=>\s*(?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")\s*,"
    )
    replacement = f"'{key}' => {value_literal},"
    content, count = pattern.subn(replacement, content, count=1)
    (found if count else missing).append(key)

with open(path, 'w') as f:
    f.write(content)

print(f"치환됨 ({len(found)}/{len(MAPPING)})")
if missing:
    print(f"NOT FOUND ({len(missing)}) — 이 키들은 확인 필요: " + ', '.join(missing))
PYEOF

sudo -u bookstack bash -c "cd $BS && php artisan config:clear && php artisan view:clear"
```

**업그레이드 때마다 재적용 필요** — 코어 언어 파일 직접 수정이라 `git pull`로 되돌아간다.

---

## 10. 디자인 톤 통일 (색상·폰트) + 로고 숨김

Manager의 톤(인디고 `#4f46e5` 포인트 컬러, 시스템 기본 폰트, 흰 배경 + 진한 회색
글자)을 게시판에도 입힌다. BookStack은 브랜드 컬러를 코어 수정 없이 설정으로 바꿀 수
있는 `app-color`/`app-color-light` 값을 지원하므로(1번 카테고리, 제일 안전함) 이걸
우선 쓰고, 폰트·배경·글자색·로고는 커스텀 head CSS로 보완한다.

**2026-08-30 확장:** 처음엔 `body`에만 폰트를 걸어서 폼 요소(입력창/버튼/선택박스는
브라우저 기본 폰트를 따로 쓰는 경우가 많음)에는 안 먹혔을 수 있다 — `!important` +
대상 확장으로 강화하고, 배경·글자색도 명시적으로 맞췄다. 다만 버튼/카드/테이블처럼
실제 마크업을 본 적 없는 요소는 여기서 억지로 셀렉터를 추측하지 않는다 — 헤더처럼
실제 markup을 받아서 정확히 맞추는 편이 이전 세션에서 훨씬 안전했다(11·12번 시행착오
참고).

```bash
sudo tee /tmp/acmebloc-design.php > /dev/null <<'EOF'
<?php
require '/var/www/bookstack/app/vendor/autoload.php';
$app = require '/var/www/bookstack/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$svc = app(\BookStack\Settings\SettingService::class);

$svc->put('app-color', '#4f46e5');       // Tailwind indigo-600, Manager 포인트 컬러
$svc->put('app-color-light', '#eef2ff'); // indigo-50, 옅은 배경/hover용

$marker = 'ACMEBLOC-DESIGN-TONE-V2';
$head = (string) $svc->get('app-custom-head', '');
if (str_contains($head, $marker)) {
    echo "design tone css: already set, skipping\n";
} else {
    $css = "\n<!-- {$marker} -->\n<style>\n"
         . "  /* Manager와 같은 시스템 기본 폰트로 통일 (Tailwind 기본 font-sans 스택) —\n"
         . "     폼 요소는 브라우저 기본 폰트를 따로 쓰는 경우가 많아 명시적으로 포함 */\n"
         . "  body, input, textarea, select, button {\n"
         . "    font-family: ui-sans-serif, system-ui, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\" !important;\n"
         . "  }\n"
         . "  /* 배경/글자색 — Manager의 흰 배경 + 진한 회색(gray-900) 글자 */\n"
         . "  body { background: #ffffff !important; color: #111827 !important; }\n"
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
> 설정 키를 다시 맞춘다. 버튼/카드/테이블 등 더 맞추고 싶은 요소가 있으면, 그 요소를
> 브라우저에서 우클릭 → 검사 → outerHTML을 복사해서 알려줄 것 — 실제 class를 보고
> 정확히 맞춘다(11번에서 헤더에 썼던 방식과 동일).

---

## 11. 게시판 헤더 — BookStack 원본 그대로 두고 스타일만 통일 + 라벨 동기화 (5번 갱신)

**여기까지의 시행착오:** 처음엔 BookStack 헤더를 통째로 숨기고 검색창/계정/설정을
Manager가 새로 만든 서브메뉴로 옮기려 했다(빈 슬롯 + JS `appendChild`). 실제로 붙여보니
①BookStack의 CSP가 nonce 없는 인라인 스크립트를 막아 이동 자체가 실패했고, ②애초에
**BookStack 원본 헤더가 이미 정확히 원하는 구성**(공간/문서함 왼쪽, 검색 가운데,
설정+계정 오른쪽)으로 되어 있어서 새로 만들 필요가 없었다 — 사용자가 브라우저에서 직접
`<header id="header" component="header-mobile-toggle" class="primary-background px-xl grid print-hidden">`
원본을 복사해서 확인해줬다. **최종 방향: 이 원본 헤더는 그대로 쓰고, `display:none`을
풀고 색상·폰트만 Manager 톤으로 덮어쓴다.** 커스텀 서브메뉴 구조(`acmebloc-board-subnav`,
빈 슬롯, 이동 스크립트)는 전부 폐기.

5번에서 넣은 Manager 메뉴바 라벨이 실제 Manager 쪽([Layout.jsx](../src/components/Layout.jsx))과
어긋나 있었다("일감관리"/"일정관리" vs 실제 "일감"/"일정") — 이번에 맞춘다.

**실제 확인된 BookStack 헤더 구조(요약):**
- `header#header.primary-background` — 이 `primary-background` 클래스가 10번에서 넣은
  `app-color`를 배경 채움으로 그대로 쓰고 있어서 진한 보라색으로 보였던 것.
- `.logo` / `.logo-image` — 로고. 10번에서 이미 정확히 이 클래스를 숨기고 있었다(그대로 둠).
- `form.search-box` 안의 `#header-search-box-input` / `#header-search-box-button` — 검색창.
- `nav.header-links` 안에 `공간`(`/board/shelves`)·`문서함`(`/board/books`)·`설정`
  (`/board/settings`, 어드민에게만 렌더링됨) 링크 + `.dropdown-container`
  (계정 드롭다운, `.user-name`)이 전부 형제 요소로 나란히 있다. 이 순서·배치 자체가
  이미 원하는 좌/중앙/우 구성이라 별도 정렬 CSS가 필요 없다.

```bash
BS=/var/www/bookstack/app
PATCH="$BS/themes/acmebloc/layouts/parts/header.blade.php"

sudo python3 - "$PATCH" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

if "MANAGER-NAV-V8" in content:
    print("already patched, skipping")
    raise SystemExit(0)

m = re.search(r'<!-- MANAGER-NAV(-V\d+)? -->.*?</style>\n(<script>.*?</script>\n)?', content, re.S)
if not m:
    raise SystemExit("old MANAGER-NAV block not found — aborting")

snippet = """<!-- MANAGER-NAV-V8 -->
<nav class="acmebloc-topnav" aria-label="Manager 메뉴">
    <a href="/dashboard">홈</a>
    <a href="/projects">프로젝트</a>
    <a href="/tasks">일감</a>
    <a href="/schedule">일정</a>
    <a href="/board" class="active">게시판</a>
    <a href="/mypage">마이페이지</a>
</nav>
<style>
.acmebloc-topnav { display: flex; align-items: center; gap: 0.25rem; border-bottom: 1px solid #e5e7eb; padding: 0 1rem; background: #fff; }
.acmebloc-topnav a { display: inline-block; padding: 0.75rem 1rem; font-size: 0.875rem; line-height: 1.25rem; font-weight: 500; color: #6b7280; text-decoration: none; border-bottom: 2px solid transparent; }
.acmebloc-topnav a:hover { color: #111827; }
.acmebloc-topnav a.active { color: #4f46e5; border-bottom-color: #4f46e5; }

/* BookStack 원본 헤더는 그대로 두고 톤만 Manager에 맞춘다 (구조/DOM은 안 건드림) */
header#header {
  background: #f9fafb !important;
  border-bottom: 1px solid #e5e7eb !important;
  box-shadow: none !important;
}
header#header, header#header * {
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji" !important;
}
.header-links a { color: #4f46e5 !important; text-decoration: none !important; }
.header-links a:hover { text-decoration: underline !important; }
/* 공간/문서함은 12번에서 로고 자리(첫 번째 flex 그룹)로 실제 이동시킨다 — 그 그룹을
   게시판 메뉴 칸 아래로 정렬 */
.acmebloc-header-shelves { display: flex; align-items: center; gap: 0.75rem; margin-left: 210px; }
.acmebloc-header-shelves a { display: inline-flex; align-items: center; gap: 0; margin-right: 15px; color: #4f46e5; text-decoration: none; font-size: 0.875rem; }
.acmebloc-header-shelves a:hover { text-decoration: underline; }
#header-search-box-input {
  background: #fff !important; border: 1px solid #d1d5db !important; color: #111827 !important;
  border-radius: 0.375rem !important; box-shadow: none !important;
}
#header-search-box-input::placeholder { color: #9ca3af !important; }
#header-search-box-input:focus {
  outline: none !important; border-color: #4f46e5 !important; box-shadow: 0 0 0 1px #4f46e5 !important;
}
#header-search-box-button { color: #6b7280 !important; }
.dropdown-container .user-name { color: #4f46e5 !important; }
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

> **확인 필요** — `header#header`, `.header-links`, `#header-search-box-input` 등은
> 실제로 복사해 받은 outerHTML 기준이라 신뢰도가 높지만, 적용 후 스크린샷으로
> 배경색·폰트·검색창이 실제로 바뀌었는지 확인할 것.

> **버전을 올릴 때마다 마커 문자열도 반드시 같이 바꿀 것** — 한 번은 CSS 내용만
> 바꾸고 마커(`MANAGER-NAV-V5`)를 그대로 둬서, 이후 재실행마다 "이미 패치됨"으로
> 스킵되어 수정 내용이 실제로는 한 번도 반영되지 않은 적이 있다. 구조가 아니라
> 내용만 바뀌어도 버전을 올린다.

---

## 12. 로고 삭제 + 공간/문서함을 실제로 그 자리로 이동 (Blade 레벨)

11번까지는 `.links a[href$="/shelves"] { margin-left: 96px; }`처럼 CSS로 위치만
맞추려 했는데 두 가지 문제가 있었다:
1. 96px가 정확히 안 맞아서 계속 어긋났다(`.links`가 `text-align: center`인 컨테이너라
   `margin-left` 하나로는 예측대로 안 움직였을 가능성이 큼).
2. 로고를 `display:none`으로 숨기기만 해서 안 쓰는 코드가 그대로 남아있었다 —
   불필요한 코드를 남기지 말라는 피드백을 받음.

**결정: 진짜로 옮긴다.** 공간/문서함 `<a>`는 BookStack 원본에서
`userCanOnAny(...Bookshelf::class)` 권한 체크로 감싸져 있어서(공간 목록을 볼 권한이
없으면 링크 자체가 안 뜬다), CSS로 숨기고 텍스트만 복제하면 권한 없는 사용자에게도
링크가 보이는 실제 버그가 생긴다 — 그래서 Blade 코드 자체를 옮겨야 한다.

**변경 파일 3개 (전부 `themes/acmebloc/layouts/parts/` 안):**
1. `header-links-shelves.blade.php` (신규) — 원본 `header-links.blade.php`의 공간/
   문서함 블록(권한 체크 포함)을 그대로 옮겨온 새 파샬. 로고가 있던 자리에 이걸 넣는다.
2. `header-links.blade.php` (원본을 복사해 수정) — 공간/문서함 블록만 제거, 검색/
   설정/게스트 로그인은 그대로.
3. `header.blade.php` (5·11번에서 이미 다루던 파일) — `@include('layouts.parts.header-logo')`
   한 줄을 `@include('layouts.parts.header-links-shelves')`로 교체. 로고는 완전히
   삭제되고 그 자리에 공간/문서함이 실제로 렌더링된다.

```bash
BS=/var/www/bookstack/app

echo "1) header-links-shelves.blade.php 생성"
sudo mkdir -p $BS/themes/acmebloc/layouts/parts
sudo tee $BS/themes/acmebloc/layouts/parts/header-links-shelves.blade.php > /dev/null <<'EOF'
<div class="acmebloc-header-shelves">
@if (user()->hasAppAccess())
    @if(userCanOnAny(\BookStack\Permissions\Permission::View, \BookStack\Entities\Models\Bookshelf::class) || userCan(\BookStack\Permissions\Permission::BookshelfViewAll) || userCan(\BookStack\Permissions\Permission::BookshelfViewOwn))
        <a href="{{ url('/shelves') }}"
           data-shortcut="shelves_view">@icon('bookshelf'){{ trans('entities.shelves') }}</a>
    @endif
    <a href="{{ url('/books') }}" data-shortcut="books_view">@icon('books'){{ trans('entities.books') }}</a>
@endif
</div>
EOF

echo "2) header-links.blade.php — 원본 복사 후 공간/문서함 블록 제거"
if [ ! -f "$BS/themes/acmebloc/layouts/parts/header-links.blade.php" ]; then
  sudo cp "$BS/resources/views/layouts/parts/header-links.blade.php" \
          "$BS/themes/acmebloc/layouts/parts/header-links.blade.php"
fi
sudo python3 - "$BS/themes/acmebloc/layouts/parts/header-links.blade.php" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

if 'shelves_view' not in content:
    print('header-links.blade.php: already stripped, skipping')
else:
    pattern = re.compile(
        r"\s*@if\(userCanOnAny.*?data-shortcut=\"books_view\">@icon\('books'\)\{\{ trans\('entities\.books'\) \}\}</a>\n",
        re.S,
    )
    new_content, count = pattern.subn('\n', content, count=1)
    if count == 0:
        raise SystemExit('header-links.blade.php: shelves/books block not found — aborting, check file manually')
    with open(path, 'w') as f:
        f.write(new_content)
    print('header-links.blade.php: shelves/books block removed')
PYEOF

echo "3) header.blade.php — 로고 include를 shelves/books 파샬로 교체"
sudo python3 - "$BS/themes/acmebloc/layouts/parts/header.blade.php" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

old = "@include('layouts.parts.header-logo')"
new = "@include('layouts.parts.header-links-shelves')"
if new in content:
    print('header.blade.php: already patched, skipping')
elif old not in content:
    raise SystemExit('header.blade.php: header-logo include not found — aborting')
else:
    content = content.replace(old, new, 1)
    with open(path, 'w') as f:
        f.write(content)
    print('header.blade.php: logo include replaced with shelves/books partial')
PYEOF

sudo chown -R bookstack:bookstack $BS/themes/acmebloc
sudo -u bookstack bash -c "cd $BS && php artisan view:clear"
```

> **확인 필요** — `header-links.blade.php`는 GitHub의 최신 BookStack 소스를 참고해
> 작성했지만, 실제로는 서버의 원본을 그대로 복사해서 패치하므로 버전 차이는 문제 없다.
> 다만 정규식 앵커(`userCanOnAny` ~ `books_view`)가 실제 원본과 다르면 안전하게
> abort하도록 만들어뒀다 — "block not found" 에러가 나면 그 파일을
> `cat`해서 보여줄 것. `.acmebloc-header-shelves`의 `margin-left`는 사용자가 실제
> 화면을 보고 210px로 확정(2026-08-28); `a` 링크의 `gap: 0` + `margin-right: 15px`도
> 같은 라운드에 확정된 값이다.

---

## 13. 파비콘을 Manager와 통일

Manager는 `/favicon.svg`를 쓰는데(`index.html`), 게시판은 BookStack 기본 파비콘을
그대로 쓰고 있었다. `layouts/base.blade.php`(루트 레이아웃)는 위 표의 ※ 주의사항대로
일부러 테마에 두지 않기로 했으므로, 거기 있는 파비콘 `<link>` 태그를 직접 고치는
대신 커스텀 head에 우리 파비콘 `<link>`를 추가로 얹는다(10·12번과 같은 채널).

```bash
sudo tee /tmp/acmebloc-favicon.php > /dev/null <<'EOF'
<?php
require '/var/www/bookstack/app/vendor/autoload.php';
$app = require '/var/www/bookstack/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$svc = app(\BookStack\Settings\SettingService::class);

$marker = 'ACMEBLOC-FAVICON';
$head = (string) $svc->get('app-custom-head', '');
if (str_contains($head, $marker)) {
    echo "favicon: already set, skipping\n";
} else {
    $link = "\n<!-- {$marker} -->\n"
          . "<link rel=\"icon\" type=\"image/svg+xml\" href=\"https://manager.acmebloc.com/favicon.svg\">\n";
    $svc->put('app-custom-head', $head . $link);
    echo "favicon: appended\n";
}
EOF

sudo -u bookstack php /tmp/acmebloc-favicon.php
sudo rm /tmp/acmebloc-favicon.php
sudo -u bookstack bash -c 'cd /var/www/bookstack/app && php artisan config:clear'
```

> **확인 필요** — `layouts/base.blade.php`에 BookStack 자체 파비콘 `<link>`가 이미
> 있을 텐데, 커스텀 head는 그 뒤에 추가되는 것이라 대부분 브라우저는 나중 선언을
> 우선하지만 100% 보장은 아니다. 적용 후에도 탭 아이콘이 안 바뀌면, BookStack
> 자체 파비콘의 실제 정적 파일 경로(`public/favicon.ico` 등)를 Manager 파비콘으로
> 교체하는 방식으로 다시 시도한다.

---

## 14. Authorization 헤더를 PHP로 전달 (API 토큰 인증 선행조건)

BookStack API를 토큰으로 호출하는 기능(Manager 저장소의 `server/src/lib/bookstack.js`,
프로젝트별 공간 자동 연동)을 처음 붙여보고 나서 발견함: 토큰 값 자체는 맞는데도
매번 `요청에서 인증 토큰을 찾을 수 없습니다`(`errors.api_no_authorization_found`)
에러가 났다. BookStack의 기본 `public/.htaccess`에는 Apache가 기본적으로 CGI/
PHP에 넘겨주지 않는 `Authorization` 헤더를 강제로 넘겨주는 규칙이 있는데:

```apache
RewriteCond %{HTTP:Authorization} .
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
```

8번에서 보듯 `<Directory "/var/www/bookstack/app/public">`는 `AllowOverride None`이라
`.htaccess`를 아예 안 읽고, 그 자리를 대신하는 vhost의 수동 rewrite 규칙에는 이
줄만 빠져 있었다(트레일링 슬래시 리다이렉트·index.php 라우팅 규칙만 옮겨져 있었음).
API 인증을 쓰는 기능이 이번이 처음이라 지금까지 안 드러났던 것.

```bash
VHOST=/etc/apache2/sites-available/manager.acmebloc.com-le-ssl.conf

sudo python3 - "$VHOST" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

marker = "Handle Authorization Header"
if marker in content:
    print("already patched, skipping")
    raise SystemExit(0)

anchor = '''    <Directory "/var/www/bookstack/app/public">
      Options FollowSymlinks
      AllowOverride None
      Require all granted

      RewriteEngine On
'''
if anchor not in content:
    raise SystemExit("BookStack <Directory> block not found in expected form — aborting")

insertion = '''
      # Handle Authorization Header — Apache strips this by default; without
      # it BookStack's API token auth always fails with "no authorization
      # found" even when the token itself is correct. Mirrors BookStack's own
      # public/.htaccess, which AllowOverride None means we can't just rely on.
      RewriteCond %{HTTP:Authorization} .
      RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
'''

content = content.replace(anchor, anchor + insertion, 1)
with open(path, 'w') as f:
    f.write(content)
print("patched")
PYEOF

sudo apache2ctl configtest
sudo systemctl reload apache2
```

> **참고** — 이 vhost 파일은 BookStack 저장소(`git pull`)와 무관한 Apache 자체 설정이라
> BookStack 업그레이드로 되돌아가지 않는다. 서버를 처음부터 다시 만드는 경우에만
> 이 단계를 잊지 말 것.

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
sudo grep -c "MANAGER-NAV-V8" $BS/themes/acmebloc/layouts/parts/header.blade.php
echo
echo "=== 로고 삭제(header.blade.php가 shelves 파샬을 쓰는지, 1이어야 정상) ==="
sudo grep -c "header-links-shelves" $BS/themes/acmebloc/layouts/parts/header.blade.php
echo "=== 공간/문서함이 header-links.blade.php에서 빠졌는지 (0이어야 정상) ==="
sudo grep -c "shelves_view" $BS/themes/acmebloc/layouts/parts/header-links.blade.php
```
