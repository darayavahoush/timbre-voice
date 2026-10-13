//! Time-domain effects: biquad low/high-pass, noise gate, echo.

use std::f64::consts::{FRAC_1_SQRT_2 as Q, PI};
use wasm_bindgen::prelude::*;

pub(crate) fn db_to_lin(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

/// Second-order Butterworth-ish (Q = 1/sqrt2) section, RBJ cookbook, Direct Form I.
fn biquad(samples: &[f32], b: [f64; 3], a: [f64; 3]) -> Vec<f32> {
    let (b0, b1, b2) = (b[0] / a[0], b[1] / a[0], b[2] / a[0]);
    let (a1, a2) = (a[1] / a[0], a[2] / a[0]);
    let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    samples
        .iter()
        .map(|&s| {
            let x0 = s as f64;
            let y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
            y0 as f32
        })
        .collect()
}

fn coefficients(sample_rate: f32, cutoff_hz: f32, high: bool) -> ([f64; 3], [f64; 3]) {
    let sr = (sample_rate as f64).max(1.0);
    let fc = (cutoff_hz as f64).clamp(10.0, sr * 0.49);
    let w0 = 2.0 * PI * fc / sr;
    let (cos, sin) = (w0.cos(), w0.sin());
    let alpha = sin / (2.0 * Q);
    let b = if high {
        [(1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0]
    } else {
        [(1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0]
    };
    (b, [1.0 + alpha, -2.0 * cos, 1.0 - alpha])
}

/// 12 dB/oct low-pass.
#[wasm_bindgen]
pub fn lowpass(samples: &[f32], sample_rate: f32, cutoff_hz: f32) -> Vec<f32> {
    let (b, a) = coefficients(sample_rate, cutoff_hz, false);
    biquad(samples, b, a)
}

/// 12 dB/oct high-pass (rumble / plosive / mains-hum removal).
#[wasm_bindgen]
pub fn highpass(samples: &[f32], sample_rate: f32, cutoff_hz: f32) -> Vec<f32> {
    let (b, a) = coefficients(sample_rate, cutoff_hz, true);
    biquad(samples, b, a)
}

/// Noise gate: a peak envelope follower (decays over `release_ms`) opens the
/// gate when it rises above `threshold_db`; the gain itself is smoothed with
/// `attack_ms` / `release_ms` time constants so it never clicks.
#[wasm_bindgen]
pub fn noise_gate(
    samples: &[f32],
    sample_rate: f32,
    threshold_db: f32,
    attack_ms: f32,
    release_ms: f32,
) -> Vec<f32> {
    let sr = (sample_rate as f64).max(1.0);
    let thr = db_to_lin(threshold_db as f64);
    let coef = |ms: f32| (-1.0 / (sr * (ms as f64).max(0.1) / 1000.0)).exp();
    let (att, rel) = (coef(attack_ms), coef(release_ms));
    let (mut env, mut gain) = (0.0f64, 0.0f64);
    samples
        .iter()
        .map(|&s| {
            let a = (s as f64).abs();
            env = if a > env { a } else { a + (env - a) * rel };
            let target = if env >= thr { 1.0 } else { 0.0 };
            let c = if target > gain { att } else { rel };
            gain = target + (gain - target) * c;
            (s as f64 * gain) as f32
        })
        .collect()
}

/// Feedback echo. `mix` is the wet level (0..1), `feedback` the repeat decay
/// (0..0.95). The output is extended so the tail rings out instead of being cut.
#[wasm_bindgen]
pub fn echo(samples: &[f32], sample_rate: f32, delay_ms: f32, feedback: f32, mix: f32) -> Vec<f32> {
    let d = ((sample_rate as f64 * (delay_ms as f64).clamp(1.0, 2000.0)) / 1000.0).round() as usize;
    let fb = (feedback as f64).clamp(0.0, 0.95);
    let mix = (mix as f64).clamp(0.0, 1.0);
    if samples.is_empty() || d == 0 {
        return samples.to_vec();
    }
    // Repeats needed until the tail drops below -60 dB (bounded to 6 s).
    let repeats = if fb < 1e-3 {
        1
    } else {
        (1e-3f64.ln() / fb.ln()).ceil() as usize + 1
    };
    let tail = (d * repeats).min((sample_rate as usize).saturating_mul(6));
    let len = samples.len() + if mix > 0.0 { tail } else { 0 };
    let mut wet = vec![0.0f64; len];
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        if i >= d {
            let x = samples.get(i - d).copied().unwrap_or(0.0) as f64;
            wet[i] = x + fb * wet[i - d];
        }
        let dry = samples.get(i).copied().unwrap_or(0.0) as f64;
        out.push((dry + mix * wet[i]) as f32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 16_000.0;

    fn sine(freq: f32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(SR * secs) as usize)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / SR).sin())
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    #[test]
    fn lowpass_passes_low_and_kills_high() {
        let lo = lowpass(&sine(100.0, 1.0, 0.5), SR, 1000.0);
        let hi = lowpass(&sine(7000.0, 1.0, 0.5), SR, 1000.0);
        assert!(rms(&lo[4000..]) > 0.34);
        assert!(rms(&hi[4000..]) < 0.01);
    }

    #[test]
    fn highpass_passes_high_and_kills_low() {
        let lo = highpass(&sine(50.0, 1.0, 0.5), SR, 1000.0);
        let hi = highpass(&sine(6000.0, 1.0, 0.5), SR, 1000.0);
        assert!(rms(&lo[4000..]) < 0.01);
        assert!(rms(&hi[4000..]) > 0.33);
    }

    #[test]
    fn gate_silences_noise_floor_and_passes_speech_level() {
        let mut x = sine(300.0, 0.5, 0.002); // -54 dB hiss
        x.extend(sine(300.0, 0.5, 0.5)); // loud
        let g = noise_gate(&x, SR, -40.0, 2.0, 50.0);
        assert!(rms(&g[..7000]) < 0.0002);
        let loud = rms(&g[10_000..]);
        assert!((loud - 0.3535).abs() < 0.02, "{loud}");
    }

    #[test]
    fn echo_repeats_at_delay_with_feedback() {
        let mut x = vec![0.0f32; 1000];
        x[0] = 1.0;
        let out = echo(&x, 1000.0, 100.0, 0.5, 0.8);
        assert!((out[0] - 1.0).abs() < 1e-6);
        assert!((out[100] - 0.8).abs() < 1e-6);
        assert!((out[200] - 0.4).abs() < 1e-6);
        assert!(out.len() > x.len());
        assert!(out.last().unwrap().abs() < 1e-2);
    }

    #[test]
    fn echo_with_zero_mix_is_passthrough() {
        let x = sine(200.0, 0.1, 0.3);
        assert_eq!(echo(&x, SR, 120.0, 0.5, 0.0), x);
    }
}
