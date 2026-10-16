import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { kitReady } from './lib/kit'
import Home from './pages/Home'
import Studio from './pages/Studio'
import SessionPage from './pages/Session'

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/75" title={`${detail}: ${ok ? 'ready' : 'not ready'}`}>
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-mint' : 'bg-white/30'}`} />
      {label}
    </span>
  )
}

function Wordmark() {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5 text-white">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <circle cx="16" cy="16" r="6" fill="#ff5a3c" />
        <circle cx="16" cy="16" r="12" fill="none" stroke="white" strokeWidth="1.8" strokeDasharray="1.6 3.2" strokeLinecap="round" />
      </svg>
      <span className="font-display text-2xl font-medium italic tracking-tight">timbre</span>
    </Link>
  )
}

export default function App() {
  const [wasmOk, setWasmOk] = useState(false)
  const [apiOk, setApiOk] = useState(false)

  useEffect(() => {
    kitReady.then((k) => setWasmOk(k.rms_level(new Float32Array([1, -1, 1, -1])) > 0.99)).catch(() => setWasmOk(false))
    fetch('/api/hello').then((r) => setApiOk(r.ok)).catch(() => setApiOk(false))
  }, [])

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-paper">
        <header className="on-stage bg-stage">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
            <Wordmark />
            <div className="flex items-center gap-4">
              <Status ok={wasmOk} label="WASM" detail="Audio engine" />
              <Status ok={apiOk} label="API" detail="Server" />
            </div>
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/studio/:id" element={<Studio />} />
            <Route path="/s/:id" element={<SessionPage />} />
            <Route
              path="*"
              element={
                <div className="mx-auto max-w-6xl px-6 py-24">
                  <h1 className="text-4xl text-ink">Page not found</h1>
                  <Link to="/" className="mt-4 inline-block text-link underline">
                    Go to your library
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
