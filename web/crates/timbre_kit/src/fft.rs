//! Minimal iterative radix-2 complex FFT (f64), enough for the STFT-based
//! effects. Twiddles and the bit-reversal permutation are computed once per
//! size so a block loop can reuse one `Fft`.

use std::f64::consts::PI;

pub struct Fft {
    n: usize,
    cos: Vec<f64>,
    sin: Vec<f64>,
    rev: Vec<usize>,
}

impl Fft {
    /// `n` must be a power of two, >= 2.
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 2 && n.is_power_of_two(),
            "FFT size must be a power of two"
        );
        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| i.reverse_bits() >> (usize::BITS - bits))
            .collect();
        let (mut cos, mut sin) = (Vec::with_capacity(n / 2), Vec::with_capacity(n / 2));
        for k in 0..n / 2 {
            let a = -2.0 * PI * k as f64 / n as f64;
            cos.push(a.cos());
            sin.push(a.sin());
        }
        Self { n, cos, sin, rev }
    }

    /// In-place forward transform (unscaled, e^{-j...}).
    pub fn forward(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, false);
    }

    /// In-place inverse transform, scaled by 1/n so `inverse(forward(x)) == x`.
    pub fn inverse(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, true);
        let s = 1.0 / self.n as f64;
        re.iter_mut().for_each(|v| *v *= s);
        im.iter_mut().for_each(|v| *v *= s);
    }

    fn transform(&self, re: &mut [f64], im: &mut [f64], inverse: bool) {
        let n = self.n;
        debug_assert!(re.len() == n && im.len() == n);
        for i in 0..n {
            let j = self.rev[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let half = len / 2;
            let step = n / len;
            for start in (0..n).step_by(len) {
                for k in 0..half {
                    let wr = self.cos[k * step];
                    let wi = if inverse {
                        -self.sin[k * step]
                    } else {
                        self.sin[k * step]
                    };
                    let (a, b) = (start + k, start + k + half);
                    let tr = re[b] * wr - im[b] * wi;
                    let ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
            len <<= 1;
        }
    }
}

/// Periodic Hann window (the right choice for overlap-add analysis/synthesis).
pub fn hann(n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_is_identity() {
        let fft = Fft::new(64);
        let orig: Vec<f64> = (0..64).map(|i| ((i * 7 + 3) % 11) as f64 - 5.0).collect();
        let (mut re, mut im) = (orig.clone(), vec![0.0; 64]);
        fft.forward(&mut re, &mut im);
        fft.inverse(&mut re, &mut im);
        for (a, b) in re.iter().zip(&orig) {
            assert!((a - b).abs() < 1e-9);
        }
        assert!(im.iter().all(|v| v.abs() < 1e-9));
    }

    #[test]
    fn sine_lands_in_expected_bin() {
        let n = 256;
        let fft = Fft::new(n);
        let mut re: Vec<f64> = (0..n)
            .map(|i| (2.0 * PI * 10.0 * i as f64 / n as f64).sin())
            .collect();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        let mag: Vec<f64> = re.iter().zip(&im).map(|(r, i)| r.hypot(*i)).collect();
        let peak = (0..n / 2)
            .max_by(|&a, &b| mag[a].total_cmp(&mag[b]))
            .unwrap();
        assert_eq!(peak, 10);
    }
}
