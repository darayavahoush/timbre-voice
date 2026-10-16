import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

type Variant = 'primary' | 'ink' | 'outline' | 'ghost' | 'danger' | 'onStage'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const sizes = { md: 'px-5 py-2.5 text-sm', sm: 'px-3.5 py-1.5 text-[13px]' }
const variants: Record<Variant, string> = {
  primary: 'bg-coral text-white hover:bg-coral-deep',
  ink: 'bg-ink text-paper hover:opacity-85',
  outline: 'border border-line-strong text-ink hover:bg-ink/5',
  ghost: 'text-mute hover:bg-ink/5 hover:text-ink',
  danger: 'border border-coral/50 text-coral-deep hover:bg-coral/10',
  onStage: 'border border-white/40 text-white hover:bg-white/10',
}

export function buttonClass(variant: Variant = 'outline', size: keyof typeof sizes = 'md', extra = '') {
  return `${base} ${sizes[size]} ${variants[variant]} ${extra}`
}

type Common = { variant?: Variant; size?: keyof typeof sizes }

export function Button({
  variant = 'outline',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & Common) {
  return <button {...props} className={buttonClass(variant, size, className)} />
}

export function LinkButton({ variant = 'outline', size = 'md', className = '', ...props }: LinkProps & Common) {
  return <Link {...props} className={buttonClass(variant, size, className)} />
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-6 ${className}`}>{children}</section>
}

/** The indigo masthead every page opens with; its lower edge is a large curve. */
export function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`on-stage stage-surface rounded-b-[2.5rem] text-white md:rounded-b-[4.5rem] ${className}`}>
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-4 md:pb-20">{children}</div>
    </section>
  )
}

export function ErrorNote({ error, onStage = false }: { error: string | null; onStage?: boolean }) {
  if (!error) return null
  return (
    <p
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm ${
        onStage ? 'border-white/30 bg-white/10 text-white' : 'border-coral/40 bg-coral/10 text-ink'
      }`}
    >
      {error}
    </p>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-coral' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  )
}

export function Icon({ name, className = 'h-4 w-4' }: { name: 'play' | 'pause' | 'stop' | 'chevron' | 'mic' | 'copy'; className?: string }) {
  const p = { className, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true } as const
  switch (name) {
    case 'play':
      return <svg {...p}><path d="M4.5 2.8v10.4a.5.5 0 0 0 .77.42l8.1-5.2a.5.5 0 0 0 0-.84l-8.1-5.2a.5.5 0 0 0-.77.42Z" /></svg>
    case 'pause':
      return <svg {...p}><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
    case 'stop':
      return <svg {...p}><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
    case 'chevron':
      return <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 5 8l5 5" /></svg>
    case 'mic':
      return <svg {...p}><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    case 'copy':
      return <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" /><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H3.3A1.8 1.8 0 0 0 1.5 3.3v5.4a1.8 1.8 0 0 0 1.8 1.8h.2" /></svg>
  }
}
