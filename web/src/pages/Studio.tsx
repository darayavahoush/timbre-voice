import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button, ErrorNote, Icon, Stage, Switch, buttonClass } from '../components/ui'
import { Player } from '../components/Player'
import { Waveform } from '../components/Waveform'
import { getRecording, uploadRecording, type Recording } from '../lib/api'
import { analyze, decodeAudio, process as runChain } from '../lib/dsp'
import type { Effect } from '../lib/dspTypes'
import { fmtDuration } from '../lib/format'

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

export default function Studio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [rec, setRec] = useState<Recording | null>(null)
  const [source, setSource] = useState<{ samples: Float32Array; channels: number; sampleRate: number } | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [fx, setFx] = useState<State>(initial)
  const [out, setOut] = useState<{ url: string; blob: Blob; peaks: Float32Array; durationMs: number; key: string } | null>(null)
  const [busy, setBusy] = useState<'process' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const beforeAudio = useRef<HTMLAudioElement>(null)
  const afterAudio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const r = await getRecording(Number(id))
        const blob = await (await fetch(r.audio_url)).blob()
        const dec = await decodeAudio(blob)
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
  const chainKey = useMemo(() => JSON.stringify(chain), [chain])
  // The preview no longer matches the controls once any switch or slider moves.
  const stale = out !== null && out.key !== chainKey

  async function apply() {
    if (!source) return
    setBusy('process')
    setError(null)
    try {
      const res = await runChain(source.samples, source.channels, source.sampleRate, chain)
      const blob = new Blob([res.wav! as BlobPart], { type: 'audio/wav' })
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(blob)
      setOut({ url: urlRef.current, blob, peaks: res.peaks, durationMs: res.durationMs!, key: chainKey })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed')
    } finally {
      setBusy(null)
    }
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
        effects: { chain: JSON.parse(out.key) },
      })
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setBusy(null)
    }
  }

  const preset = (on: Effect['type'][]) =>
    setFx((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, on: on.includes(k as Effect['type']) }])))

  const loading = !source && !error

  return (
    <>
      <Stage>
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white">
          <Icon name="chevron" className="h-3.5 w-3.5" />
          Library
        </Link>
        <h1 className="mt-6 max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] font-light leading-[1.02] tracking-[-0.02em]">
          {rec ? rec.title : 'Studio'}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/80">
          Effects run in your browser, so nothing is uploaded until you save.
        </p>
      </Stage>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="fx-h">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <h2 id="fx-h" className="mr-3 text-3xl font-medium tracking-tight text-ink">
              Effects
            </h2>
            {PRESETS.map((p) => (
              <Button key={p.name} size="sm" onClick={() => preset(p.on)}>
                {p.name}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => preset([])}>
              Clear all
            </Button>
          </div>

          <ul className="space-y-3">
            {DEFS.map((d) => {
              const on = fx[d.type].on
              return (
                <li
                  key={d.type}
                  className={`rounded-2xl border p-4 transition-colors ${on ? 'border-coral/60 bg-card' : 'border-line bg-card/50'}`}
                >
                  <div className="flex items-center gap-4">
                    <Switch
                      checked={on}
                      label={`Use ${d.label}`}
                      onChange={(v) => setFx((p) => ({ ...p, [d.type]: { ...p[d.type], on: v } }))}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{d.label}</p>
                      <p className="text-sm text-mute">{d.hint}</p>
                    </div>
                  </div>
                  {on && (
                    <div className="mt-4 grid gap-x-8 gap-y-3 pl-14 sm:grid-cols-2">
                      {d.fields.map((f) => {
                        const v = fx[d.type].values[f.key]
                        return (
                          <label key={f.key} className="block text-sm text-mute">
                            <span className="flex justify-between">
                              {f.label}
                              <span className="tabular-nums text-ink">
                                {v} {f.unit}
                              </span>
                            </span>
                            <input
                              type="range"
                              min={f.min}
                              max={f.max}
                              step={f.step}
                              value={v}
                              aria-label={`${d.label} ${f.label}`}
                              style={{ ['--p' as string]: `${((v - f.min) / (f.max - f.min)) * 100}%` }}
                              onChange={(e) =>
                                setFx((p) => ({
                                  ...p,
                                  [d.type]: { ...p[d.type], values: { ...p[d.type].values, [f.key]: Number(e.target.value) } },
                                }))
                              }
                              className="w-full"
                            />
                          </label>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ErrorNote error={error} />

          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="text-lg font-medium text-ink">Before</h2>
            {loading ? (
              <div className="mt-3 h-20 animate-pulse rounded-xl bg-ink/5" aria-label="Reading your recording" />
            ) : (
              <Waveform
                peaks={peaks}
                label="Original waveform. Click to seek"
                className="mt-3 text-link"
                audioRef={beforeAudio}
                durationMs={rec?.duration_ms}
              />
            )}
            {rec && <Player src={rec.audio_url} durationMs={rec.duration_ms} className="mt-3" audioRef={beforeAudio} />}
          </div>

          <div className="rounded-2xl border border-line bg-card p-5">
            <Button variant="primary" onClick={apply} disabled={!source || busy !== null} className="w-full">
              {busy === 'process' ? 'Processing…' : out ? (stale ? 'Apply changes' : 'Apply again') : 'Apply effects'}
            </Button>
            <p className="mt-2 text-center text-sm text-mute">
              {chain.length ? `${chain.length} effect${chain.length > 1 ? 's' : ''} selected` : 'No effects selected, mono mixdown only'}
            </p>
          </div>

          {out && (
            <div className={`rounded-2xl border bg-card p-5 ${stale ? 'border-butter' : 'border-line'}`}>
              <h2 className="text-lg font-medium text-ink">
                After <span className="font-sans text-sm font-normal text-mute">{fmtDuration(out.durationMs)}</span>
              </h2>
              {stale && <p className="mt-1 text-sm text-ink">You’ve changed settings since this preview. Apply again to hear them.</p>}
              <Waveform
                peaks={out.peaks}
                label="Processed waveform. Click to seek"
                className="mt-3 text-coral"
                audioRef={afterAudio}
                durationMs={out.durationMs}
              />
              <Player src={out.url} durationMs={out.durationMs} className="mt-3" audioRef={afterAudio} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="ink" onClick={save} disabled={busy !== null || stale}>
                  {busy === 'save' ? 'Saving…' : 'Save to library'}
                </Button>
                <a href={out.url} download={`${rec?.title ?? 'recording'}.wav`} className={buttonClass('outline')}>
                  Download WAV
                </a>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
