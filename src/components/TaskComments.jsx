import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { extractMentionUserIds } from '../lib/mentions'
import { Avatar } from './ProjectMembers'
import MarkdownContent from './MarkdownContent'
import MarkdownEditor from './MarkdownEditor'

function formatDateTime(value) {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function CommentItem({ comment, mentionMembers, mentionUsersById, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await onSave(comment.id, draft.trim())
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('댓글을 삭제할까요?')) return
    try {
      await onDelete(comment.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <li className="flex gap-2">
      <Avatar user={comment.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{comment.author?.name}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">{formatDateTime(comment.createdAt)}</span>
        </div>
        {editing ? (
          <div className="mt-1 flex flex-col gap-2">
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              mentionMembers={mentionMembers}
              mentionUsersById={mentionUsersById}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.trim()}
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setDraft(comment.body)
                  setError('')
                }}
                className="rounded-md px-2 py-1 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <MarkdownContent text={comment.body} mentionUsersById={mentionUsersById} />
        )}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {comment.isMine && !editing && (
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            >
              수정
            </button>
            <button type="button" onClick={remove} className="text-xs text-red-600 hover:text-red-500 dark:text-red-400">
              삭제
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function TaskComments({ projectId, taskId, members }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [composeKey, setComposeKey] = useState(0)

  // 현재 멤버 + 과거에 멘션됐지만 지금은 나간 사람까지 합친 맵. 나간 사람도
  // TaskCommentMention → User 조회는 여전히 유효해서 최신 이름을 계속 보여줄 수
  // 있다 (스펙 6.2).
  const mentionUsersById = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m]))
    for (const comment of comments) {
      for (const user of comment.mentions || []) {
        if (!map.has(user.id)) map.set(user.id, user)
      }
    }
    return map
  }, [members, comments])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}/comments`)
        if (!cancelled) setComments(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId])

  const post = async () => {
    if (!draft.trim()) return
    setPosting(true)
    try {
      const comment = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}/comments`, {
        method: 'POST',
        body: { body: draft.trim(), mentionUserIds: extractMentionUserIds(draft) },
      })
      setComments((current) => [...current, comment])
      setDraft('')
      setComposeKey((k) => k + 1) // MDXEditor's markdown prop is initial-only — remount to clear it
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  const saveComment = async (id, body) => {
    const updated = await apiFetch(`/api/projects/${projectId}/tasks/${taskId}/comments/${id}`, {
      method: 'PATCH',
      body: { body, mentionUserIds: extractMentionUserIds(body) },
    })
    setComments((current) => current.map((c) => (c.id === id ? updated : c)))
  }

  const deleteComment = async (id) => {
    await apiFetch(`/api/projects/${projectId}/tasks/${taskId}/comments/${id}`, { method: 'DELETE' })
    setComments((current) => current.filter((c) => c.id !== id))
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        댓글 {comments.length > 0 && `(${comments.length})`}
      </h4>
      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              mentionMembers={members}
              mentionUsersById={mentionUsersById}
              onSave={saveComment}
              onDelete={deleteComment}
            />
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <MarkdownEditor
          key={composeKey}
          value={draft}
          onChange={setDraft}
          mentionMembers={members}
          mentionUsersById={mentionUsersById}
          placeholder="댓글을 입력하세요. @로 멤버를 멘션할 수 있어요"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="button"
          onClick={post}
          disabled={posting || !draft.trim()}
          className="self-start rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {posting ? '작성 중...' : '댓글 작성'}
        </button>
      </div>
    </div>
  )
}

export default TaskComments
