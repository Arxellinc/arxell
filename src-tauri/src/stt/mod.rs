//! STT module - Speech-to-Text functionality using whisper.cpp
//!
//! This module provides:
//! - WhisperSupervisor for managing the whisper.cpp child process
//! - WhisperClient for HTTP communication with the whisper server
//! - Tauri commands for start, stop, transcribe, and status

#[cfg(feature = "tauri-runtime")]
pub mod client;
#[cfg(feature = "tauri-runtime")]
pub mod events;
#[cfg(feature = "tauri-runtime")]
pub mod supervisor;

#[cfg(feature = "tauri-runtime")]
use crate::app_paths;
#[cfg(feature = "tauri-runtime")]
use bzip2::read::BzDecoder;
#[cfg(feature = "tauri-runtime")]
use reqwest::blocking::Client;
#[cfg(feature = "tauri-runtime")]
use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
#[cfg(feature = "tauri-runtime")]
use std::fs;
#[cfg(feature = "tauri-runtime")]
use std::path::{Path, PathBuf};
#[cfg(feature = "tauri-runtime")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(feature = "tauri-runtime")]
use std::sync::OnceLock;
#[cfg(feature = "tauri-runtime")]
use tar::Archive;
#[cfg(feature = "tauri-runtime")]
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg(feature = "tauri-runtime")]
static SILERO_VAD_DISCOVERY_LOGGED: AtomicBool = AtomicBool::new(false);
#[cfg(feature = "tauri-runtime")]
static STREAM_STATE: OnceLock<Mutex<StreamState>> = OnceLock::new();
#[cfg(feature = "tauri-runtime")]
static STREAM_CONFIG: OnceLock<Mutex<StreamConfig>> = OnceLock::new();
#[cfg(feature = "tauri-runtime")]
static CACHED_VAD_MODEL_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

#[cfg(feature = "tauri-runtime")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum STTBackend {
    WhisperCpp,
    SherpaOnnx,
}

#[cfg(feature = "tauri-runtime")]
impl STTBackend {
    fn as_str(self) -> &'static str {
        match self {
            Self::WhisperCpp => "whisper_cpp",
            Self::SherpaOnnx => "sherpa_onnx",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        let normalized = value.trim().to_lowercase();
        match normalized.as_str() {
            "whisper_cpp" | "whisper" | "whisper.cpp" => Some(Self::WhisperCpp),
            "sherpa_onnx" | "sherpa-onnx" | "sherpa" => Some(Self::SherpaOnnx),
            _ => None,
        }
    }
}

#[cfg(feature = "tauri-runtime")]
#[derive(Debug, Default)]
struct StreamState {
    speaking: bool,
    speech_start_frames: u32,
    speech_end_frames: u32,
    pre_speech: Vec<f32>,
    utterance: Vec<f32>,
    current_utterance_id: Option<String>,
    last_partial_samples: usize,
    noise_floor_rms: f32,
}

#[cfg(feature = "tauri-runtime")]
#[derive(Debug, Clone, Copy)]
struct StreamConfig {
    start_frames: u32,
    end_frames: u32,
    pre_speech_samples: usize,
    partial_threshold_samples: usize,
    partial_step_samples: usize,
    finalize_speech_samples: usize,
}

#[cfg(feature = "tauri-runtime")]
impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            start_frames: 2,
            end_frames: 8,
            pre_speech_samples: 10_240,
            partial_threshold_samples: 16_000,
            partial_step_samples: 11_200,
            finalize_speech_samples: 12_800,
        }
    }
}

#[cfg(feature = "tauri-runtime")]
fn stream_state() -> &'static Mutex<StreamState> {
    STREAM_STATE.get_or_init(|| Mutex::new(StreamState::default()))
}

#[cfg(feature = "tauri-runtime")]
fn stream_config() -> &'static Mutex<StreamConfig> {
    STREAM_CONFIG.get_or_init(|| Mutex::new(StreamConfig::default()))
}

