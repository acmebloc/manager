import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, apiUpload } from '../lib/api'
import { matchesKoreanQuery } from '../lib/korean'
import { formatFileSize, isAllowedExcelExt, MAX_ATTACHMENT_SIZE } from '../lib/uploads'

function toDateInputValue(iso) {
  return iso ? iso.slice(0, 10) : ''
}

function fromDateInputValue(value) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null
}

// server/src/lib/taskImport.js의 dedupeKey와 정확히 같은 공식 — 손으로 동기화
// (src/lib/uploads.js의 EXT_ALLOWLIST 복제와 같은 이유). 검수 화면에서 제목/
// 날짜를 인라인으로 고칠 때마다 서버를 다시 왕복하지 않고, 미리 받아둔 기존
// 일감 키 목록(existingTaskKeys)을 상대로 그 자리에서 다시 판정한다.
function dedupeKey(title, startAt, endAt) {
  if (!startAt || !endAt) return null
  return `${title.trim()} ${startAt} ${endAt}`
}

function isTitleMissing(row) {
  return !row.title.trim()
}

function isDateOrderInvalid(row) {
  return Boolean(row.startAt && row.endAt && row.startAt > row.endAt)
}

function isRowValid(row) {
  return !isTitleMissing(row) && !isDateOrderInvalid(row)
}

function isRowEdited(row) {
  const o = row.original
  return (
    row.title !== o.title ||
    row.startAt !== o.startAt ||
    row.endAt !== o.endAt ||
    row.assigneeId !== o.assigneeId ||
    row.createdById !== o.createdById
  )
}

