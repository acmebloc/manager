import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white dark:bg-gray-900">
      <h1 className="text-4xl font-semibold text-gray-900 dark:text-white">
        acmebloc-manager
      </h1>
      <p className="text-gray-500 dark:text-gray-400">
        React + Vite + Tailwind CSS 세팅 완료
      </p>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500"
      >
        Count is {count}
      </button>
    </div>
  )
}

export default App
