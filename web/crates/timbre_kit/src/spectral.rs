//! STFT-based effects: phase-vocoder pitch shift, cepstral formant shift and
//! the voice anonymizer built from the two.
//!
//! Everything here is offline (whole-clip) processing; the browser hands over a
//! decoded buffer and gets a buffer of the same length back.

use crate::fft::{hann, Fft};
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

/// Frame size and synthesis hop (75% overlap, Hann/Hann is a clean COLA pair).
const N: usize = 2048;
const HOP: usize = N / 4;

fn wrap_phase(p: f64) -> f64 {
    p - 2.0 * PI * (p / (2.0 * PI)).round()
}

/// Phase-vocoder time stretch: output is ~`stretch` times longer, pitch intact.
fn time_stretch(input: &[f32], stretch: f64) -> Vec<f32> {
    if input.is_empty() {
        return Vec::new();
    }
    let fft = Fft::new(N);
    let win = hann(N);
    let ha_f = HOP as f64 / stretch; // analysis hop (fractional)

    // Zero-pad so the first/last samples are covered by full overlaps.
    let mut padded = vec![0.0f64; N];
    padded.extend(input.iter().map(|&x| x as f64));
    padded.extend(std::iter::repeat_n(0.0, N));

    let frames = ((padded.len() - N) as f64 / ha_f).floor() as usize + 1;
    let out_len = (frames - 1) * HOP + N;
    let mut out = vec![0.0f64; out_len];
    let mut norm = vec![0.0f64; out_len];

    let bins = N / 2 + 1;
    let mut prev_phase = vec![0.0f64; bins];
    let mut synth_phase = vec![0.0f64; bins];
    let (mut re, mut im) = (vec![0.0f64; N], vec![0.0f64; N]);
    let mut prev_pos = 0usize;

    for f in 0..frames {
        let pos = ((f as f64 * ha_f).round() as usize).min(padded.len() - N);
        for i in 0..N {
            re[i] = padded[pos + i] * win[i];
            im[i] = 0.0;
        }
        fft.forward(&mut re, &mut im);

        let ha = (pos - prev_pos) as f64;
        for k in 0..bins {
            let mag = re[k].hypot(im[k]);
            let phase = im[k].atan2(re[k]);
            if f == 0 {
                synth_phase[k] = phase;
            } else {
                let omega = 2.0 * PI * k as f64 / N as f64;
                // Deviation from the bin's centre frequency -> true frequency.
                let inst = if ha > 0.0 {
                    omega + wrap_phase(phase - prev_phase[k] - omega * ha) / ha
                } else {
                    omega
                };
                synth_phase[k] += inst * HOP as f64;
            }
            prev_phase[k] = phase;
            re[k] = mag * synth_phase[k].cos();
            im[k] = mag * synth_phase[k].sin();
        }
        im[0] = 0.0;
        im[N / 2] = 0.0;
        for k in 1..N / 2 {
            re[N - k] = re[k];
            im[N - k] = -im[k];
        }
        fft.inverse(&mut re, &mut im);
        for i in 0..N {
            out[f * HOP + i] += re[i] * win[i];
            norm[f * HOP + i] += win[i] * win[i];
        }
        prev_pos = pos;
    }

    let start = (N as f64 * stretch).round() as usize;
    let len = (input.len() as f64 * stretch).round() as usize;
    (start..start + len)
        .map(|i| match (out.get(i), norm.get(i)) {
            (Some(&o), Some(&n)) if n > 1e-8 => (o / n) as f32,
            _ => 0.0,
        })
        .collect()
}

/// Shift pitch by `semitones` (±24) without changing duration: stretch by the
/// pitch ratio with the phase vocoder, then resample back to the original length.
/// Note formants move with the pitch (chipmunk/ogre); pair with [`formant_shift`]
/// to decouple them.
#[wasm_bindgen]
pub fn pitch_shift(samples: &[f32], semitones: f32) -> Vec<f32> {
    let st = (semitones as f64).clamp(-24.0, 24.0);
    if samples.is_empty() || st.abs() < 1e-3 {
        return samples.to_vec();
    }
    let ratio = 2f64.powf(st / 12.0);
    let stretched = time_stretch(samples, ratio);
    (0..samples.len())
        .map(|j| {
            let pos = j as f64 * ratio;
            let i = pos.floor() as usize;
            let frac = (pos - i as f64) as f32;
            let a = stretched.get(i).copied().unwrap_or(0.0);
            let b = stretched.get(i + 1).copied().unwrap_or(0.0);
            a + (b - a) * frac
        })
        .collect()
}

