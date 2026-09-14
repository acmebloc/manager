import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { loadSession } from '../lib/secureProfileStore'
import NavSearchBox from './NavSearchBox'
import NotificationBell from './NotificationBell'

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

// 모바일 헤더는 햄버거·로고·프로필만 남기는데도 자리가 빠듯해 더 짧게 자른다.
const MAX_NAME_LENGTH_MOBILE = 4

function truncateName(name, limit = MAX_NAME_LENGTH) {
  if (typeof name !== 'string') return ''
  return name.length > limit ? `${name.slice(0, limit)}…` : name
}

// 메뉴 6개의 자연 너비 합이 397px이라 좌우 여백만 더해도 휴대폰 화면을 넘는다
// (실측: 검색·알림·프로필을 빼고도 429px). 그래서 좁은 화면에서는 메뉴를 서랍에
// 넣는다. 경계는 768px — 이 폭에서는 지금 한 줄 배치가 아직 멀쩡하다.
//
// CSS로 숨기지 않고 **어느 쪽 하나만 렌더링**하는 이유: 양쪽에 다 그려두면
// NotificationBell이 두 번 마운트돼 폴링이 두 배가 된다.
const MOBILE_QUERY = '(max-width: 767px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (event) => setIsMobile(event.matches)
    mq.addEventListener('change', onChange)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function MenuLinks({ itemClassName }) {
  return MENU_ITEMS.map((item) =>
    item.external ? (
      <a key={item.to} href={item.to} className={itemClassName({ isActive: false })}>
        {item.label}
      </a>
    ) : (
      <NavLink key={item.to} to={item.to} end={item.end} className={itemClassName}>
        {item.label}
      </NavLink>
    ),
  )
}

// 서랍 안에서는 세로로 쌓이므로 아래 밑줄 대신 **왼쪽 막대**로 현재 위치를
// 표시한다. 밑줄은 세로 목록에서 항목 사이 구분선처럼 읽힌다.
const drawerLinkClassName = ({ isActive }) =>
  `border-l-4 px-4 py-3 text-sm font-medium ${
    isActive
      ? 'border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400'
      : 'border-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
  }`

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
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 모바일에서는 벨이 서랍 안에 있어 열기 전까지 배지가 안 보인다 — 햄버거에
  // 점으로 대신 알린다. 값은 벨이 이미 폴링하는 것을 그대로 받는다.
  const [unreadCount, setUnreadCount] = useState(0)
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

  // 다른 화면으로 가면 서랍은 닫는다. 링크를 눌렀는데 서랍이 그대로 덮여 있으면
  // 이동한 화면이 보이지 않는다.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 넓은 화면으로 돌아가면 서랍을 정리한다 — 열린 채로 두면 데스크톱 배치 위에
  // 덮개만 남는다.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false)
  }, [isMobile])

  // 열려 있는 동안 Esc로 닫고, 뒤 페이지가 같이 스크롤되지 않게 잠근다.
  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [drawerOpen])

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

  const profile = showViewer && (
    <div className="flex items-center gap-2">
      <img
        src={session.profile.picture}
        alt=""
        referrerPolicy="no-referrer"
        className="h-7 w-7 shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-700"
      />
      <span title={session.profile.name} className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
        {truncateName(session.profile.name, isMobile ? MAX_NAME_LENGTH_MOBILE : MAX_NAME_LENGTH)}
      </span>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-gray-900">
      {isMobile ? (
        <>
          <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="메뉴 열기"
              aria-expanded={drawerOpen}
              className="relative -ml-1 flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
              {/* 벨이 서랍 안으로 들어가 배지가 안 보이므로, 안 읽은 알림이 있다는
                  사실만 여기 점으로 남긴다(개수는 열어서 확인). */}
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
              )}
            </button>
            <div className="ml-auto">{profile}</div>
          </header>

          {/* 서랍은 **닫혀 있어도 DOM에 남긴다** — 안의 NotificationBell이 계속
              폴링해야 햄버거의 점이 맞기 때문이다. 대신 invisible로 탭 순서에서
              빠뜨려, 닫힌 서랍의 링크에 키보드 포커스가 들어가지 않게 한다. */}
          <div
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
              drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-gray-200 bg-white transition-transform dark:border-gray-700 dark:bg-gray-900 ${
              drawerOpen ? 'translate-x-0' : 'invisible -translate-x-full'
            }`}
            role="dialog"
            aria-label="메뉴"
          >
            {/* 알림은 서랍 **맨 위**에 둔다(사용자 결정). 목록 아래에 있으면 메뉴를
                다 지나야 닿고, 서랍을 열자마자 눈에 들어오는 자리가 여기다.
                이 줄이 relative라 알림 패널이 줄 바로 아래로 펼쳐진다. */}
            <div className="relative flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <NotificationBell className="static flex items-center" inDrawer onUnreadChange={setUnreadCount} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="메뉴 닫기"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav className="flex flex-col py-2">
              <MenuLinks itemClassName={drawerLinkClassName} />
            </nav>

            {/* 메뉴 **바로 다음**에 온다. 처음엔 mt-auto로 서랍 맨 아래에 붙였는데,
                기기 화면이 보이는 영역보다 크면 그대로 잘려서 검색·알림이 아예
                없는 것처럼 보였다(실제로 그렇게 보고받았다). 목록의 연장으로
                두면 메뉴를 따라 내려오다 자연히 만난다. */}
            {showSearch && (
              <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                <NavSearchBox />
              </div>
            )}
          </div>
        </>
      ) : (
        <nav className="flex items-center gap-1 border-b border-gray-200 px-4 dark:border-gray-700">
          <MenuLinks itemClassName={linkClassName} />

          {/* 남는 공간을 차지해 검색창을 메뉴와 프로필 표시 사이 가운데에 둔다 —
              항상 렌더링해 페이지에 따라 메뉴바 폭이 흔들리지 않게 하고, 내용만
              조건부로 넣는다. */}
          <div className="flex flex-1 justify-center px-4">{showSearch && <NavSearchBox />}</div>

          <NotificationBell />

          {/* 지금 로그인된 계정을 알려주기만 하는 표시 — 누를 곳도, 펼쳐지는 것도
              없다. 그래서 button이나 링크가 아니라 그냥 텍스트다. */}
          <div className="mr-9">{profile}</div>
        </nav>
      )}
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
