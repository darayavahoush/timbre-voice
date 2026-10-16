import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Global keyboard shortcuts. Keys are lowercase `event.key` values, optionally
 * prefixed with `mod+` (Ctrl/⌘), `alt+`, and `shift+` (only with mod), e.g.
 * 'r', ' ', '?', 'mod+z', 'mod+shift+z'. Ignored while typing in a field
 * (except Escape) and while a button/link has focus for the Space key.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map)
  useEffect(() => {
    ref.current = map
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const t = e.target as HTMLElement | null
      const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      const mod = e.metaKey || e.ctrlKey
      const combo = `${mod ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${mod && e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`
      const fn = ref.current[combo]
      if (!fn) return
      if (editable && combo !== 'escape') return
      if (combo === ' ' && t && /^(BUTTON|A|AUDIO|SUMMARY)$/.test(t.tagName)) return
      fn(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** Undo/redo state. Edits that share a `key` within 800 ms collapse into one step (slider drags). */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState(() => ({ past: [] as T[], present: initial(), future: [] as T[] }))
  const last = useRef<{ key: string; t: number } | null>(null)

  const set = useCallback((update: T | ((prev: T) => T), key?: string) => {
    const now = Date.now()
    const merge = !!key && last.current?.key === key && now - last.current.t < 800
    last.current = key ? { key, t: now } : null
    setH((cur) => {
      const next = typeof update === 'function' ? (update as (p: T) => T)(cur.present) : update
      return { past: merge ? cur.past : [...cur.past, cur.present].slice(-100), present: next, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    last.current = null
    setH((c) => (c.past.length ? { past: c.past.slice(0, -1), present: c.past[c.past.length - 1], future: [c.present, ...c.future] } : c))
  }, [])

  const redo = useCallback(() => {
    last.current = null
    setH((c) => (c.future.length ? { past: [...c.past, c.present], present: c.future[0], future: c.future.slice(1) } : c))
  }, [])

  return { state: h.present, set, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}

export function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title
    return () => {
      document.title = prev
    }
  }, [title])
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
