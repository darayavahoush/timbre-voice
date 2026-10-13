import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { kitReady } from './lib/kit'
import Home from './pages/Home'
import Studio from './pages/Studio'
import SessionPage from './pages/Session'

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mute">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-link' : 'bg-hairline-strong'}`} />
      {label}
    </span>
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
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/80 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
            <Link to="/" className="font-semibold tracking-tight text-ink">timbre</Link>
            <div className="flex items-center gap-4">
              <Dot ok={wasmOk} label="WASM" />
              <Dot ok={apiOk} label="API" />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/studio/:id" element={<Studio />} />
            <Route path="/s/:id" element={<SessionPage />} />
            <Route path="*" element={<p className="text-mute">Page not found.</p>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
