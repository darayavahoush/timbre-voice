import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { deleteRecording, renameRecording, transcribeRecording, type Recording } from '../lib/api'
import { fmtDate, fmtDuration, fmtSize } from '../lib/format'
import { useHotkeys } from '../lib/hooks'
import { Button, Card, ErrorNote, inputClass, Kbd, Segmented, Spinner } from './ui'

const KIND_LABEL = { original: 'original', processed: 'processed', mix: 'session mix' } as const
type Kind = 'all' | Recording['kind']
type Sort = 'newest' | 'oldest' | 'longest' | 'title'
type Change = (next: (prev: Recording[]) => Recording[]) => void

const SORTS: Record<Sort, (a: Recording, b: Recording) => number> = {
  newest: (a, b) => b.inserted_at.localeCompare(a.inserted_at),
  oldest: (a, b) => a.inserted_at.localeCompare(b.inserted_at),
  longest: (a, b) => b.duration_ms - a.duration_ms,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
}

export function Library({ recordings, onChange }: { recordings: Recording[] | null; onChange: Change }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useHotkeys({
    '/': (e) => {
      e.preventDefault()
      searchRef.current?.focus()
    },
  })

  // Only one clip plays at a time.
  useEffect(() => {
    const onPlay = (e: Event) => document.querySelectorAll('audio').forEach((a) => a !== e.target && a.pause())
    document.addEventListener('play', onPlay, true)
    return () => document.removeEventListener('play', onPlay, true)
  }, [])

  const visible = useMemo(() => {
    if (!recordings) return []
    const q = query.trim().toLowerCase()
    return recordings
      .filter(
        (r) =>
          (kind === 'all' || r.kind === kind) &&
          (!q || [r.title, r.transcript, r.summary].some((s) => s?.toLowerCase().includes(q))),
      )
      .sort(SORTS[sort])
  }, [recordings, query, kind, sort])

  if (recordings === null)
    return (
      <ul className="space-y-3" aria-busy="true" aria-label="Loading recordings">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-28 rounded-lg border border-hairline bg-canvas-soft motion-safe:animate-pulse" />
        ))}
      </ul>
    )
  if (recordings.length === 0)
    return (
      <Card>
        <p className="text-sm text-mute">No recordings yet — hit Record above to make your first one.</p>
      </Card>
    )

  const chosen = visible.filter((r) => selected.has(r.id))
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
    setBulkError(null)
  }

  async function bulkDelete() {
    if (!chosen.length || !confirm(`Delete ${chosen.length} recording${chosen.length > 1 ? 's' : ''}? This can’t be undone.`)) return
    setBulkBusy(true)
    setBulkError(null)
    const results = await Promise.allSettled(chosen.map((r) => deleteRecording(r.id)))
    const gone = new Set(chosen.filter((_, i) => results[i].status === 'fulfilled').map((r) => r.id))
    onChange((prev) => prev.filter((r) => !gone.has(r.id)))
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))))
    const failedCount = chosen.length - gone.size
    if (failedCount) setBulkError(`${failedCount} recording${failedCount > 1 ? 's' : ''} couldn’t be deleted.`)
    else exitSelect()
    setBulkBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
          placeholder="Search title or transcript"
          aria-label="Search recordings"
          className={`${inputClass} w-full flex-1 sm:w-auto`}
        />
        <Kbd>/</Kbd>
        <Segmented
          label="Filter by type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'original', label: 'Originals' },
            { value: 'processed', label: 'Processed' },
            { value: 'mix', label: 'Mixes' },
          ]}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort recordings" className={inputClass}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="longest">Longest</option>
          <option value="title">Title A–Z</option>
        </select>
        <Button onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting}>
          {selecting ? 'Done' : 'Select'}
        </Button>
      </div>

      {selecting && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-sm">
          <span className="text-ink">{chosen.length} selected</span>
          <Button variant="ghost" className="!py-0.5" onClick={() => setSelected(new Set(visible.map((r) => r.id)))}>Select all {visible.length}</Button>
          <Button variant="ghost" className="!py-0.5" onClick={() => setSelected(new Set())} disabled={!chosen.length}>Clear</Button>
          <span className="grow" />
          <Button variant="danger" className="!py-0.5" onClick={bulkDelete} disabled={!chosen.length || bulkBusy}>
            {bulkBusy ? <><Spinner /> Deleting…</> : 'Delete selected'}
          </Button>
        </div>
      )}
      <ErrorNote error={bulkError} />

      <p className="text-xs text-mute" aria-live="polite">
        {visible.length === recordings.length ? `${recordings.length} recording${recordings.length > 1 ? 's' : ''}` : `Showing ${visible.length} of ${recordings.length}`}
      </p>

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-mute">Nothing matches.</p>
          <Button variant="ghost" className="mt-2 !px-0" onClick={() => { setQuery(''); setKind('all') }}>Clear search and filters</Button>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id}>
              <Item recording={r} onChange={onChange} selecting={selecting} selected={selected.has(r.id)} onToggle={() => toggle(r.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Item({
  recording: r,
  onChange,
  selecting,
  selected,
  onToggle,
}: {
  recording: Recording
  onChange: Change
  selecting: boolean
  selected: boolean
  onToggle: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(r.title)
  const [busy, setBusy] = useState<'transcribe' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const replace = (next: Recording) => onChange((prev) => prev.map((x) => (x.id === next.id ? next : x)))

  async function rename() {
    setEditing(false)
    if (!title.trim() || title.trim() === r.title) return setTitle(r.title)
    try {
      replace(await renameRecording(r.id, title.trim()))
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
    <Card className={selected ? 'ring-2 ring-link' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {selecting && (
            <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${r.title}`} className="mt-1.5" />
          )}
          <div className="min-w-0">
            {editing ? (
              <input
                autoFocus
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename()
                  if (e.key === 'Escape') (setTitle(r.title), setEditing(false))
                }}
                aria-label="Title"
                className="rounded border border-hairline-strong bg-canvas px-2 py-0.5 text-sm text-ink"
              />
            ) : (
              <button onClick={() => setEditing(true)} title="Rename" className="max-w-full truncate text-left font-medium text-ink hover:underline">
                {r.title}
              </button>
            )}
            <p className="mt-0.5 text-xs text-mute">
              <span className="mr-2 rounded-full border border-hairline px-1.5 py-0.5">{KIND_LABEL[r.kind]}</span>
              {fmtDate(r.inserted_at)} · {fmtDuration(r.duration_ms)} · {fmtSize(r.byte_size)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/studio/${r.id}`} className="inline-flex items-center rounded-md border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-soft">
            Studio
          </Link>
          <Button onClick={transcribe} disabled={busy !== null}>
            {busy === 'transcribe' ? <><Spinner /> Transcribing…</> : r.transcript ? 'Re-transcribe' : 'Transcribe'}
          </Button>
          <a href={r.audio_url} download className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-mute hover:text-ink">
            Download
          </a>
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
