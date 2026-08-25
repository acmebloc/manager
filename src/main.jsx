import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
// @mdxeditor/editor pulls in @lexical/code (for its markdown import/export
// pipeline, even though we don't use codeBlockPlugin), which depends on
// prismjs. Prism's own language files assume a global `Prism` set up by its
// core — imported here, first, so that side effect runs before anything else
// in the bundle touches it (production build crashed the whole app on load
// otherwise: "Uncaught ReferenceError: Prism is not defined").
import 'prismjs'
import './index.css'
import '@mdxeditor/editor/style.css'
import Layout from './components/Layout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import MyPage from './pages/MyPage.jsx'
import ProjectsPage from './pages/ProjectsPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import TaskFormPage from './pages/TaskFormPage.jsx'
import TasksPage from './pages/TasksPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:projectId/new" element={<TaskFormPage />} />
          <Route path="/tasks/:projectId/:taskId" element={<TaskFormPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/mypage" element={<MyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
