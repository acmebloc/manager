import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import '@mdxeditor/editor/style.css'
import Layout from './components/Layout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MyPage from './pages/MyPage.jsx'
import ProjectsPage from './pages/ProjectsPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import TaskBoardPage from './pages/TaskBoardPage.jsx'
import TasksPage from './pages/TasksPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id/board" element={<TaskBoardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/mypage" element={<MyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
