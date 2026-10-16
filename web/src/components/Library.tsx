import { useState } from 'react'
import { Link } from 'react-router'
import { deleteRecording, renameRecording, subtitlesUrl, transcribeRecording, type Recording } from '../lib/api'
import { fmtDate, fmtDuration, fmtSize } from '../lib/format'
import { Button, ErrorNote, buttonClass } from './ui'
import { Player } from './Player'

type Change = (next: (prev: Recording[]) => Recording[]) => void
type Filter = 'all' | Recording['kind']

const KIND = {
  original: { label: 'Recording', tone: 'bg-link/12 text-link' },
  processed: { label: 'Processed', tone: 'bg-coral/15 text-coral-deep' },
  mix: { label: 'Session mix', tone: 'bg-ink/10 text-ink' },
} as const

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'original', label: 'Recordings' },
  { id: 'processed', label: 'Processed' },
  { id: 'mix', label: 'Mixes' },
]

export function Library({ recordings, onChange }: { recordings: Recording[] | null; onChange: Change }) {
  const [filter, setFilter] = useState<Filter>('all')

  if (recordings === null)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading recordings">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-ink/5" />
        ))}
      </div>
    )

  if (recordings.length === 0)
    return (
      <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
        <p className="font-display text-2xl text-ink">Nothing recorded yet.</p>
        <p className="mt-2 text-mute">Press the coral button above and say something. Your takes will land here.</p>
      </div>
    )

  const count = (f: Filter) => (f === 'all' ? recordings.length : recordings.filter((r) => r.kind === f).length)
  const shown = filter === 'all' ? recordings : recordings.filter((r) => r.kind === filter)
  const titles = new Map(recordings.map((r) => [r.id, r.title]))

  return (
    <div>
      <div role="tablist" aria-label="Filter recordings" className="mb-5 flex flex-wrap gap-2">
        {FILTERS.filter((f) => f.id === 'all' || count(f.id) > 0).map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.id ? 'bg-ink text-paper' : 'text-mute hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {f.label} <span className="tabular-nums opacity-60">{count(f.id)}</span>
          </button>
        ))}
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {shown.map((r) => (
          <li key={r.id}>
            <Item recording={r} parentTitle={r.parent_id ? titles.get(r.parent_id) : undefined} onChange={onChange} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Item({ recording: r, parentTitle, onChange }: { recording: Recording; parentTitle?: string; onChange: Change }) {
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
    if (!confirm(`Delete “${r.title}”? This can’t be undone.`)) return
    setBusy('delete')
    try {
      await deleteRecording(r.id)
      onChange((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setBusy(null)
    }
  }

  const kind = KIND[r.kind]

  return (
    <article className="py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
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
              className="w-full rounded-lg border border-line-strong bg-card px-2 py-1 font-display text-xl text-ink"
            />
          ) : (
            <h3 className="truncate font-display text-xl font-medium text-ink">
              <button onClick={() => setEditing(true)} title="Click to rename" className="text-left hover:underline">
                {r.title}
              </button>
            </h3>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${kind.tone}`}>{kind.label}</span>
            <span>{fmtDate(r.inserted_at)}</span>
            <span className="tabular-nums">{fmtDuration(r.duration_ms)}</span>
            <span className="tabular-nums">{fmtSize(r.byte_size)}</span>
          </p>
          {parentTitle && <p className="mt-1 text-[13px] text-mute">Made from “{parentTitle}”</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/studio/${r.id}`} className={buttonClass('outline', 'sm')}>
            Open in Studio
          </Link>
          <Button size="sm" onClick={transcribe} disabled={busy !== null}>
            {busy === 'transcribe' ? 'Transcribing…' : r.transcript ? 'Re-transcribe' : 'Transcribe'}
          </Button>
          {r.has_subtitles && (
            <a
              href={subtitlesUrl(r.id)}
              download
              title="Download subtitles with timestamps (SubRip)"
              className={buttonClass('outline', 'sm')}
            >
              .srt
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy !== null} aria-label={`Delete ${r.title}`}>
            Delete
          </Button>
        </div>
      </div>

      <Player src={r.audio_url} durationMs={r.duration_ms} className="mt-4" />

      {r.summary && (
        <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink">
          <span className="font-semibold">Summary: </span>
          {r.summary}
        </p>
      )}
      {r.transcript && (
        <details className="mt-3 max-w-prose text-sm">
          <summary className="cursor-pointer text-mute hover:text-ink">Transcript</summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-body">{r.transcript}</p>
        </details>
      )}
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </article>
  )
}
