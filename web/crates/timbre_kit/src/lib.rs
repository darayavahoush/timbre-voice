//! timbre_kit — the client-side Rust that compiles to WebAssembly.
//!
//! The browser decodes audio to raw PCM and hands it to Rust as `Float32Array`s;
//! Rust does the DSP and returns new buffers. Every function is pure (no hidden
//! state, no panics on odd input) so effects compose as a plain chain in JS.
//!
//! * level / metering: [`rms_level`], [`peak_level`], [`waveform_peaks`]
//! * easy: [`gain_db`], [`normalize`], [`trim_silence`], [`to_mono`]
//! * medium: [`filters::noise_gate`], [`filters::lowpass`], [`filters::highpass`],
//!   [`filters::echo`], [`spectral::pitch_shift`]
//! * advanced: [`spectral::formant_shift`], [`spectral::anonymize`]
//! * io: [`resample`], [`wav::encode_wav`], [`wav::f32_to_pcm16le`]

mod fft;
pub mod filters;
pub mod spectral;
pub mod wav;

use wasm_bindgen::prelude::*;

/// Root-mean-square level of a block of `f32` PCM samples (each in -1.0..=1.0).
///
/// Takes a `Float32Array` straight from the Web Audio API and returns a single
/// scalar the UI can render as a meter.
#[wasm_bindgen]
pub fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Largest absolute sample value.
#[wasm_bindgen]
pub fn peak_level(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

/// Downsample a waveform to `buckets` peak values (0..1) for drawing.
#[wasm_bindgen]
pub fn waveform_peaks(samples: &[f32], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return vec![0.0; buckets];
    }
    (0..buckets)
        .map(|b| {
            let lo = b * samples.len() / buckets;
            let hi = ((b + 1) * samples.len() / buckets)
                .max(lo + 1)
                .min(samples.len());
            peak_level(&samples[lo..hi])
        })
        .collect()
}

/// Apply `db` decibels of gain (no clipping here; the WAV encoder clamps).
#[wasm_bindgen]
pub fn gain_db(samples: &[f32], db: f32) -> Vec<f32> {
    let g = filters::db_to_lin(db as f64) as f32;
    samples.iter().map(|s| s * g).collect()
}

/// Scale so the loudest sample sits at `target_db` dBFS (e.g. -1.0).
#[wasm_bindgen]
pub fn normalize(samples: &[f32], target_db: f32) -> Vec<f32> {
    let peak = peak_level(samples);
    if peak < 1e-9 {
        return samples.to_vec();
    }
    let g = (filters::db_to_lin(target_db.min(0.0) as f64) as f32) / peak;
    samples.iter().map(|s| s * g).collect()
}

/// Trim leading/trailing silence. Level is measured in 10 ms RMS windows;
/// anything under `threshold_db` counts as silence, and `pad_ms` of audio is
/// kept either side so words don't get clipped. All-silent input -> empty.
#[wasm_bindgen]
pub fn trim_silence(samples: &[f32], sample_rate: f32, threshold_db: f32, pad_ms: f32) -> Vec<f32> {
    let win = ((sample_rate as f64 * 0.01) as usize).max(1);
    let thr = filters::db_to_lin(threshold_db as f64) as f32;
    let loud: Vec<bool> = samples.chunks(win).map(|c| rms_level(c) >= thr).collect();
    let (Some(first), Some(last)) = (loud.iter().position(|&l| l), loud.iter().rposition(|&l| l))
    else {
        return Vec::new();
    };
    let pad = (sample_rate as f64 * pad_ms.max(0.0) as f64 / 1000.0) as usize;
    let start = (first * win).saturating_sub(pad);
    let end = ((last + 1) * win + pad).min(samples.len());
    samples[start..end].to_vec()
}

/// Mix interleaved multi-channel audio down to mono (equal-weight average).
#[wasm_bindgen]
pub fn to_mono(interleaved: &[f32], channels: u32) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(ch)
        .map(|f| f.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Linear-interpolation resampler. When downsampling, a 2-stage low-pass at
/// 0.45x the target rate runs first to keep aliasing out of the result.
#[wasm_bindgen]
pub fn resample(samples: &[f32], from_hz: f32, to_hz: f32) -> Vec<f32> {
    if samples.is_empty() || from_hz <= 0.0 || to_hz <= 0.0 || (from_hz - to_hz).abs() < 0.5 {
        return samples.to_vec();
    }
    let src: Vec<f32> = if to_hz < from_hz {
        let cut = to_hz * 0.45;
        filters::lowpass(&filters::lowpass(samples, from_hz, cut), from_hz, cut)
    } else {
        samples.to_vec()
    };
    let ratio = from_hz as f64 / to_hz as f64;
    let out_len = (samples.len() as f64 / ratio).round() as usize;
    (0..out_len)
        .map(|j| {
            let pos = j as f64 * ratio;
            let i = pos.floor() as usize;
            let frac = (pos - i as f64) as f32;
            let a = src[i.min(src.len() - 1)];
            let b = src[(i + 1).min(src.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms_level(&[0.0; 128]), 0.0);
    }

    #[test]
    fn rms_of_empty_is_zero() {
        assert_eq!(rms_level(&[]), 0.0);
    }

    #[test]
    fn rms_of_full_scale_is_one() {
        assert!((rms_level(&[1.0, -1.0, 1.0, -1.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn gain_6db_roughly_doubles() {
        let out = gain_db(&[0.25, -0.1], 6.0206);
        assert!((out[0] - 0.5).abs() < 1e-3 && (out[1] + 0.2).abs() < 1e-3);
    }

    #[test]
    fn normalize_hits_target_peak() {
        let out = normalize(&[0.1, -0.2, 0.05], -1.0);
        let want = 10f32.powf(-1.0 / 20.0);
        assert!((peak_level(&out) - want).abs() < 1e-5);
        assert_eq!(normalize(&[0.0; 4], -1.0), vec![0.0; 4]); // silence untouched
    }

    #[test]
    fn trim_removes_edges_but_keeps_padding() {
        let mut x = vec![0.0f32; 1600];
        x.extend(std::iter::repeat_n(0.5, 1600));
        x.extend(vec![0.0f32; 1600]);
        let out = trim_silence(&x, 16_000.0, -50.0, 20.0);
        assert!(out.len() >= 1600 && out.len() <= 1600 + 2 * 320 + 160);
        assert!(trim_silence(&[0.0; 800], 16_000.0, -50.0, 20.0).is_empty());
    }

    #[test]
    fn mono_averages_channels() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(to_mono(&[0.3, 0.4], 1), vec![0.3, 0.4]);
    }

    #[test]
    fn resample_changes_length_proportionally() {
        let x = vec![0.1f32; 48_000];
        assert_eq!(resample(&x, 48_000.0, 16_000.0).len(), 16_000);
        assert_eq!(resample(&x, 48_000.0, 48_000.0).len(), 48_000);
        assert_eq!(resample(&x[..8000], 8_000.0, 16_000.0).len(), 16_000);
    }

    #[test]
    fn resample_downsample_preserves_tone() {
        let x: Vec<f32> = (0..48_000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin())
            .collect();
        let y = resample(&x, 48_000.0, 16_000.0);
        let r = rms_level(&y[2000..14_000]);
        assert!((r - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.03, "{r}");
    }

    #[test]
    fn peaks_have_requested_length() {
        let p = waveform_peaks(&[0.1, -0.9, 0.3, 0.2, 0.0, 0.0], 3);
        assert_eq!(p, vec![0.9, 0.3, 0.0]);
        assert_eq!(waveform_peaks(&[], 4), vec![0.0; 4]);
    }
}
