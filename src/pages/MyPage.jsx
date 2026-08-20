import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endGoogleSession } from '../lib/googleAuth'
import { resizeImageFile } from '../lib/imageUtils'
import { deleteProfile, loadProfile, saveProfile } from '../lib/secureProfileStore'

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a2 2 0 01-.878.507l-3 1a1 1 0 01-1.264-1.264l1-3a2 2 0 01.507-.878l8.5-8.5z" />
    </svg>
  )
}

function MyPage() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const fileInputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await loadProfile()
      if (cancelled) return
      if (!cached) {
        navigate('/', { replace: true })
        return
      }
      setProfile(cached)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const handleWithdraw = useCallback(async () => {
    await deleteProfile()
    endGoogleSession()
    navigate('/', { replace: true })
  }, [navigate])

  const startEditName = () => {
    setNameDraft(profile.name)
    setIsEditingName(true)
  }

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    const next = { ...profile, name: trimmed }
    await saveProfile(next)
    setProfile(next)
    setIsEditingName(false)
  }, [nameDraft, profile])

  const handlePickImage = () => fileInputRef.current?.click()

  const handleImageChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const dataUrl = await resizeImageFile(file)
      const next = { ...profile, picture: dataUrl }
      await saveProfile(next)
      setProfile(next)
    },
    [profile],
  )

  if (loading) return null

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
