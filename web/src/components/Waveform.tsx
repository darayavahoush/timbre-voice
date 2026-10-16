import { useEffect, useRef } from 'react'

/** Peak-bar waveform; `peaks` are 0..1 values (from the WASM `waveform_peaks`). Redraws on resize. */
export function Waveform({ peaks, label }: { peaks: Float32Array | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
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
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', draw)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', draw)
    }
  }, [peaks])
  return <canvas ref={ref} role="img" aria-label={label} className="h-16 w-full text-link" />
}
