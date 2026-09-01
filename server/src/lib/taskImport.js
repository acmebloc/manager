import JSZip from 'jszip'

// Excel → Task 일괄 등록의 헤더 매핑/행 파싱/이름 매칭을 담당한다. 라우트
// (routes/tasks.js의 /import/preview, /import/commit)는 이 모듈을 얇게 감싸기만
// 하고, DB에는 전혀 접근하지 않는다 — 프로젝트 멤버 목록은 호출부가 이미
// 복호화해서 넘겨준다.

export const MAX_IMPORT_ROWS = 500

// Excel 표준 시리얼 날짜 변환(1900 날짜 체계). exceljs 자신의 excelToDate가 쓰는
// 것과 동일한 공식(1900년을 윤년으로 잘못 취급하는 엑셀의 유명한 버그까지 포함해
// 25569를 더함)이라, 여기서 만든 값을 나중에 exceljs가 다시 디코딩해도 정확히
// 같은 날짜로 돌아온다.
function dateToExcelSerial(date) {
  return 25569 + date.getTime() / (24 * 3600 * 1000)
}

// exceljs 4.4.0(2023년 이후 사실상 유지보수 종료)은 OOXML의 ISO-8601 날짜 셀
// 타입(`t="d"`, 스펙상 유효하지만 흔치 않은 표현)을 아예 처리하지 못한다 —
// node_modules/exceljs/lib/xlsx/xform/sheet/cell-xform.js의 parseClose가
// t==='d' 케이스가 없어 default 분기로 떨어져 `parseFloat("2026-10-01")`을
// 그대로 실행해버리고, 하이픈에서 끊겨 2026이라는 완전히 엉뚱한 "시리얼 값"이
// 되고, 그걸 다시 날짜로 변환하면서 1905년 근처의 엉뚱한 날짜가 나온다(실제로
// Mac Excel에서 만든 .xls를 다시 xlsx로 저장했을 때 이 형식으로 나오는 걸
// 확인함). exceljs에 로드를 맡기기 전에 그런 셀만 미리 표준 숫자 시리얼로
// 바꿔치기해 이 버그를 피해간다. 시트가 정상 포맷(순수 숫자 시리얼)이면 아무
// 것도 바뀌지 않고 원본 버퍼를 그대로 돌려준다.
export async function normalizeIsoDateCells(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const sheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))

  let changed = false
  for (const name of sheetFiles) {
    const xml = await zip.file(name).async('string')
    // t="d" 셀이 수식 결과인 경우 <v> 앞에 <f>...</f>가 먼저 온다 — 그것도
    // 건너뛰고 매칭해야 그런 셀도 정규화된다.
    const rewritten = xml.replace(/(<c\b[^>]*\bt="d"[^>]*>)(?:<f[^>]*>[\s\S]*?<\/f>)?<v>([^<]+)<\/v>/g, (match, openTag, isoText) => {
      const date = new Date(isoText)
      if (Number.isNaN(date.getTime())) return match
      changed = true
      return `${openTag.replace(/\st="d"/, '')}<v>${dateToExcelSerial(date)}</v>`
    })
    if (rewritten !== xml) zip.file(name, rewritten)
  }

  if (!changed) return buffer
  return zip.generateAsync({ type: 'nodebuffer' })
}

const HEADER_SYNONYMS = {
  title: ['제목', '업무명', '일감명'],
  startAt: ['시작일', '시작날짜'],
  endAt: ['종료일', '마감일', '종료날짜'],
  createdBy: ['작성자', '등록자'],
  assignee: ['담당자'],
}

// exceljs 셀 값은 문자열/숫자/Date/서식 객체({richText, formula 결과 등})로 들어올
// 수 있어, 어떤 형태든 사람이 입력한 텍스트로 환원한다. 수식이 #DIV/0! 같은
// 에러로 끝나면 result가 {error: '...'} 객체라 richText/result/text 중 어느
// 것도 못 찾고 String(value)까지 떨어지는데, 일반 객체의 String()은 그냥
// "[object Object]"라 이 값이 그대로 제목 등에 들어갈 뻔했다 — 빈 값으로 취급.
function cellText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('')
    if (value.result !== undefined) return cellText(value.result)
    if (value.error !== undefined) return ''
    if (value.text !== undefined) return String(value.text)
  }
  return String(value)
}

