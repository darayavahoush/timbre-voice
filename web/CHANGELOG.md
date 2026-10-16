# Timbre web — enhancement notes

All changes are frontend-only (React/TS). No server or Rust API changes were needed.

## Polish
- Skip link, visible focus rings, `prefers-reduced-motion`, safe-area insets, `role="meter"` / `progressbar` on meters
- Keyboard shortcuts via one `useHotkeys` hook (press `?`): R/P record, / search, A/B/Space/⌘Z in Studio, M/L in sessions
- `ErrorBoundary` per route; network failures mapped to a clear `ApiError`; API health re-polled + offline banner
- Per-page document titles; waveform redraws on resize and theme change

## Recorder / Library
- Pause/resume (paused time excluded from the clock), discard, mic-unplugged handling
- Upload progress (XHR) and **retry without losing the take** if the upload fails; `beforeunload` guard
- Library: search (title/transcript/summary), kind filter, sort, multi-select bulk delete (`allSettled`, partial-failure reporting), one-clip-at-a-time playback, skeleton loading, download

## Studio
- A/B player: one `<audio>` flips original ⇄ processed, preserving position and play state
- Undo/redo with edit coalescing (slider drags = one step), reset
- Saved presets (localStorage, schema-tolerant), live preview (350 ms debounce) with stale-result dropping via run ids

## Sessions
- Reconnect state surfaced (socket + channel); capture no longer pushes while disconnected (phoenix would queue and replay audio as a burst); `listen` re-subscribed on re-join
- Leave, mute (`M`), muted shown as level 0 to peers, peak-hold meters, stale-level decay, wake lock while recording
- Mobile: sticky control bar, wrapping rows, Web Share, clipboard fallback

## Not verifiable here
Typechecks clean under `strict`; bundles with Vite. Not run against the real `timbre_kit` WASM or Phoenix API (not in the zip).
