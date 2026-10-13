import type { ButtonHTMLAttributes, ReactNode } from 'react'

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed'

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
  return <button {...props} className={`${base} ${styles} ${className}`} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-hairline bg-canvas p-5 ${className}`}>{children}</section>
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
      {error}
    </p>
  )
}

export function Meter({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hairline" aria-hidden>
      <div className="h-full rounded-full bg-link transition-[width] duration-100" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}