function parseDateCell(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && value.result !== undefined) return parseDateCell(value.result)
  const text = cellText(value).trim()
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// 헤더 행(exceljs Row)을 훑어 필드별 열 번호를 찾는다. '제목'은 이 기능이 성립하기
// 위한 최소 요건이라 못 찾으면 그 자리에서 예외를 던져 프리뷰 자체를 막는다.
export function buildHeaderMap(headerRow) {
  const map = {}
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell.value).trim()
    if (!text) return
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (map[field] === undefined && synonyms.includes(text)) {
        map[field] = colNumber
      }
    }
  })
  if (map.title === undefined) {
    throw new Error("필수 헤더 '제목'을 찾을 수 없습니다")
  }
  return map
}

function normalizeName(name) {
  return name.trim().toLowerCase()
}

// rawName이 프로젝트 멤버 중 정확히 한 명과 이름이 일치하면 그 사람을 반환한다.
// 이름이 암호화되어 저장되므로 SQL 매칭이 불가능해, 호출부가 미리 복호화해 넘긴
// members 배열을 대상으로 애플리케이션 레벨에서 비교한다(동명이인이면 모호하다고
// 보고 매칭하지 않는다 — 유니크 제약이 없는 값이라 잘못 짚느니 미배정이 안전하다).
export function resolveMemberByName(members, rawValue) {
  const text = cellText(rawValue).trim()
  if (!text) return { userId: null, label: null, reason: 'empty' }

  const norm = normalizeName(text)
  const matches = members.filter((m) => normalizeName(m.user.name) === norm)
  if (matches.length === 1) return { userId: matches[0].userId, label: matches[0].user.name, reason: null }
  if (matches.length === 0) return { userId: null, label: text, reason: 'not_found' }
  return { userId: null, label: text, reason: 'ambiguous' }
}

// PM으로 가장 먼저 등록된 멤버 — "관례상 가장 자연스러운 원래 PM"을 작성자
// 미기재 행의 기본 등록자로 쓰기 위함(프로젝트는 PM이 여러 명일 수 있음).
export function firstPm(members) {
  const pms = members.filter((m) => m.role === 'pm')
  if (pms.length === 0) return null
  return pms.reduce((earliest, m) => (m.createdAt < earliest.createdAt ? m : earliest))
}

