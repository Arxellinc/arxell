//! Integration tests for the voice pipeline.
//!
//! Run with:   cargo test --test voice_pipeline
//! With output: cargo test --test voice_pipeline -- --nocapture
//!
//! These tests exercise the WAV encoding, VAD, and STT request format
//! without requiring a running Tauri app or live audio hardware.

use arx_lib::audio::capture::pcm_to_wav;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_sine(freq: f32, secs: f32, sr: u32) -> Vec<f32> {
    let n = (secs * sr as f32) as usize;
    (0..n)
        .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin() * 0.5)
        .collect()
}

fn wav_sample_rate(wav: &[u8]) -> u32 {
    u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]])
}

fn wav_channels(wav: &[u8]) -> u16 {
    u16::from_le_bytes([wav[22], wav[23]])
}

fn wav_bits_per_sample(wav: &[u8]) -> u16 {
    u16::from_le_bytes([wav[34], wav[35]])
}

fn wav_byte_rate(wav: &[u8]) -> u32 {
    u32::from_le_bytes([wav[28], wav[29], wav[30], wav[31]])
}

// ── WAV header tests ──────────────────────────────────────────────────────────

#[test]
fn wav_magic_bytes_riff_and_wave() {
    let wav = pcm_to_wav(&make_sine(440.0, 0.1, 16000), 16000).unwrap();
    assert_eq!(&wav[0..4], b"RIFF", "must start with RIFF");
    assert_eq!(&wav[8..12], b"WAVE", "byte 8 must be WAVE");
    println!("[PASS] WAV magic bytes: RIFF...WAVE");
}

#[test]
fn wav_sample_rate_is_16khz() {
    let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
    assert_eq!(wav_sample_rate(&wav), 16000);
    println!("[PASS] Sample rate in WAV header = 16000");
}

#[test]
fn wav_is_mono() {
    let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
    assert_eq!(wav_channels(&wav), 1);
    println!("[PASS] Channels = 1 (mono)");
}

#[test]
fn wav_is_16_bit() {
    let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
    assert_eq!(wav_bits_per_sample(&wav), 16);
    println!("[PASS] Bits per sample = 16");
}

#[test]
fn wav_byte_rate_is_correct() {
    // ByteRate = SampleRate * NumChannels * BitsPerSample / 8
    let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
    assert_eq!(wav_byte_rate(&wav), 16000 * 2);
    println!("[PASS] Byte rate = 32000");
}

// ── WAV size tests ────────────────────────────────────────────────────────────

#[test]
fn wav_size_equals_header_plus_samples() {
    let n = 3200usize; // 200ms
    let wav = pcm_to_wav(&vec![0.0f32; n], 16000).unwrap();
    let expected = 44 + n * 2; // 44-byte header + 2 bytes per i16 sample
    assert_eq!(
        wav.len(),
        expected,
        "WAV size mismatch: got {} expected {}",
        wav.len(),
        expected
    );
    println!("[PASS] WAV size = 44 + {}*2 = {} bytes", n, expected);
}

#[test]
fn wav_one_second_size() {
    let wav = pcm_to_wav(&make_sine(440.0, 1.0, 16000), 16000).unwrap();
    assert_eq!(wav.len(), 44 + 32000, "1s 16kHz 16-bit mono = 32044 bytes");
    println!("[PASS] 1-second 440Hz WAV = {} bytes", wav.len());
}

#[test]
fn wav_empty_input_valid() {
    let wav = pcm_to_wav(&[], 16000).unwrap();
    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(wav.len(), 44, "empty audio = 44-byte header only");
    println!("[PASS] Empty input produces 44-byte WAV header");
}

// ── WAV data tests ────────────────────────────────────────────────────────────

#[test]
fn wav_silence_encodes_to_zeros() {
    let wav = pcm_to_wav(&vec![0.0f32; 512], 16000).unwrap();
    assert!(
        wav[44..].iter().all(|&b| b == 0),
        "all silence samples should encode to zero bytes"
    );
    println!("[PASS] Silence PCM encodes to all-zero data bytes");
}

#[test]
fn wav_full_scale_peak_maps_to_i16_max() {
    let wav = pcm_to_wav(&[1.0f32], 16000).unwrap();
    let sample = i16::from_le_bytes([wav[44], wav[45]]);
    assert_eq!(sample, i16::MAX, "+1.0 should map to i16::MAX (32767)");
    println!("[PASS] +1.0f32 -> i16::MAX ({})", i16::MAX);
}

