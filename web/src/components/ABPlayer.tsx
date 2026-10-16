import { useRef, type RefObject } from 'react'
import { Kbd, Segmented } from './ui'

export type Side = 'A' | 'B'

/**
 * One <audio> element that flips between the original (A) and processed (B)
 * source. Playback position and play/pause state carry over, so you can
 * A/B the same passage without hunting for it. (Position is time-based, so a
 * trim effect shifts the matching moment slightly.)
 */
export function ABPlayer({
  aUrl,
  bUrl,
  side,
  onSide,
  audioRef,
}: {
  aUrl: string
  bUrl: string
  side: Side
  onSide: (s: Side) => void
  audioRef: RefObject<HTMLAudioElement | null>
}) {
  const url = side === 'A' ? aUrl : bUrl
  const lastUrl = useRef(url)
  const pending = useRef<{ t: number; play: boolean } | null>(null)

  // A new src resets the element, so snapshot where we were *before* React commits it.
  // This covers both an A/B flip and a fresh render from live preview.
  if (lastUrl.current !== url) {
    const el = audioRef.current
    pending.current = el ? { t: el.currentTime, play: !el.paused } : null
    lastUrl.current = url
  }

  function restore() {
    const el = audioRef.current
    const p = pending.current
    pending.current = null
    if (!el || !p) return
    el.currentTime = Math.min(p.t, Number.isFinite(el.duration) ? el.duration : p.t)
    if (p.play) void el.play().catch(() => {})
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Segmented
          label="Compare original and processed"
          value={side}
          onChange={onSide}
          options={[
            { value: 'A', label: 'A · Original' },
            { value: 'B', label: 'B · Processed' },
          ]}
        />
        <span className="text-xs text-mute">
          <Kbd>B</Kbd> switches while playing
        </span>
      </div>
      <audio ref={audioRef} controls src={url} onLoadedMetadata={restore} className="w-full" />
    </div>
  )
}
