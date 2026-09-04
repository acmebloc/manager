import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { loadSession } from '../lib/secureProfileStore'
import NavSearchBox from './NavSearchBox'

// BookStack lives at /board on this same domain but is a separate app —
// Apache hands that path straight to it, so it needs a real browser
// navigation (same tab, same as every other menu item), not a React Router route.
const MENU_ITEMS = [
  { to: '/dashboard', label: '홈', end: true },
  { to: '/projects', label: '프로젝트' },
  { to: '/tasks', label: '일감' },
  { to: '/schedule', label: '일정' },
  { to: '/board', label: '게시판', external: true },
  { to: '/mypage', label: '마이페이지' },
]

// 이름이 길면 메뉴바가 밀리므로 글자 수로 자른다. CSS truncate가 아니라 여기서
// 자르는 이유는 기준이 "7글자"라서 — 폭 기준으로 자르면 한글·영문에 따라 잘리는
// 지점이 달라진다. 전체 이름은 title 속성으로 남긴다.
const MAX_NAME_LENGTH = 7

// 검색창은 홈/프로젝트/일감/일정 메뉴(그 하위 라우트 포함)와 검색결과
// 페이지 자체에만 노출한다 — 마이페이지·게시판(별도 탭)에는 없음.
const SEARCH_ENABLED_PREFIXES = ['/dashboard', '/projects', '/tasks', '/schedule', '/search']

function isSearchEnabledPath(pathname) {
  return SEARCH_ENABLED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function truncateName(name) {
  if (typeof name !== 'string') return ''
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH)}…` : name
}

const linkClassName = ({ isActive }) =>
  `border-b-2 px-4 py-3 text-sm font-medium ${
    isActive
      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
      : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
  }`

// Guards every route nested under this layout (dashboard/projects/tasks/
// schedule/mypage) — without this, typing one of those URLs directly loaded
// the page with no session check at all (only mypage had its own check).
// Same as everywhere else in this app: reads the local encrypted cache only,
// no server round trip just to answer "am I logged in".
function Layout() {
  const [checked, setChecked] = useState(false)
  // 가드에는 존재 여부만 필요하지만, 메뉴바 오른쪽에 지금 로그인한 사람을
  // 표시하려면 프로필까지 있어야 해서 세션을 통째로 들고 있는다.
  const [session, setSession] = useState(null)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await loadSession()
      if (cancelled) return
      setSession(cached)
      setChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!checked) return null
  // 어디로 가려던 길이었는지 로그인 화면에 넘긴다 — 알림 메일의 링크는 일감이나
  // 일정을 직접 가리키는데, 목적지를 버리고 보내면 로그인한 뒤 대시보드에
  // 떨어져서 그 링크가 가리키던 것을 사용자가 다시 찾아 들어가야 했다.
  // LoginPage가 이 값을 동일 출처 경로인지 검사한 뒤에만 따라간다.
  if (!session) {
    const destination = location.pathname + location.search
    return <Navigate to={`/?continue=${encodeURIComponent(destination)}`} replace />
  }

  // 마이페이지에는 띄우지 않는다 — 그 화면이 이미 같은 프로필을 크게 보여주고
  // 있어서 같은 정보가 두 번 나온다. 게시판은 BookStack이 자기 헤더를 그리므로
  // (docs/bookstack-patches.md) 애초에 이 메뉴바를 지나지 않는다.
  const showViewer = location.pathname !== '/mypage'
  const showSearch = isSearchEnabledPath(location.pathname)

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      <nav className="flex items-center gap-1 border-b border-gray-200 px-4 dark:border-gray-700">
        {MENU_ITEMS.map((item) =>
          item.external ? (
            <a key={item.to} href={item.to} className={linkClassName({ isActive: false })}>
              {item.label}
            </a>
          ) : (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClassName}>
              {item.label}
            </NavLink>
          ),
        )}

        {/* 남는 공간을 차지해 검색창을 메뉴와 프로필 표시 사이 가운데에 둔다 —
            항상 렌더링해 페이지에 따라 메뉴바 폭이 흔들리지 않게 하고, 내용만
            조건부로 넣는다. */}
        <div className="flex flex-1 justify-center px-4">{showSearch && <NavSearchBox />}</div>

        {/* 지금 로그인된 계정을 알려주기만 하는 표시 — 누를 곳도, 펼쳐지는 것도
            없다. 그래서 button이나 링크가 아니라 그냥 텍스트다. 오른쪽 여백은
            이 요소의 mr-11(44px) + nav의 px-4(16px). 왼쪽의 flex-1 검색창
            자리가 이미 남는 공간을 다 차지해 오른쪽 끝에 붙으므로 별도
            ml-auto는 필요 없다. */}
        {showViewer && (
          <div className="mr-11 flex items-center gap-2">
            <img
              src={session.profile.picture}
              alt=""
              referrerPolicy="no-referrer"
              className="h-7 w-7 shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-700"
            />
            <span
              title={session.profile.name}
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
            >
              {truncateName(session.profile.name)}
            </span>
          </div>
        )}
      </nav>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