// 헤더 다음 행부터 끝까지 순회해 미리보기/등록에 쓸 행 목록을 만든다. DB 쓰기는
// 전혀 하지 않고, 매칭 실패는 해당 필드만 비우고 경고만 남긴다(행 자체는 그대로
// 살려서 등록 대상에 포함시킨다) — 완전히 빈 행은 결과에 아예 포함하지 않는다.
// 제목이 비었거나 시작일>종료일이어도 여기서는 그대로 통과시킨다 — 검수 화면에서
// 인라인으로 고칠 수 있으니, 무엇이 왜 문제인지는 프리뷰 UI가 그 자리에서
// 실시간으로 보여주는 쪽이 파싱 시점에 조용히 null로 지우는 것보다 낫다.
export function parseImportRows(worksheet, headerMap, members) {
  const rows = []
  const lastRowNumber = worksheet.lastRow ? worksheet.lastRow.number : 1

  for (let rowNumber = 2; rowNumber <= lastRowNumber; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    // actualCellCount === 0은 "셀을 한 번도 건드린 적 없는" 행만 걸러낸다 —
    // 수식이 빈 문자열로 계산되거나 입력 후 지워진 셀은 값이 ''인 채로
    // 여전히 "존재하는" 셀(ValueType.String)이라 여기 안 걸린다. 그래서 매핑된
    // 5개 열을 실제로 다 읽어본 뒤에도 전부 비어 있을 때만 건너뛴다.
    if (row.actualCellCount === 0) continue

    const titleText = cellText(row.getCell(headerMap.title).value).trim()
    const warnings = []

    const startAt = headerMap.startAt ? parseDateCell(row.getCell(headerMap.startAt).value) : null
    const endAt = headerMap.endAt ? parseDateCell(row.getCell(headerMap.endAt).value) : null

    const assigneeCell = headerMap.assignee ? row.getCell(headerMap.assignee).value : null
    const assigneeText = cellText(assigneeCell).trim()
    const createdByCell = headerMap.createdBy ? row.getCell(headerMap.createdBy).value : null
    const createdByText = cellText(createdByCell).trim()

    if (!titleText && !startAt && !endAt && !assigneeText && !createdByText) continue

    const assigneeResolved = resolveMemberByName(members, assigneeCell)
    if (assigneeResolved.reason === 'not_found') {
      warnings.push(`담당자 '${assigneeResolved.label}'을(를) 프로젝트 멤버에서 찾을 수 없어 미배정 처리했습니다`)
    } else if (assigneeResolved.reason === 'ambiguous') {
      warnings.push(`담당자 '${assigneeResolved.label}'과(와) 이름이 같은 멤버가 여러 명이라 미배정 처리했습니다`)
    }

    let createdByResolved = resolveMemberByName(members, createdByCell)
    let createdByFallback = false
    if (createdByResolved.reason === 'empty') {
      const pm = firstPm(members)
      createdByResolved = pm
        ? { userId: pm.userId, label: pm.user.name, reason: null }
        : { userId: null, label: null, reason: 'empty' }
      createdByFallback = Boolean(pm)
      if (!pm) warnings.push('작성자가 비어 있고 이 프로젝트에는 PM이 없어 자동 배정하지 못했습니다')
    } else if (createdByResolved.reason === 'not_found') {
      warnings.push(`작성자 '${createdByResolved.label}'을(를) 프로젝트 멤버에서 찾을 수 없어 미배정 처리했습니다`)
    } else if (createdByResolved.reason === 'ambiguous') {
      warnings.push(`작성자 '${createdByResolved.label}'과(와) 이름이 같은 멤버가 여러 명이라 미배정 처리했습니다`)
    }

    rows.push({
      rowNumber,
      title: titleText,
      startAt: startAt ? startAt.toISOString() : null,
      endAt: endAt ? endAt.toISOString() : null,
      assigneeId: assigneeResolved.userId,
      assigneeLabel: assigneeResolved.label,
      createdById: createdByResolved.userId,
      createdByLabel: createdByResolved.label,
      createdByFallback,
      warnings,
    })
  }

  return rows
}

// 제목/시작일/종료일이 전부 있어야 비교 대상이 된다 — 날짜가 비어 있는 행/기존
// 일감은 "같은 일감"으로 단정할 근거가 부족해 중복으로 보지 않는다(사용자 확인
// 반영). 담당자/작성자는 비교에서 제외 — 같은 업무를 다른 사람에게 재배정해
// 다시 올리는 경우도 흔해 비교군이 아니라고 확인됨.
//
// 클라이언트(src/components/TaskExcelImport.jsx)가 정확히 같은 공식을 그대로
// 복제해서 쓴다 — 검수 화면에서 제목/날짜를 인라인으로 고치면 그 자리에서 다시
// 계산해 "중복" 표시가 즉시 사라지거나 나타나야 하는데, 그때마다 서버를 다시
// 왕복하는 대신(수백 행이어도 문자열 Set 비교라 비용이 거의 없다) 서버는 기존
// 일감의 키 목록만 한 번 내려주고 판정 자체는 클라이언트가 매 입력마다 로컬에서
// 한다.
function dedupeKey(title, startAt, endAt) {
  if (!startAt || !endAt) return null
  return `${title.trim()} ${startAt} ${endAt}`
}

// 그 프로젝트에 이미 등록된 일감들의 중복 판정용 키 목록(중복 제거됨). 상태
// (todo/doing/…)는 가리지 않고 모든 일감을 대상으로 한다 — 진행 중인 일감이어도
// 비교 대상.
export function existingTaskDedupeKeys(existingTasks) {
  return [
    ...new Set(
      existingTasks
        .map((t) => dedupeKey(t.title, t.startAt?.toISOString() ?? null, t.endAt?.toISOString() ?? null))
        .filter(Boolean),
    ),
  ]
}
