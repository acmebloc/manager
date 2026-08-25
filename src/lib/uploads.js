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
