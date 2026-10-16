import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ABPlayer, type Side } from '../components/ABPlayer'
import { Button, Card, ErrorNote, inputClass, Kbd, Spinner } from '../components/ui'
import { Waveform } from '../components/Waveform'
import { getRecording, uploadRecording, type Recording } from '../lib/api'
import { analyze, decodeAudio, process as runChain } from '../lib/dsp'
import type { Effect } from '../lib/dspTypes'
import { fmtDuration } from '../lib/format'
import { useHistory, useHotkeys, useTitle } from '../lib/hooks'
import { loadJSON, saveJSON } from '../lib/storage'

type Field = { key: string; label: string; min: number; max: number; step: number; unit: string }
type Def = { type: Effect['type']; label: string; hint: string; fields: Field[]; defaults: Record<string, number> }

const DEFS: Def[] = [
  { type: 'trim', label: 'Trim silence', hint: 'Cut dead air from the start and end', fields: [
    { key: 'thresholdDb', label: 'Threshold', min: -80, max: -20, step: 1, unit: 'dB' },
    { key: 'padMs', label: 'Keep', min: 0, max: 500, step: 10, unit: 'ms' }], defaults: { thresholdDb: -50, padMs: 120 } },
  { type: 'highpass', label: 'High-pass filter', hint: 'Remove rumble and plosives', fields: [
    { key: 'hz', label: 'Cutoff', min: 20, max: 500, step: 5, unit: 'Hz' }], defaults: { hz: 90 } },
  { type: 'lowpass', label: 'Low-pass filter', hint: 'Tame hiss and harshness (or go lo-fi)', fields: [
    { key: 'hz', label: 'Cutoff', min: 1000, max: 12000, step: 100, unit: 'Hz' }], defaults: { hz: 7000 } },
  { type: 'gate', label: 'Noise gate', hint: 'Silence the room tone between words', fields: [
    { key: 'thresholdDb', label: 'Threshold', min: -70, max: -15, step: 1, unit: 'dB' },
    { key: 'attackMs', label: 'Attack', min: 1, max: 50, step: 1, unit: 'ms' },
    { key: 'releaseMs', label: 'Release', min: 20, max: 500, step: 10, unit: 'ms' }], defaults: { thresholdDb: -45, attackMs: 5, releaseMs: 120 } },
  { type: 'pitch', label: 'Pitch shift', hint: 'Change pitch, keep the length', fields: [
    { key: 'semitones', label: 'Shift', min: -12, max: 12, step: 0.5, unit: 'st' }], defaults: { semitones: 3 } },
  { type: 'anonymize', label: 'Voice anonymizer', hint: 'Pitch + formant shift so the speaker is hard to recognise', fields: [
    { key: 'semitones', label: 'Pitch', min: -8, max: 8, step: 0.5, unit: 'st' },
    { key: 'formant', label: 'Formants', min: 0.7, max: 1.4, step: 0.05, unit: '×' }], defaults: { semitones: -4, formant: 0.85 } },
  { type: 'echo', label: 'Echo', hint: 'Repeats that fade out', fields: [
    { key: 'delayMs', label: 'Delay', min: 60, max: 800, step: 10, unit: 'ms' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.05, unit: '' },
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.05, unit: '' }], defaults: { delayMs: 280, feedback: 0.4, mix: 0.5 } },
  { type: 'gain', label: 'Gain', hint: 'Volume up or down', fields: [
    { key: 'db', label: 'Gain', min: -24, max: 24, step: 0.5, unit: 'dB' }], defaults: { db: 6 } },
  { type: 'normalize', label: 'Normalize', hint: 'Make the loudest peak hit a target level', fields: [
    { key: 'targetDb', label: 'Peak', min: -12, max: 0, step: 0.5, unit: 'dBFS' }], defaults: { targetDb: -1 } },
]

type State = Record<string, { on: boolean; values: Record<string, number> }>
const initial = (): State => Object.fromEntries(DEFS.map((d) => [d.type, { on: false, values: { ...d.defaults } }]))

const PRESETS: { name: string; on: Effect['type'][] }[] = [
  { name: 'Clean up voice', on: ['trim', 'highpass', 'gate', 'normalize'] },
  { name: 'Anonymize', on: ['highpass', 'anonymize', 'normalize'] },
  { name: 'Radio', on: ['highpass', 'lowpass', 'echo', 'normalize'] },
]

type SavedPreset = { name: string; fx: State }
const PRESET_KEY = 'timbre.studio.presets'
const LIVE_KEY = 'timbre.studio.live'

/** Fill gaps so presets saved by an older version of the effect list still load. */
const hydrate = (fx: Partial<State>): State =>
  Object.fromEntries(DEFS.map((d) => [d.type, { on: !!fx[d.type]?.on, values: { ...d.defaults, ...fx[d.type]?.values } }]))

