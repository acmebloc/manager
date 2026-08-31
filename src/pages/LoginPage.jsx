import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GOOGLE_CLIENT_ID, initGoogleSignIn, renderGoogleButton } from '../lib/googleAuth'
import { loadSession, saveSession } from '../lib/secureProfileStore'

function GoogleGIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.2-17 10.3z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.4 0 10.4-2 14.2-5.2l-6.6-5.4C29.6 35 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.4l-6.6 5.1C9.9 39.6 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.6l6.6 5.4C40.9 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  )
}

// `continue` is attacker-reachable — it's just a query parameter, and this
// page is the site root, so anyone can hand out a manager.acmebloc.com link
// that lands somewhere else entirely. The only legitimate producer is
// /oidc/authorize's "you're not logged in yet" redirect (oidc.js), which
// always emits a path on this origin, so that's all we accept.
//
// Rejected on purpose: absolute URLs ("https://elsewhere"), protocol-relative
// ones ("//elsewhere" — the browser reads those as absolute), the backslash
// variant ("/\elsewhere", which some browsers normalize the same way), and
// anything non-string. Everything else is a plain same-origin path.
function safeContinuePath(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  if (raw[0] !== '/') return null
  if (raw[1] === '/' || raw[1] === '\\') return null
  return raw
}

// If we got here via a redirect from the OIDC /authorize endpoint (e.g.
// BookStack, because there was no manager_session cookie yet), `continue`
// points back at that same /oidc/authorize request so it can finish once
// we're actually logged in. That's a backend route, not a frontend one, so
// it needs a real navigation — not React Router.
function goAfterLogin(navigate) {
  const params = new URLSearchParams(window.location.search)
  const continuePath = safeContinuePath(params.get('continue'))
  if (continuePath) {
    window.location.href = continuePath
  } else {
    navigate('/dashboard')
  }
}

// Standalone login screen — no menu here, just sign-in. A cached session
// shows the "~로 접속" button instead of the Gmail button; either path lands
// on the dashboard once the user is signed in. The session's presence alone
// decides that UI state — no server round trip just to check "am I logged in".
function LoginPage() {
  const [session, setSession] = useState(null)
  const [gsiReady, setGsiReady] = useState(false)
  const [gsiError, setGsiError] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const googleButtonRef = useRef(null)
  const fakeButtonRef = useRef(null)
  const navigate = useNavigate()

  const handleCredential = useCallback(
    async (idToken) => {
      setSigningIn(true)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        })
        if (!res.ok) throw new Error('login failed')
        const { token, user } = await res.json()
        const nextSession = { token, profile: user }
        await saveSession(nextSession)
        setSession(nextSession)
        goAfterLogin(navigate)
      } catch (err) {
        console.error('Google sign-in failed:', err)
      } finally {
        setSigningIn(false)
      }
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await loadSession()
      if (!cancelled) setSession(cached)

      // waitForGis(googleAuth.js)는 10초 안에 GIS 스크립트가 안 뜨면(광고
      // 차단기 등으로 accounts.google.com 자체가 막힌 경우) reject한다 — 여기서
      // 안 잡으면 unhandled rejection으로 조용히 끝나고, gsiReady가 계속
      // false인데도 화면은 멀쩡해 보이는 로그인 버튼을 그린다(눌러도 반응 없음).
      try {
        const available = await initGoogleSignIn(handleCredential)
        if (!cancelled) setGsiReady(available)
      } catch (err) {
        console.error('Google Identity Services failed to load:', err)
        if (!cancelled) setGsiError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [handleCredential])

  useEffect(() => {
    if (gsiReady && !session && googleButtonRef.current && fakeButtonRef.current) {
      const width = Math.round(fakeButtonRef.current.getBoundingClientRect().width)
      renderGoogleButton(googleButtonRef.current, { width })
    }
  }, [gsiReady, session])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-white px-4 dark:bg-gray-900">
      <h1 className="text-4xl font-semibold text-gray-900 dark:text-white">Manager</h1>

      {session ? (
        <button
          type="button"
          onClick={() => goAfterLogin(navigate)}
          className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-gray-300 bg-white px-[10px] text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          <img
            src={session.profile.picture}
            alt=""
            referrerPolicy="no-referrer"
            className="h-6 w-6 rounded-full"
          />
          <span>{session.profile.email}로 접속</span>
        </button>
      ) : GOOGLE_CLIENT_ID && gsiError ? (
        <div
          title="Google 로그인을 불러오지 못했습니다. 광고 차단 확장 프로그램을 꺼거나 새로고침해 보세요."
          className="flex h-10 cursor-not-allowed items-center whitespace-nowrap rounded-full border border-dashed border-gray-300 px-[10px] text-sm text-gray-400 dark:border-gray-600 dark:text-gray-500"
        >
          Gmail 로그인을 불러올 수 없어요
        </div>
      ) : GOOGLE_CLIENT_ID ? (
        <div className="relative inline-flex">
          <button
            ref={fakeButtonRef}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-gray-300 bg-white px-[10px] text-sm font-medium text-gray-700 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <GoogleGIcon />
            {signingIn ? '로그인 중...' : 'Gmail 로그인'}
          </button>
          {/* Google's real "Sign in with Google" button is rendered here and
             layered on top, invisible (opacity-0) but still interactive — a
             real click lands on it and opens the genuine account picker. */}
          <div ref={googleButtonRef} className="absolute inset-0 opacity-0" />
        </div>
      ) : (
        <div
          title="루트에 .env를 만들고 VITE_GOOGLE_CLIENT_ID를 설정하세요 (.env.example 참고)"
          className="flex h-10 cursor-not-allowed items-center whitespace-nowrap rounded-full border border-dashed border-gray-300 px-[10px] text-sm text-gray-400 dark:border-gray-600 dark:text-gray-500"
        >
          Gmail 로그인 (설정 필요)
        </div>
      )}
    </div>
  )
}

export default LoginPage