#[cfg(feature = "tauri-runtime")]
async fn transcribe_with_supervisor(
    supervisor: &Arc<Mutex<supervisor::WhisperSupervisor>>,
    pcm_samples: &[f32],
) -> Result<String, String> {
    let supervisor = supervisor.lock().await;
    let endpoint = supervisor
        .endpoint()
        .await
        .ok_or_else(|| "STT service not running".to_string())?;
    let port = endpoint
        .strip_prefix("http://127.0.0.1:")
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "Invalid endpoint".to_string())?;
    let client = client::WhisperClient::new(port);
    client.transcribe(pcm_samples).await
}

#[cfg(feature = "tauri-runtime")]
enum SherpaOfflineModel {
    SenseVoice {
        model: PathBuf,
        tokens: PathBuf,
    },
    MoonshineV2 {
        encoder: PathBuf,
        merged_decoder: PathBuf,
        tokens: PathBuf,
    },
}

#[cfg(feature = "tauri-runtime")]
fn resolve_sherpa_model(app: &tauri::AppHandle) -> Option<SherpaOfflineModel> {
    fn first_model_pair_under(root: &Path) -> Option<SherpaOfflineModel> {
        if !root.is_dir() {
            return None;
        }
        let model_names = ["model.int8.onnx", "model.onnx", "sense-voice.onnx"];
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let tokens = dir.join("tokens.txt");
            if tokens.is_file() {
                let moonshine_encoder = dir.join("encoder_model.ort");
                let moonshine_decoder = dir.join("decoder_model_merged.ort");
                if moonshine_encoder.is_file() && moonshine_decoder.is_file() {
                    return Some(SherpaOfflineModel::MoonshineV2 {
                        encoder: moonshine_encoder,
                        merged_decoder: moonshine_decoder,
                        tokens: tokens.clone(),
                    });
                }
                for model_name in model_names {
                    let model = dir.join(model_name);
                    if model.is_file() {
                        return Some(SherpaOfflineModel::SenseVoice {
                            model,
                            tokens: tokens.clone(),
                        });
                    }
                }
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                }
            }
        }
        None
    }

    let app_data_dir = app_paths::app_data_dir();
    let resource_dir = app.path().resource_dir().ok()?;
    let roots = [
        app_data_dir.join("STT").join("sherpa"),
        app_data_dir.join("stt").join("sherpa"),
        app_data_dir.join("STT").join("models").join("sherpa"),
        app_data_dir.join("stt").join("models").join("sherpa"),
        resource_dir.join("stt").join("sherpa"),
        resource_dir.join("voice").join("sherpa"),
        resource_dir.join("sherpa"),
    ];
    for root in roots {
        if let Some(found) = first_model_pair_under(&root) {
            return Some(found);
        }
    }
    None
}

#[cfg(feature = "tauri-runtime")]
fn list_installed_sherpa_model_names(_app: &tauri::AppHandle) -> Vec<String> {
    fn collect_model_names_under(root: &Path, out: &mut Vec<String>) {
        if !root.is_dir() {
            return;
        }
        let model_names = ["model.int8.onnx", "model.onnx", "sense-voice.onnx"];
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let tokens = dir.join("tokens.txt");
            if tokens.is_file() {
                let moonshine_encoder = dir.join("encoder_model.ort");
                let moonshine_decoder = dir.join("decoder_model_merged.ort");
                if moonshine_encoder.is_file() && moonshine_decoder.is_file() {
                    if let Some(parent) = dir.file_name().and_then(|s| s.to_str()) {
                        out.push(parent.to_string());
                    } else {
                        out.push("moonshine".to_string());
                    }
                    continue;
                }
                for model_name in model_names {
                    let model = dir.join(model_name);
                    if model.is_file() {
                        if let Some(parent) = dir.file_name().and_then(|s| s.to_str()) {
                            out.push(parent.to_string());
                        } else if let Some(file) = model.file_name().and_then(|s| s.to_str()) {
                            out.push(file.to_string());
                        }
                        break;
                    }
                }
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                }
            }
        }
    }

    let mut names = vec!["auto".to_string()];
    let mut discovered = Vec::new();
    let app_data_dir = app_paths::app_data_dir();
    let roots = [
        app_data_dir.join("STT").join("sherpa"),
        app_data_dir.join("stt").join("sherpa"),
        app_data_dir.join("STT").join("models").join("sherpa"),
        app_data_dir.join("stt").join("models").join("sherpa"),
    ];
    for root in roots {
        collect_model_names_under(&root, &mut discovered);
    }
    discovered.sort();
    discovered.dedup();
    names.extend(discovered);
    names
}