export default function Studio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [rec, setRec] = useState<Recording | null>(null)
  useTitle(rec ? `${rec.title} — Studio` : 'Studio')
  const [source, setSource] = useState<{ samples: Float32Array; channels: number; sampleRate: number } | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const history = useHistory<State>(initial)
  const fx = history.state
  const [out, setOut] = useState<{ url: string; blob: Blob; peaks: Float32Array; durationMs: number } | null>(null)
  const [busy, setBusy] = useState<'process' | 'preview' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [side, setSide] = useState<Side>('B')
  const [live, setLive] = useState<boolean>(() => loadJSON(LIVE_KEY, false))
  const [saved, setSaved] = useState<SavedPreset[]>(() => loadJSON(PRESET_KEY, []))
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')
  const urlRef = useRef<string | null>(null)
  const runId = useRef(0)
  const playerRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const r = await getRecording(Number(id))
        const res = await fetch(r.audio_url)
        if (!res.ok) throw new Error(`Couldn’t download the audio (${res.status})`)
        const dec = await decodeAudio(await res.blob())
        const a = await analyze(dec.samples, dec.channels)
        if (dead) return
        setRec(r)
        setSource(dec)
        setPeaks(a.peaks)
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : 'Could not load this recording')
      }
    })()
    return () => {
      dead = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [id])

  const chain = useMemo<Effect[]>(
    () => DEFS.filter((d) => fx[d.type].on).map((d) => ({ type: d.type, ...fx[d.type].values }) as Effect),
    [fx],
  )

  // Each run gets an id; results from a superseded run are dropped so a slow
  // render can never overwrite a newer one.
  const run = useCallback(
    async (mode: 'process' | 'preview') => {
      if (!source) return
      const mine = ++runId.current
      setBusy(mode)
      setError(null)
      try {
        const res = await runChain(source.samples, source.channels, source.sampleRate, chain)
        if (mine !== runId.current) return
        const blob = new Blob([res.wav! as BlobPart], { type: 'audio/wav' })
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = URL.createObjectURL(blob)
        setOut({ url: urlRef.current, blob, peaks: res.peaks, durationMs: res.durationMs! })
      } catch (e) {
        if (mine === runId.current) setError(e instanceof Error ? e.message : 'Processing failed')
      } finally {
        if (mine === runId.current) setBusy(null)
      }
    },
    [source, chain],
  )

  // Live preview: re-render shortly after the last change.
  useEffect(() => {
    if (!live || !source) return
    const t = setTimeout(() => void run('preview'), 350)
    return () => clearTimeout(t)
  }, [live, source, run])

  const toggleLive = (on: boolean) => {
    setLive(on)
    saveJSON(LIVE_KEY, on)
  }

  async function save() {
    if (!out || !rec || !source) return
    setBusy('save')
    try {
      await uploadRecording(out.blob, {
        title: `${rec.title} (processed)`,
        durationMs: out.durationMs,
        sampleRate: source.sampleRate,
        kind: 'processed',
        parentId: rec.id,
        effects: { chain },
      })
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setBusy(null)
    }
  }

  const setOn = (on: Effect['type'][]) =>
    history.set((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, on: on.includes(k as Effect['type']) }])))

  function savePreset() {
    const name = presetName.trim()
    if (!name) return
    const next = [...saved.filter((p) => p.name !== name), { name, fx }]
    setSaved(next)
    saveJSON(PRESET_KEY, next)
    setNaming(false)
    setPresetName('')
  }

  function deletePreset(name: string) {
    const next = saved.filter((p) => p.name !== name)
    setSaved(next)
    saveJSON(PRESET_KEY, next)
  }

  const seconds = source ? source.samples.length / source.channels / source.sampleRate : 0

  useHotkeys({
    a: () => source && busy === null && void run('process'),
    b: () => out && setSide((s) => (s === 'A' ? 'B' : 'A')),
    ' ': (e) => {
      const el = playerRef.current
      if (!el) return
      e.preventDefault()
      void (el.paused ? el.play().catch(() => {}) : el.pause())
    },
    'mod+z': (e) => (e.preventDefault(), history.undo()),
    'mod+shift+z': (e) => (e.preventDefault(), history.redo()),
    'mod+y': (e) => (e.preventDefault(), history.redo()),
  })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-mute hover:text-ink">← Library</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">{rec ? rec.title : 'Studio'}</h1>
        <p className="text-sm text-mute">Effects run in your browser (Rust → WebAssembly); nothing is uploaded until you save.</p>
      </div>
      <ErrorNote error={error} />
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-ink">{out ? 'Original' : 'Before'}</h2>
        <Waveform peaks={peaks} label="Original waveform" />
        {rec && !out && <audio ref={playerRef} controls src={rec.audio_url} className="mt-3 w-full" />}
        {!rec && !error && <p className="mt-3 flex items-center gap-2 text-xs text-mute"><Spinner /> Loading and decoding…</p>}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-semibold text-ink">Effects</h2>
          {PRESETS.map((p) => (
            <Button key={p.name} onClick={() => setOn(p.on)} className="!py-1 text-xs">{p.name}</Button>
          ))}
          <Button variant="ghost" onClick={() => setOn([])} className="!py-1 text-xs">Clear</Button>
          <span className="grow" />
          <Button variant="ghost" onClick={history.undo} disabled={!history.canUndo} className="!py-1 text-xs" aria-label="Undo">↶ Undo</Button>
          <Button variant="ghost" onClick={history.redo} disabled={!history.canRedo} className="!py-1 text-xs" aria-label="Redo">↷ Redo</Button>
          <Button variant="ghost" onClick={() => history.set(initial())} className="!py-1 text-xs">Reset</Button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-hairline pb-4">
          <span className="text-xs text-mute">My presets</span>
          {saved.map((p) => (
            <span key={p.name} className="inline-flex items-center rounded-md border border-hairline-strong">
              <button onClick={() => history.set(hydrate(p.fx))} className="px-2 py-1 text-xs text-ink hover:bg-canvas-soft">{p.name}</button>
              <button onClick={() => deletePreset(p.name)} aria-label={`Delete preset ${p.name}`} className="px-1.5 py-1 text-xs text-mute hover:text-red-500">×</button>
            </span>
          ))}
          {naming ? (
            <form className="inline-flex gap-2" onSubmit={(e) => (e.preventDefault(), savePreset())}>
              <input autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} maxLength={40} placeholder="Preset name" aria-label="Preset name" className={`${inputClass} !py-1 text-xs`} />
              <Button type="submit" className="!py-1 text-xs" disabled={!presetName.trim()}>Save</Button>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setNaming(true)} className="!py-1 text-xs">+ Save current</Button>
          )}
        </div>

        <div className="space-y-3">
          {DEFS.map((d) => (
            <div key={d.type} className={`rounded-md border p-3 ${fx[d.type].on ? 'border-hairline-strong' : 'border-hairline'}`}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={fx[d.type].on}
                  onChange={(e) => history.set((p) => ({ ...p, [d.type]: { ...p[d.type], on: e.target.checked } }), `on:${d.type}`)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{d.label}</span>
                  <span className="block text-xs text-mute">{d.hint}</span>
                </span>
              </label>
              {fx[d.type].on && (
                <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                  {d.fields.map((f) => {
                    const v = fx[d.type].values[f.key]
                    return (
                      <label key={f.key} className="text-xs text-mute">
                        <span className="flex justify-between">
                          {f.label}
                          <span className="font-mono text-ink">{v} {f.unit}</span>
                        </span>
                        <input
                          type="range" min={f.min} max={f.max} step={f.step} value={v}
                          aria-label={`${d.label} ${f.label}`}
                          aria-valuetext={`${v} ${f.unit}`.trim()}
                          onChange={(e) =>
                            history.set(
                              (p) => ({ ...p, [d.type]: { ...p[d.type], values: { ...p[d.type].values, [f.key]: Number(e.target.value) } } }),
                              `v:${d.type}.${f.key}`,
                            )
                          }
                          className="w-full"
                        />
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => run('process')} disabled={!source || busy === 'process' || busy === 'save'}>
            {busy === 'process' ? <><Spinner /> Processing…</> : <>Apply effects <Kbd>A</Kbd></>}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={live} onChange={(e) => toggleLive(e.target.checked)} />
            Live preview
            {busy === 'preview' && <Spinner />}
          </label>
          <span className="text-xs text-mute">{chain.length ? `${chain.length} effect${chain.length > 1 ? 's' : ''}` : 'Mono mixdown only'}</span>
        </div>
        {live && seconds > 120 && (
          <p className="mt-2 text-xs text-mute">This clip is {fmtDuration(seconds * 1000)} long — live preview re-renders all of it on every change, so it may lag. Turn it off to apply manually.</p>
        )}
      </Card>

      {out && rec && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">Processed <span className="font-normal text-mute">· {fmtDuration(out.durationMs)}</span></h2>
          <Waveform peaks={out.peaks} label="Processed waveform" />
          <div className="mt-3">
            <ABPlayer aUrl={rec.audio_url} bUrl={out.url} side={side} onSide={setSide} audioRef={playerRef} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="primary" onClick={save} disabled={busy === 'save' || busy === 'process'}>
              {busy === 'save' ? <><Spinner /> Saving…</> : 'Save as new recording'}
            </Button>
            <a href={out.url} download={`${rec.title}.wav`} className="inline-flex items-center rounded-md border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-soft">Download WAV</a>
          </div>
        </Card>
      )}
    </div>
  )
}
