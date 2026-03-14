use crate::audio::capture::{
    pcm_to_wav, start_capture, VadConfig, VadMode, VoicePipeline, VoiceUtterance,
};
use crate::audio::state::SharedAudioState;
use crate::audio::stt as local_stt;
use crate::audio::tts as local_tts;
use crate::AppState;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::path::Path;
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

// ── DB helpers ────────────────────────────────────────────────────────────────

fn get_db_setting(app: &AppHandle, key: &str, default: &str) -> String {
    let s = app.state::<AppState>();
    let db = s.db.lock().unwrap();
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

/// Expand `~` to the user's home directory.
fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = std::env::var("HOME").ok() {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

/// Resolve a voice script from the Tauri resource directory.
fn script_path(app: &AppHandle, name: &str) -> Option<String> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("resources/scripts/voice").join(name))
        .and_then(|p| p.to_str().map(|s| s.to_string()))
}

fn default_whisper_model_path(app: &AppHandle) -> String {
    app.path()
        .app_data_dir()
        .map(|d| d.join("whisper").join("ggml-base-q8_0.bin"))
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "ggml-base-q8_0.bin".to_string())
}

fn default_python_bin() -> String {
    #[cfg(target_os = "windows")]
    {
        "python".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "python3".to_string()
    }
}

fn resolved_kokoro_python_path(app: &AppHandle) -> String {
    let configured = expand_home(&get_db_setting(app, "kokoro_python_path", ""));
    if !configured.trim().is_empty() && Path::new(&configured).exists() {
        return configured;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        #[cfg(target_os = "windows")]
        let candidate = app_dir
            .join("kokoro")
            .join("runtime")
            .join("venv")
            .join("Scripts")
            .join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let candidate = app_dir
            .join("kokoro")
            .join("runtime")
            .join("venv")
            .join("bin")
            .join("python3");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    default_python_bin()
}

// ── Voice capture ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_voice_start(
    app: AppHandle,
    state: State<'_, AppState>,
    audio_state: State<'_, SharedAudioState>,
) -> Result<(), String> {
    {
        let mut active = state.voice_active.lock().unwrap();
        if *active {
            return Ok(());
        }
        *active = true;
    }

    let vad_model = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/silero_vad.onnx");

    // Read VAD tuning from DB settings (all have sensible defaults)
    let stt_engine = get_db_setting(&app, "stt_engine", "whisper_rs");

    // Partial transcription cadence for whisper-rs.
    // Lower interval improves perceived responsiveness in the input box.
    let partial_ms: u64 = if stt_engine != "external" { 500 } else { 0 };

    // A slightly larger pre-roll prevents clipping the first syllable/word
    // when VAD flips to speech a frame late.
    let speech_pad_pre_ms = get_db_setting(&app, "vad_speech_pad_pre_ms", "320")
        .parse::<u32>()
        .unwrap_or(320)
        .max(320);

    let vad_config = VadConfig {
        threshold: get_db_setting(&app, "vad_threshold", "0.35")
            .parse()
            .unwrap_or(0.35),
        min_silence_ms: get_db_setting(&app, "vad_min_silence_ms", "1200")
            .parse()
            .unwrap_or(1200),
        end_silence_grace_ms: get_db_setting(&app, "vad_end_silence_grace_ms", "320")
            .parse()
            .unwrap_or(320),
        speech_pad_pre_ms,
        min_speech_ms: get_db_setting(&app, "vad_min_speech_ms", "50")
            .parse()
            .unwrap_or(50),
        max_speech_s: get_db_setting(&app, "vad_max_speech_s", "30.0")
            .parse()
            .unwrap_or(30.0),
        amplitude_threshold: get_db_setting(&app, "vad_amplitude_threshold", "0.005")
            .parse()
            .unwrap_or(0.005),
        mode: match get_db_setting(&app, "vad_mode", "auto").as_str() {
            "onnx" => VadMode::OnnxOnly,
            "amplitude" => VadMode::AmplitudeOnly,
            _ => VadMode::Auto,
        },
        partial_interval_ms: partial_ms,
        stt_script: String::new(),
        stt_model: String::new(),
        stt_model_dir: String::new(),
    };

    let pipeline = VoicePipeline::new();
    // Use the AppState-level run flag so cmd_voice_stop can actually stop the loops.
    // Reset to true here; cmd_voice_stop sets it false.
    let running = state.voice_running.clone();
    running.store(true, std::sync::atomic::Ordering::SeqCst);
    let local_buf: Arc<Mutex<Vec<f32>>> = pipeline.audio_buffer.clone();
    let app_thread = app.clone();
    // Capture the existing Tauri tokio runtime handle so the transcription
    // thread reuses it instead of spawning a new Runtime per utterance.
    // Creating and dropping a Runtime per call kills its thread-pool threads,
    // which triggers PR_SET_PDEATHSIG(SIGTERM) on the whisper daemon.
    let rt_handle = tokio::runtime::Handle::current();

    let preferred_device = audio_state.lock().unwrap().selected_device_name.clone();

    // Create channel for utterances from capture loop to transcription.
    // Both finals (voice:transcript) and partials (voice:partial) flow through
    // this single channel so the persistent Whisper daemon handles both paths.
    let (utterance_tx, utterance_rx): (
        std::sync::mpsc::Sender<VoiceUtterance>,
        std::sync::mpsc::Receiver<VoiceUtterance>,
    ) = std::sync::mpsc::channel();

    // Spawn transcription listener thread
    let app_transcribe = app.clone();
    let running_transcribe = running.clone();
    std::thread::spawn(move || {
        while running_transcribe.load(Ordering::SeqCst) {
            match utterance_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(VoiceUtterance::Final(samples)) => {
                    if !samples.is_empty() {
                        // Reuse the existing Tauri tokio runtime — never create a new
                        // Runtime here, as dropping it kills its thread-pool threads and
                        // triggers PR_SET_PDEATHSIG(SIGTERM) on the whisper daemon.
                        rt_handle.block_on(transcribe_and_emit(
                            app_transcribe.clone(),
                            samples,
                            false, // is_partial
                        ));
                    }
                }
                Ok(VoiceUtterance::Partial(samples)) => {
                    if !samples.is_empty() {
                        rt_handle.block_on(transcribe_and_emit(
                            app_transcribe.clone(),
                            samples,
                            true, // is_partial
                        ));
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Continue waiting
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    log::debug!("[voice] utterance channel disconnected");
                    break;
                }
            }
        }
        // Final cleanup
        let _ = app_transcribe.emit("voice:state", serde_json::json!({ "state": "idle" }));
        let s = app_transcribe.state::<AppState>();
        *s.voice_active.lock().unwrap() = false;
    });

    // Start capture loop (now runs continuously until voice_stop)
    if let Err(e) = start_capture(
        app_thread.clone(),
        running.clone(),
        local_buf,
        vad_model,
        vad_config,
        utterance_tx,
        preferred_device,
    ) {
        let _ = app_thread.emit("voice:state", serde_json::json!({ "state": "idle" }));
        log::error!("[voice] capture error: {}", e);
        let s = app_thread.state::<AppState>();
        *s.voice_active.lock().unwrap() = false;
        return Err(e.to_string());
    }

    Ok(())
}