#[cfg(feature = "tauri-runtime")]
fn transcribe_with_sherpa(app: &tauri::AppHandle, pcm_samples: &[f32]) -> Result<String, String> {
    use sherpa_onnx::{
        OfflineMoonshineModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
        OfflineSenseVoiceModelConfig,
    };
    let model = resolve_sherpa_model(app).ok_or_else(|| {
        "Sherpa STT model not found. Expected either SenseVoice files (model.int8.onnx or model.onnx + tokens.txt) or Moonshine files (encoder_model.ort + decoder_model_merged.ort + tokens.txt).".to_string()
    })?;

    let mut config = OfflineRecognizerConfig::default();
    match model {
        SherpaOfflineModel::SenseVoice { model, tokens } => {
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: Some(model.to_string_lossy().to_string()),
                language: Some("auto".to_string()),
                use_itn: true,
            };
            config.model_config.tokens = Some(tokens.to_string_lossy().to_string());
        }
        SherpaOfflineModel::MoonshineV2 {
            encoder,
            merged_decoder,
            tokens,
        } => {
            config.model_config.moonshine = OfflineMoonshineModelConfig {
                encoder: Some(encoder.to_string_lossy().to_string()),
                merged_decoder: Some(merged_decoder.to_string_lossy().to_string()),
                ..OfflineMoonshineModelConfig::default()
            };
            config.model_config.tokens = Some(tokens.to_string_lossy().to_string());
        }
    }
    config.model_config.provider = Some("cpu".to_string());
    config.model_config.num_threads = 1;

    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| "Failed to create Sherpa offline recognizer".to_string())?;
    let stream = recognizer.create_stream();
    stream.accept_waveform(16_000, pcm_samples);
    recognizer.decode(&stream);
    let result = stream
        .get_result()
        .ok_or_else(|| "Sherpa recognition returned no result".to_string())?;
    Ok(result.text)
}

#[cfg(feature = "tauri-runtime")]
async fn transcribe_backend(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, STTState>,
    pcm_samples: &[f32],
) -> Result<String, String> {
    let backend = *state.backend.lock().await;
    match backend {
        STTBackend::WhisperCpp => transcribe_with_supervisor(&state.supervisor, pcm_samples).await,
        STTBackend::SherpaOnnx => transcribe_with_sherpa(app, pcm_samples),
    }
}

/// Managed state for the STT system
#[cfg(feature = "tauri-runtime")]
pub struct STTState {
    pub supervisor: Arc<Mutex<supervisor::WhisperSupervisor>>,
    pub backend: Arc<Mutex<STTBackend>>,
}

#[cfg(not(feature = "tauri-runtime"))]
pub struct STTState {
    pub supervisor: Arc<Mutex<()>>,
}

impl STTState {
    pub fn new() -> Self {
        #[cfg(feature = "tauri-runtime")]
        {
            Self {
                supervisor: Arc::new(Mutex::new(supervisor::WhisperSupervisor::new())),
                backend: Arc::new(Mutex::new(STTBackend::WhisperCpp)),
            }
        }
        #[cfg(not(feature = "tauri-runtime"))]
        {
            Self {
                supervisor: Arc::new(Mutex::new(())),
            }
        }
    }
}

impl Default for STTState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "tauri-runtime")]
fn resolve_silero_vad_model_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let app_data_dir = app_paths::app_data_dir();
    let resource_dir = app.path().resource_dir().ok()?;
    let candidates = [
        app_data_dir.join("STT").join("vad").join("silero_vad.onnx"),
        app_data_dir
            .join("STT")
            .join("models")
            .join("silero_vad.onnx"),
        app_data_dir.join("stt").join("vad").join("silero_vad.onnx"),
        app_data_dir
            .join("stt")
            .join("models")
            .join("silero_vad.onnx"),
        resource_dir.join("voice").join("silero_vad.onnx"),
        resource_dir.join("silero_vad.onnx"),
    ];
    candidates.iter().find(|p: &&PathBuf| p.is_file()).cloned()
}

