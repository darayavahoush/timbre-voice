import { useEffect, useRef, useState, type RefObject } from 'react'
import { fmtClock } from '../lib/format'
import { Icon } from './ui'

/** Compact audio player: round play button, coral seek bar, elapsed / total. */
export function Player({
  src,
  durationMs = 0,
  className = '',
  audioRef,
}: {
  src: string
  durationMs?: number
  className?: string
  /** Share the <audio> element with a <Waveform> so clicking the waveform seeks this player. */
  audioRef?: RefObject<HTMLAudioElement | null>
}) {
  const own = useRef<HTMLAudioElement>(null)
  const audio = audioRef ?? own
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(durationMs / 1000)

  useEffect(() => setDur(durationMs / 1000), [durationMs])

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) a.play().catch(() => setPlaying(false))
    else a.pause()
  }
  const seek = (v: number) => {
    if (audio.current) audio.current.currentTime = v
    setT(v)
  }
  const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setT(0)
        }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0 && !durationMs) setDur(d)
        }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral pl-px text-white transition-colors hover:bg-coral-deep"
      >
        <Icon name={playing ? 'pause' : 'play'} className="h-3.5 w-3.5" />
      </button>
      <input
        type="range"
        min={0}
        max={dur || 1}
        step={0.01}
        value={Math.min(t, dur || 1)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Seek"
        style={{ ['--p' as string]: `${pct}%` }}
        className="min-w-0 flex-1"
      />
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-mute">
        {fmtClock(t * 1000)} / {fmtClock(dur * 1000)}
      </span>
    </div>
  )
}