// ── STT pipeline ──────────────────────────────────────────────────────────────

/// Transcribe `samples` and emit the appropriate voice event.
///
/// - `is_partial = false` → final utterance → emits `voice:transcript`
/// - `is_partial = true`  → in-progress snapshot → emits `voice:partial`
async fn transcribe_and_emit(app: AppHandle, samples: Vec<f32>, is_partial: bool) {
    let state = app.state::<AppState>();
    let stt_engine = get_db_setting(&app, "stt_engine", "whisper_rs");
    let stt_url = get_db_setting(&app, "stt_url", "");
    let api_key = get_db_setting(&app, "api_key", "");
    let base_url = get_db_setting(&app, "base_url", "http://localhost:11434/v1");

    log::info!(
        "[STT] start: {} samples ({:.2}s), engine={}",
        samples.len(),
        samples.len() as f32 / 16000.0,
        stt_engine
    );

    // Encode PCM → WAV
    let wav_bytes = match pcm_to_wav(&samples, 16000) {
        Ok(b) => b,
        Err(e) => {
            log::error!("[STT] WAV encode failed: {}", e);
            emit_error(&app, format!("Audio encode error: {e}"));
            finalize(&app);
            return;
        }
    };
    log::info!("[STT] WAV: {} bytes", wav_bytes.len());

    let result: Result<String, String> = match stt_engine.as_str() {
        "whisper_rs" | "whisper" => {
            let model_path = expand_home(&get_db_setting(
                &app,
                "whisper_rs_model_path",
                &default_whisper_model_path(&app),
            ));
            let language = get_db_setting(&app, "whisper_rs_language", "en");
            log::info!(
                "[STT] whisper-rs: model_path={} language={}",
                model_path,
                language
            );
            let wav = wav_bytes.clone();
            let ctx_handle = state.whisper_rs_ctx.clone();
            tokio::task::spawn_blocking(move || {
                local_stt::transcribe_whisper_rs_persistent(&ctx_handle, &wav, &model_path, &language)
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string()))
        }

        _ /* "external" */ => {
            if stt_url.is_empty() {
                Err("No STT URL configured. Set it in Voice settings or switch to Whisper (local).".to_string())
            } else {
                log::info!("[STT] external: POST {}", stt_url);
                let client = crate::ai::client::AiClient::new(state.http_client.clone(), base_url, api_key, String::new());
                client.transcribe_audio(&stt_url, wav_bytes).await.map_err(|e| e.to_string())
            }
        }
    };

    match result {
        Ok(text) => {
            let trimmed = text.trim().to_string();
            // Whisper hallucinates these tokens on non-speech audio (keyboard clicks,
            // breathing, silence). Discard them before emitting anything.
            if is_whisper_hallucination(&trimmed) {
                log::debug!("[STT] hallucination discarded: {:?}", trimmed);
                if !is_partial {
                    finalize(&app);
                }
                return;
            }
            if is_partial {
                // Partials are best-effort: don't warn on empty (common mid-word)
                if !trimmed.is_empty() {
                    log::debug!("[STT] partial: {:?}", trimmed);
                    let _ = app.emit("voice:partial", serde_json::json!({ "text": trimmed }));
                }
                // Don't call finalize() for partials — capture loop continues
                return;
            }
            log::info!("[STT] transcript: {:?} ({} chars)", trimmed, trimmed.len());
            if trimmed.is_empty() {
                log::warn!("[STT] empty transcript — is the model loaded / mic level sufficient?");
                emit_error(
                    &app,
                    "STT returned empty transcript — speak louder or check mic level",
                );
            } else {
                let _ = app.emit("voice:transcript", serde_json::json!({ "text": trimmed }));
            }
        }
        Err(e) => {
            if is_partial {
                // Partial failures are expected (e.g. too-short audio); suppress errors
                log::debug!("[STT] partial error (ignored): {}", e);
                return;
            }
            log::error!("[STT] error: {}", e);
            emit_error(&app, format!("STT error: {e}"));
        }
    }

    finalize(&app);
}

