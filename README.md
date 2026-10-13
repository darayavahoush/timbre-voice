# timbre — voice recorder

Record in the browser, process the voice with Rust/WASM, and mix several people
into one recording. Phoenix + SQLite on the back, React on the front, a Rust crate
compiled to WebAssembly for the DSP.

**All three parts are built, plus the LLM bonus.**

| Part | What you get |
| --- | --- |
| 1 · Record & save | Mic → `MediaRecorder` → multipart upload → SQLite BLOB. Library with playback (HTTP Range, so seeking works everywhere), rename, delete. |
| 2 · Voice processing | `timbre_kit` (Rust → WASM) runs **9 effects** in a Web Worker: trim silence, high-/low-pass, noise gate, pitch shift, **voice anonymizer** (pitch + formant shift), echo, gain, normalize (+ mono mixdown, WAV encode). Before/after waveforms and playback; save the result as a new take linked to its original. |
| 3 · Multiplayer + merge | Create a session, share `/s/<id>`, everyone joins from their own browser. Mic audio streams over a Phoenix Channel; the host starts/stops a take and the server mixes all tracks into one WAV that is saved to the library. Optional live listening (headphones). |
| Bonus · Transcribe | One click → transcript + AI title + summary via any OpenAI-compatible API (needs `OPENAI_API_KEY`). |

Deployed at: _add your URL here_

## Run it

```bash
nix develop --impure   # or direnv allow — pins Elixir, Node, Rust+wasm, wasm-pack, just
just setup             # build WASM, install web deps, create + migrate the SQLite db
just dev               # API :4010 + web :5173  →  open http://localhost:5173
just test              # cargo test + mix test
just check             # web typecheck + mix format --check-formatted
```

Without Nix: Elixir 1.18+, Node 22+, Rust (rustup) + `wasm-pack` + `just`.

To try multiplayer on one machine, open the session link in a second browser
profile or an incognito window (each browser identity is one participant) and use
headphones. To try the transcript bonus: `OPENAI_API_KEY=sk-... just dev`.

## How it works

```
browser                                         Phoenix (:4010)                SQLite
────────────────────────────────────────────────────────────────────────────────────
MediaRecorder ── POST /api/recordings (multipart) ──▶ Recordings ──────────────▶ recordings.audio (BLOB)
<audio> ◀── GET /api/recordings/:id/audio (Range/ETag) ◀─ substr(blob, off, len)

decodeAudioData ─▶ Web Worker ─▶ timbre_kit.wasm (effect chain) ─▶ WAV ─▶ upload as kind=processed

mic ─▶ AudioWorklet (→16 kHz mono) ─▶ WASM f32→pcm16 ─ channel "session:<id>" ─▶ Room GenServer
                                                       ◀─ roster / state / levels / (opt-in) audio relay
host "stop" ─────────────────────────────────────────▶ Mixer ─▶ WAV ─▶ recordings (kind=mix)
```

### Backend (`api/`)

