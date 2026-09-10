import { useEffect, useRef, useState } from 'react'

// 화면 상단의 "프로젝트명 ▾" 선택기. 일정 화면이 쓰던 것을 관계도에서도 그대로
// 쓰기 위해 꺼냈다 — 두 화면이 같은 자리에서 같은 모양으로 프로젝트를 고른다.
//
// 목록은 항상 최신 생성순으로 정렬한다. 기본 선택(첫 번째)과 같은 기준이어야
// "맨 위에 있는 게 기본값"이 성립하는데, /api/projects의 정렬에 암묵적으로
// 기대지 않도록 여기서 한 번 더 명시한다.
function ProjectPicker({ projects, selectedId, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (projects.length === 0) return null

  const selected = projects.find((p) => p.id === selectedId)
  const ordered = [...projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  // 아래 여백(mb-3)을 이 안에 둔다 — 부모가 감싸면 프로젝트가 없을 때(위에서
  // null을 반환) 빈 껍데기만 남아 쓸데없는 여백이 생긴다.
  return (
    <div className="relative mb-3 inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-base font-medium text-gray-900 dark:text-white"
      >
        {selected?.name}
        <span className="text-[#000000] dark:text-white">▾</span>
      </button>
      {open && (
        <ul className="absolute z-10 mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {ordered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(p.id)
                  setOpen(false)
                }}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  p.id === selectedId
                    ? 'font-medium text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ProjectPicker
