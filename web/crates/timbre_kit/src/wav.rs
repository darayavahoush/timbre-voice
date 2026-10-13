//! PCM16 helpers: WAV container encode (client-side, for uploading processed
//! audio) and raw little-endian PCM16 (the live-session wire format).

use wasm_bindgen::prelude::*;

#[inline]
fn to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

/// Float samples (-1..1) -> raw little-endian signed 16-bit PCM bytes.
#[wasm_bindgen]
pub fn f32_to_pcm16le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        out.extend_from_slice(&to_i16(s).to_le_bytes());
    }
    out
}

/// Interleaved float samples -> a complete 16-bit PCM WAV file.
#[wasm_bindgen]
pub fn encode_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let channels = channels.max(1);
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * channels as u32 * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&(channels * 2).to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        out.extend_from_slice(&to_i16(s).to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_is_well_formed() {
        let wav = encode_wav(&[0.0, 1.0, -1.0, 0.5], 16_000, 1);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(
            u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize,
            wav.len() - 8
        );
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        assert_eq!(wav.len(), 44 + 8);
        assert_eq!(i16::from_le_bytes(wav[46..48].try_into().unwrap()), 32767);
        assert_eq!(i16::from_le_bytes(wav[48..50].try_into().unwrap()), -32767);
    }

    #[test]
    fn out_of_range_samples_clip_instead_of_wrapping() {
        let b = f32_to_pcm16le(&[2.0, -2.0, f32::NAN]);
        assert_eq!(i16::from_le_bytes([b[0], b[1]]), 32767);
        assert_eq!(i16::from_le_bytes([b[2], b[3]]), -32767);
        assert_eq!(i16::from_le_bytes([b[4], b[5]]), 0);
    }
}
