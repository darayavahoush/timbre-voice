// Mic capture for live sessions. An AudioWorklet downsamples whatever the
// hardware runs at (44.1/48 kHz) to the 16 kHz mono the server expects, with a
// stateful low-pass + linear resampler so there are no seams between chunks.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0; this.prev = 0;
    this.out = new Float32Array(2048); this.n = 0;
    this.lp = this.ratio > 1.01;
    if (this.lp) {
      const w0 = 2 * Math.PI * 7000 / sampleRate, c = Math.cos(w0), a = Math.sin(w0) / (2 * Math.SQRT1_2);
      const a0 = 1 + a;
      this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
      this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
  }
  filt(x) {
    if (!this.lp) return x;
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  emit(v) {
    this.out[this.n++] = v;
    if (this.n === this.out.length) {
      const c = this.out;
      this.port.postMessage(c, [c.buffer]);
      this.out = new Float32Array(2048); this.n = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const y = this.filt(ch[i]);
      while (this.phase < 1) { this.emit(this.prev + (y - this.prev) * this.phase); this.phase += this.ratio; }
      this.phase -= 1; this.prev = y;
    }
    return true;
  }
}
registerProcessor('capture', Capture);
`

export type MicCapture = { stop: () => void }

/** Calls `onChunk` with 2048-sample (128 ms) Float32 blocks at 16 kHz. */
export async function startCapture(onChunk: (chunk: Float32Array) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  const ctx = new AudioContext()
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture', { numberOfOutputs: 1, outputChannelCount: [1] })
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data)
  // Keep the node pulled by the graph without making any sound.
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(ctx.destination)
  return {
    stop() {
      node.port.onmessage = null
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}

/** Plays back other participants' relayed 16 kHz PCM with a small jitter buffer. */
export class LivePlayer {
  private ctx = new AudioContext()
  private next = new Map<string, number>()

  push(senderId: string, pcm: ArrayBuffer) {
    const ints = new Int16Array(pcm.slice(0, pcm.byteLength - (pcm.byteLength % 2)))
    if (!ints.length) return
    const buf = this.ctx.createBuffer(1, ints.length, 16000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ints.length; i++) ch[i] = ints[i] / 32768
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const now = this.ctx.currentTime
    // Re-sync to ~200 ms of buffer whenever a sender has fallen behind.
    const at = Math.max(this.next.get(senderId) ?? 0, now + 0.2)
    src.start(at)
    this.next.set(senderId, at + buf.duration)
  }

  close() {
    void this.ctx.close()
  }
}