- **`Timbre.Recordings`** — one table; `audio` is a `load_in_query: false` BLOB, so
  listing never loads audio. Range requests are served with SQLite `substr()` on
  the blob, so a seek into a 20 MB take reads only the bytes asked for. Validation:
  `audio/*` only, 50 MB cap, parent must exist (SQLite doesn't name FK constraints,
  so Ecto can't map them — checked explicitly for a clean 422).
- **`Timbre.Sessions` / `Sessions.Room`** — the durable part (share link, host,
  resulting mix) is a row; the live part is one GenServer per active session under
  a `DynamicSupervisor` + `Registry`. Host identity is a random token returned once
  at creation and stored only as a SHA-256 hash.
- **Audio contract** — 16 kHz mono PCM16, ~128 ms chunks, sent *contiguously* (a
  muted client sends zeros). Tracks are therefore gap-free timelines and alignment
  only needs each participant's start offset, estimated from first-chunk arrival
  relative to "record". Phoenix's JS client buffers pushes across a reconnect, so a
  flaky link delays audio rather than punching holes in it.
- **`Timbre.Audio.Mixer`** — pure function; sums tracks in 1 s blocks, scales by
  `1/√n` (headroom for uncorrelated voices), clamps to int16. A reference test
  checks it sample-by-sample across block boundaries.
- **Safety rails** — max 8 participants, 64 KB chunk cap, 30 min per track, 256 KB
  websocket frame cap, audio from non-participants/outside a take is dropped, an
  abandoned take is auto-saved after 60 s with nobody connected, an empty take
  isn't saved.
- **`Timbre.Transcription`** — `Req` against `/audio/transcriptions` and
  `/chat/completions`; base URL and models are configurable (Groq etc. work).
  Tests use `Req.Test` stubs, never the network.

### WASM (`web/crates/timbre_kit`)

Pure functions `&[f32] → Vec<f32>`, no hidden state, no panics on odd input
(empty buffers, NaN, absurd parameters are clamped).

- Easy: gain, normalize, silence trim, mono mixdown. Medium: noise gate, RBJ biquad
  low/high-pass, feedback echo (tail rings out), pitch shift. Advanced: voice
  anonymizer.
- **Pitch shift** = phase-vocoder time-stretch (own radix-2 FFT, 2048-pt Hann,
  75 % overlap) then resample back to the original length.
- **Formant shift** = cepstral-liftering envelope estimate per STFT frame, then
  each bin is re-weighted by `env(k/ratio)/env(k)`; phases are untouched so pitch
  stays put. **Anonymize** = pitch shift, then formant shift by the compensating
  ratio — so the two knobs (pitch, formants) are independent.
- Tests are numeric, not "doesn't crash": pitch +12 st lands at 2× the input
  frequency (±2 %), formant shift moves the spectral centroid while the pulse-train
  period stays at 80 samples, the gate drops a −54 dB noise floor but passes
  speech-level audio, echo repeats land at `delay·n` with `feedback^n`, etc.
- Effects run in a **Web Worker**, so a long pitch-shift never freezes the UI.

### Frontend (`web/`)

React 19 + Tailwind 4 + react-router. `lib/dsp.ts` is a typed promise wrapper over
the worker; `lib/capture.ts` holds the AudioWorklet (stateful low-pass + linear
resampler, so chunk seams are inaudible) and the live-listen jitter buffer.

## Tests

- `cd web/crates/timbre_kit && cargo test` — 26 DSP tests (clippy-clean).
- `cd api && mix test` — 67 tests: context + controller (upload, Range 206/416, ETag
  304, validation, transcription stubs), mixer, WAV writer, room lifecycle
  (offsets, reconnect, caps, auto-save), and channel tests (host-only controls,
  relay to listeners only, no echo to sender, finished-session join).

## Deploy (Fly.io, single origin)

The `Dockerfile` builds WASM + the Vite app and bakes them into a Phoenix release,
so there is no CORS and no second host. SQLite lives on a volume.

```bash
fly launch --no-deploy --copy-config      # choose an app name
fly volumes create timbre_data --size 1
fly secrets set SECRET_KEY_BASE=$(openssl rand -base64 48) PHX_HOST=<app>.fly.dev
fly deploy
```

Run **one** machine (`fly.toml` pins this): live rooms are in-memory on a node.

## Known limits / what I'd do next

- **Single node.** Rooms are local processes; scaling out means sticky routing by
  session id or moving room state to a distributed registry.
- **Mix alignment is ±network latency** (tens of ms) — fine for conversation, not
  sample-accurate. A client-side capture timestamp per chunk would tighten it.
- **Audio lives in SQLite.** Good for a take-home (one file to back up); at scale
  I'd move blobs to object storage and keep metadata in the DB.
- No auth/accounts: access is by unguessable link. Transcription is synchronous
  (a long file holds a request open) — a job + progress event would be nicer.
- The phase vocoder has the usual "phasiness" on extreme shifts; phase-locking or
  a PSOLA path would clean that up.
