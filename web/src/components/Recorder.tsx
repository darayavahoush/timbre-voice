import { useEffect, useRef, useState } from 'react'
import { uploadRecording, type Recording } from '../lib/api'
import { defaultTitle, fmtDuration, pickMime } from '../lib/format'
import { useHotkeys } from '../lib/hooks'
import { kitReady } from '../lib/kit'
import { Button, Card, ErrorNote, inputClass, Kbd, Meter, ProgressBar, Spinner } from './ui'

type State = 'idle' | 'recording' | 'paused' | 'saving'
type Take = { blob: Blob; durationMs: number; title: string }

export function Recorder({ onSaved }: { onSaved: (r: Recording) => void }) {
  const [state, setState] = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [title, setTitle] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // A take whose upload failed is kept so a flaky connection never loses a recording.
  const [failed, setFailed] = useState<Take | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const discard = useRef(false)
  // Wall-clock excluding paused time: `since === 0` means paused.
  const clock = useRef({ acc: 0, since: 0 })
  const now = () => clock.current.acc + (clock.current.since ? performance.now() - clock.current.since : 0)

  const active = state === 'recording' || state === 'paused'

  useEffect(
    () => () => {
      discard.current = true
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
      cleanup.current?.()
    },
    [],
  )

  // Don't let a stray refresh eat a take.
  useEffect(() => {
    if (!active && !failed) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [active, failed])

  async function send(take: Take) {
    setState('saving')
    setProgress(0)
    setError(null)
    try {
      const saved = await uploadRecording(take.blob, { title: take.title, durationMs: take.durationMs }, setProgress)
      setFailed(null)
      setTitle('')
      onSaved(saved)
    } catch (e) {
      setFailed(take)
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setState('idle')
      setElapsed(0)
    }
  }

  async function start() {
    setError(null)
    setFailed(null)
    discard.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)

      // Live input meter: analyser frames go through the WASM rms_level.
      const kit = await kitReady
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const frame = new Float32Array(analyser.fftSize)
      clock.current = { acc: 0, since: performance.now() }
      let raf = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(frame)
        setLevel(clock.current.since ? Math.min(1, kit.rms_level(frame) * 4) : 0)
        setElapsed(now())
        raf = requestAnimationFrame(tick)
      }
      tick()

      cleanup.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        setLevel(0)
      }

      // The mic vanishing mid-take (unplugged, permission revoked) ends the take cleanly.
      stream.getAudioTracks()[0]?.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop())

      rec.onstop = () => {
        const durationMs = now()
        cleanup.current?.()
        cleanup.current = null
        recorder.current = null
        if (discard.current) {
          setState('idle')
          setElapsed(0)
          return
        }
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
        if (blob.size === 0) {
          setError('No audio was captured. Check your microphone and try again.')
          setState('idle')
          setElapsed(0)
          return
        }
        void send({ blob, durationMs, title: title.trim() || defaultTitle() })
      }
      recorder.current = rec
      rec.start(250)
      setState('recording')
    } catch (e) {
      cleanup.current?.()
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser and try again.'
          : e instanceof DOMException && e.name === 'NotFoundError'
            ? 'No microphone was found.'
            : e instanceof Error
              ? e.message
              : 'Could not start recording',
      )
    }
  }

  function togglePause() {
    const rec = recorder.current
    if (!rec) return
    if (rec.state === 'recording') {
      clock.current = { acc: now(), since: 0 }
      rec.pause()
      setState('paused')
    } else if (rec.state === 'paused') {
      clock.current.since = performance.now()
      rec.resume()
      setState('recording')
    }
  }

  function stop() {
    recorder.current?.stop()
  }

  function discardTake() {
    discard.current = true
    recorder.current?.stop()
  }

  useHotkeys({
    r: () => (active ? stop() : state === 'idle' && void start()),
    p: () => active && togglePause(),
  })

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Record</h2>
        <span aria-live="polite" className="flex items-center gap-1.5 text-xs text-mute">
          {state === 'recording' && (
            <>
              <span className="h-2 w-2 rounded-full bg-red-500 motion-safe:animate-pulse" /> Recording
            </>
          )}
          {state === 'paused' && 'Paused'}
          {state === 'saving' && (
            <>
              <Spinner /> Uploading
            </>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={state !== 'idle'}
          placeholder="Title (optional)"
          maxLength={120}
          aria-label="Recording title"
          className={`${inputClass} flex-1`}
        />
        {active ? (
          <div className="flex gap-2">
            <Button onClick={togglePause}>{state === 'paused' ? '▶ Resume' : '❚❚ Pause'}</Button>
            <Button variant="danger" onClick={stop}>■ Stop &amp; save</Button>
            <Button variant="ghost" onClick={discardTake}>Discard</Button>
          </div>
        ) : (
          <Button variant="primary" onClick={start} disabled={state === 'saving'}>
            ● Record <Kbd>R</Kbd>
          </Button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="w-12 font-mono text-sm tabular-nums text-ink" role="timer" aria-label="Elapsed time">{fmtDuration(elapsed)}</span>
        <Meter value={level} hold label="Input level" />
      </div>
      {state === 'saving' && (
        <div className="mt-3">
          <ProgressBar value={progress} label="Upload progress" />
        </div>
      )}
      <div className="mt-3">
        <ErrorNote error={error}>
          {failed && (
            <>
              <Button onClick={() => send(failed)} className="!py-0.5">Retry upload</Button>
              <Button variant="ghost" onClick={() => { setFailed(null); setError(null) }} className="!py-0.5">Discard</Button>
            </>
          )}
        </ErrorNote>
      </div>
    </Card>
  )
}