// 프로젝트 멤버 중에서 이름으로 검색해 고르는 작은 콤보박스. TaskLinks.jsx의
// TaskPicker(로컬 배열 필터 + relative/absolute 드롭다운)와 같은 구조를 따르고,
// 검색어 매칭은 멘션 기능(MarkdownEditor.jsx)이 이미 쓰는 matchesKoreanQuery로
// 초성 검색까지 지원한다.
function MemberPicker({ members, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const selected = members.find((m) => m.userId === value)
  const filtered = useMemo(
    () => members.filter((m) => matchesKoreanQuery(m.name, query)).slice(0, 30),
    [members, query],
  )

  const pick = (userId) => {
    onChange(userId)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={open ? query : (selected?.name ?? '미배정')}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        placeholder="이름 검색"
        className="w-28 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-40 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <li>
            <button
              type="button"
              onClick={() => pick(null)}
              className="block w-full rounded px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              미배정
            </button>
          </li>
          {filtered.map((m) => (
            <li key={m.userId}>
              <button
                type="button"
                onClick={() => pick(m.userId)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-700"
              >
                {m.name}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500">일치하는 멤버 없음</li>
          )}
        </ul>
      )}
    </div>
  )
}

// TaskAttachments.jsx와 같은 업로드 패턴(숨김 input + apiUpload)을 쓰되, 즉시
// 저장하지 않고 프리뷰(검수) → 커밋 2단계로 나눈다. 업로드 직후 바로 검수 화면
// 하나로 들어가며, 중복/제목 누락 등은 그 화면 안에서 체크박스와 인라인 편집으로
// 사용자가 직접 정리한다(별도 확인 팝업 없음).
function TaskExcelImport({ projectId, onImported }) {
  const [rows, setRows] = useState(null)
  const [members, setMembers] = useState([])
  const [existingKeys, setExistingKeys] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const basePath = `/api/projects/${projectId}/tasks`

  const handleFile = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return
    setError('')
    if (!isAllowedExcelExt(file.name)) {
      setError(
        '엑셀 파일(.xlsx)만 업로드할 수 있습니다. 구버전(.xls) 파일은 Excel에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 변환한 뒤 업로드해주세요',
      )
      return
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setError(`파일은 최대 ${formatFileSize(MAX_ATTACHMENT_SIZE)}까지 업로드할 수 있어요`)
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await apiUpload(`${basePath}/import/preview`, formData)
      const keySet = new Set(data.existingTaskKeys)
      setExistingKeys(keySet)
      setMembers(data.members)
      setRows(
        data.rows.map((row) => {
          const original = {
            title: row.title,
            startAt: row.startAt,
            endAt: row.endAt,
            assigneeId: row.assigneeId,
            createdById: row.createdById,
          }
          const duplicate = keySet.has(dedupeKey(row.title, row.startAt, row.endAt))
          return { ...row, original, included: isRowValid(row) && !duplicate }
        }),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const cancel = () => {
    setRows(null)
    setError('')
  }

  const updateRow = (rowNumber, patch) => {
    setRows((current) => current.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row)))
  }

  const toggleIncluded = (rowNumber) => {
    setRows((current) =>
      current.map((row) => (row.rowNumber === rowNumber ? { ...row, included: !row.included } : row)),
    )
  }

  const toggleAll = (include) => {
    setRows((current) => current.map((row) => ({ ...row, included: include })))
  }

  const checkedRows = rows?.filter((row) => row.included) ?? []
  const invalidCheckedCount = checkedRows.filter((row) => !isRowValid(row)).length
  const canCommit = checkedRows.length > 0 && invalidCheckedCount === 0
  const allChecked = Boolean(rows && rows.length > 0 && checkedRows.length === rows.length)
  const duplicateCount =
    rows?.filter((row) => existingKeys.has(dedupeKey(row.title, row.startAt, row.endAt))).length ?? 0

  const commit = async () => {
    setCommitting(true)
    setError('')
    try {
      const payload = checkedRows.map((row) => ({
        rowNumber: row.rowNumber,
        title: row.title,
        startAt: row.startAt,
        endAt: row.endAt,
        assigneeId: row.assigneeId,
        createdById: row.createdById,
      }))
      const data = await apiFetch(`${basePath}/import/commit`, { method: 'POST', body: { rows: payload } })
      setRows(null)
      onImported?.()
      // 등록 결과는 화면에 계속 남기지 않고, 사용자가 확인 버튼을 눌러야 닫히는
      // 알럿으로 확실히 인지시킨다. 실패가 있으면 몇 건인지뿐 아니라 어느 행이
      // 왜 실패했는지도 같이 보여준다 — rowNumber를 payload에 실어 보내야 서버가
      // failed[]에 그 값을 그대로 되돌려줄 수 있다.
      const failedDetail = data.failed
        .map((f) => `${f.rowNumber ?? '?'}행: ${f.error}`)
        .join('\n')
      window.alert(
        `${data.created.length}건 등록되었습니다${
          data.failed.length > 0 ? `\n\n실패 ${data.failed.length}건\n${failedDetail}` : ''
        }`,
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-50 dark:text-gray-500 dark:hover:text-gray-300"
      >
        {uploading ? '분석 중…' : '엑셀로 일감 등록(.xlsx 파일만 가능)'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(event) => handleFile(event.target.files)}
      />

      {!rows && error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {rows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800">
            <h3 className="shrink-0 text-base font-semibold text-gray-900 dark:text-white">
              엑셀 업로드 검수 — {rows.length}행 중 {checkedRows.length}건 체크됨
              {duplicateCount > 0 && ` · 기존 일감과 중복 ${duplicateCount}건`}
            </h3>
            <p className="mb-3 shrink-0 text-xs text-gray-500 dark:text-gray-400">
              체크한 일감만 등록됩니다. 제목·날짜·담당자·작성자는 셀에서 바로 고칠 수 있습니다.
            </p>

            <div className="overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400">
                    <th className="w-8 pb-2 pr-2">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => toggleAll(!allChecked)}
                        title="체크한 항목만 등록됩니다"
                      />
                    </th>
                    <th className="pb-2 pr-3">제목</th>
                    <th className="pb-2 pr-3">시작일</th>
                    <th className="pb-2 pr-3">종료일</th>
                    <th className="pb-2 pr-3">담당자</th>
                    <th className="pb-2 pr-3">작성자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const duplicate = existingKeys.has(dedupeKey(row.title, row.startAt, row.endAt))
                    const edited = isRowEdited(row)
                    const assigneeTouched = row.assigneeId !== row.original.assigneeId
                    const createdByTouched = row.createdById !== row.original.createdById
                    const dateOrderInvalid = isDateOrderInvalid(row)
                    const titleMissing = isTitleMissing(row)

                    return (
                      <tr
                        key={row.rowNumber}
                        className={`border-t border-gray-100 align-top dark:border-gray-700 ${
                          duplicate ? 'bg-amber-50 dark:bg-amber-900/20' : ''
                        } ${row.included ? '' : 'opacity-50'}`}
                      >
                        <td className="py-2 pr-2 pt-3">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={() => toggleIncluded(row.rowNumber)}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={row.title}
                            onChange={(event) => updateRow(row.rowNumber, { title: event.target.value })}
                            className={`w-full min-w-[220px] rounded border px-1.5 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-white ${
                              titleMissing ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                            }`}
                          />
                          <div className="mt-1 flex flex-wrap gap-1">
                            {duplicate && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                기존 일감과 중복
                              </span>
                            )}
                            {edited && (
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                수정됨
                              </span>
                            )}
                          </div>
                          {titleMissing && (
                            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">제목을 입력해주세요</p>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="date"
                            value={toDateInputValue(row.startAt)}
                            onChange={(event) =>
                              updateRow(row.rowNumber, { startAt: fromDateInputValue(event.target.value) })
                            }
                            className={`w-[130px] rounded border px-1.5 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-white ${
                              dateOrderInvalid ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                            }`}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="date"
                            value={toDateInputValue(row.endAt)}
                            onChange={(event) =>
                              updateRow(row.rowNumber, { endAt: fromDateInputValue(event.target.value) })
                            }
                            className={`w-[130px] rounded border px-1.5 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-white ${
                              dateOrderInvalid ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                            }`}
                          />
                          {dateOrderInvalid && (
                            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                              시작일은 종료일보다 늦을 수 없습니다
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <MemberPicker
                            members={members}
                            value={row.assigneeId}
                            onChange={(userId) => updateRow(row.rowNumber, { assigneeId: userId })}
                          />
                          {!assigneeTouched && !row.assigneeId && row.assigneeLabel && (
                            <p className="mt-1 w-28 text-[10px] text-amber-600 dark:text-amber-400">
                              엑셀 값 '{row.assigneeLabel}' 매칭 실패
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <MemberPicker
                            members={members}
                            value={row.createdById}
                            onChange={(userId) => updateRow(row.rowNumber, { createdById: userId })}
                          />
                          {!createdByTouched && row.createdByFallback && (
                            <p className="mt-1 w-28 text-[10px] text-gray-500 dark:text-gray-400">PM 자동 배정</p>
                          )}
                          {!createdByTouched && !row.createdById && !row.createdByFallback && row.createdByLabel && (
                            <p className="mt-1 w-28 text-[10px] text-amber-600 dark:text-amber-400">
                              엑셀 값 '{row.createdByLabel}' 매칭 실패
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                  엑셀에서 읽을 수 있는 행이 없습니다.
                </p>
              )}
            </div>

            {error && <p className="mt-3 shrink-0 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {invalidCheckedCount > 0 && (
              <p className="mt-3 shrink-0 text-xs text-red-600 dark:text-red-400">
                빨간색으로 표시된 항목을 수정하거나 체크를 해제해주세요 ({invalidCheckedCount}건)
              </p>
            )}

            <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
              <button
                type="button"
                onClick={cancel}
                disabled={committing}
                className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
              >
                취소
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={committing || !canCommit}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {committing ? '등록 중…' : `${checkedRows.length}건 등록`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default TaskExcelImport
