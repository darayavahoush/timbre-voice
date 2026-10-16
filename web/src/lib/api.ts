export type Recording = {
  id: number
  title: string
  kind: 'original' | 'processed' | 'mix'
  mime_type: string
  duration_ms: number
  byte_size: number
  sample_rate: number | null
  parent_id: number | null
  effects: Record<string, unknown>
  transcript: string | null
  summary: string | null
  inserted_at: string
  audio_url: string
}

export type Session = {
  id: string
  name: string
  status: 'open' | 'recording' | 'finished'
  recording_id: number | null
  host_token?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

function errorMessage(body: unknown, fallback: string): string {
  const errors = ((body as { errors?: Record<string, unknown> } | null)?.errors ?? {}) as Record<string, unknown>
  const detail = typeof errors.detail === 'string' ? errors.detail : null
  const fields = Object.entries(errors)
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('; ')
  return detail || fields || fallback
}

const NETWORK_MSG = 'Can’t reach the server — check your connection and try again.'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(NETWORK_MSG, 0)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(errorMessage(body, res.statusText || `Request failed (${res.status})`), res.status)
  return body.data as T
}

/** Multipart POST via XHR — the only way to get upload progress events. */
function upload<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      const body = xhr.response ?? {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.data as T)
      else reject(new ApiError(errorMessage(body, xhr.statusText || `Upload failed (${xhr.status})`), xhr.status))
    }
    xhr.onerror = () => reject(new ApiError(NETWORK_MSG, 0))
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0))
    xhr.send(form)
  })
}

export const getRecording = (id: number) => request<Recording>(`/api/recordings/${id}`)

export const listRecordings = () => request<Recording[]>('/api/recordings')

export function uploadRecording(
  audio: Blob,
  meta: {
    title?: string
    durationMs: number
    sampleRate?: number
    kind?: 'original' | 'processed'
    parentId?: number
    effects?: unknown
  },
  onProgress?: (fraction: number) => void,
) {
  const form = new FormData()
  form.set('audio', audio, 'recording')
  if (meta.title) form.set('title', meta.title)
  form.set('duration_ms', String(Math.round(meta.durationMs)))
  if (meta.sampleRate) form.set('sample_rate', String(meta.sampleRate))
  if (meta.kind) form.set('kind', meta.kind)
  if (meta.parentId) form.set('parent_id', String(meta.parentId))
  if (meta.effects) form.set('effects', JSON.stringify(meta.effects))
  return onProgress
    ? upload<Recording>('/api/recordings', form, onProgress)
    : request<Recording>('/api/recordings', { method: 'POST', body: form })
}

export const renameRecording = (id: number, title: string) =>
  request<Recording>(`/api/recordings/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })

export const deleteRecording = (id: number) =>
  request<void>(`/api/recordings/${id}`, { method: 'DELETE' })

export const transcribeRecording = (id: number) =>
  request<Recording>(`/api/recordings/${id}/transcribe`, { method: 'POST' })

export const createSession = (name: string) =>
  request<Session>('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })

export const getSession = (id: string) => request<Session>(`/api/sessions/${id}`)
