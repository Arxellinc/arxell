//! Voice pipeline diagnostic command.
//!
//! `cmd_voice_diagnostics` runs a series of checks through every layer of the
//! voice pipeline and emits detailed `log:info` / `log:warn` events so that
//! results appear both in the Tauri log and in the frontend DiagnosticsPanel.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::audio::capture::pcm_to_wav;
use crate::AppState;

// ── Result type ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DiagResult {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

impl DiagResult {
    fn pass(name: &str, detail: impl Into<String>) -> Self {
        let d = detail.into();
        log::info!("[DIAG] ✓  {:40}  {}", name, d);
        Self {
            name: name.to_string(),
            ok: true,
            detail: d,
        }
    }

    fn fail(name: &str, detail: impl Into<String>) -> Self {
        let d = detail.into();
        log::warn!("[DIAG] ✗  {:40}  {}", name, d);
        Self {
            name: name.to_string(),
            ok: false,
            detail: d,
        }
    }

    fn info(name: &str, detail: impl Into<String>) -> Self {
        let d = detail.into();
        log::info!("[DIAG] ℹ  {:40}  {}", name, d);
        Self {
            name: name.to_string(),
            ok: true,
            detail: d,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn get_setting(app: &AppHandle, key: &str) -> String {
    let s = app.state::<AppState>();
    let db = s.db.lock().unwrap();
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}

/// Extract the base URL (scheme + host + port) from any URL.
fn base_url_of(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let after = &url[scheme_end + 3..];
        let end = after.find('/').unwrap_or(after.len());
        format!("{}://{}", &url[..scheme_end], &after[..end])
    } else {
        url.to_string()
    }
}

/// Generate a 440 Hz sine wave at 16 kHz.
fn make_sine_16k(secs: f32) -> Vec<f32> {
    let n = (secs * 16000.0) as usize;
    (0..n)
        .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin() * 0.5)
        .collect()
}

// ── Main command ──────────────────────────────────────────────────────────────

/// Run a comprehensive voice pipeline diagnostic.
///
/// Each check is logged via `log::info!` / `log::warn!` (appears in the Tauri
/// dev console and in the frontend log panel) AND returned as a structured
/// `DiagResult` so the UI can render pass/fail status.
#[tauri::command]
pub async fn cmd_voice_diagnostics(app: AppHandle) -> Vec<DiagResult> {
    let mut r: Vec<DiagResult> = Vec::new();

    log::info!("[DIAG] ============================================================");
    log::info!("[DIAG]  arx Voice Pipeline Diagnostics");
    log::info!("[DIAG] ============================================================");

    // ── 1. Settings ───────────────────────────────────────────────────────────
    log::info!("[DIAG] --- 1. Settings ---");

    let stt_url = get_setting(&app, "stt_url");
    let tts_url = get_setting(&app, "tts_url");
    let tts_engine = get_setting(&app, "tts_engine");
    let api_key = get_setting(&app, "api_key");
    let model = get_setting(&app, "model");
    let kokoro_model_path = get_setting(&app, "kokoro_model_path");
    let kokoro_voices_path = get_setting(&app, "kokoro_voices_path");
    r.push(DiagResult::info("settings/model", format!("{}", model)));
    r.push(DiagResult::info(
        "settings/tts_engine",
        format!("{}", tts_engine),
    ));

    r.push(if !api_key.is_empty() {
        DiagResult::pass("settings/api_key", "set (non-empty)")
    } else {
        DiagResult::fail(
            "settings/api_key",
            "empty — external endpoints may reject requests",
        )
    });

    r.push(if !stt_url.is_empty() {
        DiagResult::pass("settings/stt_url", format!("{}", stt_url))
    } else {
        DiagResult::fail("settings/stt_url", "empty — STT transcription disabled")
    });

    // ── 2. Audio devices ──────────────────────────────────────────────────────
    log::info!("[DIAG] --- 2. Audio Devices ---");
    {
        let host = cpal::default_host();

        match host.default_input_device() {
            Some(d) => r.push(DiagResult::pass(
                "audio/default_input",
                d.name().unwrap_or_else(|_| "unnamed".to_string()),
            )),
            None => r.push(DiagResult::fail(
                "audio/default_input",
                "no default microphone — voice capture will fail",
            )),
        }

        match host.default_output_device() {
            Some(d) => r.push(DiagResult::pass(
                "audio/default_output",
                d.name().unwrap_or_else(|_| "unnamed".to_string()),
            )),
            None => r.push(DiagResult::fail(
                "audio/default_output",
                "no default speaker — TTS playback will fail",
            )),
        }

        let n_in = host.input_devices().map(|d| d.count()).unwrap_or(0);
        let n_out = host.output_devices().map(|d| d.count()).unwrap_or(0);
        r.push(DiagResult::info(
            "audio/device_count",
            format!("{} inputs, {} outputs", n_in, n_out),
        ));
    }

    // ── 3. VAD model ─────────────────────────────────────────────────────────
    log::info!("[DIAG] --- 3. Silero VAD Model ---");
    {
        let vad_path = app
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join("resources/silero_vad.onnx"));

        match vad_path {
            None => r.push(DiagResult::fail(
                "vad/resource_dir",
                "could not resolve resource dir",
            )),
            Some(path) => {
                if !path.exists() {
                    r.push(DiagResult::fail(
                        "vad/model_file",
                        format!("not found at {:?} — amplitude fallback active", path),
                    ));
                } else {
                    r.push(DiagResult::pass("vad/model_file", format!("{:?}", path)));

                    match crate::audio::vad::SileroVad::new(&path) {
                        Err(e) => r.push(DiagResult::fail(
                            "vad/model_load",
                            format!("ONNX load failed: {} — amplitude fallback active", e),
                        )),
                        Ok(mut vad) => {
                            r.push(DiagResult::pass("vad/model_load", "loaded OK"));

                            // Silence → expect low probability
                            let silence = vec![0.0f32; 512];
                            match vad.predict(&silence) {
                                Ok(p) => r.push(if p < 0.5 {
                                    DiagResult::pass(
                                        "vad/silence_prob",
                                        format!("{:.4} (< 0.5 ✓)", p),
                                    )
                                } else {
                                    DiagResult::fail(
                                        "vad/silence_prob",
                                        format!("{:.4} (expected < 0.5)", p),
                                    )
                                }),
                                Err(e) => {
                                    r.push(DiagResult::fail("vad/silence_prob", e.to_string()))
                                }
                            }

                            // Loud 440Hz sine → typically triggers speech detection
                            let loud: Vec<f32> = (0..512)
                                .map(|i| {
                                    (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin()
                                        * 0.9
                                })
                                .collect();
                            match vad.predict(&loud) {
                                Ok(p) => r.push(DiagResult::info(
                                    "vad/sine_prob",
                                    format!("{:.4} (440Hz @ 0.9 amplitude)", p),
                                )),
                                Err(e) => r.push(DiagResult::fail("vad/sine_prob", e.to_string())),
                            }
                        }
                    }
                }
            }
        }
    }

    // ── 4. WAV encoding ───────────────────────────────────────────────────────
    log::info!("[DIAG] --- 4. WAV Encoding ---");
    {
        let samples = make_sine_16k(0.5); // 0.5 seconds
        let expected_size = 44 + samples.len() * 2;

        match pcm_to_wav(&samples, 16000) {
            Err(e) => r.push(DiagResult::fail("wav/encode", e.to_string())),
            Ok(wav) => {
                let is_riff = wav.starts_with(b"RIFF");
                let is_wave = wav.get(8..12) == Some(b"WAVE");
                let correct_size = wav.len() == expected_size;

                if is_riff && is_wave && correct_size {
                    r.push(DiagResult::pass(
                        "wav/encode",
                        format!("{} bytes, RIFF/WAVE header OK", wav.len()),
                    ));
                } else {
                    r.push(DiagResult::fail(
                        "wav/encode",
                        format!(
                            "header_ok={}/{}, size={}/{} (got/expected)",
                            is_riff,
                            is_wave,
                            wav.len(),
                            expected_size
                        ),
                    ));
                }

                let sr = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
                let ch = u16::from_le_bytes([wav[22], wav[23]]);
                let bps = u16::from_le_bytes([wav[34], wav[35]]);

                r.push(if sr == 16000 {
                    DiagResult::pass("wav/sample_rate", format!("{} Hz", sr))
                } else {
                    DiagResult::fail("wav/sample_rate", format!("{} Hz (expected 16000)", sr))
                });

                r.push(if ch == 1 {
                    DiagResult::pass("wav/channels", "1 (mono)")
                } else {
                    DiagResult::fail("wav/channels", format!("{} (expected 1)", ch))
                });

                r.push(if bps == 16 {
                    DiagResult::pass("wav/bits_per_sample", "16")
                } else {
                    DiagResult::fail("wav/bits_per_sample", format!("{} (expected 16)", bps))
                });
            }
        }
    }

    // ── 5. TTS engine ─────────────────────────────────────────────────────────
    log::info!("[DIAG] --- 5. TTS Engine ({}) ---", tts_engine);
    match tts_engine.as_str() {
        "kokoro" => {
            use std::path::Path;
            if kokoro_model_path.is_empty() {
                r.push(DiagResult::fail("tts/kokoro_model", "no model path configured"));
            } else if !Path::new(&kokoro_model_path).exists() {
                r.push(DiagResult::fail(
                    "tts/kokoro_model",
                    format!("'{}' not found", kokoro_model_path),
                ));
            } else {
                r.push(DiagResult::pass(
                    "tts/kokoro_model",
                    format!("'{}' found", kokoro_model_path),
                ));
            }
            if kokoro_voices_path.is_empty() {
                r.push(DiagResult::fail("tts/kokoro_voices", "no voices path configured"));
            } else if !Path::new(&kokoro_voices_path).exists() {
                r.push(DiagResult::fail(
                    "tts/kokoro_voices",
                    format!("'{}' not found", kokoro_voices_path),
                ));
            } else {
                r.push(DiagResult::pass(
                    "tts/kokoro_voices",
                    format!("'{}' found", kokoro_voices_path),
                ));
            }
        }
        _ /* external */ => {
            if tts_url.is_empty() {
                r.push(DiagResult::fail("tts/external_url", "empty"));
            } else {
                let base = base_url_of(&tts_url);
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(3))
                    .build()
                    .unwrap();
                match client.get(&base).send().await {
                    Ok(resp) => r.push(DiagResult::pass(
                        "tts/external_reachable",
                        format!("HTTP {} from {}", resp.status(), base),
                    )),
                    Err(e) => r.push(DiagResult::fail(
                        "tts/external_reachable",
                        format!("cannot reach {}: {}", base, e),
                    )),
                }
            }
        }
    }

