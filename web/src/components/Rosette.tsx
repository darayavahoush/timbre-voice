import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

/** Shared, mutable audio state: written by the recorder every frame, read by the canvas. */
export type Live = { level: number; bins: Uint8Array | null; active: boolean; paused: boolean }
export const newLive = (): Live => ({ level: 0, bins: null, active: false, paused: false })

const PETALS = 72

/**
 * The signature element: a ring of petals that follows the live spectrum of
 * the microphone (low frequencies at the top, mirrored left/right). When no
 * mic is open it breathes slowly so the page never looks dead.
 */
export function Rosette({ live, children }: { live: RefObject<Live>; children?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const smooth = new Float32Array(PETALS)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      // Not laid out yet (hidden tab, zero-size container): skip this frame.
      if (w < 1 || h < 1) {
        raf = requestAnimationFrame(draw)
        return
      }
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) / 2
      const r0 = R * 0.36
      const maxLen = R * 0.62
      const L = live.current
      const hot = L.bins && L.active && !L.paused

      for (let i = 0; i < PETALS; i++) {
        const j = Math.min(i, PETALS - 1 - i)
        const u = j / (PETALS / 2 - 1)
        let target: number
        if (hot) {
          const k = Math.round(2 + Math.pow(u, 1.5) * 90)
          target = Math.min(1, ((L.bins![Math.min(k, L.bins!.length - 1)] ?? 0) / 255) * (1.15 + u * 0.9))
        } else {
          const b = reduce ? 0 : Math.sin(t / 1400 + j * 0.28) * 0.5 + Math.sin(t / 2300 - j * 0.11) * 0.5
          target = 0.17 + 0.13 * (b + 1) * (L.paused ? 0.35 : 1)
        }
        smooth[i] += (target - smooth[i]) * (target > smooth[i] ? 0.5 : 0.12)
        const v = smooth[i]
        const a = -Math.PI / 2 + (i / PETALS) * Math.PI * 2
        const len = 6 + v * maxLen
        g.lineCap = 'round'
        g.lineWidth = Math.max(3, ((2 * Math.PI * r0) / PETALS) * 0.62)
        g.strokeStyle = v > 0.62 ? `rgba(255,150,125,${0.7 + v * 0.3})` : `rgba(255,255,255,${0.4 + v * 0.6})`
        g.beginPath()
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len))
        g.stroke()
      }
      // Faint inner ring that swells with overall loudness.
      g.lineWidth = 1.5
      g.strokeStyle = 'rgba(255,255,255,0.25)'
      g.beginPath()
      g.arc(cx, cy, Math.max(1, r0 - 10 - (hot ? L.level * 8 : 0)), 0, Math.PI * 2)
      g.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div className="relative aspect-square w-full max-w-[26rem]">
      <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}
