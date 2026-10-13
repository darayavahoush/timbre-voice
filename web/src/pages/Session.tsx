import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Socket, type Channel } from 'phoenix'
import { Button, ErrorNote, Icon, LinkButton, Stage } from '../components/ui'
import { Player } from '../components/Player'
import { getRecording, getSession, type Recording, type Session as SessionInfo } from '../lib/api'
import { LivePlayer, startCapture, type MicCapture } from '../lib/capture'
import { fmtClock } from '../lib/format'
import { kitReady } from '../lib/kit'
import { clientId, getHostToken, savedName, saveName } from '../lib/session'

type Participant = { id: string; name: string; host: boolean; live: boolean }
type RoomState = { status: 'open' | 'recording' | 'finished'; recording_id: number | null; participants: Participant[] }

const TILE_COLORS = ['#2a2ee6', '#ff5a3c', '#12133a', '#6a4cff', '#0f8f6e']
const colorFor = (s: string) => TILE_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE_COLORS.length]

function Masthead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Stage>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white">
        <Icon name="chevron" className="h-3.5 w-3.5" />
        Library
      </Link>
      <h1 className="mt-6 max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] font-light leading-[1.02] tracking-[-0.02em]">{title}</h1>
      {children}
    </Stage>
  )
}

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
      <>
        <Masthead title="Session not found" />
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="text-ink">This link doesn’t match a session. Check it with whoever sent it, or start a new one.</p>
          <LinkButton to="/" variant="ink" className="mt-5">
            Go to your library
          </LinkButton>
        </div>
      </>
    )
  }
  if (!info) {
    return (
      <>
        <Masthead title="Joining…" />
        <div className="mx-auto max-w-6xl px-6 py-12 text-mute">Loading session…</div>
      </>
    )
  }

  if (!joined) {
    const done = info.status === 'finished' && info.recording_id
    return (
      <>
        <Masthead title={info.name}>
          <p className="mt-4 max-w-xl text-lg text-white/80">
            {done ? 'This session has finished.' : 'Join to share your microphone with everyone in this session. Use headphones to avoid feedback.'}
          </p>
        </Masthead>
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="max-w-md rounded-2xl border border-line bg-card p-6">
            {done ? (
              <FinishedPlayer recordingId={info.recording_id!} />
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveName(name)
                  setJoined(true)
                }}
              >
                <label className="block text-sm font-semibold text-ink" htmlFor="join-name">
                  Your name
                </label>
                <input
                  id="join-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  required
                  autoFocus
                  placeholder="How should others see you?"
                  className="w-full rounded-xl border border-line-strong bg-paper px-4 py-2.5 text-ink placeholder:text-mute"
                />
                <Button variant="primary" type="submit" className="w-full">
                  Join the session
                </Button>
              </form>
            )}
          </div>
        </div>
      </>
    )
  }
  return <Room session={info} name={name.trim() || 'Guest'} />
}

