import { useCallback, useEffect, useRef, useState } from 'react'
import { apiDownload, apiFetch, apiUpload } from '../lib/api'
import { REVIEW_KIND_CLASS, REVIEW_KIND_LABELS } from '../lib/taskReview'
import { formatFileSize, isAllowedAttachmentExt, MAX_ATTACHMENT_SIZE } from '../lib/uploads'

function formatDateTime(value) {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

// 검수·반려 이력. 텍스트는 불변이고(등록되면 수정·삭제 불가), 산출물 파일만
// 올린 사람이 교체·삭제할 수 있다 — 그래서 이 컴포넌트가 하는 쓰기 동작은
// "산출물 파일 첨부/삭제" 두 가지뿐이다. 이력을 새로 만드는 건 상태 전이
// (TaskStatusDialog)의 몫이다.
//
// 가장 최근 이력만 펼쳐두고 나머지는 접는다 — 차수가 쌓이면 화면이 이력으로만
// 가득 차기 때문이다. 목록 자체에도 내부 스크롤을 둔다.
function TaskReviewHistory({ projectId, taskId, reloadKey }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [uploadingId, setUploadingId] = useState(null)
  // 이력마다 숨김 file input을 따로 두지 않고, 하나를 공유하면서 "지금 어느
  // 이력에 올리는 중인지"만 기억한다.
  const pendingReviewIdRef = useRef(null)
  const fileInputRef = useRef(null)

  const basePath = `/api/projects/${projectId}/tasks/${taskId}/reviews`

  const load = useCallback(
    async (options = {}) => {
      try {
        const data = await apiFetch(basePath)
        setReviews(data)
        // 최초 로드(또는 상태가 바뀌어 다시 불렀을 때)엔 마지막 이력만 펼친다.
        // 단 최종완료 이력은 펼칠 내용이 없으므로(승인 기록뿐) 건너뛰고, 내용이
        // 있는 가장 최근 이력을 펼친다. 사용자가 직접 접었다 펼친 상태는 파일
        // 업로드 같은 부분 갱신에서 건드리지 않는다.
        if (!options.keepExpanded) {
          const newest = [...data].reverse().find((r) => r.body || r.links.length > 0 || r.output)
          setExpandedIds(new Set(newest ? [newest.id] : []))
        }
        setError('')
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    [basePath],
  )

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const toggle = (id) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleFile = async (fileList) => {
    const picked = fileList?.[0]
    const reviewId = pendingReviewIdRef.current
    pendingReviewIdRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!picked || !reviewId) return

    if (picked.size > MAX_ATTACHMENT_SIZE) {
      setError(`산출물 파일은 최대 ${formatFileSize(MAX_ATTACHMENT_SIZE)}까지 첨부할 수 있어요`)
      return
    }
    if (!isAllowedAttachmentExt(picked.name)) {
      setError('허용되지 않는 파일 형식입니다')
      return
    }

    setUploadingId(reviewId)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', picked)
      await apiUpload(`${basePath}/${reviewId}/attachment`, formData)
      await load({ keepExpanded: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingId(null)
    }
  }

  const removeOutput = async (review) => {
    if (!window.confirm(`${review.output.fileName}을(를) 삭제할까요?`)) return
    setError('')
    try {
      await apiFetch(`${basePath}/${review.id}/attachment/${review.output.id}`, { method: 'DELETE' })
      await load({ keepExpanded: true })
    } catch (err) {
      setError(err.message)
    }
  }

  const download = async (review) => {
    try {
      await apiDownload(`${basePath}/${review.id}/attachment/${review.output.id}`, review.output.fileName)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null
  if (reviews.length === 0 && !error) return null

  // 최신 이력이 위로.
  const ordered = [...reviews].reverse()

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        검수·반려 이력 ({reviews.length})
      </h4>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto">
        {ordered.map((review) => {
          // 최종완료 이력은 본문도 산출물도 없다(승인 기록뿐) — 펼칠 게 없는데
          // 접기/펼치기 버튼을 두면 눌러도 아무 반응이 없고, 펼친 상태로 두면
          // 빈 칸만 있는 영역이 생긴다. 그래서 내용이 있을 때만 버튼으로 만든다.
          const hasDetail = Boolean(
            review.body || review.links.length > 0 || review.output || review.canUpload,
          )
          const expanded = hasDetail && expandedIds.has(review.id)
          const HeaderTag = hasDetail ? 'button' : 'div'
          return (
            <li key={review.id} className="rounded-md border border-gray-200 dark:border-gray-700">
              <HeaderTag
                {...(hasDetail ? { type: 'button', onClick: () => toggle(review.id) } : {})}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{review.round}차</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_KIND_CLASS[review.kind]}`}
                >
                  {REVIEW_KIND_LABELS[review.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
                  {review.author?.name || '알 수 없음'}
                  {!expanded && review.body && ` · ${review.body}`}
                </span>
                <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {formatDateTime(review.createdAt)}
                </span>
              </HeaderTag>

              {expanded && (
                <div className="flex flex-col gap-2 border-t border-gray-100 px-2.5 py-2 dark:border-gray-700">
                  {review.body && (
                    <p className="whitespace-pre-wrap text-sm text-gray-900 dark:text-white">{review.body}</p>
                  )}

                  {review.links.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {review.links.map((link) => (
                        <li key={link} className="min-w-0 truncate text-xs">
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}

                  {review.output && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => download(review)}
                        className="min-w-0 max-w-full truncate text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                      >
                        {review.output.fileName}
                      </button>
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">
                        {formatFileSize(review.output.size)}
                      </span>
                      {/* 최초 등록물과 다르다는 사실만 알린다 — 몇 번 바뀌었는지는 세지 않는다. */}
                      {review.outputReplaced && (
                        <span className="shrink-0 text-amber-600 dark:text-amber-400">
                          — 산출물이 변경되었습니다
                        </span>
                      )}
                      {review.output.canDelete && (
                        <button
                          type="button"
                          onClick={() => removeOutput(review)}
                          className="shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )}

                  {review.canUpload && (
                    <button
                      type="button"
                      onClick={() => {
                        pendingReviewIdRef.current = review.id
                        fileInputRef.current?.click()
                      }}
                      disabled={uploadingId === review.id}
                      className="self-start text-xs text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400"
                    >
                      {uploadingId === review.id ? '업로드 중...' : '산출물 파일 첨부'}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => handleFile(event.target.files)} />
    </div>
  )
}

export default TaskReviewHistory
