import { loadSession } from './secureProfileStore'

// Wraps fetch with the session's bearer token and JSON handling, so pages
// don't each rebuild the same headers. Reads the token from the encrypted
// cache per call rather than holding it in memory, so a withdrawal takes
// effect on the next request instead of the next reload.
export async function apiFetch(path, { method = 'GET', body } = {}) {
  const session = await loadSession()
  if (!session) throw new ApiError('Not signed in', 401)

  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  if (res.status === 204) return null

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(payload?.error || `Request failed (${res.status})`, res.status)
  }
  return payload
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// For multipart uploads — FormData sets its own Content-Type boundary, so it
// must not be set manually (the browser handles that itself).
export async function apiUpload(path, formData) {
  const session = await loadSession()
  if (!session) throw new ApiError('Not signed in', 401)

  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
    body: formData,
  })

  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(payload?.error || `Request failed (${res.status})`, res.status)
  }
  return payload
}

// For authenticated file downloads — <a href> can't carry a Bearer header,
// so fetch as a blob and trigger the save via a temporary object URL.
export async function apiDownload(path, suggestedName) {
  const session = await loadSession()
  if (!session) throw new ApiError('Not signed in', 401)

  const res = await fetch(path, { headers: { Authorization: `Bearer ${session.token}` } })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new ApiError(payload?.error || `Download failed (${res.status})`, res.status)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
}
