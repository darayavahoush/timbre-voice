import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { fmtClock } from '../lib/format'

const SEEK_STEP_S = 5

/**
 * Rounded peak-bar waveform with a playhead. `peaks` are 0..1 values (from the
 * WASM `waveform_peaks`). Played bars use the CSS text colour (`className`),
 * the rest are the same colour faded.
 *
 * Pass `audioRef` to make it interactive: click or drag to seek, arrow keys to
 * nudge 5 s, Space to play/pause. It follows the element while it plays.
 */
export function Waveform({
  peaks,
  label,
  className = 'text-link',
  audioRef,
  durationMs,
}: {
  peaks: Float32Array | null
  label: string
  className?: string
  audioRef?: RefObject<HTMLAudioElement | null>
  /** MediaRecorder WebM reports `duration === Infinity`, so the stored length is the fallback. */
  durationMs?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const seekable = !!audioRef

  const lengthS = useCallback((): number => {
    const d = audioRef?.current?.duration
    return d && Number.isFinite(d) ? d : (durationMs ?? 0) / 1000
  }, [audioRef, durationMs])

  // Follow the audio element: rAF while playing so the playhead glides
  // instead of ticking ~4x/s like `timeupdate`.
  // `peaks` is a dep because the <audio> element often mounts in the same
  // render that delivers them, after this component's first effect run.
  useEffect(() => {
    const audio = audioRef?.current
    if (!audio) return
    let raf = 0
    const sync = () => {
      const len = lengthS()
      setProgress(len > 0 ? Math.min(1, audio.currentTime / len) : 0)
    }
    const loop = () => {
      sync()
      raf = requestAnimationFrame(loop)
    }
    const onPlay = () => {
      cancelAnimationFrame(raf)
      loop()
    }
    const onStop = () => {
      cancelAnimationFrame(raf)
      sync()
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onStop)
    audio.addEventListener('ended', onStop)
    audio.addEventListener('seeked', sync)
    audio.addEventListener('loadedmetadata', sync)
    if (audio.paused) sync()
    else onPlay()
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onStop)
      audio.removeEventListener('ended', onStop)
      audio.removeEventListener('seeked', sync)
      audio.removeEventListener('loadedmetadata', sync)
    }
  }, [audioRef, lengthS, peaks])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    canvas.width = w * dpr
    canvas.height = h * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    if (!peaks || peaks.length === 0) return
    const css = getComputedStyle(canvas)
    const color = css.color
    const ink = css.getPropertyValue('--color-ink').trim() || color
    const step = w / peaks.length
    const bar = Math.max(2, step * 0.6)
    const playedX = progress * w
    for (let i = 0; i < peaks.length; i++) {
      const bh = Math.max(3, Math.min(1, peaks[i]) * h)
      const x = i * step + (step - bar) / 2
      g.globalAlpha = !seekable || x + bar / 2 <= playedX ? 1 : 0.32
      g.fillStyle = color
      g.beginPath()
      g.roundRect(x, (h - bh) / 2, bar, bh, bar / 2)
      g.fill()
    }
    g.globalAlpha = 1
    if (seekable) {
      if (hover !== null && !scrubbing) {
        g.globalAlpha = 0.35
        g.fillStyle = ink
        g.fillRect(hover * w - 0.5, 0, 1, h)
        g.globalAlpha = 1
      }
      g.fillStyle = ink
      g.fillRect(Math.min(w - 2, Math.max(0, playedX - 1)), 0, 2, h)
    }
  }, [peaks, progress, hover, scrubbing, seekable])

  useEffect(draw, [draw])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw])

  const fractionAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const seekTo = (frac: number) => {
    const audio = audioRef?.current
    const len = lengthS()
    if (!audio || len <= 0) return
    audio.currentTime = frac * len
    setProgress(frac)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const audio = audioRef?.current
    const len = lengthS()
    if (!audio || len <= 0) return
    const to = (s: number) => seekTo(Math.min(len, Math.max(0, s)) / len)
    if (e.key === 'ArrowRight') to(audio.currentTime + SEEK_STEP_S)
    else if (e.key === 'ArrowLeft') to(audio.currentTime - SEEK_STEP_S)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(len)
    else if (e.key === ' ' || e.key === 'Enter') void (audio.paused ? audio.play() : audio.pause())
    else return
    e.preventDefault()
  }

  const len = lengthS()
  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role={seekable ? 'slider' : 'img'}
        aria-label={label}
        aria-valuemin={seekable ? 0 : undefined}
        aria-valuemax={seekable ? Math.round(len) : undefined}
        aria-valuenow={seekable ? Math.round(progress * len) : undefined}
        aria-valuetext={seekable ? `${fmtClock(progress * len * 1000)} of ${fmtClock(len * 1000)}` : undefined}
        tabIndex={seekable ? 0 : undefined}
        onKeyDown={seekable ? onKeyDown : undefined}
        onPointerDown={
          seekable
            ? (e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                setScrubbing(true)
                seekTo(fractionAt(e.clientX))
              }
            : undefined
        }
        onPointerMove={
          seekable
            ? (e) => {
                const f = fractionAt(e.clientX)
                setHover(f)
                if (scrubbing) seekTo(f)
              }
            : undefined
        }
        onPointerUp={seekable ? () => setScrubbing(false) : undefined}
        onPointerCancel={seekable ? () => setScrubbing(false) : undefined}
        onPointerLeave={seekable ? () => setHover(null) : undefined}
        className={`block h-20 w-full touch-none ${seekable ? 'cursor-pointer' : ''} ${className}`}
      />
      {seekable && hover !== null && len > 0 && (
        <span
          className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[11px] tabular-nums text-paper"
          style={{ left: `${hover * 100}%` }}
        >
          {fmtClock(hover * len * 1000)}
        </span>
      )}
    </div>
  )
}