/// Returns true for known Whisper hallucination tokens that should be discarded.
/// These are emitted on non-speech audio: keyboard clicks, breathing, silence, etc.
fn is_whisper_hallucination(text: &str) -> bool {
    // Strip outer brackets/parens for matching
    let lower = text.to_lowercase();
    let inner = lower
        .trim_matches(|c| c == '[' || c == ']' || c == '(' || c == ')')
        .trim();
    matches!(
        inner,
        "blank_audio"
            | "silence"
            | "music"
            | "applause"
            | "laughter"
            | "noise"
            | "inaudible"
            | "unintelligible"
            | "static"
            | "beep"
            | "background noise"
            | "no speech"
            | "background music"
    ) || lower.contains("[blank_audio]")
        || lower.contains("[ silence ]")
        || lower.contains("(silence)")
}

fn emit_error(app: &AppHandle, msg: impl Into<String>) {
    let msg = msg.into();
    // Log so it appears in backend terminal AND gets forwarded to frontend log panel
    log::error!("[STT] {}", msg);
    let _ = app.emit("voice:error", serde_json::json!({ "message": msg }));
}

fn finalize(app: &AppHandle) {
    // The capture loop is continuous — after each transcription the pipeline
    // keeps running. Emit "listening" so the UI shows the mic as ready again.
    // Do NOT clear voice_active here; that would allow cmd_voice_start to spawn
    // a second pipeline on top of the still-running one.
    let _ = app.emit("voice:state", serde_json::json!({ "state": "listening" }));
}

// ── TTS ───────────────────────────────────────────────────────────────────────

/// Returned by `cmd_tts_speak`.  Bundles WAV bytes with an optional IPA phoneme
/// string extracted from Kokoro's G2P stage (used by the frontend lipsync scheduler).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSpeakResult {
    pub audio_bytes: Vec<u8>,
    /// IPA phoneme string, or `null` when unavailable (external engine / G2P failed).
    pub phonemes: Option<String>,
}