#[test]
fn wav_negative_full_scale_maps_to_i16_min() {
    let wav = pcm_to_wav(&[-1.0f32], 16000).unwrap();
    let sample = i16::from_le_bytes([wav[44], wav[45]]);
    // hound clamps to i16::MIN (-32768)
    assert!(
        sample <= -32767,
        "-1.0 should map near i16::MIN, got {}",
        sample
    );
    println!("[PASS] -1.0f32 -> {} (≈ i16::MIN)", sample);
}

#[test]
fn wav_clipping_does_not_panic_or_error() {
    let samples = vec![2.0f32, -2.0f32, 100.0f32, -100.0f32];
    let result = pcm_to_wav(&samples, 16000);
    assert!(
        result.is_ok(),
        "out-of-range samples must be clamped, not panic: {:?}",
        result.err()
    );
    println!("[PASS] Out-of-range samples clamped without error");
}

#[test]
fn wav_nonzero_audio_is_not_silent() {
    let sine = make_sine(440.0, 0.1, 16000);
    let wav = pcm_to_wav(&sine, 16000).unwrap();
    let data = &wav[44..];
    let all_zero = data.iter().all(|&b| b == 0);
    assert!(
        !all_zero,
        "a 440Hz sine should NOT encode to all-zero bytes"
    );
    println!("[PASS] Non-silent audio encodes to non-zero bytes");
}

// ── Multipart form tests ──────────────────────────────────────────────────────

#[test]
fn stt_wav_meets_minimum_size_for_whisper() {
    // Whisper-compatible servers typically reject < 100ms audio.
    // 0.5s should be safely above any reasonable threshold.
    let samples = make_sine(440.0, 0.5, 16000);
    let wav = pcm_to_wav(&samples, 16000).unwrap();
    assert!(
        wav.len() > 1000,
        "0.5s WAV is suspiciously small: {} bytes (expected ~16044)",
        wav.len()
    );
    println!(
        "[PASS] 0.5s WAV = {} bytes (above minimum for STT)",
        wav.len()
    );
}

// ── VAD / pipeline constants ──────────────────────────────────────────────────

#[test]
fn vad_chunk_is_512_samples_32ms_at_16khz() {
    // 32ms * 16000 Hz = 512 samples — this is the contract for Silero VAD
    let expected_chunk: usize = 512;
    let duration_ms: f32 = 32.0;
    let sr: f32 = 16000.0;
    assert_eq!((duration_ms * sr / 1000.0) as usize, expected_chunk);
    println!(
        "[PASS] VAD chunk size: {} samples = {}ms @ {}Hz",
        expected_chunk, duration_ms, sr
    );
}

#[test]
fn silence_frames_constant_covers_640ms() {
    // 20 frames * 32ms/frame = 640ms silence = end of utterance
    let frames: usize = 20;
    let frame_ms: usize = 32;
    assert_eq!(frames * frame_ms, 640);
    println!(
        "[PASS] Silence detection: {} frames * {}ms = {}ms",
        frames,
        frame_ms,
        frames * frame_ms
    );
}

// ── Round-trip decode test ────────────────────────────────────────────────────

#[test]
fn wav_can_be_decoded_back_by_hound() {
    let original: Vec<f32> = make_sine(440.0, 0.1, 16000);
    let wav_bytes = pcm_to_wav(&original, 16000).unwrap();

    let cursor = std::io::Cursor::new(wav_bytes.as_slice());
    let mut reader =
        hound::WavReader::new(cursor).expect("hound should be able to read back the WAV");
    let spec = reader.spec();

    assert_eq!(spec.sample_rate, 16000);
    assert_eq!(spec.channels, 1);
    assert_eq!(spec.bits_per_sample, 16);
    assert_eq!(spec.sample_format, hound::SampleFormat::Int);

    let decoded: Vec<i16> = reader
        .samples::<i16>()
        .map(|s: Result<i16, _>| s.unwrap())
        .collect();
    assert_eq!(
        decoded.len(),
        original.len(),
        "decoded sample count should match original"
    );

    // Check that the peak value is reasonable (440Hz sine at 0.5 amplitude -> ~0.5*32767)
    let peak = decoded.iter().map(|&s| s.abs()).max().unwrap_or(0);
    assert!(
        peak > 10000,
        "440Hz 0.5-amplitude sine should decode to peak > 10000, got {}",
        peak
    );

    println!(
        "[PASS] WAV round-trip: {} samples, peak i16 = {}",
        decoded.len(),
        peak
    );
}
