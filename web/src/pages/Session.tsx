import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Socket, type Channel } from 'phoenix'
import { Button, Card, ErrorNote, Meter } from '../components/ui'
import { getSession, type Session as SessionInfo } from '../lib/api'
import { LivePlayer, startCapture, type MicCapture } from '../lib/capture'
import { fmtDuration } from '../lib/format'
import { kitReady } from '../lib/kit'
import { clientId, getHostToken, savedName, saveName } from '../lib/session'

type Participant = { id: string; name: string; host: boolean; live: boolean }
type RoomState = { status: 'open' | 'recording' | 'finished'; recording_id: number | null; participants: Participant[] }

export default function SessionPage() {
  const { id = '' } = useParams()
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(savedName())
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    getSession(id).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : 'Session not found'))
  }, [id])

  if (error && !info) {
    return (
      <Card>
        <p className="text-ink">That session doesn’t exist.</p>
        <Link to="/" className="text-sm text-link">Back home</Link>
      </Card>
    )
  }
  if (!info) return <p className="text-sm text-mute">Loading…</p>

  if (!joined) {
    return (
      <Card className="max-w-md">
        <h1 className="text-lg font-semibold text-ink">{info.name}</h1>
        {info.status === 'finished' && info.recording_id ? (
          <FinishedPlayer recordingId={info.recording_id} />
        ) : (
          <>
            <p className="mb-4 mt-1 text-sm text-mute">Join to share your microphone with everyone in this session. Use headphones to avoid feedback.</p>
            <form
              className="flex gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                saveName(name)
                setJoined(true)
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                required
                autoFocus
                placeholder="Your name"
                aria-label="Your name"
                className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-sm text-ink"
              />
              <Button variant="primary" type="submit">Join</Button>
            </form>
          </>
        )}
      </Card>
    )
  }
  return <Room session={info} name={name.trim() || 'Guest'} />
}

function FinishedPlayer({ recordingId }: { recordingId: number }) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-mute">This session has finished. Here’s the mixed recording:</p>
      <audio controls src={`/api/recordings/${recordingId}/audio`} className="w-full" />
      <Link to={`/studio/${recordingId}`} className="text-sm text-link">Open in Studio →</Link>
    </div>
  )
}

