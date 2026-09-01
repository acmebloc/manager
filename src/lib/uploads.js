// Mirrors server/src/lib/uploads.js's EXT_ALLOWLIST/limits — kept in sync by
// hand. This copy only gives instant client-side feedback; the server
// enforces the real limit regardless.
export const ATTACHMENT_EXT_ALLOWLIST = new Set([
  'xlsx', 'xls', 'csv', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'hwp', 'hwpx', 'txt',
  'zip',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
])

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_TASK = 10

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function isAllowedAttachmentExt(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return Boolean(ext) && ATTACHMENT_EXT_ALLOWLIST.has(ext)
}

// Excel 일괄 등록은 .xlsx만 받는다(구버전 .xls는 파싱 라이브러리가 못 읽는다) —
// mirrors server/src/lib/uploads.js's taskImportUpload fileFilter.
const EXCEL_EXT_ALLOWLIST = new Set(['xlsx'])

export function isAllowedExcelExt(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return Boolean(ext) && EXCEL_EXT_ALLOWLIST.has(ext)
}
