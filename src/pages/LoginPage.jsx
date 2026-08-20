import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GOOGLE_CLIENT_ID, initGoogleSignIn, renderGoogleButton } from '../lib/googleAuth'
import { loadProfile, saveProfile } from '../lib/secureProfileStore'

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

// Standalone login screen — no menu here, just sign-in. A cached login shows
// the "~로 접속" button instead of the Gmail button; either path lands on
// the dashboard once the user is signed in.
function LoginPage() {
  const [profile, setProfile] = useState(null)
  const [gsiReady, setGsiReady] = useState(false)
  const googleButtonRef = useRef(null)
  const fakeButtonRef = useRef(null)
  const navigate = useNavigate()

  const handleCredential = useCallback(
    async (nextProfile) => {
      await saveProfile(nextProfile)
      setProfile(nextProfile)
      navigate('/dashboard')
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await loadProfile()
      if (!cancelled) setProfile(cached)

      const available = await initGoogleSignIn(handleCredential)
      if (!cancelled) setGsiReady(available)
    })()
    return () => {
      cancelled = true
    }
  }, [handleCredential])

  useEffect(() => {
    if (gsiReady && !profile && googleButtonRef.current && fakeButtonRef.current) {
      const width = Math.round(fakeButtonRef.current.getBoundingClientRect().width)
      renderGoogleButton(googleButtonRef.current, { width })
    }
  }, [gsiReady, profile])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-white px-4 dark:bg-gray-900">
      <h1 className="text-4xl font-semibold text-gray-900 dark:text-white">Manager</h1>

      {profile ? (
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-gray-300 bg-white px-[10px] text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          <img
            src={profile.picture}
            alt=""
            referrerPolicy="no-referrer"
            className="h-6 w-6 rounded-full"
          />
          <span>{profile.email}로 접속</span>
        </button>
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
            Gmail 로그인
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
