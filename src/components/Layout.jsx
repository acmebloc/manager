import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { loadSession } from '../lib/secureProfileStore'

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
  const [hasSession, setHasSession] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = await loadSession()
      if (cancelled) return
      setHasSession(Boolean(session))
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
  if (!hasSession) {
    const destination = location.pathname + location.search
    return <Navigate to={`/?continue=${encodeURIComponent(destination)}`} replace />
  }

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
      </nav>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