/// Warp the spectral envelope (vocal-tract resonances) by `ratio` while leaving
/// the pitch alone: ratio > 1 = smaller/brighter "vocal tract", < 1 = larger.
///
/// The envelope is estimated per frame by cepstral liftering of the log
/// magnitude spectrum, then each bin is re-weighted by env(k/ratio)/env(k).
/// Phases are untouched, so the excitation (pitch) is preserved.
#[wasm_bindgen]
pub fn formant_shift(samples: &[f32], sample_rate: f32, ratio: f32) -> Vec<f32> {
    let ratio = (ratio as f64).clamp(0.5, 2.0);
    if samples.is_empty() || (ratio - 1.0).abs() < 1e-3 {
        return samples.to_vec();
    }
    let lifter = ((sample_rate as f64 / 1000.0).round() as usize).clamp(8, N / 8);

    let fft = Fft::new(N);
    let win = hann(N);
    let mut padded = vec![0.0f64; N];
    padded.extend(samples.iter().map(|&x| x as f64));
    padded.extend(std::iter::repeat_n(0.0, N));
    let frames = (padded.len() - N) / HOP + 1;
    let mut out = vec![0.0f64; padded.len()];
    let mut norm = vec![0.0f64; padded.len()];
    let bins = N / 2 + 1;
    let (mut re, mut im) = (vec![0.0f64; N], vec![0.0f64; N]);
    let (mut cre, mut cim) = (vec![0.0f64; N], vec![0.0f64; N]);
    let mut env = vec![0.0f64; bins];

    for f in 0..frames {
        let pos = f * HOP;
        for i in 0..N {
            re[i] = padded[pos + i] * win[i];
            im[i] = 0.0;
        }
        fft.forward(&mut re, &mut im);

        // Log-magnitude -> real cepstrum -> lifter -> smoothed log envelope.
        for k in 0..bins {
            let lm = (re[k].hypot(im[k]) + 1e-9).ln();
            cre[k] = lm;
            if k > 0 && k < N / 2 {
                cre[N - k] = lm;
            }
        }
        cim.iter_mut().for_each(|v| *v = 0.0);
        fft.forward(&mut cre, &mut cim);
        for q in (lifter + 1)..(N - lifter) {
            cre[q] = 0.0;
            cim[q] = 0.0;
        }
        fft.inverse(&mut cre, &mut cim);
        env[..bins].copy_from_slice(&cre[..bins]);

        for k in 0..bins {
            let src = (k as f64 / ratio).min((bins - 1) as f64);
            let i = src.floor() as usize;
            let frac = src - i as f64;
            let warped = env[i] + (env[(i + 1).min(bins - 1)] - env[i]) * frac;
            let gain = (warped - env[k]).clamp(-3.0, 3.0).exp();
            re[k] *= gain;
            im[k] *= gain;
        }
        im[0] = 0.0;
        im[N / 2] = 0.0;
        for k in 1..N / 2 {
            re[N - k] = re[k];
            im[N - k] = -im[k];
        }
        fft.inverse(&mut re, &mut im);
        for i in 0..N {
            out[pos + i] += re[i] * win[i];
            norm[pos + i] += win[i] * win[i];
        }
    }

    (0..samples.len())
        .map(|i| {
            let j = N + i;
            if norm[j] > 1e-8 {
                (out[j] / norm[j]) as f32
            } else {
                0.0
            }
        })
        .collect()
}

