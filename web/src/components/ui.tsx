import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed'

export const inputClass =
  'min-w-0 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-mute'

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) {
  const styles = {
    default: 'border border-hairline-strong text-ink hover:bg-canvas-soft',
    primary: 'bg-ink text-canvas hover:opacity-85',
    danger: 'border border-red-500/40 text-red-500 hover:bg-red-500/10',
    ghost: 'text-mute hover:text-ink',
  }[variant]
  return <button type="button" {...props} className={`${base} ${styles} ${className}`} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-hairline bg-canvas p-5 ${className}`}>{children}</section>
}

export function ErrorNote({ error, children }: { error: string | null; children?: ReactNode }) {
  if (!error) return null
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
      <span>{error}</span>
      {children && <span className="flex gap-2">{children}</span>}
    </div>
  )
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const cls = tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-hairline bg-canvas-soft text-body'
  return (
    <div role="status" className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  )
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-hairline">
      <div className="h-full rounded-full bg-link transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-hairline-strong bg-canvas-soft px-1.5 py-px font-mono text-[10px] text-ink">{children}</kbd>
}

/** Level meter with optional peak-hold tick; turns red when clipping. */
export function Meter({ value, hold = false, label = 'Level' }: { value: number; hold?: boolean; label?: string }) {
  const v = Math.min(1, Math.max(0, value))
  const [peak, setPeak] = useState(0)
  useEffect(() => {
    if (hold) setPeak((p) => Math.max(p, v))
  }, [hold, v])
  useEffect(() => {
    if (!hold) return
    const t = setInterval(() => setPeak((p) => (p > 0 ? Math.max(0, p - 0.04) : p)), 100)
    return () => clearInterval(t)
  }, [hold])
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-hairline"
    >
      <div className={`h-full rounded-full duration-100 motion-safe:transition-[width] ${v > 0.95 ? 'bg-red-500' : 'bg-link'}`} style={{ width: `${v * 100}%` }} />
      {hold && peak > 0.02 && <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `calc(${peak * 100}% - 2px)` }} />}
    </div>
  )
}

/** Compact multi-option toggle (filters, A/B). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-hairline p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${value === o.value ? 'bg-ink text-canvas' : 'text-mute hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
