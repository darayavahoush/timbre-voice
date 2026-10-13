// Runs the Rust/WASM effect chain off the main thread so a long pitch-shift
// never freezes the UI.
import init, * as kit from 'timbre_kit'
import { CHAIN_ORDER, type DspRequest, type DspResponse, type Effect } from './dspTypes'

const ready = init()

function apply(x: Float32Array, sampleRate: number, fx: Effect): Float32Array {
  switch (fx.type) {
    case 'trim':
      return kit.trim_silence(x, sampleRate, fx.thresholdDb, fx.padMs)
    case 'highpass':
      return kit.highpass(x, sampleRate, fx.hz)
    case 'lowpass':
      return kit.lowpass(x, sampleRate, fx.hz)
    case 'gate':
      return kit.noise_gate(x, sampleRate, fx.thresholdDb, fx.attackMs, fx.releaseMs)
    case 'pitch':
      return kit.pitch_shift(x, fx.semitones)
    case 'anonymize':
      return kit.anonymize(x, sampleRate, fx.semitones, fx.formant)
    case 'echo':
      return kit.echo(x, sampleRate, fx.delayMs, fx.feedback, fx.mix)
    case 'gain':
      return kit.gain_db(x, fx.db)
    case 'normalize':
      return kit.normalize(x, fx.targetDb)
  }
}

self.onmessage = async (e: MessageEvent<DspRequest & { id: number }>) => {
  const { id, ...req } = e.data
  const reply = (res: DspResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage({ id, ...res }, transfer)
  try {
    await ready
    // Mono mixdown is always the first step.
    let x = kit.to_mono(req.samples, req.channels)
    if (req.op === 'analyze') {
      return reply({ ok: true, peaks: kit.waveform_peaks(x, req.buckets) })
    }
    for (const type of CHAIN_ORDER) {
      const fx = req.chain.find((c) => c.type === type)
      if (fx) x = apply(x, req.sampleRate, fx)
      if (x.length === 0) throw new Error('Nothing left after trimming — lower the silence threshold.')
    }
    const wav = kit.encode_wav(x, req.sampleRate, 1)
    reply(
      { ok: true, peaks: kit.waveform_peaks(x, req.buckets), wav, durationMs: (x.length / req.sampleRate) * 1000 },
      [wav.buffer as ArrayBuffer],
    )
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
