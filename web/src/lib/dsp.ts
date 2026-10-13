import type { DspRequest, DspResponse, Effect } from './dspTypes'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: DspResponse & { ok: true }) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<DspResponse & { id: number }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data)
      else p.reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(e.message || 'DSP worker crashed')))
      pending.clear()
      worker = null
    }
  }
  return worker
}

function call(req: DspRequest) {
  return new Promise<DspResponse & { ok: true }>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    // Hand the worker its own copy; the UI keeps the decoded original.
    getWorker().postMessage({ id, ...req, samples: req.samples.slice() })
  })
}

export const analyze = (samples: Float32Array, channels: number, buckets = 600) =>
  call({ op: 'analyze', samples, channels, buckets })

export const process = (
  samples: Float32Array,
  channels: number,
  sampleRate: number,
  chain: Effect[],
  buckets = 600,
) => call({ op: 'process', samples, channels, sampleRate, chain, buckets })

/** Decode any browser-playable blob into interleaved float samples. */
export async function decodeAudio(blob: Blob) {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const { numberOfChannels: channels, length, sampleRate } = buf
    const interleaved = new Float32Array(length * channels)
    for (let c = 0; c < channels; c++) {
      const data = buf.getChannelData(c)
      for (let i = 0; i < length; i++) interleaved[i * channels + c] = data[i]
    }
    return { samples: interleaved, channels, sampleRate, durationMs: buf.duration * 1000 }
  } finally {
    void ctx.close()
  }
}
