use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::mpsc::Sender;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::device::normalize_label;
use super::vad::SileroVad;

const SAMPLE_RATE: u32 = 16000;
const VAD_CHUNK: usize = 512; // 32ms @ 16kHz
const CHUNK_MS: u32 = VAD_CHUNK as u32 * 1000 / SAMPLE_RATE; // 32

// ── VAD configuration ─────────────────────────────────────────────────────────

/// Which signal source to use for voice activity detection.
#[derive(Clone, Debug, Default)]
pub enum VadMode {
    /// Try Silero ONNX model, fall back to amplitude RMS if unavailable.
    #[default]
    Auto,
    /// Require Silero ONNX — still amplitude-falls-back with a warning if model missing.
    OnnxOnly,
    /// Skip ONNX entirely; use amplitude RMS threshold only.
    AmplitudeOnly,
}

/// Runtime VAD tuning parameters — read from the DB settings at voice-start time.
#[derive(Clone, Debug)]
pub struct VadConfig {
    /// Silero speech-probability threshold (0.0–1.0). Default 0.35.
    pub threshold: f32,
    /// Continuous silence (ms) required to end an utterance. Default 1200ms.
    pub min_silence_ms: u32,
    /// Extra silence hold (ms) after min_silence before finalizing utterance.
    /// Prevents cutoffs on short conversational pauses. Default 320ms.
    pub end_silence_grace_ms: u32,
    /// Audio prepended before speech onset from a rolling ring-buffer (ms). Default 320ms.
    pub speech_pad_pre_ms: u32,
    /// Minimum speech duration to accept; shorter utterances are discarded (ms). Default 50ms.
    pub min_speech_ms: u32,
    /// Maximum utterance length before a forced cut (seconds). Default 30s.
    pub max_speech_s: f32,
    /// RMS amplitude threshold used when ONNX is unavailable. Default 0.005.
    pub amplitude_threshold: f32,
    /// Which detection backend to use.
    pub mode: VadMode,

    // ── Partial / streaming transcription ─────────────────────────────────
    /// Emit `voice:partial` events every this many ms during speech. 0 = disabled.
    pub partial_interval_ms: u64,
    /// Absolute path to stt_whisper.py (empty → partial disabled).
    pub stt_script: String,
    /// Whisper model size (e.g. "tiny").
    pub stt_model: String,
    /// Directory where Whisper will store downloaded models (empty → default cache).
    pub stt_model_dir: String,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            threshold: 0.35,
            min_silence_ms: 1200,
            end_silence_grace_ms: 320,
            speech_pad_pre_ms: 320,
            min_speech_ms: 50,
            max_speech_s: 30.0,
            amplitude_threshold: 0.005,
            mode: VadMode::Auto,
            partial_interval_ms: 1500,
            stt_script: String::new(),
            stt_model: "tiny".to_string(),
            stt_model_dir: String::new(),
        }
    }
}

// ── Event types ───────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
struct VoiceStateEvent {
    state: String,
}

#[derive(Clone, serde::Serialize)]
struct AmplitudeEvent {
    level: f32,
}

// ── Pipeline handle ───────────────────────────────────────────────────────────

pub struct VoicePipeline {
    pub running: Arc<AtomicBool>,
    pub audio_buffer: Arc<Mutex<Vec<f32>>>,
}

impl VoicePipeline {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

// ── Utterance message type ────────────────────────────────────────────────────

/// Message sent from the capture loop to the transcription thread.
///
/// - `Final`   — complete utterance; transcription thread emits `voice:transcript`
/// - `Partial` — mid-speech snapshot for interim display / speculative prefill;
///               transcription thread emits `voice:partial`
pub enum VoiceUtterance {
    Final(Vec<f32>),
    Partial(Vec<f32>),
}

fn resolve_input_device(host: &cpal::Host, preferred_name: Option<&str>) -> Result<cpal::Device> {
    if let Some(name) = preferred_name {
        let candidates: Vec<cpal::Device> = host
            .input_devices()
            .map_err(|e| anyhow::anyhow!("Failed to list input devices: {e}"))?
            .collect();
        if let Some(device) = candidates.iter().find(|d| d.name().ok().as_deref() == Some(name))
        {
            return Ok(device.clone());
        }
        let normalized = normalize_label(name);
        if let Some(device) = candidates.iter().find(|d| {
            d.name()
                .ok()
                .map(|n| normalize_label(&n) == normalized)
                .unwrap_or(false)
        }) {
            return Ok(device.clone());
        }
        log::warn!(
            "[VAD] preferred input device '{}' not found; falling back to default",
            name
        );
    }
    host.default_input_device()
        .ok_or_else(|| anyhow::anyhow!("No input device available"))
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Start continuous capture. Utterances are sent via `utterance_tx` instead of terminating the loop.
/// The loop runs until `running` is set to false by `cmd_voice_stop`.
pub fn start_capture(
    app: AppHandle,
    running: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    vad_model_path: std::path::PathBuf,
    config: VadConfig,
    utterance_tx: Sender<VoiceUtterance>,
    preferred_device: Option<String>,
) -> Result<()> {
    running.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        if let Err(e) = capture_loop(
            app,
            running,
            audio_buffer,
            vad_model_path,
            config,
            utterance_tx,
            preferred_device,
        ) {
            log::error!("[VAD] capture error: {}", e);
        }
    });

