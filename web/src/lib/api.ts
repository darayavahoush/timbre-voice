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
  has_subtitles: boolean
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errors = body?.errors ?? {}
    const msg =
      errors.detail ??
      Object.entries(errors)
        .map(([k, v]) => `${k} ${(v as string[]).join(', ')}`)
        .join('; ') ??
      res.statusText
    throw new ApiError(msg || res.statusText, res.status)
  }
  return body.data as T
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
) {
  const form = new FormData()
  form.set('audio', audio, 'recording')
  if (meta.title) form.set('title', meta.title)
  form.set('duration_ms', String(Math.round(meta.durationMs)))
  if (meta.sampleRate) form.set('sample_rate', String(meta.sampleRate))
  if (meta.kind) form.set('kind', meta.kind)
  if (meta.parentId) form.set('parent_id', String(meta.parentId))
  if (meta.effects) form.set('effects', JSON.stringify(meta.effects))
  return request<Recording>('/api/recordings', { method: 'POST', body: form })
}

export const renameRecording = (id: number, title: string) =>
  request<Recording>(`/api/recordings/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })

export const deleteRecording = (id: number) =>
  request<void>(`/api/recordings/${id}`, { method: 'DELETE' })

/** Direct download URL for the SubRip (.srt) file; 404s until the take is transcribed. */
export const subtitlesUrl = (id: number) => `/api/recordings/${id}/transcript.srt`

export const transcribeRecording = (id: number) =>
  request<Recording>(`/api/recordings/${id}/transcribe`, { method: 'POST' })

export const createSession = (name: string) =>
  request<Session>('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })

export const getSession = (id: string) => request<Session>(`/api/sessions/${id}`)
