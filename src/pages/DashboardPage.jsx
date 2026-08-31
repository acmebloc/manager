import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

// 홈 = 소속 프로젝트나 할당된 일감이 없어도 볼 수 있는, 이 서비스가 뭘
// 제공하는지 보여주는 개요판. "내 것" 위젯이 아니라 기능 안내 + 서비스
// 전체 러프 통계로 구성한다.
const FEATURES = [
  { to: '/projects', title: '프로젝트', description: '프로젝트를 만들고 멤버와 등급을 관리합니다.' },
  { to: '/tasks', title: '일감', description: '프로젝트별 일감을 등록하고 진행 상태를 관리합니다.' },
  { to: '/schedule', title: '일정', description: '개인 일정과 프로젝트 일정을 캘린더로 확인합니다.' },
  { to: '/board', title: '게시판', description: '프로젝트별 공간과 문서함에서 자료를 관리합니다.', external: true },
  { to: '/mypage', title: '마이페이지', description: '프로필과 이메일 알림 설정을 관리합니다.' },
]

const STATUS_ORDER = ['todo', 'doing', 'review', 'done']
const STATUS_LABELS = { todo: '대기', doing: '진행중', review: '검토', done: '완료' }
// 대기→진행중→검토→완료는 순서를 바꾸면 의미가 달라지는 진행 단계(ordinal)라,
// 서로 다른 색(범주형) 대신 파랑 한 가지 색조의 명도 단계로 순서를 표현한다.
// 다크 모드는 어두운 배경에서 옅은 단계가 묻히지 않도록 명도 순서를 뒤집는다
// (배경이 밝을 땐 옅은 색이, 어두울 땐 짙은 색이 표면에 묻힌다).
const STATUS_COLORS = {
  todo: 'bg-[#86b6ef] dark:bg-[#1c5cab]',
  doing: 'bg-[#5598e7] dark:bg-[#2a78d6]',
  review: 'bg-[#2a78d6] dark:bg-[#5598e7]',
  done: 'bg-[#184f95] dark:bg-[#86b6ef]',
}

const cardClassName = 'rounded-lg border border-gray-200 p-4 dark:border-gray-700'

function TaskStatusBar({ counts, total }) {
  if (total === 0) {
    return <div className="mt-2 h-2.5 rounded-full bg-gray-100 dark:bg-gray-700" />
  }
  return (
    <div className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
      {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <div
          key={status}
          className={STATUS_COLORS[status]}
          style={{ flex: counts[status] }}
          title={`${STATUS_LABELS[status]} ${counts[status]}개`}
        />
      ))}
    </div>
  )
}

// 프로젝트 수/일정 건수처럼 시각화할 형태가 마땅치 않은 순수 숫자 지표엔,
// 대신 값이 로드될 때 0에서 목표값까지 짧게 세어 올라가는 인터랙션을 준다.
// prefers-reduced-motion이면 애니메이션 없이 바로 최종값을 보여준다.
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      fromRef.current = target
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let frame
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - progress) ** 3 // ease-out — 도착할수록 느려진다
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return value
}

function CountUp({ value }) {
  return useCountUp(value).toLocaleString('ko-KR')
}

function FeatureCard({ feature }) {
  const content = (
    <>
      <h3 className="text-base font-medium text-gray-900 dark:text-white">{feature.title}</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{feature.description}</p>
    </>
  )
  const className = `block ${cardClassName} hover:border-indigo-300 dark:hover:border-indigo-600`

  return feature.external ? (
    <a href={feature.to} className={className}>
      {content}
    </a>
  ) : (
    <Link to={feature.to} className={className}>
      {content}
    </Link>
  )
}

function StatCard({ label, value, unit, children }) {
  return (
    <div className={cardClassName}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
        <CountUp value={value} />
        {unit}
      </p>
      {children}
    </div>
  )
}

function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/dashboard/stats')
        if (!cancelled) setStats(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8">
      <section>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.to}>
              <FeatureCard feature={feature} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">전체 현황</h3>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {stats && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="전체 프로젝트" value={stats.projectCount} unit="개" />
            <StatCard label="전체 일감" value={stats.taskTotal} unit="개">
              <TaskStatusBar counts={stats.tasksByStatus} total={stats.taskTotal} />
              <div className="mt-2 flex flex-wrap gap-2">
                {STATUS_ORDER.map((status) => (
                  <span
                    key={status}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
                  >
                    <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]}`} />
                    {STATUS_LABELS[status]} {stats.tasksByStatus[status] ?? 0}
                  </span>
                ))}
              </div>
            </StatCard>
            <StatCard label="이번 주 일정" value={stats.thisWeekScheduleCount} unit="건" />
            <StatCard label="게시판 문서" value={stats.publishedPageCount} unit="개" />
          </div>
        )}
      </section>
    </div>
  )
}

export default DashboardPage