function FinishedPlayer({ recordingId }: { recordingId: number }) {
  const [rec, setRec] = useState<Recording | null>(null)
  useEffect(() => {
    getRecording(recordingId).then(setRec).catch(() => setRec(null))
  }, [recordingId])
  return (
    <div className="space-y-4">
      <p className="text-sm text-body">Here’s the mixed recording.</p>
      <Player src={`/api/recordings/${recordingId}/audio`} durationMs={rec?.duration_ms ?? 0} />
      <LinkButton to={`/studio/${recordingId}`} variant="outline" size="sm">
        Open in Studio
      </LinkButton>
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
  const live = state.status === 'recording'

  return (
    <>
      <Masthead title={session.name}>
        <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
          {live && (
            <p className="font-display text-7xl font-light tabular-nums leading-none tracking-tight" aria-label="Elapsed time">
              {fmtClock(elapsed)}
            </p>
          )}
          <p className="flex items-center gap-2 text-white/80" aria-live="polite">
            <span className={`h-2.5 w-2.5 rounded-full ${!connected ? 'bg-white/30' : live ? 'bg-coral' : 'bg-mint'}`} />
            {!connected ? 'Connecting…' : state.status === 'open' ? 'Waiting for the host to start' : live ? 'Recording' : 'Finished'}
          </p>
        </div>
      </Masthead>

      <div className="mx-auto max-w-6xl space-y-10 px-6 py-12">
        <ErrorNote error={error} />

        {state.status !== 'finished' && (
          <section aria-labelledby="invite-h">
            <h2 id="invite-h" className="text-2xl font-medium tracking-tight text-ink">
              Invite people
            </h2>
            <div className="mt-3 flex max-w-xl gap-2">
              <input
                readOnly
                value={link}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-full border border-line-strong bg-card px-4 py-2.5 text-sm text-ink"
              />
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }
              >
                <Icon name="copy" />
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </section>
        )}

        <section aria-labelledby="room-h">
          <h2 id="room-h" className="text-2xl font-medium tracking-tight text-ink">
            In the room <span className="font-sans text-base font-normal text-mute">{state.participants.filter((p) => p.live).length} connected</span>
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {state.participants.map((p) => {
              const isMe = p.id === me?.id
              const level = !p.live ? 0 : isMe ? (muted ? 0 : myLevel) : (levels[p.id] ?? 0)
              const color = colorFor(p.name)
              return (
                <li key={p.id} className={`rounded-2xl border border-line bg-card p-5 ${p.live ? '' : 'opacity-50'}`}>
                  <div className="relative mx-auto grid h-24 w-24 place-items-center">
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full transition-transform duration-100"
                      style={{ background: color, opacity: 0.18 + level * 0.4, transform: `scale(${1 + level * 0.45})` }}
                    />
                    <span
                      className="relative grid h-20 w-20 place-items-center rounded-full font-display text-3xl font-medium text-white"
                      style={{ background: color }}
                    >
                      {(p.name.trim()[0] ?? '?').toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-4 truncate text-center font-semibold text-ink">
                    {p.name}
                    {isMe && <span className="font-normal text-mute"> (you)</span>}
                  </p>
                  <p className="mt-1 text-center text-xs text-mute">
                    {!p.live ? 'Disconnected' : p.host ? 'Host' : isMe && muted ? 'Muted' : 'Guest'}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>

        {state.status !== 'finished' && (
          <section className="flex flex-wrap items-center gap-3 border-t border-line pt-8" aria-label="Session controls">
            <Button onClick={() => setMuted((m) => !m)} aria-pressed={muted}>
              {muted ? 'Unmute my mic' : 'Mute my mic'}
            </Button>
            <Button onClick={toggleListen} aria-pressed={listening}>
              {listening ? 'Stop listening live' : 'Listen live (use headphones)'}
            </Button>
            <span className="grow" />
            {isHost && state.status === 'open' && (
              <Button variant="primary" onClick={() => hostAction('start')} disabled={busy || !connected}>
                <Icon name="mic" />
                Start recording
              </Button>
            )}
            {isHost && state.status === 'recording' && (
              <Button variant="primary" onClick={() => hostAction('stop')} disabled={busy}>
                <Icon name="stop" />
                {busy ? 'Mixing…' : 'Stop and save the mix'}
              </Button>
            )}
            {!isHost && <span className="text-sm text-mute">Only the host can start and stop.</span>}
          </section>
        )}

        {state.status === 'finished' && state.recording_id && (
          <section className="max-w-xl rounded-2xl border border-line bg-card p-6">
            <h2 className="mb-3 text-2xl font-medium tracking-tight text-ink">Mixed recording</h2>
            <FinishedPlayer recordingId={state.recording_id} />
            <LinkButton to="/" variant="ghost" size="sm" className="mt-3">
              Back to your library
            </LinkButton>
          </section>
        )}
      </div>
    </>
  )
}