#[cfg(feature = "tauri-runtime")]
fn sherpa_silero_has_speech(samples: &[f32], model_path: &Path) -> Result<bool, String> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(model_path.to_string_lossy().to_string()),
            threshold: 0.35,
            min_silence_duration: 0.25,
            min_speech_duration: 0.10,
            window_size: 512,
            max_speech_duration: 30.0,
        },
        sample_rate: 16_000,
        num_threads: 1,
        provider: Some("cpu".to_string()),
        debug: false,
        ..VadModelConfig::default()
    };

    let vad = VoiceActivityDetector::create(&config, 30.0)
        .ok_or_else(|| "failed creating sherpa silero VAD".to_string())?;
    vad.accept_waveform(samples);
    vad.flush();

    let mut has_speech = false;
    while let Some(segment) = vad.front() {
        if segment.n() > 0 {
            has_speech = true;
            break;
        }
        vad.pop();
    }
    Ok(has_speech)
}

#[cfg(feature = "tauri-runtime")]
fn sherpa_silero_has_speech_cached(
    app: &tauri::AppHandle,
    samples: &[f32],
) -> Result<bool, String> {
    let model_path = CACHED_VAD_MODEL_PATH.get_or_init(|| resolve_silero_vad_model_path(app));
    let Some(model_path) = model_path else {
        return Ok(false);
    };
    sherpa_silero_has_speech(samples, model_path)
}
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn start_stt(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
) -> Result<(), String> {
    use log::info;

    let backend = *state.backend.lock().await;
    match backend {
        STTBackend::WhisperCpp => {
            info!("Starting STT service backend={}", backend.as_str());
            let supervisor = state.supervisor.lock().await;
            supervisor.start(&app).await
        }
        STTBackend::SherpaOnnx => {
            info!(
                "Starting STT service backend={} (local recognizer, no daemon)",
                backend.as_str()
            );
            Ok(())
        }
    }
}

