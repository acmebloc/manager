import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Toast from '../components/Toast'
import { endGoogleSession } from '../lib/googleAuth'
import { resizeImageFile } from '../lib/imageUtils'
import { clearSession, loadSession, saveSession } from '../lib/secureProfileStore'

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a2 2 0 01-.878.507l-3 1a1 1 0 01-1.264-1.264l1-3a2 2 0 01.507-.878l8.5-8.5z" />
    </svg>
  )
}

// Persists a profile field (name/picture) to the server and, on success,
// updates the local session cache with the server's decrypted response so
// the cache never drifts from what's actually stored.
async function updateProfile(session, patch) {
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('profile update failed')
  const user = await res.json()
  return { ...session, profile: user }
}

function MyPage() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await loadSession()
      if (cancelled) return
      if (!cached) {
        navigate('/', { replace: true })
        return
      }
      setSession(cached)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  // Clears the browser's own copies of the session and sends the user back to
  // the login screen. Used by both 로그아웃 and 회원탈퇴 — they differ in what
  // they ask the server to do first, not in this part.
  const clearLocalSession = useCallback(async () => {
    await clearSession()
    endGoogleSession()
    navigate('/', { replace: true })
  }, [navigate])

  // The server call drops the httpOnly cookie, which is what /oidc/authorize
  // checks — without it that cookie stays valid until its natural expiry and
  // BookStack keeps silently signing the user back in even though Manager
  // looks signed out.
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // best-effort — still clear the local session below even if this fails
    }
    await clearLocalSession()
  }, [clearLocalSession])

  const handleWithdraw = useCallback(async () => {
    const confirmed = window.confirm(
      '회원정보가 삭제되며 참여 중인 모든 프로젝트에서 제외됩니다.\n' +
        '작성한 글과 배정된 일감은 비활성 상태로 남습니다.\n\n' +
        '탈퇴하시겠습니까?',
    )
    if (!confirmed) return

    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.token}` },
      })
      if (!res.ok) {
        // 유일한 PM인 프로젝트가 있으면 409 — 어느 프로젝트인지 알려줘야
        // 사용자가 PM을 넘기고 다시 시도할 수 있다.
        const payload = await res.json().catch(() => null)
        setError(payload?.error || '탈퇴에 실패했어요. 다시 시도해주세요.')
        return
      }
    } catch {
      setError('탈퇴에 실패했어요. 다시 시도해주세요.')
      return
    }

    await clearLocalSession()
  }, [session, clearLocalSession])

  const startEditName = () => {
    setNameDraft(session.profile.name)
    setIsEditingName(true)
  }

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    try {
      const next = await updateProfile(session, { name: trimmed })
      await saveSession(next)
      setSession(next)
      setIsEditingName(false)
      setError('')
    } catch {
      setError('이름 저장에 실패했어요. 다시 시도해주세요.')
    }
  }, [nameDraft, session])

  const toggleNotifications = useCallback(async () => {
    const next = !(session.profile.emailNotificationsEnabled !== false)
    try {
      const updated = await updateProfile(session, { emailNotificationsEnabled: next })
      await saveSession(updated)
      setSession(updated)
      setError('')
      setToast({
        id: Date.now(),
        message: next ? '알림 설정이 활성화 되었습니다.' : '알림 설정이 비활성화 되었습니다.',
      })
    } catch {
      setError('알림 설정 저장에 실패했어요. 다시 시도해주세요.')
    }
  }, [session])

  const handlePickImage = () => fileInputRef.current?.click()

  const handleImageChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      try {
        const dataUrl = await resizeImageFile(file)
        const next = await updateProfile(session, { picture: dataUrl })
        await saveSession(next)
        setSession(next)
        setError('')
      } catch {
        setError('사진 저장에 실패했어요. 다시 시도해주세요.')
      }
    },
    [session],
  )

  if (loading) return null

  const { profile } = session
  const notificationsEnabled = profile.emailNotificationsEnabled !== false

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <img
            src={profile.picture}
            alt=""
            referrerPolicy="no-referrer"
            className="h-20 w-20 rounded-full object-cover"
          />
          <button
            type="button"
            onClick={handlePickImage}
            aria-label="프로필 이미지 변경"
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <PencilIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
        </div>

        {isEditingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveName()
                if (event.key === 'Escape') setIsEditingName(false)
              }}
              autoFocus
              className="rounded-md border border-gray-300 px-2 py-1 text-center text-lg font-medium text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <button
              type="button"
              onClick={saveName}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setIsEditingName(false)}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEditName}
            className="flex items-center gap-1.5 text-lg font-medium text-gray-900 hover:underline dark:text-white"
          >
            {profile.name}
            <PencilIcon />
          </button>
        )}

        <p className="text-sm text-gray-500 dark:text-gray-400">{profile.email}</p>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-3 rounded-md border border-gray-200 px-4 py-3 dark:border-gray-700">
        <span className="text-sm text-gray-700 dark:text-gray-200">이메일 알림</span>
        <button
          type="button"
          role="switch"
          aria-checked={notificationsEnabled}
          onClick={toggleNotifications}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            notificationsEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          로그아웃
        </button>
        <button
          type="button"
          onClick={handleWithdraw}
          className="rounded-md border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          회원탈퇴
        </button>
      </div>

      {toast && <Toast key={toast.id} message={toast.message} onDone={() => setToast(null)} />}
    </div>
  )
}

export default MyPage
