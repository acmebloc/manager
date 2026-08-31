import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PmHandoverDialog from '../components/PmHandoverDialog'
import Toast from '../components/Toast'
import { apiFetch } from '../lib/api'
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
  // 비어있지 않으면 "PM 넘기기" 레이어가 뜬다 — 탈퇴를 막고 있는 프로젝트 목록.
  const [solePmProjects, setSolePmProjects] = useState([])
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
  //
  // 그래서 이 요청이 실패하면 로컬 세션도 지우지 않는다. 지워버리면 Manager는
  // 로그아웃된 것처럼 보이는데 쿠키가 남아 게시판은 계속 열려 있고, 게다가 이
  // 버튼이 있는 화면 자체가 세션 가드에 막혀 다시 시도할 방법이 사라진다.
  // 실패를 실패로 알리고 그 자리에 남겨두는 편이 안전하다.
  const handleLogout = useCallback(async () => {
    let res
    try {
      res = await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      setError('로그아웃하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.')
      return
    }
    if (!res.ok) {
      setError('로그아웃하지 못했어요. 잠시 후 다시 시도해주세요.')
      return
    }
    await clearLocalSession()
  }, [clearLocalSession])

  // 최종 확인창 → 실제 탈퇴. PM 인계가 필요한 경우든 아니든 마지막 단계는
  // 항상 여기라, 확인을 누른 뒤에 막히는 일이 없다.
  const confirmAndWithdraw = useCallback(async () => {
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
      if (res.ok) {
        await clearLocalSession()
        return
      }

      const payload = await res.json().catch(() => null)
      // 여기까지 왔는데 409면, 확인 직전에 다른 PM이 빠져나가 다시 유일한 PM이
      // 된 경우다. 드물지만 막다른 길로 두지 말고 인계 레이어를 다시 띄운다.
      if (res.status === 409 && payload?.solePmProjects?.length) {
        setSolePmProjects(payload.solePmProjects)
        setError('')
        return
      }
      setError(payload?.error || '탈퇴에 실패했어요. 다시 시도해주세요.')
    } catch {
      setError('탈퇴에 실패했어요. 다시 시도해주세요.')
    }
  }, [session, clearLocalSession])

  // 버튼을 누르면 먼저 PM 인계가 필요한지부터 확인한다 — 확인창을 띄운 뒤에
  // 막아서 되돌리게 하는 대신, 막을 일이 있으면 그것부터 처리하게 한다.
  const handleWithdraw = useCallback(async () => {
    // 사이트 관리자는 서버가 400으로 막는다(me.js) — 확인창을 먼저 띄우면 PM
    // 인계 때와 똑같이 "정말 탈퇴?"에 동의한 뒤에야 안 된다는 말을 듣게 된다.
    // 서버가 여전히 최종 판단을 하고, 이건 순서만 앞당기는 것이다.
    if (session.profile.isSiteAdmin) {
      setError('사이트 관리자는 탈퇴할 수 없습니다. 다른 사람에게 관리자를 넘긴 뒤 시도해주세요.')
      return
    }

    let blocking
    try {
      blocking = await apiFetch('/api/me/sole-pm-projects')
    } catch (err) {
      setError(err.message)
      return
    }

    if (blocking.length > 0) {
      setSolePmProjects(blocking)
      setError('')
      return
    }
    await confirmAndWithdraw()
  }, [session, confirmAndWithdraw])

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

      {solePmProjects.length > 0 && (
        <PmHandoverDialog
          projects={solePmProjects}
          currentUserId={profile.id}
          onClose={() => setSolePmProjects([])}
          onResolved={() => {
            setSolePmProjects([])
            confirmAndWithdraw()
          }}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} onDone={() => setToast(null)} />}
    </div>
  )
}

export default MyPage
