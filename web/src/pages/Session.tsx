import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Socket, type Channel } from 'phoenix'
import { Banner, Button, Card, ErrorNote, inputClass, Kbd, Meter } from '../components/ui'
import { getSession, type Session as SessionInfo } from '../lib/api'
import { LivePlayer, startCapture, type MicCapture } from '../lib/capture'
import { fmtDuration } from '../lib/format'
import { useHotkeys, useOnline, useTitle } from '../lib/hooks'
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
  useTitle(info ? `${info.name} — timbre` : 'Session — timbre')

  useEffect(() => {
    getSession(id).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : 'Session not found'))
  }, [id])

  if (error && !info) {
    return (
      <Card>
        <p className="text-ink">{error === 'Session not found' || /not.?found/i.test(error) ? 'That session doesn’t exist.' : error}</p>
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
                saveName(name.trim())
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
                className={`${inputClass} flex-1`}
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

type Levels = Record<string, { v: number; t: number }>

function Room({ session, name }: { session: SessionInfo; name: string }) {
  const navigate = useNavigate()
  const online = useOnline()
  const [state, setState] = useState<RoomState>({ status: 'open', recording_id: null, participants: [] })
  const [me, setMe] = useState<{ id: string; host: boolean } | null>(null)
  const [levels, setLevels] = useState<Levels>({})
  const [muted, setMuted] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [socketUp, setSocketUp] = useState(false)
  const [channelUp, setChannelUp] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [myLevel, setMyLevel] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const channel = useRef<Channel | null>(null)
  const statusRef = useRef<RoomState['status']>('open')
  const mutedRef = useRef(false)
  const listeningRef = useRef(false)
  const player = useRef<LivePlayer | null>(null)
  const startedAt = useRef<number | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  const connected = socketUp && channelUp
  const isHost = me?.host ?? false
  const recording = state.status === 'recording'
  useTitle(recording ? `● Recording — ${session.name}` : `${session.name} — timbre`)

  useEffect(() => {
    statusRef.current = state.status
    if (state.status === 'recording') startedAt.current ??= performance.now()
    if (state.status !== 'recording') startedAt.current = null
  }, [state.status])
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])
  useEffect(() => {
    listeningRef.current = listening
  }, [listening])

  // Elapsed clock while a take is running.
  useEffect(() => {
    if (!recording) return setElapsed(0)
    const t = setInterval(() => setElapsed(performance.now() - (startedAt.current ?? performance.now())), 250)
    return () => clearInterval(t)
  }, [recording])

  // A peer that stops sending levels (closed tab, lost network) shouldn't leave a frozen meter.
  useEffect(() => {
    const t = setInterval(
      () =>
        setLevels((l) => {
          const cut = performance.now() - 1000
          let changed = false
          const next: Levels = {}
          for (const [k, x] of Object.entries(l)) {
            if (x.t < cut && x.v !== 0) {
              next[k] = { v: 0, t: x.t }
              changed = true
            } else next[k] = x
          }
          return changed ? next : l
        }),
      500,
    )
    return () => clearInterval(t)
  }, [])

  // Keep a phone awake while a take is running.
  useEffect(() => {
    if (!recording || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let dead = false
    const grab = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => (dead ? void l.release() : (lock = l)))
        .catch(() => {})
    void grab()
    const onVis = () => document.visibilityState === 'visible' && void grab()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      dead = true
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release()
    }
  }, [recording])

  // Don't lose a live take to an accidental refresh.
  useEffect(() => {
    if (!recording) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [recording])

  useEffect(() => {
    let capture: MicCapture | null = null
    let dead = false
    // phoenix.js reconnects the socket with backoff and re-joins the channel by
    // itself; we mirror both into state so the UI can say what's going on.
    const socket = new Socket('/socket')
    socket.onOpen(() => setSocketUp(true))
    socket.onClose(() => setSocketUp(false))
    socket.onError(() => setSocketUp(false))
    socket.connect()

    const ch = socket.channel(`session:${session.id}`, {
      client_id: clientId(),
      name,
      host_token: getHostToken(session.id),
    })
    channel.current = ch
    ch.onError(() => setChannelUp(false))
    ch.onClose(() => setChannelUp(false))
    ch.on('state', (s: RoomState) => setState((p) => ({ ...p, ...s })))
    ch.on('roster', (r: { participants: Participant[] }) => setState((p) => ({ ...p, participants: r.participants })))
    ch.on('level', ({ id, v }: { id: string; v: number }) => setLevels((l) => ({ ...l, [id]: { v, t: performance.now() } })))
    ch.on('audio', (buf: ArrayBuffer) => {
      const sender = new TextDecoder().decode(buf.slice(0, 8))
      player.current?.push(sender, buf.slice(8))
    })

    // These hooks re-fire on every automatic re-join, which re-syncs room state
    // and re-subscribes live listening that the server forgot.
    ch.join()
      .receive('ok', (reply: { participant_id: string; host: boolean; state: RoomState }) => {
        setMe({ id: reply.participant_id, host: reply.host })
        setState(reply.state)
        setChannelUp(true)
        setError(null)
        if (listeningRef.current) ch.push('listen', { on: true })
      })
      .receive('error', (e: { reason: string; recording_id?: number }) =>
        setError(e.reason === 'full' ? 'This session is full (8 people).' : e.reason === 'finished' ? 'This session has finished.' : `Could not join (${e.reason})`),
      )

    // Mic -> 16 kHz chunks -> level meter + (while a take is running) the server.
    // Nothing is pushed while disconnected: phoenix would queue it and replay it as a burst.
    ;(async () => {
      try {
        const kit = await kitReady
        capture = await startCapture((chunk) => {
          const level = Math.min(1, kit.rms_level(chunk) * 4)
          setMyLevel(level)
          if (ch.state !== 'joined') return
          ch.push('level', { v: mutedRef.current ? 0 : level })
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

  const toggleMute = useCallback(() => setMuted((m) => !m), [])

  function hostAction(event: 'start' | 'stop') {
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

  function leave() {
    if (recording && !confirm(isHost ? 'A take is running and you’re the host. Leave anyway?' : 'A take is running. Leave anyway?')) return
    navigate('/')
  }

  const link = `${location.origin}/s/${session.id}`
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      linkRef.current?.select()
      setCopyFailed(true)
    }
  }

  useHotkeys({ m: toggleMute, l: toggleListen }, state.status !== 'finished')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{session.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-mute">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-link' : 'bg-hairline-strong'}`} />
            {connected ? 'Connected' : me ? 'Reconnecting…' : 'Connecting…'} ·{' '}
            {state.status === 'open' && 'Waiting to start'}
            {recording && `Recording ${fmtDuration(elapsed)}`}
            {state.status === 'finished' && 'Finished'}
          </p>
        </div>
        <Button variant="ghost" onClick={leave}>Leave</Button>
      </div>

      {me && !connected && (
        <Banner tone="warn">
          {!online
            ? 'You’re offline. We’ll reconnect automatically when your network is back.'
            : recording
              ? 'Connection lost — your audio isn’t reaching the recording until you’re back. Reconnecting…'
              : 'Connection lost — reconnecting…'}
        </Banner>
      )}
      <ErrorNote error={error} />

      {state.status !== 'finished' && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">Invite people</h2>
          <div className="flex flex-wrap gap-3">
            <input ref={linkRef} readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className={`${inputClass} flex-1 bg-canvas-soft font-mono text-xs`} />
            <Button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
            {typeof navigator.share === 'function' && (
              <Button onClick={() => void navigator.share({ title: session.name, url: link }).catch(() => {})}>Share…</Button>
            )}
          </div>
          {copyFailed && <p className="mt-2 text-xs text-mute">Couldn’t copy automatically — the link is selected, press Ctrl/⌘+C.</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">In the room</h2>
        <ul className="space-y-3">
          {state.participants.map((p) => {
            const mine = p.id === me?.id
            const v = mine ? (muted ? 0 : myLevel) : (levels[p.id]?.v ?? 0)
            return (
              <li key={p.id} className="flex items-center gap-3">
                <span className="flex w-28 shrink-0 items-center gap-2 truncate text-sm text-ink sm:w-44">
                  <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition ${p.live && v > 0.1 ? 'border-link text-link' : 'border-hairline text-mute'}`}>
                    {p.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="truncate">
                    {p.name}
                    {mine && <span className="text-mute"> (you)</span>}
                  </span>
                  {p.host && <span className="rounded-full border border-hairline px-1.5 text-[10px] text-mute">host</span>}
                  {mine && muted && <span className="rounded-full border border-hairline px-1.5 text-[10px] text-mute">muted</span>}
                </span>
                <div className="min-w-0 flex-1">
                  {p.live ? <Meter value={v} hold label={`${p.name} level`} /> : <span className="text-xs text-mute">disconnected</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {state.status !== 'finished' && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas/95 p-3 shadow-lg backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'} <Kbd>M</Kbd></Button>
          <Button onClick={toggleListen} aria-pressed={listening}>{listening ? 'Stop listening' : 'Listen live'} <Kbd>L</Kbd></Button>
          <span className="grow" />
          {isHost && state.status === 'open' && (
            <Button variant="primary" onClick={() => hostAction('start')} disabled={busy || !connected} className="w-full sm:w-auto">● Start recording</Button>
          )}
          {isHost && recording && (
            <Button variant="danger" onClick={() => hostAction('stop')} disabled={busy} className="w-full sm:w-auto">{busy ? 'Mixing…' : '■ Stop & save mix'}</Button>
          )}
          {!isHost && <span className="text-xs text-mute">Only the host can start and stop. Use headphones when listening live.</span>}
        </div>
      )}

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
