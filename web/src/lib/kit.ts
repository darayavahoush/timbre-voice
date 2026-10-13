// One shared, lazily-initialised handle on the Rust/WASM module (main thread).
import init, * as kit from 'timbre_kit'

export type Kit = typeof kit
export const kitReady: Promise<Kit> = init().then(() => kit)