/// Voice anonymizer: shift pitch and move the formants by an independent
/// amount so neither the fundamental nor the timbre matches the speaker.
/// Typical: `semitones = -3..-5` with `formant_ratio = 0.85`, or the mirror
/// image (+4, 1.2).
#[wasm_bindgen]
pub fn anonymize(
    samples: &[f32],
    sample_rate: f32,
    semitones: f32,
    formant_ratio: f32,
) -> Vec<f32> {
    let shifted = pitch_shift(samples, semitones);
    // Pitch shifting already dragged the formants along by the pitch ratio;
    // `formant_ratio` is the *total* envelope move wanted, so compensate.
    let pitch_ratio = 2f32.powf(semitones.clamp(-24.0, 24.0) / 12.0);
    formant_shift(&shifted, sample_rate, formant_ratio / pitch_ratio)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 16_000.0;

    fn sine(freq: f32, secs: f32) -> Vec<f32> {
        (0..(SR * secs) as usize)
            .map(|i| 0.5 * (2.0 * std::f32::consts::PI * freq * i as f32 / SR).sin())
            .collect()
    }

    /// Dominant frequency (Hz) of the middle of a clip via a windowed FFT.
    pub(crate) fn dominant_freq(x: &[f32]) -> f32 {
        let n = 8192;
        let start = x.len() / 2 - n / 2;
        let w = hann(n);
        let fft = Fft::new(n);
        let mut re: Vec<f64> = (0..n).map(|i| x[start + i] as f64 * w[i]).collect();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        let mag: Vec<f64> = (0..n / 2).map(|k| re[k].hypot(im[k])).collect();
        let k = (1..n / 2 - 1)
            .max_by(|&a, &b| mag[a].total_cmp(&mag[b]))
            .unwrap();
        // Parabolic interpolation for sub-bin accuracy.
        let (a, b, c) = (mag[k - 1].ln(), mag[k].ln(), mag[k + 1].ln());
        let delta = 0.5 * (a - c) / (a - 2.0 * b + c);
        ((k as f64 + delta) * SR as f64 / n as f64) as f32
    }

    #[test]
    fn pitch_up_an_octave() {
        let out = pitch_shift(&sine(440.0, 2.0), 12.0);
        assert_eq!(out.len(), 32_000);
        let f = dominant_freq(&out);
        assert!((f - 880.0).abs() < 880.0 * 0.02, "got {f}");
    }

    #[test]
    fn pitch_down_five_semitones() {
        let out = pitch_shift(&sine(600.0, 2.0), -5.0);
        let expect = 600.0 * 2f32.powf(-5.0 / 12.0);
        let f = dominant_freq(&out);
        assert!((f - expect).abs() < expect * 0.02, "got {f}, want {expect}");
    }

    #[test]
    fn pitch_shift_keeps_level_roughly() {
        let input = sine(440.0, 2.0);
        let out = pitch_shift(&input, 3.0);
        let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
        let (a, b) = (rms(&input[8000..24000]), rms(&out[8000..24000]));
        assert!((a - b).abs() / a < 0.15, "in {a} out {b}");
    }

    #[test]
    fn zero_shift_is_identity() {
        let input = sine(300.0, 0.5);
        assert_eq!(pitch_shift(&input, 0.0), input);
        assert_eq!(formant_shift(&input, SR, 1.0), input);
    }

    #[test]
    fn handles_tiny_and_empty_input() {
        assert!(pitch_shift(&[], 5.0).is_empty());
        assert_eq!(pitch_shift(&[0.1, 0.2, 0.3], 5.0).len(), 3);
        assert_eq!(formant_shift(&[0.1; 100], SR, 1.3).len(), 100);
    }

    /// Voiced-ish test signal: 200 Hz pulse train through a 1 kHz low-pass.
    fn voiced() -> Vec<f32> {
        let pulses: Vec<f32> = (0..32_000)
            .map(|i| if i % 80 == 0 { 1.0 } else { 0.0 })
            .collect();
        crate::filters::lowpass(&crate::filters::lowpass(&pulses, SR, 1000.0), SR, 1000.0)
    }

    fn centroid(x: &[f32]) -> f64 {
        let n = 8192;
        let start = x.len() / 2 - n / 2;
        let w = hann(n);
        let fft = Fft::new(n);
        let mut re: Vec<f64> = (0..n).map(|i| x[start + i] as f64 * w[i]).collect();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        let (mut num, mut den) = (0.0, 0.0);
        for k in 0..n / 2 {
            let m = re[k].hypot(im[k]);
            num += m * k as f64;
            den += m;
        }
        num / den * SR as f64 / n as f64
    }

    fn period(x: &[f32]) -> usize {
        let seg = &x[8000..24000];
        (40..200)
            .max_by(|&a, &b| {
                let ac = |l: usize| (0..seg.len() - l).map(|i| seg[i] * seg[i + l]).sum::<f32>();
                ac(a).total_cmp(&ac(b))
            })
            .unwrap()
    }

    #[test]
    fn formant_shift_moves_envelope_not_pitch() {
        let input = voiced();
        let up = formant_shift(&input, SR, 1.5);
        assert_eq!(up.len(), input.len());
        assert!(
            centroid(&up) > centroid(&input) * 1.1,
            "{} vs {}",
            centroid(&up),
            centroid(&input)
        );
        assert!(
            (period(&up) as i32 - 80).abs() <= 1,
            "pitch period {}",
            period(&up)
        );
        let down = formant_shift(&input, SR, 0.7);
        assert!(centroid(&down) < centroid(&input) * 0.95);
        assert!((period(&down) as i32 - 80).abs() <= 1);
    }

    #[test]
    fn anonymize_moves_pitch_and_stays_finite() {
        // A pure tone has no formants to move, so the pitch shift must come
        // through the formant stage unharmed (ratio 1.2 vs pitch ratio 1.26).
        let out = anonymize(&sine(500.0, 2.0), SR, 4.0, 1.2);
        assert_eq!(out.len(), 32_000);
        assert!(out.iter().all(|v| v.is_finite() && v.abs() < 4.0));
        let expect = 500.0 * 2f32.powf(4.0 / 12.0);
        let f = dominant_freq(&out);
        assert!((f - expect).abs() < expect * 0.03, "got {f}, want {expect}");
    }
}
