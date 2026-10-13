import { useEffect, useRef, useState } from 'react'
import { uploadRecording, type Recording } from '../lib/api'
import { defaultTitle, fmtClock, pickMime } from '../lib/format'
import { kitReady } from '../lib/kit'
import { Button, ErrorNote, Icon } from './ui'
import { Rosette, newLive } from './Rosette'

type State = 'idle' | 'recording' | 'paused' | 'saving'

/** Stage-side recorder: a coral disc inside the live rosette, with pause, discard and a spacebar shortcut. */
export function Recorder({ onSaved }: { onSaved: (r: Recording) => void }) {
  const [state, setState] = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [clipping, setClipping] = useState(false)

  const live = useRef(newLive())
  const cleanup = useRef<(() => void) | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const titleRef = useRef('')
  const discard = useRef(false)
  // Pause-aware clock: `acc` is time already banked, `since` is when the running segment began.
  const clock = useRef<{ acc: number; since: number | null }>({ acc: 0, since: null })
  const toggleRef = useRef<() => void>(() => {})
  const stateRef = useRef<State>('idle')

  titleRef.current = title
  stateRef.current = state

  const elapsedMs = () => clock.current.acc + (clock.current.since === null ? 0 : performance.now() - clock.current.since)
  const freeze = () => {
    clock.current.acc = elapsedMs()
    clock.current.since = null
  }

  useEffect(() => () => cleanup.current?.(), [])

  // Warn before a reload or tab close throws away a take in progress.
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  async function start() {
    setError(null)
    discard.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)

      // Live input: analyser frames go through the WASM rms_level; the spectrum drives the rosette.
      const kit = await kitReady
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.55
      ctx.createMediaStreamSource(stream).connect(analyser)
      const frame = new Float32Array(analyser.fftSize)
      const bins = new Uint8Array(analyser.frequencyBinCount)
      live.current.bins = bins
      live.current.active = true
      live.current.paused = false

      clock.current = { acc: 0, since: performance.now() }
      let raf = 0
      let lastTick = -1
      let clipUntil = 0
      let clipOn = false
      const tick = () => {
        analyser.getFloatTimeDomainData(frame)
        analyser.getByteFrequencyData(bins)
        const now = performance.now()
        let peak = 0
        for (let i = 0; i < frame.length; i++) peak = Math.max(peak, Math.abs(frame[i]))
        live.current.level = Math.min(1, kit.rms_level(frame) * 4)
        if (peak >= 0.985 && clock.current.since !== null) clipUntil = now + 2500
        const c = now < clipUntil
        if (c !== clipOn) {
          clipOn = c
          setClipping(c)
        }
        const ms = elapsedMs()
        const slot = Math.floor(ms / 100)
        if (slot !== lastTick) {
          lastTick = slot
          setElapsed(ms)
        }
        raf = requestAnimationFrame(tick)
      }
      tick()

      cleanup.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        live.current.active = false
        live.current.paused = false
        live.current.bins = null
        live.current.level = 0
        setClipping(false)
      }

      rec.onstop = async () => {
        const durationMs = clock.current.acc
        cleanup.current?.()
        cleanup.current = null
        if (discard.current) {
          setState('idle')
          setElapsed(0)
          return
        }
        setState('saving')
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
          const saved = await uploadRecording(blob, { title: titleRef.current.trim() || defaultTitle(), durationMs })
          setTitle('')
          onSaved(saved)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed. Check your connection and record again.')
        } finally {
          setState('idle')
          setElapsed(0)
        }
      }
      recorder.current = rec
      rec.start(250)
      setState('recording')
    } catch (e) {
      cleanup.current?.()
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s site settings and try again.'
          : e instanceof Error
            ? e.message
            : 'Could not start recording',
      )
    }
  }

  function stop() {
    freeze()
    recorder.current?.stop()
  }

  function togglePause() {
    const rec = recorder.current
    if (!rec) return
    if (state === 'recording') {
      rec.pause()
      freeze()
      live.current.paused = true
      setState('paused')
    } else if (state === 'paused') {
      rec.resume()
      clock.current.since = performance.now()
      live.current.paused = false
      setState('recording')
    }
  }

  function discardTake() {
    if (elapsedMs() > 5000 && !confirm('Discard this recording? It hasn’t been saved yet.')) return
    discard.current = true
    freeze()
    recorder.current?.stop()
  }

  toggleRef.current = () => {
    if (stateRef.current === 'idle') void start()
    else if (stateRef.current === 'recording' || stateRef.current === 'paused') stop()
  }

  // Spacebar starts and stops, unless focus is on something that already uses it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input,textarea,select,button,a,summary,[contenteditable="true"]')) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = state === 'recording' || state === 'paused'
  const status = {
    idle: 'Ready when you are.',
    recording: 'Recording',
    paused: 'Paused. Your take is on hold.',
    saving: 'Saving to your library…',
  }[state]

  return (
    <div className="flex flex-col items-center">
      <Rosette live={live}>
        <button
          onClick={() => (state === 'idle' ? void start() : stop())}
          disabled={state === 'saving'}
          aria-label={state === 'idle' ? 'Start recording' : 'Stop and save recording'}
          className="grid h-[32%] w-[32%] place-items-center rounded-full bg-coral text-white transition-transform hover:scale-105 disabled:opacity-60"
        >
          <span className="flex flex-col items-center gap-1">
            {active ? <Icon name="stop" className="h-6 w-6" /> : <Icon name="mic" className="h-6 w-6" />}
            <span className="font-display text-xl font-medium leading-none">
              {state === 'idle' ? 'Record' : state === 'saving' ? 'Saving' : 'Stop'}
            </span>
          </span>
        </button>
      </Rosette>

      <p className="mt-2 font-display text-6xl font-light tabular-nums tracking-tight" aria-label="Elapsed time">
        {fmtClock(elapsed)}
      </p>
      <p className="mt-1 text-sm text-white/75" aria-live="polite">
        {status}
      </p>

      <div className="mt-5 flex min-h-10 items-center gap-3">
        {active && (
          <>
            <Button variant="onStage" size="sm" onClick={togglePause}>
              <Icon name={state === 'paused' ? 'play' : 'pause'} className="h-3.5 w-3.5" />
              {state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="onStage" size="sm" onClick={discardTake}>
              Discard
            </Button>
          </>
        )}
      </div>

      <div className="mt-4 w-full max-w-xs">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={state !== 'idle'}
          placeholder="Name this take (optional)"
          maxLength={120}
          aria-label="Recording title"
          className="w-full border-b border-white/40 bg-transparent px-1 pb-2 text-center text-white placeholder:text-white/55 focus:border-white focus:outline-none disabled:opacity-50"
        />
      </div>

      <div className="mt-4 min-h-6 text-center text-sm" aria-live="polite">
        {clipping && <p className="text-butter">Your input is clipping. Move back from the mic or lower its volume.</p>}
        {!clipping && state === 'idle' && <p className="text-white/55 max-md:hidden">Press space to start and stop.</p>}
      </div>
      <div className="mt-2 w-full max-w-md">
        <ErrorNote error={error} onStage />
      </div>
    </div>
  )
}
