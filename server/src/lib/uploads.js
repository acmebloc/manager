import crypto from 'node:crypto'
import { mkdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'

// Overridable for local/dev testing — production points this at
// /var/www/manager/uploads/tasks (Apache does not serve this directory;
// downloads are streamed through Express so permission checks apply).
export const TASK_UPLOAD_DIR = process.env.TASK_UPLOAD_DIR || '/var/www/manager/uploads/tasks'

// multer는 destination 디렉터리를 만들어주지 않는다 — 없으면 업로드마다 ENOENT로
// 실패한다. 그런데 이 디렉터리는 배포 디렉터리(/var/www/manager/app)의 형제라
// git pull로도, npm ci로도 생기지 않는다. 실제로 운영 서버의 것은 손으로 만든
// 것이었고 DEPLOY.md에도 절차가 없었다(§14에서 문서화했다). 서버를 다시 세울 때
// 첨부만 조용히 깨지는 걸 막으려고 여기서 보장한다 — oidcKeys.js가 keys/를
// 다루는 방식과 같다.
//
// **던지지 않는다.** TASK_UPLOAD_DIR을 지정하지 않은 로컬 개발 머신에서는 기본
// 경로(/var/www/...)를 만들 권한이 없는 게 정상인데, 여기서 던지면 첨부와 무관한
// 작업까지 서버가 아예 안 뜬다. 경고만 남기고, 실제 업로드 시점에 multer가
// 평소대로 에러를 돌려준다.
try {
  mkdirSync(TASK_UPLOAD_DIR, { recursive: true })
} catch (err) {
  console.warn(
    `[uploads] 첨부 저장 디렉터리를 만들지 못했습니다 (${TASK_UPLOAD_DIR}): ${err.message} — 첨부 업로드가 실패합니다. 로컬 개발이라면 TASK_UPLOAD_DIR을 쓰기 가능한 경로로 지정하세요`,
  )
}

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_TASK = 10

const EXT_ALLOWLIST = new Set([
  'xlsx', 'xls', 'csv', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'hwp', 'hwpx', 'txt',
  'zip',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
])

// svg is deliberately excluded — served same-origin, it's an XSS vector.
const MIME_ALLOWLIST = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'application/x-hwp',
  'application/haansofthwp',
  'application/vnd.hancom.hwpx',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase()
  if (!EXT_ALLOWLIST.has(ext) || !MIME_ALLOWLIST.has(file.mimetype)) {
    return cb(new Error('허용되지 않는 파일 형식입니다'))
  }
  cb(null, true)
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TASK_UPLOAD_DIR),
  // Random, no extension — the web server should never be able to sniff a
  // MIME type or be tricked into serving this directly (see spec §5.1).
  filename: (req, file, cb) => cb(null, crypto.randomBytes(24).toString('hex')),
})

export const taskUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
})

const EXCEL_MIME_ALLOWLIST = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

// .xlsx(OOXML)만 받는다 — 구버전 바이너리 .xls(BIFF/OLE2)는 exceljs가 아예 못 읽는다
// (파싱은 "성공"하지만 시트를 0개 인식해 헷갈리는 에러로 이어진다). BIFF 파싱을
// 지원하는 라이브러리는 npm 배포 xlsx(SheetJS) 정도뿐인데, 그건 고위험 취약점
// (Prototype Pollution/ReDoS) 때문에 이 프로젝트에서 의도적으로 배제했다 — 사용자가
// Excel에서 "다른 이름으로 저장 → xlsx"로 한 번 변환하는 쪽이 훨씬 안전하다.
//
// Excel-only, in-memory — this feeds a one-shot parse (taskImport.js), never
// written to disk or kept as a TaskAttachment, so there's nothing to clean up.
export const taskImportUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase()
    if (ext !== 'xlsx' || !EXCEL_MIME_ALLOWLIST.has(file.mimetype)) {
      return cb(new Error('엑셀 파일(.xlsx)만 업로드할 수 있습니다. 구버전(.xls) 파일은 Excel에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 변환한 뒤 업로드해주세요'))
    }
    cb(null, true)
  },
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
})

// 파일 하나를 지우고, 실패하면 로그만 남긴다 — **절대 던지지 않는다.**
//
// 라우트에서 디스크 파일 삭제는 늘 "DB는 이미 반영됐고 남은 파일만 치우는"
// 후처리다. 여기서 던지면 Express 4가 라우트 핸들러를 await하지 않는 탓에
// 에러 응답이 아니라 응답 없는 멈춤이 되고(index.js 주석), 사용자는 다시
// 눌러도 이미 지워진 행 때문에 404만 받는다. 권한 오류·디스크 문제로 남은
// 고아 파일은 로그로 추적하는 쪽이 낫다.
export async function deleteAttachmentFile(storageKey) {
  try {
    await fs.unlink(path.join(TASK_UPLOAD_DIR, storageKey))
  } catch (err) {
    // 이미 없는 파일은 실패가 아니다 — 지우려던 상태가 이미 달성돼 있다.
    if (err.code === 'ENOENT') return
    console.error(`Failed to delete attachment file ${storageKey}:`, err)
  }
}

// Bulk cleanup for task/project deletion (spec §5.4).
export async function deleteAttachmentFiles(storageKeys) {
  await Promise.all(storageKeys.map((storageKey) => deleteAttachmentFile(storageKey)))
}