    // ── 6. STT endpoint ───────────────────────────────────────────────────────
    log::info!("[DIAG] --- 6. STT Endpoint ---");
    if stt_url.is_empty() {
        r.push(DiagResult::fail(
            "stt/configured",
            "no STT URL — transcription disabled",
        ));
    } else {
        r.push(DiagResult::pass("stt/configured", format!("{}", stt_url)));

        let base = base_url_of(&stt_url);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // Connectivity
        match client.get(&base).send().await {
            Ok(resp) => r.push(DiagResult::pass(
                "stt/endpoint_reachable",
                format!("HTTP {} from {}", resp.status(), base),
            )),
            Err(e) => r.push(DiagResult::fail(
                "stt/endpoint_reachable",
                format!("cannot reach {}: {}", base, e),
            )),
        }

        // Actual transcription with synthetic 440Hz sine (0.5s)
        log::info!("[DIAG] Sending synthetic 440Hz sine (0.5s) to STT endpoint...");
        let samples = make_sine_16k(0.5);
        match pcm_to_wav(&samples, 16000) {
            Err(e) => r.push(DiagResult::fail("stt/wav_encode", e.to_string())),
            Ok(wav_bytes) => {
                log::info!(
                    "[DIAG] WAV payload: {} bytes → POST {}",
                    wav_bytes.len(),
                    stt_url
                );

                let ai_client = crate::ai::client::AiClient::new(
                    app.state::<AppState>().http_client.clone(),
                    base.clone(),
                    api_key.clone(),
                    String::new(),
                );

                match ai_client.transcribe_audio(&stt_url, wav_bytes).await {
                    Ok(text) => {
                        let trimmed = text.trim().to_string();
                        log::info!(
                            "[DIAG] STT response: {:?} ({} chars)",
                            trimmed,
                            trimmed.len()
                        );
                        if trimmed.is_empty() {
                            r.push(DiagResult::fail(
                                "stt/transcribe_test",
                                "empty response for sine wave (endpoint may need real speech; check model is loaded)",
                            ));
                        } else {
                            r.push(DiagResult::pass(
                                "stt/transcribe_test",
                                format!("response: {:?}", trimmed),
                            ));
                        }
                    }
                    Err(e) => {
                        log::warn!("[DIAG] STT request failed: {}", e);
                        r.push(DiagResult::fail(
                            "stt/transcribe_test",
                            format!("HTTP request failed: {} — check URL, model is loaded, and auth key", e),
                        ));
                    }
                }
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    let n_pass = r.iter().filter(|x| x.ok).count();
    let n_fail = r.iter().filter(|x| !x.ok).count();
    log::info!("[DIAG] ============================================================");
    log::info!(
        "[DIAG]  SUMMARY: {} passed  {} failed  ({} total)",
        n_pass,
        n_fail,
        r.len()
    );
    log::info!("[DIAG] ============================================================");

    r
}
