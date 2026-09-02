import ExcelJS from 'exceljs'

// Rendering helpers for the project export routes (routes/projectExport.js).
// No CSV/HTML-generation library exists elsewhere in this codebase, so both
// are hand-rolled here — see docs/project-export-spec.md §4 for why each
// format is built the way it is.

function cellText(value) {
  return value == null ? '' : String(value)
}

// Excel/한글 프로그램이 BOM 없는 UTF-8 CSV를 열면 한글이 깨지므로 BOM을 붙인다.
// RFC 4180: 콤마/줄바꿈/따옴표가 든 값은 셀 전체를 따옴표로 감싸고 내부 따옴표는
// 두 번 반복한다 — 참조자를 콤마로 합친 셀(projectExport.js)이 여기 해당한다.
const UTF8_BOM = '\uFEFF'

// CSV/수식 삽입(CWE-1236) 방지: 셀 값이 =, +, -, @로 시작하면 엑셀/시트 프로그램이
// 텍스트가 아니라 수식으로 해석해 실행할 수 있다(RFC4180 콤마/따옴표 이스케이프와는
// 별개 문제 — 그건 셀 구분 방식만 다룰 뿐 내용이 수식으로 읽히는 것은 못 막는다).
// 업계 표준 대응은 그런 셀 앞에 작은따옴표를 붙여 리터럴 텍스트로 강제하는 것.
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@'])

function neutralizeFormula(text) {
  return FORMULA_TRIGGER_CHARS.has(text[0]) ? `'${text}` : text
}

function escapeCsvCell(value) {
  const text = neutralizeFormula(cellText(value))
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','))
  }
  return UTF8_BOM + lines.join('\r\n')
}

function escapeHtml(value) {
  return cellText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 별도 스타일 없는 순수 테이블 구조(spec §4) — 사용자 입력값(제목 등)은 반드시
// escapeHtml을 거쳐야 한다. 빠뜨리면 다운로드한 파일을 열 때 삽입된 문자열이
// 마크업/스크립트로 해석되는 저장형 XSS가 된다.
export function buildHtmlTable(title, headers, rows) {
  const headerRow = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const bodyRows = rows
    .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`)
    .join('\n')
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<table border="1">
<thead><tr>${headerRow}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
</body>
</html>
`
}

// exceljs는 이 코드베이스에서 지금까지 읽기(taskImport.js)로만 검증됐고, 쓰기
// 경로는 이 기능에서 처음 쓴다(spec 배경 문단). 날짜/서식 문제를 아예 피하려고
// 셀 값은 전부 이미 포맷된 문자열로 받는다 — CSV/HTML과 동일한 값을 쓰므로
// 세 포맷의 표시가 서로 어긋나지 않는다.
export async function buildXlsxBuffer(sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(headers)
  for (const row of rows) {
    sheet.addRow(headers.map((header) => cellText(row[header])))
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
