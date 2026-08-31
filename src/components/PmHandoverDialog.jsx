import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { Avatar, UserSearch } from './ProjectMembers'

// 탈퇴하려는 사람이 유일한 PM으로 있는 프로젝트들을, 그 자리에서 하나씩
// 넘기게 해주는 레이어. 프로젝트마다 따로 확인 버튼을 두는 이유는, 여러 건을
// 한 번에 적용하면 중간에 하나가 실패했을 때 어디까지 반영됐는지 알기
//어려워서다 — 성공한 프로젝트는 목록에서 바로 빠지므로 남은 게 곧 할 일이다.
function ProjectRow({ project, onDone }) {
  const [picked, setPicked] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const apply = async () => {
    if (!picked) return
    setSaving(true)
    try {
      await apiFetch(`/api/projects/${project.id}/pm`, {
        method: 'POST',
        body: { userId: picked.id },
      })
      onDone(project.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <li className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{project.name}</p>

      {picked ? (
        <div className="flex items-center gap-2">
          <Avatar user={picked} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-gray-900 dark:text-white">
              {picked.name}
            </span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {picked.email}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            disabled={saving}
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
          >
            변경
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? '적용 중...' : '확인'}
          </button>
        </div>
      ) : (
        <UserSearch
          excludeUserIds={new Set()}
          onPick={setPicked}
          placeholder="새 PM으로 지정할 사람 검색"
        />
      )}

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  )
}

function PmHandoverDialog({ projects, onResolved, onClose }) {
  const [remaining, setRemaining] = useState(projects)

  const handleDone = (projectId) => {
    const next = remaining.filter((p) => p.id !== projectId)
    setRemaining(next)
    if (next.length === 0) onResolved()
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">PM 넘기기</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          아래 프로젝트의 유일한 PM이라 탈퇴할 수 없어요. 새 PM을 지정하면 탈퇴할 수 있습니다.
        </p>

        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {remaining.map((project) => (
            <ProjectRow key={project.id} project={project} onDone={handleDone} />
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default PmHandoverDialog