/// Stop the STT service (whisper.cpp server)
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stop_stt(state: tauri::State<'_, STTState>) -> Result<(), String> {
    use log::info;

    let backend = *state.backend.lock().await;
    match backend {
        STTBackend::WhisperCpp => {
            info!("Stopping STT service backend={}", backend.as_str());
            let supervisor = state.supervisor.lock().await;
            supervisor.stop().await
        }
        STTBackend::SherpaOnnx => {
            info!(
                "Stopping STT service backend={} (no daemon)",
                backend.as_str()
            );
            Ok(())
        }
    }
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_set_backend(
    state: tauri::State<'_, STTState>,
    backend: String,
) -> Result<String, String> {
    let parsed = STTBackend::from_str(&backend)
        .ok_or_else(|| format!("Unsupported STT backend: {}", backend))?;
    let mut current = state.backend.lock().await;
    *current = parsed;
    Ok(parsed.as_str().to_string())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_get_backend(state: tauri::State<'_, STTState>) -> Result<String, String> {
    let current = *state.backend.lock().await;
    Ok(current.as_str().to_string())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_set_model(
    _state: tauri::State<'_, STTState>,
    model: String,
) -> Result<String, String> {
    // Store model setting (frontend-only for now, will be used in future)
    Ok(model)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_set_language(
    _state: tauri::State<'_, STTState>,
    language: String,
) -> Result<String, String> {
    // Store language setting (frontend-only for now, will be used in future)
    Ok(language)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_set_threads(
    _state: tauri::State<'_, STTState>,
    threads: i32,
) -> Result<i32, String> {
    // Validate threads value
    if threads < 1 || threads > 8 {
        return Err("Threads must be between 1 and 8".to_string());
    }
    // Store threads setting (will be used when starting whisper.cpp server)
    Ok(threads)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_download_model(
    app: tauri::AppHandle,
    _state: tauri::State<'_, STTState>,
    file_name: String,
) -> Result<String, String> {
    use log::info;

    info!("Starting STT model download: {}", file_name);

    // Available models
    let models = [
        ("sherpa-onnx-rk3588-streaming-zipformer-en-2023-06-26.tar.bz2", "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-rk3588-streaming-zipformer-en-2023-06-26.tar.bz2"),
        ("sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2", "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2"),
    ];

    let (_model_name, url) = models
        .iter()
        .find(|(name, _)| name == &file_name)
        .ok_or_else(|| format!("Model not found: {}", file_name))?;

    // Determine download directory
    let app_data_dir = app_paths::app_data_dir();

    let download_dir = app_data_dir.join("STT").join("sherpa");

    // Create download directory if needed
    fs::create_dir_all(&download_dir)
        .map_err(|e| format!("Failed to create download directory: {}", e))?;

    let download_path = download_dir.join(&file_name);

    info!("Downloading model to: {}", download_path.display());

    let target_url = (*url).to_string();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut response = Client::builder()
            .build()
            .map_err(|e| format!("failed creating HTTP client: {e}"))?
            .get(&target_url)
            .send()
            .map_err(|e| format!("failed downloading model archive: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("download failed with HTTP {}", response.status()));
        }

        let mut out = fs::File::create(&download_path)
            .map_err(|e| format!("failed creating archive path: {e}"))?;
        std::io::copy(&mut response, &mut out)
            .map_err(|e| format!("failed writing downloaded archive: {e}"))?;

        let archive_file = fs::File::open(&download_path)
            .map_err(|e| format!("failed opening downloaded archive: {e}"))?;
        let decompressed = BzDecoder::new(archive_file);
        let mut archive = Archive::new(decompressed);
        archive
            .unpack(&download_dir)
            .map_err(|e| format!("failed extracting model archive: {e}"))?;

        let _ = fs::remove_file(&download_path);
        Ok(())
    })
    .await
    .map_err(|e| format!("download worker join error: {e}"))??;

    let installed = list_installed_sherpa_model_names(&app);
    if installed.len() <= 1 {
        return Ok(format!(
            "Downloaded and extracted {} but no compatible offline model files were detected. This bundle may target a different runtime/provider.",
            file_name
        ));
    }
    Ok(format!(
        "Downloaded and extracted {}. Installed models: {}",
        file_name,
        installed.join(", ")
    ))
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_list_models(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(list_installed_sherpa_model_names(&app))
}

/// Transcribe a chunk of PCM audio
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn transcribe_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    use log::{error, info};
    use tauri::Emitter;

    info!(
        "Received transcription request: {} samples, utterance_id: {}",
        pcm_samples.len(),
        utterance_id
    );

    // Optional backend speech gate via sherpa-onnx Silero VAD.
    // If a silero_vad.onnx model is present, skip non-speech chunks before Whisper.
    let vad_model_opt = CACHED_VAD_MODEL_PATH.get_or_init(|| resolve_silero_vad_model_path(&app));
    if !SILERO_VAD_DISCOVERY_LOGGED.swap(true, Ordering::SeqCst) {
        if let Some(vad_model) = vad_model_opt {
            info!("Silero VAD active: {}", vad_model.display());
        } else {
            info!("Silero VAD inactive: no silero_vad.onnx found, using Whisper-only path");
        }
    }
    if let Some(_vad_model) = vad_model_opt {
        match sherpa_silero_has_speech_cached(&app, &pcm_samples) {
            Ok(false) => {
                info!(
                    "Silero VAD rejected non-speech chunk: {} samples, utterance_id: {}",
                    pcm_samples.len(),
                    utterance_id
                );
                let _ = app.emit("stt://vad", events::VADPayload { is_speaking: false });
                return Ok(());
            }
            Ok(true) => {
                let _ = app.emit("stt://vad", events::VADPayload { is_speaking: true });
            }
            Err(e) => {
                error!("Silero VAD gate failed, falling back to Whisper: {}", e);
            }
        }
    }

    match transcribe_backend(&app, &state, &pcm_samples).await {
        Ok(transcript) => {
            info!("Transcription complete: {} chars", transcript.len());

            // Emit transcript event
            let _ = app.emit(
                "stt://transcript",
                events::TranscriptPayload {
                    text: transcript,
                    is_final: true,
                    utterance_id,
                },
            );
            let _ = app.emit("stt://vad", events::VADPayload { is_speaking: false });

            Ok(())
        }
        Err(e) => {
            error!("Transcription failed: {}", e);

            // Emit error event but don't restart - transient errors don't need restart
            let _ = app.emit(
                "pipeline://error",
                events::PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: format!("Transcription failed: {}", e),
                    details: None,
                },
            );
            let _ = app.emit("stt://vad", events::VADPayload { is_speaking: false });

            // Return Ok since error was emitted via event
            Ok(())
        }
    }
}

/// Transcribe a chunk as an interim partial result.
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn transcribe_partial_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    use log::{error, info};
    use tauri::Emitter;

    match transcribe_backend(&app, &state, &pcm_samples).await {
        Ok(transcript) => {
            let text = transcript.trim().to_string();
            if text.is_empty() {
                return Ok(());
            }
            info!("Partial transcription: {} chars", text.len());
            let _ = app.emit(
                "stt://partial",
                events::PartialTranscriptPayload { text, utterance_id },
            );
            Ok(())
        }
        Err(e) => {
            error!("Partial transcription failed: {}", e);
            Ok(())
        }
    }
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_stream_reset() -> Result<(), String> {
    let mut s = stream_state().lock().await;
    *s = StreamState::default();
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_stream_configure(
    start_frames: Option<u32>,
    end_frames: Option<u32>,
    pre_speech_ms: Option<u32>,
) -> Result<(), String> {
    let mut config = stream_config().lock().await;
    if let Some(value) = start_frames {
        config.start_frames = value.clamp(1, 100);
    }
    if let Some(value) = end_frames {
        config.end_frames = value.clamp(1, 200);
    }
    if let Some(value) = pre_speech_ms {
        let clamped = value.clamp(0, 2_000);
        config.pre_speech_samples = (clamped as usize).saturating_mul(16);
    }
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_stream_ingest(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
) -> Result<(), String> {
    use log::error;
    use tauri::Emitter;

    if pcm_samples.is_empty() {
        return Ok(());
    }

    let rms = (pcm_samples.iter().map(|v| v * v).sum::<f32>() / pcm_samples.len() as f32).sqrt();

    let config = {
        let cfg = stream_config().lock().await;
        *cfg
    };

    let mut s = stream_state().lock().await;
    let chunk_has_speech = match CACHED_VAD_MODEL_PATH.get_or_init(|| resolve_silero_vad_model_path(&app)) {
        Some(_) => sherpa_silero_has_speech_cached(&app, &pcm_samples)
            .unwrap_or_else(|_| rms > 0.0012),
        None => rms > 0.0012,
    };

    if !s.speaking {
        let alpha = 0.03f32;
        if s.noise_floor_rms <= 0.0 {
            s.noise_floor_rms = rms.max(0.0002);
        } else {
            s.noise_floor_rms = ((1.0 - alpha) * s.noise_floor_rms + alpha * rms).max(0.0002);
        }
    }

    if !s.speaking {
        s.pre_speech.extend_from_slice(&pcm_samples);
        let max_pre = config.pre_speech_samples;
        if s.pre_speech.len() > max_pre {
            let drop_n = s.pre_speech.len() - max_pre;
            s.pre_speech.drain(0..drop_n);
        }
    }

    if chunk_has_speech {
        s.speech_start_frames = s.speech_start_frames.saturating_add(1);
        s.speech_end_frames = 0;
    } else {
        s.speech_end_frames = s.speech_end_frames.saturating_add(1);
        s.speech_start_frames = 0;
    }

    if !s.speaking && s.speech_start_frames >= config.start_frames {
        s.speaking = true;
        s.current_utterance_id = Some(uuid::Uuid::new_v4().to_string());
        s.utterance.clear();
        let pre = s.pre_speech.clone();
        s.utterance.extend_from_slice(&pre);
        s.utterance.extend_from_slice(&pcm_samples);
        s.pre_speech.clear();
        s.last_partial_samples = 0;
        let _ = app.emit("stt://vad", events::VADPayload { is_speaking: true });
    } else if s.speaking {
        s.utterance.extend_from_slice(&pcm_samples);
    }

    let maybe_partial = if s.speaking {
        let threshold = config.partial_threshold_samples;
        let step = config.partial_step_samples;
        if s.utterance.len() >= threshold
            && s.utterance.len().saturating_sub(s.last_partial_samples) >= step
        {
            s.last_partial_samples = s.utterance.len();
            if let Some(uid) = s.current_utterance_id.clone() {
                Some((s.utterance.clone(), uid))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let should_finalize =
        s.speaking && (s.speech_end_frames >= config.end_frames || s.utterance.len() >= 480_000);
    // Fast finalize path for clean silence: commit sooner when we have enough speech
    // and the tail energy drops near the adaptive noise floor.
    let fast_silence_threshold = (s.noise_floor_rms * 1.25).max(0.0009);
    let fast_silence_finalize = s.speaking
        && s.utterance.len() >= config.finalize_speech_samples
        && s.speech_end_frames >= 4
        && rms <= fast_silence_threshold;
    let maybe_final = if should_finalize || fast_silence_finalize {
        let uid = s
            .current_utterance_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let chunk = std::mem::take(&mut s.utterance);
        s.current_utterance_id = None;
        s.speaking = false;
        s.speech_start_frames = 0;
        s.speech_end_frames = 0;
        s.pre_speech.clear();
        s.last_partial_samples = 0;
        let _ = app.emit("stt://vad", events::VADPayload { is_speaking: false });
        Some((chunk, uid))
    } else {
        None
    };
    drop(s);

    if let Some((chunk, uid)) = maybe_partial {
        if let Ok(transcript) = transcribe_backend(&app, &state, &chunk).await {
            let text = transcript.trim().to_string();
            if !text.is_empty() {
                let _ = app.emit(
                    "stt://partial",
                    events::PartialTranscriptPayload {
                        text,
                        utterance_id: uid,
                    },
                );
            }
        }
    }

    if let Some((chunk, uid)) = maybe_final {
        match transcribe_backend(&app, &state, &chunk).await {
            Ok(transcript) => {
                let _ = app.emit(
                    "stt://transcript",
                    events::TranscriptPayload {
                        text: transcript,
                        is_final: true,
                        utterance_id: uid,
                    },
                );
            }
            Err(e) => {
                error!("Streaming final transcription failed: {}", e);
                let _ = app.emit(
                    "pipeline://error",
                    events::PipelineErrorPayload {
                        source: "stt".to_string(),
                        message: format!("Transcription failed: {}", e),
                        details: None,
                    },
                );
            }
        }
    }

    Ok(())
}

/// Get the current STT status
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_status(
    state: tauri::State<'_, STTState>,
) -> Result<events::STTStatusPayload, String> {
    let backend = *state.backend.lock().await;
    match backend {
        STTBackend::WhisperCpp => {
            let supervisor = state.supervisor.lock().await;
            let status = supervisor.status().await;
            match status {
                supervisor::SupervisorStatus::Starting => Ok(events::STTStatusPayload {
                    status: "starting".to_string(),
                    message: Some("backend=whisper_cpp".to_string()),
                }),
                supervisor::SupervisorStatus::Running => Ok(events::STTStatusPayload {
                    status: "running".to_string(),
                    message: Some("backend=whisper_cpp".to_string()),
                }),
                supervisor::SupervisorStatus::Stopped => Ok(events::STTStatusPayload {
                    status: "stopped".to_string(),
                    message: Some("backend=whisper_cpp".to_string()),
                }),
                supervisor::SupervisorStatus::Error(msg) => Ok(events::STTStatusPayload {
                    status: "error".to_string(),
                    message: Some(msg),
                }),
            }
        }
        STTBackend::SherpaOnnx => Ok(events::STTStatusPayload {
            status: "running".to_string(),
            message: Some("backend=sherpa_onnx".to_string()),
        }),
    }
}

/// Generate a new UUID for an utterance
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub fn generate_utterance_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Update VAD status
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn update_vad_status(app: tauri::AppHandle, is_speaking: bool) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit("stt://vad", events::VADPayload { is_speaking });
    Ok(())
}
