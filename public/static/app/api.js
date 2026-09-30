export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

const listeners = { unauthorized: [] }
export const onUnauthorized = (fn) => listeners.unauthorized.push(fn)

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['content-type'] = 'application/json'
  }
  let res
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'network', navigator.onLine ? 'network_error' : 'offline')
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const err = data?.error || {}
    const e = new ApiError(res.status, err.code || 'error', err.message || res.statusText, err.details, data?.requestId)
    if (res.status === 401 && !path.startsWith('/api/auth/')) listeners.unauthorized.forEach((fn) => fn(e))
    throw e
  }
  return data
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, formData)
}

// Triggers a browser download of an authenticated endpoint.
export function download(path) {
  const a = document.createElement('a')
  a.href = path
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
