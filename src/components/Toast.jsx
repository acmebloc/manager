import { useEffect, useState } from 'react'

const SLIDE_MS = 300
const HOLD_MS = 3000
const FADE_MS = 300

// Slides up from the bottom of the viewport, holds for HOLD_MS once the
// slide-up finishes, then fades out — caller unmounts via onDone. Keyed by
// the caller so a second toast while one is showing restarts the sequence
// instead of just relabeling the same instance.
function Toast({ message, onDone }) {
  const [phase, setPhase] = useState('enter') // enter -> visible -> leaving

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('visible'))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (phase !== 'visible') return
    const timer = setTimeout(() => setPhase('leaving'), SLIDE_MS + HOLD_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(onDone, FADE_MS)
    return () => clearTimeout(timer)
  }, [phase, onDone])

  return (
    <div
      className={`fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 transition-all ease-out ${
        phase === 'visible' ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      style={{ transitionDuration: `${phase === 'leaving' ? FADE_MS : SLIDE_MS}ms` }}
    >
      <div className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-gray-100 dark:text-gray-900">
        {message}
      </div>
    </div>
  )
}

export default Toast
