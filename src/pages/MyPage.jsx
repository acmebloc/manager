import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

  const handleWithdraw = useCallback(async () => {
    await clearSession()
    endGoogleSession()
    navigate('/', { replace: true })
  }, [navigate])

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

  const handlePickImage = () => fileInputRef.current?.click()

  const handleImageChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const dataUrl = await resizeImageFile(file)
      try {
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

      <button
        type="button"
        onClick={handleWithdraw}
        className="rounded-md border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        회원탈퇴
      </button>
    </div>
  )
}

export default MyPage
