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
