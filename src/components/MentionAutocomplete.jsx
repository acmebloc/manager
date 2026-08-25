import { useRef, useState } from 'react'
import { matchesKoreanQuery } from '../lib/korean'
import { Avatar } from './ProjectMembers'

// @[표시이름](user:cuid) — userId로 저장해 개명/동명이인에도 안 깨진다 (스펙 6.2).
const MENTION_RE = /@\[([^\]]+)\]\(user:([^)]+)\)/g

export function extractMentionUserIds(text) {
  const ids = new Set()
  for (const match of text.matchAll(MENTION_RE)) ids.add(match[2])
  return [...ids]
}

// 렌더링 시점에 userId로 현재 이름을 다시 찾아온다 — 마커에 박제된 이름이 아니라
// membersById(현재 프로젝트 멤버 기준)를 우선하므로 개명이 반영된다. 멤버가
// 이미 나간 경우엔 마커에 저장된 표시 이름으로 그대로 보여준다.
export function renderCommentBody(text, membersById) {
  const parts = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(MENTION_RE)) {
    const [full, markedName, userId] = match
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const currentName = membersById.get(userId)?.name || markedName
    parts.push(
      <span key={`mention-${key++}`} className="font-medium text-indigo-600 dark:text-indigo-400">
        @{currentName}
      </span>,
    )
    lastIndex = match.index + full.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// '@'를 입력하면 캐럿 아래(정확한 캐럿 위치가 아니라 textarea 바로 아래 —
// 캐럿을 픽셀 단위로 추적하려면 숨겨진 미러 div가 필요해 이번 범위에서는
// 단순화했다)에 드롭다운이 뜨는 controlled textarea.
function MentionTextarea({ value, onChange, members, placeholder, rows = 3, disabled, autoFocus }) {
  const textareaRef = useRef(null)
  const [dropdown, setDropdown] = useState(null) // { atIndex, query, highlighted }

  function findActiveMention(text, caret) {
    const upToCaret = text.slice(0, caret)
    const atIndex = upToCaret.lastIndexOf('@')
    if (atIndex === -1) return null
    const between = upToCaret.slice(atIndex + 1)
    if (/\s/.test(between)) return null
    return { atIndex, query: between }
  }

  const candidates = dropdown
    ? members
        .filter(
          (m) => matchesKoreanQuery(m.name, dropdown.query) || matchesKoreanQuery(m.email, dropdown.query),
        )
        .slice(0, 6)
    : []

  function handleChange(event) {
    const text = event.target.value
    onChange(text)
    const active = findActiveMention(text, event.target.selectionStart)
    setDropdown(active ? { ...active, highlighted: 0 } : null)
  }

  function selectMember(member) {
    const el = textareaRef.current
    const caret = el.selectionStart
    const before = value.slice(0, dropdown.atIndex)
    const after = value.slice(caret)
    const marker = `@[${member.name}](user:${member.id}) `
    onChange(before + marker + after)
    setDropdown(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + marker.length
      el.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(event) {
    if (!dropdown || candidates.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setDropdown((d) => ({ ...d, highlighted: (d.highlighted + 1) % candidates.length }))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setDropdown((d) => ({ ...d, highlighted: (d.highlighted - 1 + candidates.length) % candidates.length }))
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectMember(candidates[dropdown.highlighted])
    } else if (event.key === 'Escape') {
      setDropdown(null)
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setDropdown(null), 150)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      {dropdown && candidates.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full max-w-xs overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {candidates.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMember(member)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                  index === dropdown.highlighted
                    ? 'bg-indigo-50 dark:bg-indigo-950/40'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Avatar user={member} />
                <span className="min-w-0 truncate text-sm text-gray-900 dark:text-white">{member.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default MentionTextarea
