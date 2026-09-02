import JSZip from 'jszip'
import { Router } from 'express'
import { prisma } from '../db.js'
import { buildCsv, buildHtmlTable, buildXlsxBuffer } from '../lib/exportFormats.js'
import { requireProjectRole } from '../lib/projectAccess.js'
import {
  countScheduleRows,
  countTaskRows,
  loadScheduleExportData,
  loadTaskExportData,
  scheduleToJsonRow,
  scheduleToTableRow,
  SCHEDULE_TABLE_HEADERS,
  taskToJsonRow,
  taskToTableRow,
  TASK_TABLE_HEADERS,
} from '../lib/projectExport.js'

// Mounted at /api/projects/:projectId/export — docs/project-export-spec.md
// is the design doc this implements.
const router = Router({ mergeParams: true })

const FORMATS = ['csv', 'xlsx', 'html', 'json']
const SCOPES = ['all', 'tasks', 'schedules']
const SCOPE_LABELS = { all: '전체', tasks: '일감', schedules: '일정' }

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  zip: 'application/zip',
}

// 한 요청이 실제로 만들어내는 행 수가 이 값을 넘으면 막는다(spec §5) —
// 실사용 데이터가 쌓이기 전이라 판단 근거가 부족해 넉넉하게 잡아둔 임시값이다.
// 실측 후 조정할 것. scope=all(일감+일정 합계), scope=tasks(일감만),
// scope=schedules(일정만 — 병합된 일감 포함) 전부 같은 기준으로 검사한다 —
// 애초에 위험한 건 "한 응답 안에서 CPU 바운드로 만들어내는 총 행 수"이지
// "몇 개의 스코프를 골랐는가"가 아니므로, 개별 다운로드라고 예외를 둘 이유가
// 없다(처음엔 scope=all에만 적용했다가 감사에서 지적받아 통일함).
const EXPORT_ROW_LIMIT = 2000

// 파일 시스템에서 문제되는 문자(Windows 예약 문자 포함)를 밑줄로 바꾸고,
// 지나치게 긴 이름은 잘라낸다 — 프로젝트명은 길이 제한 없이 자유롭게 지을 수
// 있어서(projects.js는 공백 여부만 검사), 그대로 다운로드 파일명/zip 내부
// 항목명에 쓰면 프록시의 헤더 크기 제한에 걸리거나 OS 경로 길이 제한을 넘길
// 수 있다.
const MAX_FILENAME_PROJECT_PART = 100

function sanitizeForFileName(name) {
  const cleaned = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim()
  return (cleaned || 'project').slice(0, MAX_FILENAME_PROJECT_PART)
}

function contentDisposition(fileName) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

async function buildFile(format, { headers, tableRows, jsonRows, sheetName, htmlTitle, part }) {
  if (format === 'csv') return { body: buildCsv(headers, tableRows), ext: 'csv' }
  if (format === 'xlsx') return { body: await buildXlsxBuffer(sheetName, headers, tableRows), ext: 'xlsx' }
  if (format === 'html') return { body: buildHtmlTable(htmlTitle, headers, tableRows), ext: 'html' }
  return {
    body: JSON.stringify(
      { schemaVersion: '1.0', exportedAt: new Date().toISOString(), scope: part, items: jsonRows },
      null,
      2,
    ),
    ext: 'json',
  }
}

// scope별로 실제 생성될 행 수를 추정해 EXPORT_ROW_LIMIT과 비교한다. countTaskRows/
// countScheduleRows(projectExport.js)는 "일정" 파일에 날짜 있는 일감이 병합되는
// 것까지 반영한 정확한 추정치를 준다 — 한 번은 raw Schedule 건수만 셌다가 실제
// 출력 행 수를 과소평가하는 버그가 있었다(감사에서 발견, 수정됨).
async function estimateRowCount(projectId, scope) {
  if (scope === 'tasks') return countTaskRows(projectId)
  if (scope === 'schedules') return countScheduleRows(projectId)
  const [taskCount, scheduleCount] = await Promise.all([countTaskRows(projectId), countScheduleRows(projectId)])
  return taskCount + scheduleCount
}

