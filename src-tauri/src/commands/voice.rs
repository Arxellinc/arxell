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
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

static VOICE_REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut Command) {}

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
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

/// Resolve a voice script from the Tauri resource directory.
fn script_path(app: &AppHandle, name: &str) -> Option<String> {
    let base = app.path().resource_dir().ok()?;
    let candidates = [
        base.join("resources/scripts/voice").join(name),
        base.join("scripts/voice").join(name),
        base.join(name),
    ];
    candidates
        .into_iter()
        .find(|p| p.exists())
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

fn python_interpreter_usable(python_bin: &str) -> bool {
    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", "import encodings"]);
    apply_no_window(&mut cmd);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn kokoro_python_candidates(app_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let base = app_dir.join("kokoro").join("runtime").join("venv");
    #[cfg(target_os = "windows")]
    {
        vec![
            base.join("Scripts").join("python.exe"),
            base.join("python.exe"),
            base.join("bin").join("python.exe"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            base.join("bin").join("python3"),
            base.join("bin").join("python"),
        ]
    }
}

fn next_voice_request_id() -> u64 {
    VOICE_REQUEST_SEQ.fetch_add(1, Ordering::SeqCst)
}

fn classify_stt_error(error: &str) -> &'static str {
    let e = error.to_ascii_lowercase();
    if e.contains("model file not found") || e.contains("model_missing") {
        "STT_MODEL_MISSING"
    } else if e.contains("failed to start") || e.contains("python_launch_failed") {
        "STT_PROCESS_LAUNCH_FAILED"
    } else if e.contains("no stt url configured") {
        "STT_URL_NOT_CONFIGURED"
    } else if e.contains("request") || e.contains("http") {
        "STT_HTTP_ERROR"
    } else {
        "STT_UNKNOWN_ERROR"
    }
}

fn classify_tts_error(error: &str) -> &'static str {
    let e = error.to_ascii_lowercase();
    if e.contains("model path not configured") || e.contains("model_missing") {
        "TTS_MODEL_MISSING"
    } else if e.contains("voices") && e.contains("missing") {
        "TTS_VOICES_MISSING"
    } else if e.contains("python_launch_failed") || e.contains("failed to spawn") {
        "TTS_PROCESS_LAUNCH_FAILED"
    } else if e.contains("url not configured") {
        "TTS_URL_NOT_CONFIGURED"
    } else if e.contains("http") || e.contains("request") {
        "TTS_HTTP_ERROR"
    } else {
        "TTS_UNKNOWN_ERROR"
    }
}

fn python_has_kokoro_runtime(python_bin: &str) -> bool {
    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", "import kokoro_onnx, onnxruntime, numpy"]);
    apply_no_window(&mut cmd);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

async fn ensure_kokoro_python_path(app: &AppHandle) -> String {
    let resolved = resolved_kokoro_python_path(app);
    if python_has_kokoro_runtime(&resolved) {
        return resolved;
    }

    let app_clone = app.clone();
    let repaired = tokio::task::spawn_blocking(move || {
        crate::ensure_kokoro_runtime_now(&app_clone).map(|p| p.to_string_lossy().to_string())
    })
    .await
    .ok()
    .and_then(Result::ok);

    if let Some(path) = repaired {
        if python_has_kokoro_runtime(&path) {
            return path;
        }
    }
    resolved
}

fn resolved_kokoro_python_path(app: &AppHandle) -> String {
    let configured = expand_home(&get_db_setting(app, "kokoro_python_path", ""));
    if !configured.trim().is_empty() && python_interpreter_usable(&configured) {
        return configured;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        for candidate in kokoro_python_candidates(&app_dir) {
            if candidate.exists() && python_interpreter_usable(candidate.to_string_lossy().as_ref())
            {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    let fallback = default_python_bin();
    if python_interpreter_usable(&fallback) {
        return fallback;
    }
    default_python_bin()
}

fn resolved_kokoro_voices_path(app: &AppHandle) -> String {
    let configured = expand_home(&get_db_setting(app, "kokoro_voices_path", ""));
    if !configured.trim().is_empty() && Path::new(&configured).exists() {
        return configured;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let kokoro_dir = app_dir.join("kokoro");
        for name in ["af_heart.bin", "af.bin"] {
            let candidate = kokoro_dir.join(name);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            for rel in [
                "resources/voice/af_heart.bin",
                "resources/voice/af.bin",
                "voice/af_heart.bin",
                "voice/af.bin",
            ] {
                let candidate = resource_dir.join(rel);
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
        if !configured.trim().is_empty() {
            return configured;
        }
        return kokoro_dir
            .join("af_heart.bin")
            .to_string_lossy()
            .to_string();
    }
    configured
}

fn resolved_kokoro_model_path(app: &AppHandle) -> String {
    let configured = expand_home(&get_db_setting(app, "kokoro_model_path", ""));
    if !configured.trim().is_empty() && Path::new(&configured).exists() {
        return configured;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let candidate = app_dir.join("kokoro").join("model_quantized.onnx");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        for rel in [
            "resources/voice/model_quantized.onnx",
            "voice/model_quantized.onnx",
        ] {
            let candidate = resource_dir.join(rel);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    configured
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
    let request_id = next_voice_request_id();
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
    crate::commands::logs::event(
        "info",
        "stt.transcribe.request",
        serde_json::json!({
            "request_id": request_id,
            "engine": stt_engine,
            "is_partial": is_partial,
            "samples": samples.len(),
            "seconds": samples.len() as f64 / 16000.0,
        }),
    );

    // Encode PCM → WAV
    let wav_bytes = match pcm_to_wav(&samples, 16000) {
        Ok(b) => b,
        Err(e) => {
            log::error!("[STT] WAV encode failed: {}", e);
            crate::commands::logs::event(
                "error",
                "stt.transcribe.result",
                serde_json::json!({
                    "request_id": request_id,
                    "result": "error",
                    "error_code": "STT_WAV_ENCODE_FAILED",
                    "error": e.to_string(),
                }),
            );
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
            let whisper_rs_available = {
                let model_path_check = model_path.clone();
                tokio::task::spawn_blocking(move || local_stt::check_whisper_rs(&model_path_check))
                    .await
                    .unwrap_or(false)
            };
            if whisper_rs_available {
                crate::commands::logs::event(
                    "debug",
                    "stt.engine.resolve",
                    serde_json::json!({
                        "request_id": request_id,
                        "engine": "whisper_rs",
                        "model_path": model_path,
                        "language": language,
                    }),
                );
                log::info!(
                    "[STT] whisper-rs: model_path={} language={}",
                    model_path,
                    language
                );
                let wav = wav_bytes.clone();
                let ctx_handle = state.whisper_rs_ctx.clone();
                tokio::task::spawn_blocking(move || {
                    local_stt::transcribe_whisper_rs_persistent(
                        &ctx_handle,
                        &wav,
                        &model_path,
                        &language,
                    )
                })
                .await
                .unwrap_or_else(|e| Err(e.to_string()))
            } else {
                let script = script_path(&app, "stt_whisper.py").unwrap_or_default();
                let model_size = get_db_setting(&app, "whisper_model_size", "tiny");
                let model_dir = expand_home(&get_db_setting(&app, "whisper_model_dir", ""));
                let python_bin = resolved_kokoro_python_path(&app);
                crate::commands::logs::event(
                    "debug",
                    "stt.engine.resolve",
                    serde_json::json!({
                        "request_id": request_id,
                        "engine": "whisper_py",
                        "python_bin": python_bin,
                        "script_path": script,
                        "model_size": model_size,
                        "model_dir": model_dir,
                        "language": language,
                    }),
                );
                log::info!(
                    "[STT] whisper-python fallback: python={} script={} model={} model_dir={} language={}",
                    python_bin,
                    script,
                    model_size,
                    model_dir,
                    language
                );
                let wav = wav_bytes.clone();
                tokio::task::spawn_blocking(move || {
                    local_stt::transcribe_whisper(
                        &wav,
                        &python_bin,
                        &script,
                        &model_size,
                        &model_dir,
                    )
                })
                .await
                .unwrap_or_else(|e| Err(e.to_string()))
            }
        }

        _ /* "external" */ => {
            if stt_url.is_empty() {
                Err("No STT URL configured. Set it in Voice settings or switch to Whisper (local).".to_string())
            } else {
                crate::commands::logs::event(
                    "debug",
                    "stt.engine.resolve",
                    serde_json::json!({
                        "request_id": request_id,
                        "engine": "external",
                        "stt_url": stt_url,
                        "base_url": base_url,
                    }),
                );
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
            crate::commands::logs::event(
                "info",
                "stt.transcribe.result",
                serde_json::json!({
                    "request_id": request_id,
                    "result": "ok",
                    "chars": trimmed.len(),
                    "is_partial": is_partial,
                }),
            );
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
            crate::commands::logs::event(
                "error",
                "stt.transcribe.result",
                serde_json::json!({
                    "request_id": request_id,
                    "result": "error",
                    "error_code": classify_stt_error(&e),
                    "error": e,
                    "is_partial": is_partial,
                }),
            );
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
    let request_id = next_voice_request_id();
    let engine = get_db_setting(&app, "tts_engine", "kokoro");
    log::info!("[TTS] speak: engine={}, {} chars", engine, text.len());
    crate::commands::logs::event(
        "info",
        "tts.request.start",
        serde_json::json!({
            "request_id": request_id,
            "engine": engine,
            "chars": text.len(),
        }),
    );

    match engine.as_str() {
        "kokoro" => {
            let script  = script_path(&app, "tts_kokoro_persistent.py").unwrap_or_default();
            let model   = resolved_kokoro_model_path(&app);
            let voices  = resolved_kokoro_voices_path(&app);
            let voice   = get_db_setting(&app, "kokoro_voice", "af_heart");
            let python_bin = ensure_kokoro_python_path(&app).await;
            crate::commands::logs::event(
                "debug",
                "tts.engine.resolve",
                serde_json::json!({
                    "request_id": request_id,
                    "engine": "kokoro",
                    "python_bin": python_bin,
                    "script_path": script,
                    "model_path": model,
                    "voices_path": voices,
                    "voice": voice,
                }),
            );
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
                Ok(r) => {
                    crate::commands::logs::event(
                        "info",
                        "tts.request.result",
                        serde_json::json!({
                            "request_id": request_id,
                            "result": "ok",
                            "engine": "kokoro",
                            "audio_bytes": r.audio.len(),
                            "phonemes": r.phonemes.is_some(),
                        }),
                    );
                    Ok(TtsSpeakResult {
                        audio_bytes: r.audio,
                        phonemes: r.phonemes,
                    })
                }
                Err(kokoro_err) => {
                    log::warn!(
                        "[TTS] Kokoro failed ({}); attempting espeak-ng fallback",
                        kokoro_err
                    );
                    crate::commands::logs::event(
                        "warn",
                        "tts.request.fallback",
                        serde_json::json!({
                            "request_id": request_id,
                            "from_engine": "kokoro",
                            "to_engine": "espeak",
                            "error_code": classify_tts_error(&kokoro_err),
                            "error": kokoro_err,
                        }),
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
                        Ok(audio) => {
                            crate::commands::logs::event(
                                "info",
                                "tts.request.result",
                                serde_json::json!({
                                    "request_id": request_id,
                                    "result": "ok",
                                    "engine": "espeak_fallback",
                                    "audio_bytes": audio.len(),
                                }),
                            );
                            Ok(TtsSpeakResult {
                                audio_bytes: audio,
                                phonemes: None,
                            })
                        }
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
                crate::commands::logs::event(
                    "error",
                    "tts.request.result",
                    serde_json::json!({
                        "request_id": request_id,
                        "result": "error",
                        "engine": "external",
                        "error_code": "TTS_URL_NOT_CONFIGURED",
                    }),
                );
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
                crate::commands::logs::event(
                    "error",
                    "tts.request.result",
                    serde_json::json!({
                        "request_id": request_id,
                        "result": "error",
                        "engine": "external",
                        "error_code": "TTS_HTTP_ERROR",
                        "status": resp.status().as_u16(),
                    }),
                );
                return Err(format!("TTS API error {}", resp.status()));
            }
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            crate::commands::logs::event(
                "info",
                "tts.request.result",
                serde_json::json!({
                    "request_id": request_id,
                    "result": "ok",
                    "engine": "external",
                    "audio_bytes": bytes.len(),
                }),
            );
            Ok(TtsSpeakResult { audio_bytes: bytes.to_vec(), phonemes: None })
        }
    }
}

// ── Engine status ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct TtsEngineStatus {
    pub kokoro: bool,
    pub kokoro_reason: Option<String>,
    pub espeak: bool,
    pub espeak_reason: Option<String>,
    pub external: bool,
    pub external_reason: Option<String>,
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
    let model = resolved_kokoro_model_path(&app);
    let voices = resolved_kokoro_voices_path(&app);
    // Keep passive status checks non-invasive and fast.
    // Runtime repair is done in cmd_tts_speak / self-test paths.
    let python_bin = resolved_kokoro_python_path(&app);
    let tts_url = get_db_setting(&app, "tts_url", "");

    let script_clone = script.clone();
    let model_clone = model.clone();
    let voices_clone = voices.clone();
    let python_clone = python_bin.clone();
    let (kokoro, kokoro_reason) = tokio::task::spawn_blocking(move || {
        if script_clone.trim().is_empty() {
            return (
                false,
                Some("script_missing: tts_kokoro.py unresolved".to_string()),
            );
        }
        if !Path::new(&script_clone).exists() {
            return (false, Some(format!("script_missing: {}", script_clone)));
        }
        if model_clone.trim().is_empty() || !Path::new(&model_clone).exists() {
            return (false, Some(format!("model_missing: {}", model_clone)));
        }
        if voices_clone.trim().is_empty() || !Path::new(&voices_clone).exists() {
            return (false, Some(format!("voices_missing: {}", voices_clone)));
        }

        let mut cmd = Command::new(&python_clone);
        cmd.args(["-c", "import kokoro_onnx, onnxruntime, numpy"]);
        apply_no_window(&mut cmd);
        let out = cmd.output();
        match out {
            Ok(o) if o.status.success() => (true, None),
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let details = if stderr.is_empty() { stdout } else { stderr };
                let reason = if details.is_empty() {
                    format!("runtime_import_failed: {}", o.status)
                } else {
                    format!("runtime_import_failed: {} ({details})", o.status)
                };
                (false, Some(reason))
            }
            Err(e) => (false, Some(format!("python_launch_failed: {e}"))),
        }
    })
    .await
    .unwrap_or((false, Some("check_failed: task_join_error".to_string())));
    let (espeak, espeak_reason) = tokio::task::spawn_blocking(move || {
        let ok = local_tts::check_espeak();
        if ok {
            (true, None)
        } else {
            (false, Some("espeak_not_found_on_path".to_string()))
        }
    })
    .await
    .unwrap_or((false, Some("check_failed: task_join_error".to_string())));

    let (external, external_reason) = if tts_url.is_empty() {
        (false, Some("url_not_configured".to_string()))
    } else {
        let result = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .map_err(|e| format!("external_client_build_failed: {e}"))
            .and_then(|c| {
                futures_util::FutureExt::now_or_never(c.get(&tts_url).send())
                    .ok_or_else(|| "external_check_timeout".to_string())
                    .and_then(|r| r.map_err(|e| format!("external_request_failed: {e}")))
                    .map(|r| {
                        if r.status().is_success() || r.status().as_u16() < 500 {
                            (true, None)
                        } else {
                            (
                                false,
                                Some(format!("external_http_status: {}", r.status().as_u16())),
                            )
                        }
                    })
            });
        match result {
            Ok(v) => v,
            Err(e) => (false, Some(e)),
        }
    };

    TtsEngineStatus {
        kokoro,
        kokoro_reason,
        espeak,
        espeak_reason,
        external,
        external_reason,
        current_engine,
    }
}

#[derive(Serialize)]
pub struct TtsSelfTestResult {
    pub current_engine: String,
    pub ok: bool,
    pub check_reason: Option<String>,
    pub synth_bytes: usize,
    pub synth_reason: Option<String>,
    pub engines: TtsEngineStatus,
}

#[tauri::command]
pub async fn cmd_tts_self_test(app: AppHandle) -> TtsSelfTestResult {
    let engines = cmd_tts_check_engines(app.clone()).await;
    let current_engine = engines.current_engine.clone();
    let mut result = TtsSelfTestResult {
        current_engine: current_engine.clone(),
        ok: false,
        check_reason: None,
        synth_bytes: 0,
        synth_reason: None,
        engines: engines.clone(),
    };

    match current_engine.as_str() {
        "kokoro" => {
            if !engines.kokoro {
                result.check_reason = engines.kokoro_reason.clone();
                return result;
            }
            let script = script_path(&app, "tts_kokoro.py").unwrap_or_default();
            let model = resolved_kokoro_model_path(&app);
            let voices = resolved_kokoro_voices_path(&app);
            let voice = get_db_setting(&app, "kokoro_voice", "af_heart");
            let python_bin = ensure_kokoro_python_path(&app).await;
            let synth = tokio::task::spawn_blocking(move || {
                local_tts::speak_kokoro(
                    &python_bin,
                    "Runtime self-test from Arxell.",
                    &script,
                    &model,
                    &voices,
                    &voice,
                )
            })
            .await;
            match synth {
                Ok(Ok(audio)) => {
                    result.synth_bytes = audio.len();
                    result.ok = !audio.is_empty();
                    if audio.is_empty() {
                        result.synth_reason = Some("kokoro_synth_returned_empty_audio".to_string());
                    }
                }
                Ok(Err(e)) => {
                    result.synth_reason = Some(format!("kokoro_synth_failed: {e}"));
                }
                Err(e) => {
                    result.synth_reason = Some(format!("kokoro_synth_task_failed: {e}"));
                }
            }
        }
        "external" => {
            if !engines.external {
                result.check_reason = engines.external_reason.clone();
                return result;
            }
            let tts_url = get_db_setting(&app, "tts_url", "");
            let api_key = get_db_setting(&app, "api_key", "lm-studio");
            let voice = get_db_setting(&app, "tts_voice", "alloy");
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build();
            match client {
                Ok(c) => {
                    let resp = c
                        .post(&tts_url)
                        .header("Authorization", format!("Bearer {}", api_key))
                        .json(&serde_json::json!({
                            "model": "tts-1",
                            "input": "Runtime self-test from Arxell.",
                            "voice": voice
                        }))
                        .send()
                        .await;
                    match resp {
                        Ok(r) if r.status().is_success() => match r.bytes().await {
                            Ok(bytes) => {
                                result.synth_bytes = bytes.len();
                                result.ok = !bytes.is_empty();
                                if bytes.is_empty() {
                                    result.synth_reason =
                                        Some("external_synth_returned_empty_audio".to_string());
                                }
                            }
                            Err(e) => {
                                result.synth_reason =
                                    Some(format!("external_read_audio_failed: {e}"));
                            }
                        },
                        Ok(r) => {
                            result.synth_reason =
                                Some(format!("external_synth_http_status: {}", r.status()));
                        }
                        Err(e) => {
                            result.synth_reason =
                                Some(format!("external_synth_request_failed: {e}"));
                        }
                    }
                }
                Err(e) => {
                    result.synth_reason = Some(format!("external_client_build_failed: {e}"));
                }
            }
        }
        _ => {
            if !engines.espeak {
                result.check_reason = engines.espeak_reason.clone();
                return result;
            }
            let voice = get_db_setting(&app, "tts_voice", "en-us");
            let synth = tokio::task::spawn_blocking(move || {
                local_tts::speak_espeak("Runtime self-test from Arxell.", &voice)
            })
            .await;
            match synth {
                Ok(Ok(audio)) => {
                    result.synth_bytes = audio.len();
                    result.ok = !audio.is_empty();
                    if audio.is_empty() {
                        result.synth_reason = Some("espeak_synth_returned_empty_audio".to_string());
                    }
                }
                Ok(Err(e)) => {
                    result.synth_reason = Some(format!("espeak_synth_failed: {e}"));
                }
                Err(e) => {
                    result.synth_reason = Some(format!("espeak_synth_task_failed: {e}"));
                }
            }
        }
    }

    result
}

#[derive(Serialize)]
pub struct SttEngineStatus {
    pub whisper_rs: bool,
    pub whisper_py: bool,
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
    let whisper_py = {
        let script = script_path(&app, "stt_whisper.py").unwrap_or_default();
        let python_bin = resolved_kokoro_python_path(&app);
        tokio::task::spawn_blocking(move || {
            !script.trim().is_empty()
                && Path::new(&script).exists()
                && local_stt::check_whisper(&python_bin)
        })
        .await
        .unwrap_or(false)
    };

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
        whisper_rs: whisper_rs || whisper_py,
        whisper_py,
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
            let model = resolved_kokoro_model_path(&app);
            let voices_path = resolved_kokoro_voices_path(&app);
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
