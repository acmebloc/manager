import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'

// Overridable for local/dev testing — production points this at
// /var/www/manager/uploads/tasks (nginx does not serve this directory;
// downloads are streamed through Express so permission checks apply).
export const TASK_UPLOAD_DIR = process.env.TASK_UPLOAD_DIR || '/var/www/manager/uploads/tasks'

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

export async function deleteAttachmentFile(storageKey) {
  try {
    await fs.unlink(path.join(TASK_UPLOAD_DIR, storageKey))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

// Best-effort bulk cleanup for task/project deletion (spec §5.4) — one
// unexpected filesystem error (permission denied, disk full) must not blow
// up the whole delete request, since Express 4 has no global async-error
// handler here and an unhandled rejection would take the process down.
export async function deleteAttachmentFiles(storageKeys) {
  await Promise.all(
    storageKeys.map((storageKey) =>
      deleteAttachmentFile(storageKey).catch((err) => {
        console.error(`Failed to delete attachment file ${storageKey}:`, err)
      }),
    ),
  )
}
