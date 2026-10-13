// The effect chain a user builds in the Studio. Order of application is fixed
// (see CHAIN_ORDER) so the UI can stay a simple set of toggles + sliders.
export type Effect =
  | { type: 'trim'; thresholdDb: number; padMs: number }
  | { type: 'highpass'; hz: number }
  | { type: 'lowpass'; hz: number }
  | { type: 'gate'; thresholdDb: number; attackMs: number; releaseMs: number }
  | { type: 'pitch'; semitones: number }
  | { type: 'anonymize'; semitones: number; formant: number }
  | { type: 'echo'; delayMs: number; feedback: number; mix: number }
  | { type: 'gain'; db: number }
  | { type: 'normalize'; targetDb: number }

export const CHAIN_ORDER: Effect['type'][] = [
  'trim',
  'highpass',
  'lowpass',
  'gate',
  'pitch',
  'anonymize',
  'echo',
  'gain',
  'normalize',
]

export type DspRequest =
  | { op: 'analyze'; samples: Float32Array; channels: number; buckets: number }
  | { op: 'process'; samples: Float32Array; channels: number; sampleRate: number; chain: Effect[]; buckets: number }

export type DspResponse =
  | { ok: true; peaks: Float32Array; wav?: Uint8Array; durationMs?: number }
  | { ok: false; error: string }