/// Synthesise `text` and return WAV bytes + optional G2P phonemes.
///
/// Engine routing via `tts_engine` DB setting:
/// - `"kokoro"`    — Kokoro ONNX via persistent Python daemon
/// - `"external"`  — OpenAI-compatible HTTP endpoint
#[tauri::command]
pub async fn cmd_tts_speak(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<TtsSpeakResult, String> {
    let engine = get_db_setting(&app, "tts_engine", "kokoro");
    log::info!("[TTS] speak: engine={}, {} chars", engine, text.len());

    match engine.as_str() {
        "kokoro" => {
            let script  = script_path(&app, "tts_kokoro_persistent.py").unwrap_or_default();
            let model   = expand_home(&get_db_setting(&app, "kokoro_model_path", ""));
            let voices  = expand_home(&get_db_setting(&app, "kokoro_voices_path", ""));
            let voice   = get_db_setting(&app, "kokoro_voice", "af_heart");
            let python_bin = resolved_kokoro_python_path(&app);
            log::info!("[TTS] kokoro: voice={} model={} (persistent daemon)", voice, model);

            // Clone config for the blocking task
            let text_clone = text.clone();
            let script_clone = script.clone();
            let model_clone = model.clone();
            let voices_clone = voices.clone();
            let voice_clone = voice.clone();
            let python_clone = python_bin.clone();

            // Get daemon handle from state
            let daemon_handle = state.kokoro_daemon.clone();

            let kokoro_result = tokio::task::spawn_blocking(move || {
                let mut daemon_guard = daemon_handle.lock().unwrap();

                // Reset daemon if model path changed (e.g. switched from int8)
                if let Some(ref d) = *daemon_guard {
                    if d.model_path() != model_clone {
                        *daemon_guard = None;
                    }
                }

                // Lazy-initialize daemon if not present
                if daemon_guard.is_none() {
                    if script_clone.is_empty() || model_clone.is_empty() || voices_clone.is_empty() {
                        return Err("Kokoro not configured: check model and voices paths".to_string());
                    }
                    log::info!("[TTS] Initializing Kokoro daemon: {} --model {} --voices {}",
                        script_clone, model_clone, voices_clone);
                    *daemon_guard = Some(local_tts::KokoroDaemon::new(
                        &python_clone,
                        &script_clone,
                        &model_clone,
                        &voices_clone,
                        &voice_clone,
                    ));
                }

                // Use daemon to synthesize
                let daemon = daemon_guard.as_mut().unwrap();
                daemon.speak(&text_clone, Some(&voice_clone))
            })
            .await
            .map_err(|e| e.to_string())?;

            match kokoro_result {
                Ok(r) => Ok(TtsSpeakResult {
                    audio_bytes: r.audio,
                    phonemes: r.phonemes,
                }),
                Err(kokoro_err) => {
                    log::warn!(
                        "[TTS] Kokoro failed ({}); attempting espeak-ng fallback",
                        kokoro_err
                    );
                    let fallback_voice = get_db_setting(&app, "tts_voice", "en-us");
                    let text_fallback = text.clone();
                    let fallback_result = tokio::task::spawn_blocking(move || {
                        if !local_tts::check_espeak() {
                            return Err("espeak-ng is not available".to_string());
                        }
                        local_tts::speak_espeak(&text_fallback, &fallback_voice)
                    })
                    .await
                    .map_err(|e| e.to_string())?;

                    match fallback_result {
                        Ok(audio) => Ok(TtsSpeakResult {
                            audio_bytes: audio,
                            phonemes: None,
                        }),
                        Err(fallback_err) => Err(format!(
                            "Kokoro failed: {}. espeak-ng fallback failed: {}",
                            kokoro_err, fallback_err
                        )),
                    }
                }
            }
        }

        _ /* "external" */ => {
            let tts_url = get_db_setting(&app, "tts_url", "");
            if tts_url.is_empty() {
                return Err("TTS URL not configured".to_string());
            }
            let api_key = get_db_setting(&app, "api_key", "lm-studio");
            let voice   = get_db_setting(&app, "tts_voice", "alloy");
            log::info!("[TTS] external: POST {}", tts_url);

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| e.to_string())?;

            let resp = client
                .post(&tts_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&serde_json::json!({ "model": "tts-1", "input": text, "voice": voice }))
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !resp.status().is_success() {
                return Err(format!("TTS API error {}", resp.status()));
            }
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            Ok(TtsSpeakResult { audio_bytes: bytes.to_vec(), phonemes: None })
        }
    }
}