function Room({ session, name }: { session: SessionInfo; name: string }) {
  const [state, setState] = useState<RoomState>({ status: 'open', recording_id: null, participants: [] })
  const [me, setMe] = useState<{ id: string; host: boolean } | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [muted, setMuted] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [myLevel, setMyLevel] = useState(0)
  const channel = useRef<Channel | null>(null)
  const statusRef = useRef<RoomState['status']>('open')
  const mutedRef = useRef(false)
  const player = useRef<LivePlayer | null>(null)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = state.status
    if (state.status === 'recording') startedAt.current ??= performance.now()
    if (state.status !== 'recording') startedAt.current = null
  }, [state.status])
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // Elapsed clock while a take is running.
  useEffect(() => {
    if (state.status !== 'recording') return setElapsed(0)
    const t = setInterval(() => setElapsed(performance.now() - (startedAt.current ?? performance.now())), 250)
    return () => clearInterval(t)
  }, [state.status])

  useEffect(() => {
    let capture: MicCapture | null = null
    let dead = false
    const socket = new Socket('/socket')
    socket.onOpen(() => setConnected(true))
    socket.onClose(() => setConnected(false))
    socket.connect()

    const ch = socket.channel(`session:${session.id}`, {
      client_id: clientId(),
      name,
      host_token: getHostToken(session.id),
    })
    channel.current = ch
    ch.on('state', (s: RoomState) => setState((p) => ({ ...p, ...s })))
    ch.on('roster', (r: { participants: Participant[] }) => setState((p) => ({ ...p, participants: r.participants })))
    ch.on('level', ({ id, v }: { id: string; v: number }) => setLevels((l) => ({ ...l, [id]: v })))
    ch.on('audio', (buf: ArrayBuffer) => {
      const sender = new TextDecoder().decode(buf.slice(0, 8))
      player.current?.push(sender, buf.slice(8))
    })

    ch.join()
      .receive('ok', (reply: { participant_id: string; host: boolean; state: RoomState }) => {
        setMe({ id: reply.participant_id, host: reply.host })
        setState(reply.state)
      })
      .receive('error', (e: { reason: string; recording_id?: number }) =>
        setError(e.reason === 'full' ? 'This session is full (8 people).' : e.reason === 'finished' ? 'This session has finished.' : `Could not join (${e.reason})`),
      )

    // Mic -> 16 kHz chunks -> level meter + (while a take is running) the server.
    ;(async () => {
      try {
        const kit = await kitReady
        capture = await startCapture((chunk) => {
          const level = Math.min(1, kit.rms_level(chunk) * 4)
          setMyLevel(level)
          ch.push('level', { v: level })
          if (statusRef.current === 'recording') {
            const pcm = mutedRef.current ? new Uint8Array(chunk.length * 2) : kit.f32_to_pcm16le(chunk)
            ch.push('audio', pcm.buffer as ArrayBuffer)
          }
        })
        if (dead) capture.stop()
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Microphone access was blocked — allow it and reload to take part.'
            : e instanceof Error ? e.message : 'Could not open the microphone',
        )
      }
    })()

    return () => {
      dead = true
      capture?.stop()
      player.current?.close()
      player.current = null
      ch.leave()
      socket.disconnect()
    }
  }, [session.id, name])

  const toggleListen = useCallback(() => {
    const on = !listening
    if (on) player.current ??= new LivePlayer()
    else {
      player.current?.close()
      player.current = null
    }
    channel.current?.push('listen', { on })
    setListening(on)
  }, [listening])

  async function hostAction(event: 'start' | 'stop') {
    setBusy(true)
    setError(null)
    channel.current
      ?.push(event, {}, 120_000)
      .receive('ok', () => setBusy(false))
      .receive('error', (e: { reason: string }) => {
        setBusy(false)
        setError(e.reason === 'nothing_recorded' ? 'Nobody spoke — nothing was saved. Try again.' : `Couldn’t ${event} (${e.reason})`)
      })
      .receive('timeout', () => {
        setBusy(false)
        setError('Timed out — check your connection.')
      })
  }

  const link = `${location.origin}/s/${session.id}`
  const [copied, setCopied] = useState(false)
  const isHost = me?.host ?? false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{session.name}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-mute">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-link' : 'bg-hairline-strong'}`} />
          {connected ? 'Connected' : 'Connecting…'} ·{' '}
          {state.status === 'open' && 'Waiting to start'}
          {state.status === 'recording' && `Recording ${fmtDuration(elapsed)}`}
          {state.status === 'finished' && 'Finished'}
        </p>
      </div>

      <ErrorNote error={error} />

      {state.status !== 'finished' && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">Invite people</h2>
          <div className="flex gap-3">
            <input readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-canvas-soft px-3 py-1.5 font-mono text-xs text-ink" />
            <Button
              onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">In the room</h2>
        <ul className="space-y-3">
          {state.participants.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <span className="w-40 truncate text-sm text-ink">
                {p.name}
                {p.id === me?.id && <span className="text-mute"> (you)</span>}
                {p.host && <span className="ml-1 rounded-full border border-hairline px-1.5 text-[10px] text-mute">host</span>}
              </span>
              <div className="flex-1">{p.live ? <Meter value={p.id === me?.id ? (muted ? 0 : myLevel) : (levels[p.id] ?? 0)} /> : <span className="text-xs text-mute">disconnected</span>}</div>
            </li>
          ))}
        </ul>
        {state.status !== 'finished' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
            <Button onClick={() => setMuted((m) => !m)} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</Button>
            <Button onClick={toggleListen} aria-pressed={listening}>{listening ? 'Stop listening live' : 'Listen live (headphones)'}</Button>
            <span className="grow" />
            {isHost && state.status === 'open' && (
              <Button variant="primary" onClick={() => hostAction('start')} disabled={busy || !connected}>● Start recording</Button>
            )}
            {isHost && state.status === 'recording' && (
              <Button variant="danger" onClick={() => hostAction('stop')} disabled={busy}>{busy ? 'Mixing…' : '■ Stop & save mix'}</Button>
            )}
            {!isHost && <span className="text-xs text-mute">Only the host can start and stop.</span>}
          </div>
        )}
      </Card>

      {state.status === 'finished' && state.recording_id && (
        <Card>
          <h2 className="text-sm font-semibold text-ink">Mixed recording</h2>
          <FinishedPlayer recordingId={state.recording_id} />
          <Link to="/" className="mt-3 inline-block text-sm text-link">Go to library</Link>
        </Card>
      )}
    </div>
  )
}
