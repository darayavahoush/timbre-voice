import { useEffect, useRef } from 'react'
import { Button, Kbd } from './ui'

const GROUPS: { title: string; items: [string[], string][] }[] = [
  { title: 'Everywhere', items: [[['?'], 'Show this help']] },
  { title: 'Home', items: [[['R'], 'Start / stop recording'], [['P'], 'Pause / resume'], [['/'], 'Search the library']] },
  {
    title: 'Studio',
    items: [
      [['A'], 'Apply effects'],
      [['B'], 'Switch original ⇄ processed'],
      [['Space'], 'Play / pause'],
      [['Ctrl/⌘', 'Z'], 'Undo'],
      [['Ctrl/⌘', 'Shift', 'Z'], 'Redo'],
    ],
  },
  { title: 'Session', items: [[['M'], 'Mute / unmute'], [['L'], 'Listen live on/off']] },
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-hairline bg-canvas p-5 text-body backdrop:bg-black/40"
    >
      <h2 id="shortcuts-title" className="text-base font-semibold text-ink">Keyboard shortcuts</h2>
      <div className="mt-3 space-y-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-mute">{g.title}</h3>
            <ul className="space-y-1.5">
              {g.items.map(([keys, label]) => (
                <li key={label} className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 text-right">
        <Button onClick={onClose}>Close</Button>
      </div>
    </dialog>
  )
}
