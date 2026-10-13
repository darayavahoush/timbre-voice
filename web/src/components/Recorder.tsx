import { useEffect, useRef, useState } from 'react'
import { uploadRecording, type Recording } from '../lib/api'
import { defaultTitle, fmtDuration, pickMime } from '../lib/format'
import { kitReady } from '../lib/kit'
import { Button, Card, ErrorNote, Meter } from './ui'

type State = 'idle' | 'recording' | 'saving'

export function Recorder({ onSaved }: { onSaved: (r: Recording) => void }) {
  const [state, setState] = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  async function start() {
    setError(null)
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
      const t0 = performance.now()
      let raf = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(frame)
        setLevel(Math.min(1, kit.rms_level(frame) * 4))
        setElapsed(performance.now() - t0)
        raf = requestAnimationFrame(tick)
      }
      tick()

      cleanup.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        setLevel(0)
      }

      rec.onstop = async () => {
        const durationMs = performance.now() - t0
        cleanup.current?.()
        cleanup.current = null
        setState('saving')
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })
          const saved = await uploadRecording(blob, { title: title.trim() || defaultTitle(), durationMs })
          setTitle('')
          onSaved(saved)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed')
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
          ? 'Microphone access was blocked. Allow it in the browser and try again.'
          : e instanceof Error
            ? e.message
            : 'Could not start recording',
      )
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-ink">Record</h2>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={state !== 'idle'}
          placeholder="Title (optional)"
          maxLength={120}
          aria-label="Recording title"
          className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-sm text-ink"
        />
        {state === 'recording' ? (
          <Button variant="danger" onClick={() => recorder.current?.stop()}>
            ■ Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={state === 'saving'}>
            {state === 'saving' ? 'Saving…' : '● Record'}
          </Button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="w-12 font-mono text-sm tabular-nums text-ink">{fmtDuration(elapsed)}</span>
        <Meter value={level} />
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  )
}
