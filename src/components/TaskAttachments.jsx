import { useEffect, useRef, useState } from 'react'
import { apiDownload, apiFetch, apiUpload } from '../lib/api'
import {
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  formatFileSize,
  isAllowedAttachmentExt,
} from '../lib/uploads'

function TaskAttachments({ projectId, taskId, canModify }) {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const basePath = `/api/projects/${projectId}/tasks/${taskId}/attachments`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(basePath)
        if (!cancelled) setAttachments(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath])

  const handleFiles = async (fileList) => {
    const files = [...fileList]
    if (files.length === 0) return
    if (attachments.length + files.length > MAX_ATTACHMENTS_PER_TASK) {
      setError(`일감당 첨부파일은 최대 ${MAX_ATTACHMENTS_PER_TASK}개입니다`)
      return
    }

    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_SIZE) {
          throw new Error(`${file.name}: 파일당 최대 20MB까지 업로드할 수 있어요`)
        }
        if (!isAllowedAttachmentExt(file.name)) {
          throw new Error(`${file.name}: 허용되지 않는 파일 형식입니다`)
        }
        const formData = new FormData()
        formData.append('file', file)
        const attachment = await apiUpload(basePath, formData)
        setAttachments((current) => [...current, attachment])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const remove = async (attachment) => {
    if (!window.confirm(`${attachment.fileName}을(를) 삭제할까요?`)) return
    try {
      await apiFetch(`${basePath}/${attachment.id}`, { method: 'DELETE' })
      setAttachments((current) => current.filter((a) => a.id !== attachment.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const download = async (attachment) => {
    try {
      await apiDownload(`${basePath}/${attachment.id}`, attachment.fileName)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          첨부파일 {attachments.length > 0 && `(${attachments.length})`}
        </h4>
        {canModify && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || attachments.length >= MAX_ATTACHMENTS_PER_TASK}
            className="text-xs text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400"
          >
            {uploading ? '업로드 중...' : '파일 추가'}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">불러오는 중...</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">첨부파일이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => download(attachment)}
                className="min-w-0 flex-1 truncate text-left text-gray-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
              >
                {attachment.fileName}
              </button>
              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                {formatFileSize(attachment.size)}
              </span>
              {canModify && (
                <button
                  type="button"
                  onClick={() => remove(attachment)}
                  className="shrink-0 text-xs text-red-600 hover:text-red-500 dark:text-red-400"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TaskAttachments