const SIZE_LIMIT_MESSAGES = {
  all: '일감과 일정을 합친 데이터가 많아 한 번에 받을 수 없습니다. 일감/일정을 각각 나눠서 받아주세요.',
  tasks: '일감 데이터가 많아 한 번에 받을 수 없습니다.',
  schedules: '일정 데이터가 많아 한 번에 받을 수 없습니다.',
}

router.get('/', requireProjectRole('member'), async (req, res) => {
  const { scope, format } = req.query
  if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'Invalid scope' })
  if (!FORMATS.includes(format)) return res.status(400).json({ error: 'Invalid format' })

  const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, select: { name: true } })
  const rawProjectName = project?.name || ''
  const projectName = sanitizeForFileName(rawProjectName)
  const stamp = todayStamp()

  const rowCount = await estimateRowCount(req.params.projectId, scope)
  if (rowCount > EXPORT_ROW_LIMIT) {
    return res.status(413).json({ error: SIZE_LIMIT_MESSAGES[scope] })
  }

  if (scope === 'all') {
    const [tasks, schedules] = await Promise.all([
      loadTaskExportData(req.params.projectId, rawProjectName),
      loadScheduleExportData(req.params.projectId, rawProjectName),
    ])
    const [taskFile, scheduleFile] = await Promise.all([
      buildFile(format, {
        headers: TASK_TABLE_HEADERS,
        tableRows: tasks.map(taskToTableRow),
        jsonRows: tasks.map(taskToJsonRow),
        sheetName: '일감',
        htmlTitle: `${projectName} 일감`,
        part: 'tasks',
      }),
      buildFile(format, {
        headers: SCHEDULE_TABLE_HEADERS,
        tableRows: schedules.map(scheduleToTableRow),
        jsonRows: schedules.map(scheduleToJsonRow),
        sheetName: '일정',
        htmlTitle: `${projectName} 일정`,
        part: 'schedules',
      }),
    ])

    // 어떤 형식이든 일감/일정은 항상 별도 파일로 두고 zip으로만 묶는다 — 워크북
    // 시트 통합 등 파일 하나로 합치는 방식은 쓰지 않는다(spec §1, 확정 사항).
    const zip = new JSZip()
    zip.file(`${projectName}_일감_${stamp}.${taskFile.ext}`, taskFile.body)
    zip.file(`${projectName}_일정_${stamp}.${scheduleFile.ext}`, scheduleFile.body)
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    res.set('Content-Type', CONTENT_TYPES.zip)
    res.set('Content-Disposition', contentDisposition(`${projectName}_전체_${stamp}.zip`))
    return res.send(zipBuffer)
  }

  const isTasks = scope === 'tasks'
  const data = isTasks
    ? await loadTaskExportData(req.params.projectId, rawProjectName)
    : await loadScheduleExportData(req.params.projectId, rawProjectName)
  const file = await buildFile(format, {
    headers: isTasks ? TASK_TABLE_HEADERS : SCHEDULE_TABLE_HEADERS,
    tableRows: isTasks ? data.map(taskToTableRow) : data.map(scheduleToTableRow),
    jsonRows: isTasks ? data.map(taskToJsonRow) : data.map(scheduleToJsonRow),
    sheetName: SCOPE_LABELS[scope],
    htmlTitle: `${projectName} ${SCOPE_LABELS[scope]}`,
    part: scope,
  })

  res.set('Content-Type', CONTENT_TYPES[format])
  res.set('Content-Disposition', contentDisposition(`${projectName}_${SCOPE_LABELS[scope]}_${stamp}.${file.ext}`))
  res.send(file.body)
})

export default router
