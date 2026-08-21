import { NavLink, Outlet } from 'react-router-dom'

// BookStack lives at /board on this same domain but is a separate app —
// Apache hands that path straight to it, so it needs a real browser
// navigation (same tab, same as every other menu item), not a React Router route.
const MENU_ITEMS = [
  { to: '/dashboard', label: '홈', end: true },
  { to: '/projects', label: '프로젝트' },
  { to: '/tasks', label: '일감관리' },
  { to: '/schedule', label: '일정관리' },
  { to: '/board', label: '게시판', external: true },
  { to: '/mypage', label: '마이페이지' },
]

const linkClassName = ({ isActive }) =>
  `border-b-2 px-4 py-3 text-sm font-medium ${
    isActive
      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
      : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
  }`

function Layout() {
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
