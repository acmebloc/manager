import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const POLL_INTERVAL_MS = 60000

function formatDateTime(value) {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  )
}

// 헤더의 알림벨 — 담당자 지정/멘션/일정 참조자/마감 임박 이벤트가 쌓인 인앱
// 알림을 보여준다. react-query 등은 이 프로젝트에 없어 다른 곳(Layout.jsx의
// 세션 체크 등)과 같은 수동 useEffect + setInterval 폴링으로 구현.
// 모바일 드로어 안에서도 쓴다. inDrawer면 패널을 **줄 폭에 맞춰 아래로** 편다:
//   - 폭: 기본 w-80(320px)은 드로어(288px)보다 넓어 밖으로 삐져나간다. left/right를
//     0으로 두되, 그 기준이 되도록 이 컴포넌트는 static이 되고 바깥 줄이 relative를
//     맡는다(벨 버튼만 감싸면 기준 폭이 28px이 되어 패널이 그만큼 쪼그라든다).
//   - 방향: 벨이 드로어 **맨 위**에 있으므로 그 줄 바로 아래로 편다(top-full).
function NotificationBell({ className = 'relative mr-3 flex items-center', inDrawer = false, onUnreadChange }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const containerRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const data = await apiFetch('/api/notifications/unread-count')
        if (!cancelled) setUnreadCount(data.count)
      } catch {
        // 배지 하나 못 갱신한다고 페이지 전체에 에러를 보일 필요는 없다.
      }
    }
    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // 안 읽은 개수를 바깥으로도 알린다. 모바일에서는 이 벨이 드로어 안에 있어서
  // 열기 전까지 배지가 안 보이는데, 햄버거에 점으로 대신 표시하기 위해서다.
  // 요청을 새로 만들지 않고 이미 폴링 중인 값을 그대로 흘려보낸다.
  useEffect(() => {
    onUnreadChange?.(unreadCount)
  }, [unreadCount, onUnreadChange])

  const loadList = async () => {
    try {
      const data = await apiFetch('/api/notifications')
      setItems(data.items)
    } catch {
      // 목록 로드 실패는 배지 숫자와 별개로 조용히 무시한다.
    }
  }

  // setState 업데이터 안에서 loadList()를 부르지 않는다 — StrictMode가 업데이터를
  // 두 번 실행해서 열 때마다 목록을 두 번 받아왔다.
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next) loadList()
  }

  const openItem = async (item) => {
    setOpen(false)
    if (!item.readAt) {
      try {
        await apiFetch(`/api/notifications/${item.id}/read`, { method: 'PATCH' })
        setUnreadCount((c) => Math.max(0, c - 1))
      } catch {
        // 읽음 처리 실패해도 이동은 막지 않는다.
      }
    }
    navigate(item.link)
  }

  const markAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' })
      setUnreadCount(0)
      setItems((current) => current.map((i) => ({ ...i, readAt: i.readAt || new Date().toISOString() })))
    } catch {
      // 무시 — 다음 폴링에서 배지가 다시 맞춰진다.
    }
  }

  return (
    <div className={className} ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="알림"
        className="relative flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className={`absolute z-20 rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800 ${
            inDrawer ? 'left-2 right-2 top-full mt-1' : 'right-0 top-9 w-80'
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">알림</p>
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              모두 읽음
            </button>
          </div>
          {items.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">새 알림이 없습니다.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${
                      item.readAt ? 'text-gray-500 dark:text-gray-400' : 'font-medium text-gray-900 dark:text-white'
                    }`}
                  >
                    <p>{item.title}</p>
                    <p className="mt-0.5 text-gray-400 dark:text-gray-500">{formatDateTime(item.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
