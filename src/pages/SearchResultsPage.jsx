import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const SORT_OPTIONS = [
  { value: 'relevance', label: '관련도순' },
  { value: 'latest', label: '최신순' },
]

const LABEL_STYLES = {
  프로젝트: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  일감: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  댓글: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  첨부파일: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
  일정: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  사용자: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
}

function ResultLabel({ label }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        LABEL_STYLES[label] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      }`}
    >
      {label}
    </span>
  )
}

function containsQuery(text, query) {
  return Boolean(text) && text.toLowerCase().includes(query.toLowerCase())
}

// 검색어가 실제로 들어있는 부분만 강조 표시한다 — 댓글처럼 제목(일감/프로젝트
// 이름)엔 검색어가 없고 스니펫에만 있는 경우, 항상 제목을 굵게 표시하면
// 정작 매치된 텍스트가 안 보이므로 이걸로 대신 찾아 보여준다.
function highlightMatch(text, query) {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-indigo-50 px-0.5 font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// 사용자 결과는 링크 없는 단순 텍스트(프로필 이미지+이름+이메일)로,
// 그 외는 각자의 화면으로 이동하는 카드로 렌더링한다. 굵게 강조되는 자리는
// 항상 검색어가 실제로 들어있는 필드다 — 댓글처럼 title(일감/프로젝트 이름)엔
// 검색어가 없고 snippet에만 있으면 snippet을 앞으로 당겨 강조한다.
function ResultCard({ item, query }) {
  const titleHasMatch = containsQuery(item.title, query)
  const primaryText = titleHasMatch || !item.snippet ? item.title : item.snippet
  const secondaryText = titleHasMatch || !item.snippet ? item.snippet : item.title

  const inner = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ResultLabel label={item.label} />
      {item.kind === 'user' && (
        <img
          src={item.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-6 w-6 shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-700"
        />
      )}
      <span className="max-w-[50%] shrink-0 truncate text-sm font-medium text-gray-900 dark:text-white">
        {highlightMatch(primaryText, query)}
      </span>
      {secondaryText && (
        <>
          <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
          <span className="min-w-0 shrink truncate text-sm text-gray-500 dark:text-gray-400">
            {highlightMatch(secondaryText, query)}
          </span>
        </>
      )}
      {item.meta && (
        <>
          <span className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
          <span className="max-w-[25%] shrink-0 truncate text-xs text-gray-400 dark:text-gray-500">
            {item.meta}
          </span>
        </>
      )}
    </div>
  )

  const cardClassName = 'rounded-lg border border-gray-200 p-3 dark:border-gray-700'

  if (!item.link) return <div className={cardClassName}>{inner}</div>

  return (
    <Link to={item.link} className={`block ${cardClassName} hover:border-indigo-300 dark:hover:border-indigo-600`}>
      {inner}
    </Link>
  )
}

function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const sort = searchParams.get('sort') === 'latest' ? 'latest' : 'relevance'
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!q) {
      setData({ total: 0, pageSize: 30, results: [] })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const result = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&sort=${sort}&page=${page}`)
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [q, sort, page])

  // 정렬을 바꾸면 1페이지로 되돌아간다 — 이전 정렬 기준의 마지막 페이지
  // 번호가 새 정렬에서는 범위 밖일 수 있다.
  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    if (key !== 'page') next.delete('page')
    setSearchParams(next)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || 30))) : 1

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-8">
      <h2 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-white">검색 결과</h2>
      <p className="mb-6 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        해당 검색결과는 게시판 콘텐츠를 포함하고 있지 않습니다. 게시판 콘텐츠 검색은 게시판 메뉴에서 검색을
        부탁드립니다.
      </p>

      {!q ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">검색어를 입력해주세요.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">&quot;{q}&quot;</span> 검색 결과
            </p>
            <select
              value={sort}
              onChange={(event) => updateParam('sort', event.target.value)}
              className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!loading && data && (
            <>
              {data.results.length === 0 ? (
                <p className="py-12 text-center text-gray-500 dark:text-gray-400">검색 결과가 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.results.map((item) => (
                    <li key={item.id}>
                      <ResultCard item={item} query={q} />
                    </li>
                  ))}
                </ul>
              )}

              {data.total > 0 && (
                <div className="mt-4 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>총 {data.total}건</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => updateParam('page', String(page - 1))}
                      className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
                    >
                      이전
                    </button>
                    <span>
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => updateParam('page', String(page + 1))}
                      className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default SearchResultsPage
