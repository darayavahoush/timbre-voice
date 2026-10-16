import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { useHotkeys, useOnline } from './lib/hooks'
import { kitReady } from './lib/kit'
import Home from './pages/Home'
import Studio from './pages/Studio'
import SessionPage from './pages/Session'

function Dot({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mute" title={detail}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-link' : 'bg-hairline-strong'}`} />
      {label}
      <span className="sr-only">{ok ? 'ready' : 'unavailable'}</span>
    </span>
  )
}

/** Resets the error boundary whenever the route changes. */
function Routed() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/studio/:id" element={<Studio />} />
        <Route path="/s/:id" element={<SessionPage />} />
        <Route path="*" element={<p className="text-mute">Page not found. <Link to="/" className="text-link">Go home</Link></p>} />
      </Routes>
    </ErrorBoundary>
  )
}

export default function App() {
  const [wasmOk, setWasmOk] = useState(false)
  const [apiOk, setApiOk] = useState(false)
  const [help, setHelp] = useState(false)
  const online = useOnline()

  useEffect(() => {
    kitReady.then((k) => setWasmOk(k.rms_level(new Float32Array([1, -1, 1, -1])) > 0.99)).catch(() => setWasmOk(false))
  }, [])

  // Re-check the API on an interval and whenever the network comes back.
  const checkApi = useCallback(() => {
    fetch('/api/hello').then((r) => setApiOk(r.ok)).catch(() => setApiOk(false))
  }, [])
  useEffect(() => {
    checkApi()
    const t = setInterval(checkApi, 30_000)
    return () => clearInterval(t)
  }, [checkApi, online])

  useHotkeys({ '?': () => setHelp(true) })

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-1.5 focus:text-sm focus:text-canvas">
          Skip to content
        </a>
        <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
            <Link to="/" className="font-semibold tracking-tight text-ink">timbre</Link>
            <div className="flex items-center gap-4">
              <Dot ok={wasmOk} label="WASM" detail="Rust DSP module" />
              <Dot ok={apiOk && online} label="API" detail="Phoenix API" />
              <button onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="rounded border border-hairline px-1.5 text-xs text-mute hover:text-ink">?</button>
            </div>
          </div>
        </header>
        {!online && (
          <p role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-1.5 text-center text-xs text-amber-600 dark:text-amber-400">
            You’re offline — recording still works, but uploads and sessions need a connection.
          </p>
        )}
        <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-8 outline-none">
          <Routed />
        </main>
        <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
      </div>
    </BrowserRouter>
  )
}
