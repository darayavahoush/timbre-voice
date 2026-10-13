import { useEffect, useRef } from 'react'

/** Peak-bar waveform; `peaks` are 0..1 values (from the WASM `waveform_peaks`). */
export function Waveform({ peaks, label }: { peaks: Float32Array | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = canvas
    canvas.width = w * dpr
    canvas.height = h * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    g.fillStyle = getComputedStyle(canvas).color
    if (!peaks) return
    const bar = w / peaks.length
    for (let i = 0; i < peaks.length; i++) {
      const bh = Math.max(1, Math.min(1, peaks[i]) * h)
      g.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 0.5), bh)
    }
  }, [peaks])
  return <canvas ref={ref} role="img" aria-label={label} className="h-16 w-full text-link" />
}
