import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { taskStatusLabel } from '../lib/taskFields'
import { MAX_REVIEW_LINKS, normalizeReviewLink } from '../lib/taskReview'
import {
  formatFileSize,
  isAllowedAttachmentExt,
  MAX_ATTACHMENT_SIZE,
} from '../lib/uploads'

// 검수자 드롭다운의 선택지. 담당자는 검수자가 될 수 없으니(서버도 같은 판단을
// 한다) 목록에서 빼고, 지금 검수자로 지정된 사람은 프로젝트에서 빠졌더라도
// 반드시 남겨둔다 — 선택된 값이 옵션에 없으면 브라우저가 첫 옵션("선택")을
// 보여주는데 state에는 예전 id가 그대로 있어서, 화면과 실제 저장값이 어긋난다.
//
// 이름을 못 붙이는 경우가 있다: 칸반/목록에서 띄운 팝업은 목록 응답에 검수자
// 객체가 없어(reviewerId만 있다) task.reviewer가 undefined다. 그때도 옵션 자체는
// 만들어야 하므로 이름 없이 표시한다.
function buildReviewerChoices(memberUsers, task) {
  const list = (memberUsers || []).filter((m) => m.id !== task.assigneeId)
  if (!task.reviewerId || list.some((m) => m.id === task.reviewerId)) return list
  const name = task.reviewer?.name ? `${task.reviewer.name} (프로젝트 미참여)` : '현재 검수자 (프로젝트 미참여)'
  return [...list, { id: task.reviewerId, name }]
}

// 검수요청 / 반려 팝업. 규칙은 한 문장이다 — **검수중에 들어갈 때는 검수요청
// 팝업, 검수중에서 뒤로 나올 때는 반려사유 팝업**(docs/task-review-spec.md 4장).
// 앞으로(→완료) 나갈 때나 대기↔진행중 사이에서는 이 팝업이 뜨지 않는다.
//
// 칸반 드래그·목록 뷰의 상태 select·상세페이지의 상태 select 세 곳이 모두 이
// 컴포넌트를 쓴다. 그래서 프로젝트 멤버 목록은 props로 받되(상세페이지는 이미
// 갖고 있다) 없으면 스스로 불러온다(칸반/목록은 멤버를 안 들고 있다).
function TaskStatusDialog({ projectId, task, requires, toStatus, members, onCancel, onSubmit }) {
  const isRequest = requires === 'request'

  const [memberOptions, setMemberOptions] = useState(members || null)
  const [reviewerId, setReviewerId] = useState(task.reviewerId || '')
  const [body, setBody] = useState('')
  const [links, setLinks] = useState([])
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!isRequest || memberOptions) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/projects/${projectId}/members`)
        if (!cancelled) setMemberOptions(data.map((m) => m.user))
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRequest, projectId])

  const reviewerChoices = buildReviewerChoices(memberOptions, task)

  const addLink = () => {
    if (links.length >= MAX_REVIEW_LINKS) {
      setLinkError(`산출물 링크는 최대 ${MAX_REVIEW_LINKS}개까지 등록할 수 있어요`)
      return
    }
    const normalized = normalizeReviewLink(linkInput)
    if (normalized.error) {
      setLinkError(normalized.error)
      return
    }
    if (links.includes(normalized.link)) {
      setLinkError('이미 추가한 링크예요')
      return
    }
    setLinks((current) => [...current, normalized.link])
    setLinkInput('')
    setLinkError('')
  }

  const pickFile = (fileList) => {
    const picked = fileList?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!picked) return
    if (picked.size > MAX_ATTACHMENT_SIZE) {
      setError(`산출물 파일은 최대 ${formatFileSize(MAX_ATTACHMENT_SIZE)}까지 첨부할 수 있어요`)
      return
    }
    if (!isAllowedAttachmentExt(picked.name)) {
      setError('허용되지 않는 파일 형식입니다')
      return
    }
    setError('')
    setFile(picked)
  }

  const submit = async () => {
    if (!body.trim()) {
      setError(isRequest ? '검수 내용을 입력해주세요' : '반려 사유를 입력해주세요')
      return
    }
    if (isRequest && !reviewerId) {
      setError('검수자를 지정해주세요')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        review: { body: body.trim(), links },
        ...(isRequest && { reviewerId }),
        file,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {isRequest ? '검수요청' : '반려'}
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {task.title} · {taskStatusLabel(task.status)} → {taskStatusLabel(toStatus)}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {isRequest && (
            <label className="text-xs text-gray-500 dark:text-gray-400">
              검수자
              <select
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="">선택</option>
                {reviewerChoices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="text-xs text-gray-500 dark:text-gray-400">
            {isRequest ? '검수 내용' : '반려 사유'}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              autoFocus
              placeholder={isRequest ? '무엇을 검수해야 하는지 적어주세요' : '반려하는 이유를 적어주세요'}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </label>

          {/* 산출물(링크·파일)은 검수요청 이력에만 붙는다 — 반려는 사유 텍스트만 남긴다. */}
          {isRequest && (
            <>
              <div>
                <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                  산출물 링크 <span className="text-gray-400 dark:text-gray-500">(최대 {MAX_REVIEW_LINKS}개)</span>
                </p>
                {links.length > 0 && (
                  <ul className="mb-2 flex flex-col gap-1">
                    {links.map((link) => (
                      <li
                        key={link}
                        className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"
                      >
                        <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{link}</span>
                        <button
                          type="button"
                          onClick={() => setLinks((current) => current.filter((l) => l !== link))}
                          className="shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {links.length < MAX_REVIEW_LINKS && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      onKeyDown={(e) => {
                        // 폼 안이 아니라 다이얼로그라 Enter가 submit으로 새지 않지만,
                        // 링크 입력 중 Enter는 "추가"로 동작하는 쪽이 자연스럽다.
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        addLink()
                      }}
                      placeholder="example.com/design/v2"
                      className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={addLink}
                      disabled={!linkInput.trim()}
                      className="shrink-0 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    >
                      추가
                    </button>
                  </div>
                )}
                {linkError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{linkError}</p>}
              </div>

              <div>
                <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                  산출물 첨부 <span className="text-gray-400 dark:text-gray-500">(1개)</span>
                </p>
                {file ? (
                  <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-xs dark:border-gray-700">
                    <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{file.name}</span>
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    파일 선택
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => pickFile(event.target.files)}
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:text-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? '처리 중...' : isRequest ? '검수요청' : '반려'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TaskStatusDialog
