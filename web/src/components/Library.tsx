import { useState } from 'react'
import { Link } from 'react-router'
import {
  deleteRecording,
  renameRecording,
  transcribeRecording,
  type Recording,
} from '../lib/api'
import { fmtDate, fmtDuration, fmtSize } from '../lib/format'
import { Button, Card, ErrorNote } from './ui'

const KIND_LABEL = { original: 'original', processed: 'processed', mix: 'session mix' } as const

export function Library({
  recordings,
  onChange,
}: {
  recordings: Recording[] | null
  onChange: (next: (prev: Recording[]) => Recording[]) => void
}) {
  if (recordings === null) return <p className="text-sm text-mute">Loading…</p>
  if (recordings.length === 0)
    return (
      <Card>
        <p className="text-sm text-mute">No recordings yet — hit Record above to make your first one.</p>
      </Card>
    )
  return (
    <ul className="space-y-3">
      {recordings.map((r) => (
        <li key={r.id}>
          <Item recording={r} onChange={onChange} />
        </li>
      ))}
    </ul>
  )
}

function Item({
  recording: r,
  onChange,
}: {
  recording: Recording
  onChange: (next: (prev: Recording[]) => Recording[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(r.title)
  const [busy, setBusy] = useState<'transcribe' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const replace = (next: Recording) => onChange((prev) => prev.map((x) => (x.id === next.id ? next : x)))

  async function rename() {
    setEditing(false)
    if (title.trim() === r.title) return
    try {
      replace(await renameRecording(r.id, title))
    } catch (e) {
      setTitle(r.title)
      setError(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  async function transcribe() {
    setBusy('transcribe')
    setError(null)
    try {
      replace(await transcribeRecording(r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirm(`Delete “${r.title}”?`)) return
    setBusy('delete')
    try {
      await deleteRecording(r.id)
      onChange((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setBusy(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === 'Enter' && rename()}
              aria-label="Title"
              className="rounded border border-hairline-strong bg-canvas px-2 py-0.5 text-sm text-ink"
            />
          ) : (
            <button onClick={() => setEditing(true)} title="Rename" className="truncate text-left font-medium text-ink hover:underline">
              {r.title}
            </button>
          )}
          <p className="mt-0.5 text-xs text-mute">
            <span className="mr-2 rounded-full border border-hairline px-1.5 py-0.5">{KIND_LABEL[r.kind]}</span>
            {fmtDate(r.inserted_at)} · {fmtDuration(r.duration_ms)} · {fmtSize(r.byte_size)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/studio/${r.id}`} className="inline-flex items-center rounded-md border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-soft">
            Studio
          </Link>
          <Button onClick={transcribe} disabled={busy !== null}>
            {busy === 'transcribe' ? 'Transcribing…' : r.transcript ? 'Re-transcribe' : 'Transcribe'}
          </Button>
          <Button variant="ghost" onClick={remove} disabled={busy !== null} aria-label={`Delete ${r.title}`}>
            Delete
          </Button>
        </div>
      </div>
      <audio controls preload="none" src={r.audio_url} className="mt-3 w-full" />
      {r.summary && (
        <p className="mt-3 text-sm text-ink">
          <span className="font-medium">Summary: </span>
          {r.summary}
        </p>
      )}
      {r.transcript && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-mute">Transcript</summary>
          <p className="mt-1 whitespace-pre-wrap text-body">{r.transcript}</p>
        </details>
      )}
      <div className="mt-2">
        <ErrorNote error={error} />
      </div>
    </Card>
  )
}
