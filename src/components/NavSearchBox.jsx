import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

// 검색결과 페이지에 있을 때는 입력창에 지금 검색어를 반영해 바로 수정할 수
// 있게 하고, 그 외 페이지에서는 항상 빈 채로 시작한다.
function NavSearchBox() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const currentQuery = searchParams.get('q') || ''
  const [value, setValue] = useState('')

  // currentQuery(문자열)가 아니라 searchParams(객체) 전체에 의존하면, 검색
  // 페이지에서 정렬·페이지만 바꿔도(q는 그대로여도) useSearchParams가 매번 새
  // 객체를 돌려줘 이 effect가 다시 돌면서 사용자가 아직 제출 안 하고 입력
  // 중이던 글자를 URL의 q로 덮어써버린다.
  useEffect(() => {
    setValue(location.pathname === '/search' ? currentQuery : '')
  }, [location.pathname, currentQuery])

  const submit = (event) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm items-center">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="프로젝트, 일감, 일정, 사용자 검색"
        className="w-full rounded-l-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
      />
      <button
        type="submit"
        className="shrink-0 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
      >
        검색
      </button>
    </form>
  )
}

export default NavSearchBox