// ── Engine status ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TtsEngineStatus {
    pub kokoro: bool,
    pub espeak: bool,
    pub external: bool,
    pub current_engine: String,
}

#[tauri::command]
pub fn cmd_get_kokoro_bootstrap_status() -> crate::KokoroBootstrapStatus {
    crate::get_kokoro_bootstrap_status()
}

#[tauri::command]
pub async fn cmd_tts_check_engines(app: AppHandle) -> TtsEngineStatus {
    let current_engine = get_db_setting(&app, "tts_engine", "kokoro");
    let script = script_path(&app, "tts_kokoro.py").unwrap_or_default();
    let model = expand_home(&get_db_setting(&app, "kokoro_model_path", ""));
    let voices = expand_home(&get_db_setting(&app, "kokoro_voices_path", ""));
    let python_bin = resolved_kokoro_python_path(&app);
    let tts_url = get_db_setting(&app, "tts_url", "");

    let script_clone = script.clone();
    let model_clone = model.clone();
    let voices_clone = voices.clone();
    let python_clone = python_bin.clone();
    let kokoro = tokio::task::spawn_blocking(move || {
        local_tts::check_kokoro(&script_clone, &python_clone)
            && std::path::Path::new(&model_clone).exists()
            && std::path::Path::new(&voices_clone).exists()
    })
    .await
    .unwrap_or(false);
    let espeak = tokio::task::spawn_blocking(local_tts::check_espeak)
        .await
        .unwrap_or(false);

    let external = if tts_url.is_empty() {
        false
    } else {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .ok()
            .map(|c| {
                futures_util::FutureExt::now_or_never(c.get(&tts_url).send())
                    .and_then(|r| r.ok())
                    .map(|r| r.status().is_success() || r.status().as_u16() < 500)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    };

    TtsEngineStatus {
        kokoro,
        espeak,
        external,
        current_engine,
    }
}

#[derive(Serialize)]
pub struct SttEngineStatus {
    pub whisper_rs: bool,
    pub external: bool,
    pub current_engine: String,
}

#[tauri::command]
pub async fn cmd_stt_check_engines(app: AppHandle) -> SttEngineStatus {
    let current_engine = get_db_setting(&app, "stt_engine", "whisper_rs");
    let stt_url = get_db_setting(&app, "stt_url", "");

    let whisper_rs_model_path = expand_home(&get_db_setting(
        &app,
        "whisper_rs_model_path",
        &default_whisper_model_path(&app),
    ));

    let whisper_rs =
        tokio::task::spawn_blocking(move || local_stt::check_whisper_rs(&whisper_rs_model_path))
            .await
            .unwrap_or(false);

    let external = !stt_url.is_empty() && {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .ok()
            .map(|c| {
                futures_util::FutureExt::now_or_never(c.get(&stt_url).send())
                    .and_then(|r| r.ok())
                    .is_some()
            })
            .unwrap_or(false)
    };

    SttEngineStatus {
        whisper_rs,
        external,
        current_engine,
    }
}

#[tauri::command]
pub fn cmd_stt_list_whisper_models(dir: String) -> Vec<String> {
    let expanded = expand_home(&dir);
    let path = std::path::Path::new(&expanded);
    if !path.is_dir() {
        return vec![];
    }
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("bin") {
                if let Some(s) = p.to_str() {
                    models.push(s.to_string());
                }
            }
        }
    }
    models.sort();
    models
}

#[tauri::command]
pub async fn cmd_tts_list_voices(app: AppHandle) -> Vec<String> {
    let engine = get_db_setting(&app, "tts_engine", "kokoro");
    let python_bin = resolved_kokoro_python_path(&app);
    let mut voices = match engine.as_str() {
        "kokoro" => {
            let model = expand_home(&get_db_setting(&app, "kokoro_model_path", ""));
            let voices_path = expand_home(&get_db_setting(&app, "kokoro_voices_path", ""));
            tokio::task::spawn_blocking(move || {
                local_tts::list_kokoro_voices(&model, &voices_path, &python_bin)
            })
            .await
            .unwrap_or_default()
        }
        "external" => vec![
            "alloy".to_string(),
            "ash".to_string(),
            "ballad".to_string(),
            "coral".to_string(),
            "echo".to_string(),
            "fable".to_string(),
            "nova".to_string(),
            "onyx".to_string(),
            "sage".to_string(),
            "shimmer".to_string(),
            "verse".to_string(),
        ],
        _ => Vec::new(),
    };

    let current = if engine == "kokoro" {
        get_db_setting(&app, "kokoro_voice", "af_heart")
    } else {
        get_db_setting(&app, "tts_voice", "alloy")
    };
    let current_trimmed = current.trim();
    if !current_trimmed.is_empty() && !voices.iter().any(|v| v == current_trimmed) {
        voices.push(current_trimmed.to_string());
    }
    voices.sort();
    voices.dedup();
    voices
}