    Ok(())
}

// ── Capture + VAD loop ────────────────────────────────────────────────────────

fn capture_loop(
    app: AppHandle,
    running: Arc<AtomicBool>,
    _audio_buffer: Arc<Mutex<Vec<f32>>>,
    vad_model_path: std::path::PathBuf,
    config: VadConfig,
    utterance_tx: Sender<VoiceUtterance>,
    preferred_device: Option<String>,
) -> Result<()> {
    let host = cpal::default_host();
    let device = resolve_input_device(&host, preferred_device.as_deref())?;

    let cpal_config = cpal::StreamConfig {
        channels: 1,
        sample_rate: cpal::SampleRate(SAMPLE_RATE),
        buffer_size: cpal::BufferSize::Default,
    };

    // Shared ring buffer for incoming audio frames
    let ring: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let ring_clone = ring.clone();

    let app_err = app.clone();
    let stream = device.build_input_stream(
        &cpal_config,
        move |data: &[f32], _| {
            ring_clone.lock().unwrap().extend_from_slice(data);
        },
        move |e| {
            log::error!("[VAD] stream error: {}", e);
            let _ = app_err.emit("audio_device_lost", format!("Stream error: {e}"));
        },
        None,
    )?;

    stream.play()?;

    let _ = app.emit(
        "voice:state",
        VoiceStateEvent {
            state: "listening".to_string(),
        },
    );

    // ── Derive frame counts from config ─────────────────────────────────────

    let silence_frames = (config.min_silence_ms / CHUNK_MS).max(1) as usize;
    let grace_frames = (config.end_silence_grace_ms / CHUNK_MS).max(1) as usize;
    let pre_pad_frames = (config.speech_pad_pre_ms / CHUNK_MS) as usize;
    let min_speech_frames = (config.min_speech_ms / CHUNK_MS) as usize;
    let max_speech_frames = ((config.max_speech_s * 1000.0) as u32 / CHUNK_MS).max(1) as usize;

    log::info!(
        "[VAD] config: threshold={:.2} silence={}f grace={}f pre={}f min={}f max={}f amp={:.4} mode={:?}",
        config.threshold,
        silence_frames,
        grace_frames,
        pre_pad_frames,
        min_speech_frames,
        max_speech_frames,
        config.amplitude_threshold,
        config.mode
    );

    // ── Set up VAD model ─────────────────────────────────────────────────────

    let use_onnx = !matches!(config.mode, VadMode::AmplitudeOnly);
    let mut vad: Option<SileroVad> = if use_onnx {
        match SileroVad::new(&vad_model_path) {
            Ok(v) => {
                log::info!("[VAD] Silero ONNX model loaded");
                Some(v)
            }
            Err(e) => {
                log::warn!(
                    "[VAD] ONNX model unavailable ({}), using amplitude fallback",
                    e
                );
                None
            }
        }
    } else {
        log::info!("[VAD] mode=amplitude, skipping ONNX");
        None
    };

    // ── Smart VAD constants ───────────────────────────────────────────────────

    // Fast-path finalization: if the Silero probability NEVER exceeded this
    // value during the entire silence window, the silence is considered "clean"
    // (no breathing, no hesitation sounds) and we finalize at FAST_SILENCE_MS
    // instead of waiting for min_silence_ms.  Breathing / "um" / ambient noise
    // during a mid-sentence pause keeps the probability above this threshold,
    // preventing premature finalization.
    const DEEP_SILENCE_PROB_THRESHOLD: f32 = 0.08;
    // Minimum silence duration (ms) required for the fast path.
    // Long enough to survive brief within-sentence pauses but shorter than
    // a deliberate end-of-utterance silence.
    const FAST_SILENCE_MS: u32 = 800;
    let fast_silence_frames = (FAST_SILENCE_MS / CHUNK_MS).max(1) as usize;

    // ── Partial transcription state ──────────────────────────────────────────

    // Partials are enabled when a fire interval is set.  The transcription
    // thread (whisper-rs persistent ctx) handles them in-process without any
    // subprocess cold-start, so there is no need to gate on stt_script.
    let partial_enabled = config.partial_interval_ms > 0;
    let partial_interval = Duration::from_millis(config.partial_interval_ms.max(500));
    let mut last_partial_at = Instant::now();
    // Minimum frames before we bother sending a partial (~640ms of speech)
    let partial_min_frames = VAD_CHUNK * 20;

    // ── State ────────────────────────────────────────────────────────────────

    // Rolling ring of recent frames for pre-speech padding
    let mut pre_ring: VecDeque<Vec<f32>> = VecDeque::new();
    let mut speech_frames: Vec<f32> = Vec::new();
    let mut in_speech = false;
    let mut silence_count = 0usize;
    let mut pending_finalize_frames = 0usize;
    let mut utterance_count: u32 = 0;
    // Maximum Silero probability seen during the current silence window.
    // A non-zero value means the silence contains breathing/hesitation sounds,
    // which disqualifies the fast-path finalization.
    let mut silence_max_prob: f32 = 0.0;
    // Throttle amplitude events to ~12 Hz (one per ~83 ms) to avoid flooding
    // Tauri IPC and triggering continuous React re-renders during silence.
    let mut last_amp_emit = Instant::now();

    // ── Main capture loop ────────────────────────────────────────────────────

    while running.load(Ordering::SeqCst) {
        let samples: Vec<f32> = {
            let mut r = ring.lock().unwrap();
            std::mem::take(&mut *r)
        };

        let mut pos = 0;
        while pos + VAD_CHUNK <= samples.len() {
            let chunk = &samples[pos..pos + VAD_CHUNK];
            pos += VAD_CHUNK;

            // Compute RMS for amplitude display and fallback VAD
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();

            // Throttle amplitude events to ~12 Hz to avoid flooding Tauri IPC
            // with 31 events/second even during silence.
            if last_amp_emit.elapsed().as_millis() >= 83 {
                let _ = app.emit("voice:amplitude", AmplitudeEvent { level: rms });
                last_amp_emit = Instant::now();
            }

            // Compute raw speech probability (needed for smart silence tracking).
            // is_speech is derived from the same value so we only run the ONNX
            // model once per chunk.
            let speech_prob = if let Some(ref mut v) = vad {
                v.predict(chunk).unwrap_or(if rms > config.amplitude_threshold {
                    1.0
                } else {
                    0.0
                })
            } else if rms > config.amplitude_threshold {
                1.0
            } else {
                0.0
            };
            let is_speech = speech_prob > config.threshold;

            if is_speech {
                if !in_speech {
                    in_speech = true;
                    // Prepend pre-roll buffer so we capture the speech onset
                    for prev in pre_ring.drain(..) {
                        speech_frames.extend(prev);
                    }
                    let _ = app.emit(
                        "voice:state",
                        VoiceStateEvent {
                            state: "speaking".to_string(),
                        },
                    );
                }
                silence_count = 0; // reset on any speech frame
                silence_max_prob = 0.0; // start fresh silence tracking on next gap
                pending_finalize_frames = 0; // cancel pending finalize on resumed speech
                speech_frames.extend_from_slice(chunk);

                // Force-end utterance if maximum duration exceeded
                if speech_frames.len() / VAD_CHUNK >= max_speech_frames {
                    log::info!(
                        "[VAD] max speech duration ({:.1}s) reached, forcing end",
                        config.max_speech_s
                    );
                    deliver(
                        &app,
                        &utterance_tx,
                        &mut speech_frames,
                        &mut in_speech,
                        &mut silence_count,
                        &mut pre_ring,
                        0,
                        &mut utterance_count,
                    );
                    pending_finalize_frames = 0;
                    // Don't break - continue listening for next utterance
                }
            } else {
                // no-op handled below
            }

            // ── Partial / streaming transcription ────────────────────────────
            // Send a snapshot of the current speech buffer to the transcription
            // thread via the shared channel.  The thread uses the persistent
            // Whisper daemon (no subprocess cold-start) and emits voice:partial.
            // Rate-limited by last_partial_at; the transcription thread drops
            // the partial if it arrives while a final is already being processed.
            if in_speech
                && partial_enabled
                && running.load(Ordering::Relaxed)
                && speech_frames.len() >= partial_min_frames
                && last_partial_at.elapsed() >= partial_interval
            {
                last_partial_at = Instant::now();
                let snapshot = speech_frames.clone();
                // send() on an unbounded mpsc channel never blocks; ignore send
                // errors (they just mean the transcription thread has exited).
                let _ = utterance_tx.send(VoiceUtterance::Partial(snapshot));
            }

            if !is_speech {
                if !in_speech {
                    // Maintain the pre-roll ring buffer
                    if pre_pad_frames > 0 {
                        if pre_ring.len() >= pre_pad_frames {
                            pre_ring.pop_front();
                        }
                        pre_ring.push_back(chunk.to_vec());
                    }
                } else {
                    // In speech but this frame is silent — accumulate and count.
                    speech_frames.extend_from_slice(chunk);
                    silence_count += 1;

                    // Track the highest Silero probability seen during this silence
                    // window.  Breathing, "um", hesitation sounds, or ambient noise
                    // all push the probability above the deep-silence threshold, which
                    // prevents the fast path from firing mid-sentence.
                    silence_max_prob = silence_max_prob.max(speech_prob);

                    // ── Fast path: clean end-of-speech ───────────────────────
                    // If the entire silence window has been truly quiet (Silero
                    // never spiked above DEEP_SILENCE_PROB_THRESHOLD) we can
                    // finalize at FAST_SILENCE_MS rather than waiting the full
                    // min_silence_ms.  This shaves 200–400 ms off the typical
                    // end-of-turn latency without cutting off mid-sentence pauses,
                    // which almost always contain audible breathing.
                    if silence_count >= fast_silence_frames
                        && silence_max_prob < DEEP_SILENCE_PROB_THRESHOLD
                    {
                        log::debug!(
                            "[VAD] fast finalize: {}ms clean silence (max_prob={:.3})",
                            silence_count as u32 * CHUNK_MS,
                            silence_max_prob
                        );
                        deliver(
                            &app,
                            &utterance_tx,
                            &mut speech_frames,
                            &mut in_speech,
                            &mut silence_count,
                            &mut pre_ring,
                            min_speech_frames,
                            &mut utterance_count,
                        );
                        silence_max_prob = 0.0;
                        pending_finalize_frames = 0;
                    }
                    // ── Slow path: hesitation / ambiguous pause ───────────────
                    // Breathing or sounds during the pause kept silence_max_prob
                    // elevated.  Fall back to the configured min_silence_ms with
                    // the existing adaptive grace to handle within-sentence pauses
                    // (user says "um", pauses ~1 s, then continues).
                    else if silence_count >= silence_frames {
                        pending_finalize_frames += 1;
                        let speech_ms = speech_frames.len() as u32 * 1000 / SAMPLE_RATE;
                        let adaptive_grace_frames = if speech_ms < 1400 {
                            grace_frames * 2
                        } else {
                            grace_frames
                        };

                        if pending_finalize_frames >= adaptive_grace_frames {
                            log::debug!(
                                "[VAD] slow finalize: {}ms silence (max_prob={:.3})",
                                silence_count as u32 * CHUNK_MS,
                                silence_max_prob
                            );
                            deliver(
                                &app,
                                &utterance_tx,
                                &mut speech_frames,
                                &mut in_speech,
                                &mut silence_count,
                                &mut pre_ring,
                                min_speech_frames,
                                &mut utterance_count,
                            );
                            silence_max_prob = 0.0;
                            pending_finalize_frames = 0;
                            // Don't break - continue listening for next utterance
                        }
                    }
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    drop(stream);
    Ok(())
}

/// Finalise an utterance: send via channel if it meets min_speech_frames.
/// The capture loop continues running - does NOT set running=false.
fn deliver(
    app: &AppHandle,
    utterance_tx: &Sender<VoiceUtterance>,
    speech_frames: &mut Vec<f32>,
    in_speech: &mut bool,
    silence_count: &mut usize,
    pre_ring: &mut VecDeque<Vec<f32>>,
    min_speech_frames: usize,
    utterance_count: &mut u32,
) {
    let speech_chunk_count = speech_frames.len() / VAD_CHUNK;

    if min_speech_frames == 0 || speech_chunk_count >= min_speech_frames {
        *utterance_count += 1;
        log::debug!(
            "[VAD] utterance #{}: {} chunks ({:.2}s)",
            utterance_count,
            speech_chunk_count,
            speech_frames.len() as f32 / SAMPLE_RATE as f32
        );

        // Send utterance via channel for transcription
        let samples = speech_frames.clone();
        if let Err(e) = utterance_tx.send(VoiceUtterance::Final(samples)) {
            log::error!("[VAD] failed to send utterance: {}", e);
        }

        let _ = app.emit(
            "voice:state",
            VoiceStateEvent {
                state: "processing".to_string(),
            },
        );
    } else {
        log::debug!(
            "[VAD] utterance {} chunks < min {} chunks, discarding",
            speech_chunk_count,
            min_speech_frames
        );
    }

    speech_frames.clear();
    *in_speech = false;
    *silence_count = 0;
    pre_ring.clear();
}

// ── WAV encoding ──────────────────────────────────────────────────────────────

/// Encode PCM f32 samples to WAV bytes.
/// Output: standard RIFF/WAVE container, 16-bit signed integer, mono.
pub fn pcm_to_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
    for &sample in samples {
        let s = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer.write_sample(s)?;
    }
    writer.finalize()?;
    Ok(cursor.into_inner())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sine(freq: f32, secs: f32, sr: u32) -> Vec<f32> {
        let n = (secs * sr as f32) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin() * 0.5)
            .collect()
    }

    #[test]
    fn wav_magic_bytes() {
        let wav = pcm_to_wav(&make_sine(440.0, 0.1, 16000), 16000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF", "header should start with RIFF");
        assert_eq!(&wav[8..12], b"WAVE", "byte 8 should be WAVE");
    }

    #[test]
    fn wav_size_matches_samples() {
        let n = 1600usize; // 100ms
        let wav = pcm_to_wav(&vec![0.5f32; n], 16000).unwrap();
        assert_eq!(wav.len(), 44 + n * 2, "WAV size = 44 + samples*2");
    }

    #[test]
    fn wav_sample_rate_in_header() {
        let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
        let sr = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
        assert_eq!(sr, 16000, "sample rate bytes at offset 24");
    }

    #[test]
    fn wav_is_mono() {
        let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
        let ch = u16::from_le_bytes([wav[22], wav[23]]);
        assert_eq!(ch, 1, "channel count should be 1 (mono)");
    }

    #[test]
    fn wav_16_bits_per_sample() {
        let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
        let bps = u16::from_le_bytes([wav[34], wav[35]]);
        assert_eq!(bps, 16, "bits-per-sample should be 16");
    }

    #[test]
    fn wav_silence_data_is_all_zeros() {
        let wav = pcm_to_wav(&vec![0.0f32; 512], 16000).unwrap();
        assert!(
            wav[44..].iter().all(|&b| b == 0),
            "silence PCM should encode to all-zero data bytes"
        );
    }

    #[test]
    fn wav_clipping_does_not_panic() {
        let result = pcm_to_wav(&vec![2.0f32, -2.0f32, 1.5f32, -1.5f32], 16000);
        assert!(result.is_ok(), "out-of-range samples should be clamped");
    }

    #[test]
    fn wav_empty_input_is_valid() {
        let wav = pcm_to_wav(&[], 16000).unwrap();
        assert_eq!(
            &wav[0..4],
            b"RIFF",
            "empty input should still produce valid RIFF header"
        );
    }

    #[test]
    fn wav_byte_rate_in_header() {
        let wav = pcm_to_wav(&vec![0.0f32; 64], 16000).unwrap();
        let byte_rate = u32::from_le_bytes([wav[28], wav[29], wav[30], wav[31]]);
        assert_eq!(
            byte_rate, 32000,
            "byte rate should be 32000 for 16kHz mono 16-bit"
        );
    }

    #[test]
    fn wav_full_scale_peak_maps_to_i16_max() {
        let wav = pcm_to_wav(&[1.0f32], 16000).unwrap();
        let sample = i16::from_le_bytes([wav[44], wav[45]]);
        assert_eq!(sample, i16::MAX, "+1.0 f32 should map to i16::MAX");
    }

    #[test]
    fn wav_vad_chunk_size_constant() {
        assert_eq!(VAD_CHUNK, 512);
    }

    #[test]
    fn wav_one_second_has_expected_size() {
        let samples = make_sine(440.0, 1.0, 16000);
        assert_eq!(samples.len(), 16000, "1 second at 16kHz = 16000 samples");
        let wav = pcm_to_wav(&samples, 16000).unwrap();
        assert_eq!(
            wav.len(),
            44 + 32000,
            "1s 16kHz 16-bit mono WAV = 32044 bytes"
        );
    }

    #[test]
    fn vad_config_defaults_are_sane() {
        let cfg = VadConfig::default();
        assert!(cfg.threshold > 0.0 && cfg.threshold < 1.0);
        assert!(cfg.min_silence_ms >= 100);
        assert!(cfg.max_speech_s >= 5.0);
        assert!(cfg.amplitude_threshold > 0.0 && cfg.amplitude_threshold < 1.0);
    }

    #[test]
    fn chunk_ms_is_32() {
        assert_eq!(CHUNK_MS, 32, "512 samples @ 16kHz = 32ms per chunk");
    }
}