// ── Endpoint check (legacy compat) ────────────────────────────────────────────

#[derive(Serialize)]
pub struct VoiceEndpointStatus {
    pub stt: bool,
    pub tts: bool,
    pub stt_url: String,
    pub tts_url: String,
}

#[tauri::command]
pub async fn cmd_check_voice_endpoints(app: AppHandle) -> Result<VoiceEndpointStatus, String> {
    let stt_url = get_db_setting(&app, "stt_url", "");
    let tts_url = get_db_setting(&app, "tts_url", "");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let stt_ok = !stt_url.is_empty() && client.get(base_url_of(&stt_url)).send().await.is_ok();
    let tts_ok = !tts_url.is_empty() && client.get(base_url_of(&tts_url)).send().await.is_ok();

    Ok(VoiceEndpointStatus {
        stt: stt_ok,
        tts: tts_ok,
        stt_url,
        tts_url,
    })
}

fn base_url_of(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let after = &url[scheme_end + 3..];
        let end = after.find('/').unwrap_or(after.len());
        format!("{}://{}", &url[..scheme_end], &after[..end])
    } else {
        url.to_string()
    }
}

#[tauri::command]
pub fn cmd_voice_stop(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    // Signal both the capture loop and the transcription thread to exit.
    state.voice_running.store(false, Ordering::SeqCst);
    *state.voice_active.lock().unwrap() = false;
    let _ = app.emit("voice:state", serde_json::json!({ "state": "idle" }));
    Ok(())
}

// ── Audio devices ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AudioDevices {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub default_input: Option<String>,
    pub default_output: Option<String>,
}

#[tauri::command]
pub fn cmd_list_audio_devices() -> Result<AudioDevices, String> {
    let host = cpal::default_host();
    let inputs_raw: Vec<String> = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| d.name().ok())
        .collect();
    let outputs_raw: Vec<String> = host
        .output_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| d.name().ok())
        .collect();
    let default_input = host.default_input_device().and_then(|d| d.name().ok());
    let default_output = host.default_output_device().and_then(|d| d.name().ok());

    fn normalize(name: &str) -> String {
        name.trim().to_string()
    }

    #[cfg(target_os = "linux")]
    fn is_linux_alias(name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        lower.contains("card=")
            || lower.contains(",dev=")
            || lower.starts_with("sysdefault")
            || lower.starts_with("plughw")
            || lower.starts_with("front:")
            || lower.starts_with("surround")
            || lower.starts_with("dmix")
            || lower.starts_with("dsnoop")
            || lower.starts_with("hw:")
    }

    fn dedupe(items: Vec<String>) -> Vec<String> {
        use std::collections::BTreeSet;
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        for n in items {
            let v = normalize(&n);
            if v.is_empty() {
                continue;
            }
            let key = v.to_ascii_lowercase();
            if seen.insert(key) {
                out.push(v);
            }
        }
        out
    }

    let mut inputs = dedupe(inputs_raw);
    let mut outputs = dedupe(outputs_raw);

    #[cfg(target_os = "linux")]
    {
        if let Some(def_in) = default_input.as_ref().map(|s| normalize(s)) {
            inputs.retain(|n| !is_linux_alias(n) || normalize(n) == def_in);
        } else {
            inputs.retain(|n| !is_linux_alias(n));
        }
        if let Some(def_out) = default_output.as_ref().map(|s| normalize(s)) {
            outputs.retain(|n| !is_linux_alias(n) || normalize(n) == def_out);
        } else {
            outputs.retain(|n| !is_linux_alias(n));
        }
    }

    Ok(AudioDevices {
        inputs,
        outputs,
        default_input,
        default_output,
    })
}
