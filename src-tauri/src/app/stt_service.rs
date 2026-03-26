#![cfg(feature = "tauri-runtime")]

use crate::contracts::{
    EventSeverity, EventStage, SttDownloadModelRequest, SttDownloadModelResponse,
    SttListModelsRequest, SttListModelsResponse, SttModelRecord, SttSetModelRequest,
    SttSetModelResponse, SttStartRequest, SttStartResponse, SttStatusRequest, SttStatusResponse,
    SttStopRequest, SttStopResponse, Subsystem,
};
use crate::observability::EventHub;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::Manager;
use tract_onnx::prelude::*;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const STT_ENGINE_ID: &str = "whisper.cpp";
const STT_MODEL_FILE: &str = "ggml-base-q8_0.bin";
const SILERO_MODEL_FILE: &str = "silero_vad.onnx";
const STT_LANGUAGE: &str = "en";
const DEFAULT_VAD_THRESHOLD: f32 = 0.35;
const DEFAULT_MIN_SILENCE_MS: u32 = 900;
const AMPLITUDE_FALLBACK_THRESHOLD: f32 = 0.005;
const MAX_UTTERANCE_MS: u32 = 30_000;
const PRE_ROLL_MS: u32 = 320;
const SILERO_CHUNK: usize = 512;
const PARTIAL_TRANSCRIBE_INTERVAL_MS: u64 = 1200;
const PARTIAL_MIN_SPEECH_MS: u32 = 700;
const VAD_PROGRESS_INTERVAL_MS: u64 = 250;

#[derive(Clone)]
struct SharedState {
    state: String,
    last_error: Option<String>,
    last_transcript: Option<String>,
    model_path: Option<String>,
    auto_submit: bool,
    vad_threshold: f32,
    min_silence_ms: u32,
}

struct RuntimeState {
    running: bool,
    stop_flag: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    whisper_ctx: Arc<Mutex<Option<WhisperContext>>>,
}

struct SileroVad {
    model: SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>,
    state: Tensor,
}

impl SileroVad {
    fn new(model_path: &Path) -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_path(model_path)
            .map_err(|e| format!("silero model load failed: {e}"))?
            .with_input_fact(0, f32::fact([1, SILERO_CHUNK as i64]).into())
            .map_err(|e| format!("silero input fact[0] failed: {e}"))?
            .with_input_fact(1, i64::fact([1]).into())
            .map_err(|e| format!("silero input fact[1] failed: {e}"))?
            .with_input_fact(2, f32::fact([2, 1, 64]).into())
            .map_err(|e| format!("silero input fact[2] failed: {e}"))?
            .into_optimized()
            .map_err(|e| format!("silero optimize failed: {e}"))?
            .into_runnable()
            .map_err(|e| format!("silero runnable conversion failed: {e}"))?;
        let state = Tensor::zero::<f32>(&[2, 1, 64])
            .map_err(|e| format!("silero state init failed: {e}"))?;
        Ok(Self { model, state })
    }

    fn predict(&mut self, samples: &[f32]) -> Result<f32, String> {
        if samples.len() != SILERO_CHUNK {
            return Err(format!(
                "silero expects {} samples, got {}",
                SILERO_CHUNK,
                samples.len()
            ));
        }
        let audio = tract_onnx::prelude::tract_ndarray::Array2::from_shape_vec(
            (1, SILERO_CHUNK),
            samples.to_vec(),
        )
        .map_err(|e| format!("silero audio tensor conversion failed: {e}"))?;
        let sr = tract_onnx::prelude::tract_ndarray::arr1(&[16_000i64]);
        let audio_tensor: Tensor = audio.into();
        let sr_tensor: Tensor = sr.into();
        let outputs = self
            .model
            .run(tvec![
                audio_tensor.into(),
                sr_tensor.into(),
                self.state.clone().into()
            ])
            .map_err(|e| format!("silero inference failed: {e}"))?;
        let prob = outputs[0]
            .to_array_view::<f32>()
            .map_err(|e| format!("silero output decode failed: {e}"))?
            .iter()
            .next()
            .copied()
            .unwrap_or(0.0);
        self.state = outputs[1].clone().into_tensor();
        Ok(prob)
    }
}

#[derive(Clone)]
pub struct SttService {
    hub: EventHub,
    shared: Arc<Mutex<SharedState>>,
    runtime: Arc<Mutex<RuntimeState>>,
}

impl SttService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            shared: Arc::new(Mutex::new(SharedState {
                state: "idle".to_string(),
                last_error: None,
                last_transcript: None,
                model_path: None,
                auto_submit: true,
                vad_threshold: DEFAULT_VAD_THRESHOLD,
                min_silence_ms: DEFAULT_MIN_SILENCE_MS,
            })),
            runtime: Arc::new(Mutex::new(RuntimeState {
                running: false,
                stop_flag: Arc::new(AtomicBool::new(false)),
                worker: None,
                whisper_ctx: Arc::new(Mutex::new(None)),
            })),
        }
    }

    pub fn status(
        &self,
        app: &tauri::AppHandle,
        request: SttStatusRequest,
    ) -> Result<SttStatusResponse, String> {
        let preferred_model = self
            .shared
            .lock()
            .map_err(|_| "stt shared lock poisoned".to_string())?
            .model_path
            .clone();
        let model_path = resolve_active_model_path(app, preferred_model.as_deref())?;
        {
            let mut shared = self
                .shared
                .lock()
                .map_err(|_| "stt shared lock poisoned".to_string())?;
            shared.model_path = Some(model_path.to_string_lossy().to_string());
        }
        let shared = self
            .shared
            .lock()
            .map_err(|_| "stt shared lock poisoned".to_string())?
            .clone();
        let running = self
            .runtime
            .lock()
            .map_err(|_| "stt runtime lock poisoned".to_string())?
            .running;

        let response = SttStatusResponse {
            correlation_id: request.correlation_id.clone(),
            engine: STT_ENGINE_ID.to_string(),
            ready: model_path.is_file(),
            running,
            state: shared.state,
            model_path: shared.model_path.unwrap_or_default(),
            auto_submit: shared.auto_submit,
            vad_threshold: shared.vad_threshold,
            min_silence_ms: shared.min_silence_ms,
            last_transcript: shared.last_transcript,
            reason: shared.last_error,
        };
        self.emit(
            request.correlation_id.as_str(),
            "stt.runtime.status",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "engine": response.engine,
                "ready": response.ready,
                "running": response.running,
                "state": response.state,
            }),
        );
        Ok(response)
    }

    pub fn start_listening(
        &self,
        app: &tauri::AppHandle,
        request: SttStartRequest,
    ) -> Result<SttStartResponse, String> {
        let preferred_model = self
            .shared
            .lock()
            .map_err(|_| "stt shared lock poisoned".to_string())?
            .model_path
            .clone();
        let model_path = resolve_active_model_path(app, preferred_model.as_deref())?;
        let silero_model_path = resolve_silero_model_path(app);
        let correlation_id = request.correlation_id.clone();

        let (vad_threshold, min_silence_ms, auto_submit) = {
            let mut shared = self
                .shared
                .lock()
                .map_err(|_| "stt shared lock poisoned".to_string())?;
            shared.vad_threshold = request
                .vad_threshold
                .unwrap_or(shared.vad_threshold)
                .clamp(0.05, 0.95);
            shared.min_silence_ms = request
                .min_silence_ms
                .unwrap_or(shared.min_silence_ms)
                .clamp(250, 5000);
            shared.auto_submit = request.auto_submit.unwrap_or(shared.auto_submit);
            shared.model_path = Some(model_path.to_string_lossy().to_string());
            shared.last_error = None;
            shared.state = "listening".to_string();
            (
                shared.vad_threshold,
                shared.min_silence_ms,
                shared.auto_submit,
            )
        };

        let (stop_flag, whisper_ctx) = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "stt runtime lock poisoned".to_string())?;
            if runtime.running {
                return Ok(SttStartResponse {
                    correlation_id,
                    started: false,
                    state: "listening".to_string(),
                });
            }
            runtime.running = true;
            runtime.stop_flag = Arc::new(AtomicBool::new(false));
            (Arc::clone(&runtime.stop_flag), Arc::clone(&runtime.whisper_ctx))
        };

        self.emit(
            request.correlation_id.as_str(),
            "stt.capture.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "engineId": STT_ENGINE_ID,
                "modelPath": model_path,
                "vadThreshold": vad_threshold,
                "minSilenceMs": min_silence_ms,
                "autoSubmit": auto_submit,
            }),
        );

        let hub = self.hub.clone();
        let shared = Arc::clone(&self.shared);
        let runtime = Arc::clone(&self.runtime);
        let corr = request.correlation_id.clone();
        let worker = std::thread::spawn(move || {
            let result = run_capture_loop(
                &hub,
                &shared,
                &whisper_ctx,
                stop_flag.as_ref(),
                corr.as_str(),
                model_path.as_path(),
                silero_model_path.as_deref(),
                vad_threshold,
                min_silence_ms,
                auto_submit,
            );
            if let Err(err) = result {
                if let Ok(mut shared_guard) = shared.lock() {
                    shared_guard.state = "error".to_string();
                    shared_guard.last_error = Some(err.clone());
                }
                hub.emit(hub.make_event(
                    corr.as_str(),
                    Subsystem::Runtime,
                    "stt.capture.error",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "message": err }),
                ));
            }
            if let Ok(mut runtime_guard) = runtime.lock() {
                runtime_guard.running = false;
            }
        });

        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "stt runtime lock poisoned".to_string())?;
            runtime.worker = Some(worker);
        }

        Ok(SttStartResponse {
            correlation_id: request.correlation_id,
            started: true,
            state: "listening".to_string(),
        })
    }

    pub fn list_models(
        &self,
        app: &tauri::AppHandle,
        request: SttListModelsRequest,
    ) -> Result<SttListModelsResponse, String> {
        let active_path = resolve_active_model_path(
            app,
            self.shared
                .lock()
                .map_err(|_| "stt shared lock poisoned".to_string())?
                .model_path
                .as_deref(),
        )?;
        let mut models = discover_stt_models(app, active_path.as_path())?;
        models.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(SttListModelsResponse {
            correlation_id: request.correlation_id,
            models,
        })
    }

    pub fn set_model(
        &self,
        request: SttSetModelRequest,
    ) -> Result<SttSetModelResponse, String> {
        let model_path = PathBuf::from(request.model_path.trim());
        if !model_path.is_file() {
            return Err(format!("stt model path does not exist: {}", model_path.display()));
        }
        {
            let mut shared = self
                .shared
                .lock()
                .map_err(|_| "stt shared lock poisoned".to_string())?;
            shared.model_path = Some(model_path.to_string_lossy().to_string());
            shared.last_error = None;
        }
        Ok(SttSetModelResponse {
            correlation_id: request.correlation_id,
            model_path: model_path.to_string_lossy().to_string(),
            applied: true,
        })
    }

    pub fn download_model(
        &self,
        app: &tauri::AppHandle,
        request: SttDownloadModelRequest,
    ) -> Result<SttDownloadModelResponse, String> {
        let whisper_dir = whisper_app_data_dir(app)?;
        let file_name = request
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| infer_filename_from_url(request.url.as_str()));
        let dest = whisper_dir.join(file_name);

        self.emit(
            request.correlation_id.as_str(),
            "stt.model.download",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "url": request.url, "dest": dest }),
        );

        download_to_file(request.url.as_str(), dest.as_path())?;

        {
            let mut shared = self
                .shared
                .lock()
                .map_err(|_| "stt shared lock poisoned".to_string())?;
            shared.model_path = Some(dest.to_string_lossy().to_string());
            shared.last_error = None;
        }

        let size_mb = dest
            .metadata()
            .ok()
            .map(|m| m.len() / (1024 * 1024))
            .unwrap_or(0);
        let model = SttModelRecord {
            id: dest.to_string_lossy().to_string(),
            name: dest
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("model")
                .to_string(),
            path: dest.to_string_lossy().to_string(),
            size_mb,
            is_active: true,
            is_bundled: false,
        };

        self.emit(
            request.correlation_id.as_str(),
            "stt.model.download",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "path": model.path, "sizeMb": model.size_mb }),
        );

        Ok(SttDownloadModelResponse {
            correlation_id: request.correlation_id,
            model,
        })
    }

    pub fn stop_listening(&self, request: SttStopRequest) -> Result<SttStopResponse, String> {
        let worker = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "stt runtime lock poisoned".to_string())?;
            if !runtime.running {
                return Ok(SttStopResponse {
                    correlation_id: request.correlation_id,
                    stopped: false,
                    state: "idle".to_string(),
                });
            }
            runtime.stop_flag.store(true, Ordering::SeqCst);
            runtime.running = false;
            runtime.worker.take()
        };
        if let Some(handle) = worker {
            let _ = handle.join();
        }
        if let Ok(mut shared) = self.shared.lock() {
            shared.state = "idle".to_string();
        }
        self.emit(
            request.correlation_id.as_str(),
            "stt.capture.complete",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "stopped": true }),
        );
        Ok(SttStopResponse {
            correlation_id: request.correlation_id,
            stopped: true,
            state: "idle".to_string(),
        })
    }

    fn emit(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Runtime,
            action,
            stage,
            severity,
            payload,
        ));
    }
}

impl Drop for SttService {
    fn drop(&mut self) {
        let _ = self.stop_listening(SttStopRequest {
            correlation_id: "stt-service-drop".to_string(),
        });
    }
}

fn ensure_model_deployed(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let whisper_dir = whisper_app_data_dir(app)?;
    let model_dest = whisper_dir.join(STT_MODEL_FILE);
    if model_dest.exists() {
        return Ok(model_dest);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?;
    let candidates = [
        resource_dir.join("resources/whisper").join(STT_MODEL_FILE),
        resource_dir.join("whisper").join(STT_MODEL_FILE),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("whisper")
            .join(STT_MODEL_FILE),
    ];
    let source = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("bundled whisper model not found ({STT_MODEL_FILE})"))?;
    std::fs::copy(&source, &model_dest)
        .map_err(|e| format!("failed copying whisper model into app data dir: {e}"))?;
    Ok(model_dest)
}

fn resolve_active_model_path(
    app: &tauri::AppHandle,
    preferred: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(p) = preferred {
        let path = PathBuf::from(p.trim());
        if path.is_file() {
            return Ok(path);
        }
    }
    ensure_model_deployed(app)
}

fn whisper_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let whisper_dir = app_data_dir.join("whisper");
    std::fs::create_dir_all(&whisper_dir)
        .map_err(|e| format!("failed creating whisper data dir: {e}"))?;
    Ok(whisper_dir)
}

fn discover_stt_models(app: &tauri::AppHandle, active_path: &Path) -> Result<Vec<SttModelRecord>, String> {
    let mut paths: Vec<(PathBuf, bool)> = Vec::new();
    let whisper_dir = whisper_app_data_dir(app)?;
    if let Ok(entries) = std::fs::read_dir(&whisper_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_whisper_model_file(path.as_path()) {
                paths.push((path, false));
            }
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate_dirs = [resource_dir.join("resources/whisper"), resource_dir.join("whisper")];
        for dir in candidate_dirs {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if is_whisper_model_file(path.as_path()) {
                        paths.push((path, true));
                    }
                }
            }
        }
    }
    let mut out: Vec<SttModelRecord> = Vec::new();
    for (path, bundled) in paths {
        let path_str = path.to_string_lossy().to_string();
        if out.iter().any(|m| m.path == path_str) {
            continue;
        }
        let size_mb = path.metadata().map(|m| m.len() / (1024 * 1024)).unwrap_or(0);
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("model")
            .to_string();
        out.push(SttModelRecord {
            id: path_str.clone(),
            name,
            path: path_str.clone(),
            size_mb,
            is_active: path == active_path,
            is_bundled: bundled,
        });
    }
    if !out.iter().any(|m| m.path == active_path.to_string_lossy()) && active_path.is_file() {
        out.push(SttModelRecord {
            id: active_path.to_string_lossy().to_string(),
            name: active_path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("model")
                .to_string(),
            path: active_path.to_string_lossy().to_string(),
            size_mb: active_path.metadata().map(|m| m.len() / (1024 * 1024)).unwrap_or(0),
            is_active: true,
            is_bundled: false,
        });
    }
    Ok(out)
}

fn is_whisper_model_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
        return false;
    };
    name.ends_with(".bin") || name.ends_with(".gguf")
}

fn infer_filename_from_url(url: &str) -> String {
    let without_query = url.split('?').next().unwrap_or(url);
    let fallback = STT_MODEL_FILE.to_string();
    without_query
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(fallback)
}

fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("stt download client init failed: {e}"))?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("stt model download request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("stt model download failed with status {}", response.status()));
    }
    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("failed creating stt model file at {}: {e}", dest.display()))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = response
            .read(&mut buf)
            .map_err(|e| format!("stt model download read failed: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("failed writing stt model file: {e}"))?;
    }
    Ok(())
}

fn resolve_silero_model_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidates = [
        resource_dir.join(format!("resources/{SILERO_MODEL_FILE}")),
        resource_dir.join(SILERO_MODEL_FILE),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(SILERO_MODEL_FILE),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn run_capture_loop(
    hub: &EventHub,
    shared: &Arc<Mutex<SharedState>>,
    whisper_ctx: &Arc<Mutex<Option<WhisperContext>>>,
    stop_flag: &AtomicBool,
    correlation_id: &str,
    model_path: &Path,
    silero_model_path: Option<&Path>,
    vad_threshold: f32,
    min_silence_ms: u32,
    auto_submit: bool,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device available".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("failed to read default input config: {e}"))?;
    let stream_config = config.config();
    let channels = stream_config.channels.max(1) as usize;
    let input_rate = stream_config.sample_rate.0.max(1);

    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let stream = build_capture_stream(&device, &stream_config, config.sample_format(), channels, tx)?;
    stream
        .play()
        .map_err(|e| format!("failed to start capture stream: {e}"))?;

    let mut silero = silero_model_path.and_then(|path| SileroVad::new(path).ok());
    let mut vad_mode = if silero.is_some() { "silero_onnx" } else { "amplitude" };
    hub.emit(hub.make_event(
        correlation_id,
        Subsystem::Runtime,
        "stt.vad.start",
        EventStage::Start,
        EventSeverity::Info,
        json!({ "vadMode": vad_mode }),
    ));
    hub.emit(hub.make_event(
        correlation_id,
        Subsystem::Runtime,
        "stt.capture.progress",
        EventStage::Progress,
        EventSeverity::Info,
        json!({ "state": "listening", "sampleRate": input_rate, "channels": channels }),
    ));

    let pre_roll_samples = ((input_rate as u64 * PRE_ROLL_MS as u64) / 1000) as usize;
    let silence_samples_threshold = ((input_rate as u64 * min_silence_ms as u64) / 1000) as usize;
    let max_samples = ((input_rate as u64 * MAX_UTTERANCE_MS as u64) / 1000) as usize;

    let mut pre_roll = VecDeque::<f32>::with_capacity(pre_roll_samples.saturating_mul(2));
    let mut silero_resampled = VecDeque::<f32>::new();
    let mut speech_active = false;
    let mut speech_buffer = Vec::<f32>::new();
    let mut trailing_silence = 0usize;
    let mut last_partial_emit = Instant::now();
    let mut last_partial_text = String::new();
    let mut last_vad_progress_emit = Instant::now();

    while !stop_flag.load(Ordering::SeqCst) {
        let chunk = match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => chunk,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("audio capture stream disconnected".to_string());
            }
        };
        if chunk.is_empty() {
            continue;
        }

        for sample in &chunk {
            pre_roll.push_back(*sample);
            if pre_roll.len() > pre_roll_samples {
                let _ = pre_roll.pop_front();
            }
        }

        let rms = compute_rms(chunk.as_slice());
        let mut speech_prob = 0.0f32;
        let mut had_silero_frame = false;
        if let Some(vad) = silero.as_mut() {
            let chunk_16k = resample_to_16k(chunk.as_slice(), input_rate);
            for sample in chunk_16k {
                silero_resampled.push_back(sample);
            }
            while silero_resampled.len() >= SILERO_CHUNK {
                had_silero_frame = true;
                let mut frame = vec![0.0f32; SILERO_CHUNK];
                for sample in &mut frame {
                    *sample = silero_resampled.pop_front().unwrap_or(0.0);
                }
                match vad.predict(frame.as_slice()) {
                    Ok(prob) => speech_prob = speech_prob.max(prob),
                    Err(err) => {
                        silero = None;
                        vad_mode = "amplitude";
                        hub.emit(hub.make_event(
                            correlation_id,
                            Subsystem::Runtime,
                            "stt.vad.error",
                            EventStage::Error,
                            EventSeverity::Warn,
                            json!({ "message": err, "fallback": "amplitude" }),
                        ));
                        break;
                    }
                }
            }
        }

        let speech = if silero.is_some() && had_silero_frame {
            speech_prob >= vad_threshold
        } else {
            rms >= AMPLITUDE_FALLBACK_THRESHOLD
        };

        if last_vad_progress_emit.elapsed() >= Duration::from_millis(VAD_PROGRESS_INTERVAL_MS) {
            hub.emit(hub.make_event(
                correlation_id,
                Subsystem::Runtime,
                "stt.vad.progress",
                EventStage::Progress,
                EventSeverity::Info,
                json!({ "speechProb": speech_prob, "rms": rms, "vadMode": vad_mode, "speech": speech }),
            ));
            last_vad_progress_emit = Instant::now();
        }

        if !speech_active && speech {
            speech_active = true;
            speech_buffer.clear();
            speech_buffer.extend(pre_roll.iter().copied());
            trailing_silence = 0;
            if let Ok(mut guard) = shared.lock() {
                guard.state = "speech_detected".to_string();
            }
            hub.emit(hub.make_event(
                correlation_id,
                Subsystem::Runtime,
                "stt.vad.progress",
                EventStage::Progress,
                EventSeverity::Info,
                json!({ "speechProb": speech_prob, "rms": rms, "vadMode": vad_mode }),
            ));
        }

        if speech_active {
            speech_buffer.extend(chunk.iter().copied());
            if speech {
                trailing_silence = 0;
            } else {
                trailing_silence = trailing_silence.saturating_add(chunk.len());
            }
            if last_partial_emit.elapsed() >= Duration::from_millis(PARTIAL_TRANSCRIBE_INTERVAL_MS)
                && speech_buffer.len()
                    >= ((input_rate as u64 * PARTIAL_MIN_SPEECH_MS as u64) / 1000) as usize
            {
                let partial = transcribe_partial(whisper_ctx, model_path, speech_buffer.as_slice(), input_rate);
                if let Some(text) = partial {
                    let normalized = text.trim().to_string();
                    if !normalized.is_empty() && normalized != last_partial_text {
                        hub.emit(hub.make_event(
                            correlation_id,
                            Subsystem::Runtime,
                            "stt.transcript.partial",
                            EventStage::Progress,
                            EventSeverity::Info,
                            json!({ "text": normalized }),
                        ));
                        last_partial_text = normalized;
                    }
                }
                last_partial_emit = Instant::now();
            }
            let reached_silence = trailing_silence >= silence_samples_threshold;
            let reached_max = speech_buffer.len() >= max_samples;
            if reached_silence || reached_max {
                let utterance = speech_buffer.clone();
                speech_buffer.clear();
                speech_active = false;
                trailing_silence = 0;
                last_partial_text.clear();
                if utterance.len() > ((input_rate as usize) / 8) {
                    transcribe_and_emit(
                        hub,
                        shared,
                        whisper_ctx,
                        correlation_id,
                        model_path,
                        utterance.as_slice(),
                        input_rate,
                        auto_submit,
                    );
                }
                if let Ok(mut guard) = shared.lock() {
                    guard.state = "listening".to_string();
                }
            }
        }
    }

    drop(stream);
    if let Ok(mut guard) = shared.lock() {
        guard.state = "idle".to_string();
    }
    Ok(())
}

fn transcribe_partial(
    whisper_ctx: &Arc<Mutex<Option<WhisperContext>>>,
    model_path: &Path,
    utterance: &[f32],
    input_rate: u32,
) -> Option<String> {
    let pcm_16k = resample_to_16k(utterance, input_rate);
    if pcm_16k.is_empty() {
        return None;
    }
    let text = transcribe_samples(whisper_ctx, model_path, pcm_16k.as_slice()).ok()?;
    let normalized = sanitize_transcript(text.as_str());
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn transcribe_and_emit(
    hub: &EventHub,
    shared: &Arc<Mutex<SharedState>>,
    whisper_ctx: &Arc<Mutex<Option<WhisperContext>>>,
    correlation_id: &str,
    model_path: &Path,
    utterance: &[f32],
    input_rate: u32,
    auto_submit: bool,
) {
    if let Ok(mut guard) = shared.lock() {
        guard.state = "transcribing".to_string();
    }
    hub.emit(hub.make_event(
        correlation_id,
        Subsystem::Runtime,
        "stt.transcribe.start",
        EventStage::Start,
        EventSeverity::Info,
        json!({ "samples": utterance.len(), "inputSampleRate": input_rate }),
    ));

    let pcm_16k = resample_to_16k(utterance, input_rate);
    match transcribe_samples(whisper_ctx, model_path, pcm_16k.as_slice()) {
        Ok(text) => {
            let normalized = sanitize_transcript(text.as_str());
            if normalized.is_empty() {
                hub.emit(hub.make_event(
                    correlation_id,
                    Subsystem::Runtime,
                    "stt.transcript.ignored",
                    EventStage::Complete,
                    EventSeverity::Info,
                    json!({ "reason": "non_speech_or_empty" }),
                ));
                hub.emit(hub.make_event(
                    correlation_id,
                    Subsystem::Runtime,
                    "stt.transcribe.complete",
                    EventStage::Complete,
                    EventSeverity::Info,
                    json!({ "textLength": 0 }),
                ));
                if let Ok(mut guard) = shared.lock() {
                    guard.state = "listening".to_string();
                }
                return;
            }
            if let Ok(mut guard) = shared.lock() {
                guard.last_transcript = Some(normalized.clone());
                guard.last_error = None;
                guard.state = "listening".to_string();
            }
            hub.emit(hub.make_event(
                correlation_id,
                Subsystem::Runtime,
                "stt.transcribe.complete",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "textLength": normalized.len() }),
            ));
            hub.emit(hub.make_event(
                correlation_id,
                Subsystem::Runtime,
                "stt.transcript.final",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "text": normalized, "autoSubmit": auto_submit }),
            ));
        }
        Err(err) => {
            if let Ok(mut guard) = shared.lock() {
                guard.last_error = Some(err.clone());
                guard.state = "listening".to_string();
            }
            hub.emit(hub.make_event(
                correlation_id,
                Subsystem::Runtime,
                "stt.transcribe.error",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "message": err }),
            ));
        }
    }
}

fn sanitize_transcript(raw: &str) -> String {
    let mut without_brackets = String::with_capacity(raw.len());
    let mut in_brackets = false;
    for ch in raw.chars() {
        if ch == '[' {
            in_brackets = true;
            continue;
        }
        if in_brackets {
            if ch == ']' {
                in_brackets = false;
            }
            continue;
        }
        without_brackets.push(ch);
    }
    let collapsed = without_brackets
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = collapsed.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let artifact_key = normalized
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .to_ascii_lowercase();
    if matches!(
        artifact_key.as_str(),
        "blank_audio"
            | "blankaudio"
            | "silence"
            | "noise"
            | "music"
            | "inaudible"
            | "unknown"
    ) {
        return String::new();
    }
    if !normalized.chars().any(|c| c.is_alphanumeric()) {
        return String::new();
    }
    normalized.to_string()
}

fn transcribe_samples(
    whisper_ctx: &Arc<Mutex<Option<WhisperContext>>>,
    model_path: &Path,
    pcm_16k: &[f32],
) -> Result<String, String> {
    let mut guard = whisper_ctx
        .lock()
        .map_err(|_| "whisper context lock poisoned".to_string())?;
    if guard.is_none() {
        let model = WhisperContext::new_with_params(
            model_path
                .to_str()
                .ok_or_else(|| "invalid model path".to_string())?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("failed loading whisper model: {e}"))?;
        *guard = Some(model);
    }
    let context = guard
        .as_ref()
        .ok_or_else(|| "whisper context unavailable".to_string())?;
    let mut state = context
        .create_state()
        .map_err(|e| format!("failed creating whisper state: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(STT_LANGUAGE));
    params.set_translate(false);
    params.set_n_threads(4);
    state
        .full(params, pcm_16k)
        .map_err(|e| format!("whisper transcription failed: {e}"))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("failed to query whisper segments: {e}"))?;
    let mut output = String::new();
    for i in 0..num_segments {
        let segment = state
            .full_get_segment_text(i)
            .map_err(|e| format!("failed to read whisper segment: {e}"))?;
        output.push_str(segment.as_str());
    }
    Ok(output.trim().to_string())
}

fn resample_to_16k(input: &[f32], input_rate: u32) -> Vec<f32> {
    if input.is_empty() || input_rate == 0 {
        return Vec::new();
    }
    if input_rate == 16_000 {
        return input.to_vec();
    }
    let ratio = 16_000.0f32 / input_rate as f32;
    let out_len = (input.len() as f32 * ratio).max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f32 / ratio;
        let left = src.floor() as usize;
        let right = (left + 1).min(input.len().saturating_sub(1));
        let frac = src - left as f32;
        out.push(input[left] * (1.0 - frac) + input[right] * frac);
    }
    out
}

fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

fn build_capture_stream(
    device: &cpal::Device,
    stream_config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    tx: mpsc::Sender<Vec<f32>>,
) -> Result<cpal::Stream, String> {
    let err_fn = move |err| {
        eprintln!("stt input stream error: {err}");
    };
    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                stream_config,
                move |data: &[f32], _| {
                    let _ = tx.send(interleaved_to_mono_f32(data, channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string()),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                stream_config,
                move |data: &[i16], _| {
                    let converted: Vec<f32> =
                        data.iter().map(|v| *v as f32 / i16::MAX as f32).collect();
                    let _ = tx.send(interleaved_to_mono_f32(converted.as_slice(), channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string()),
        cpal::SampleFormat::U16 => device
            .build_input_stream(
                stream_config,
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|v| (*v as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    let _ = tx.send(interleaved_to_mono_f32(converted.as_slice(), channels));
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string()),
        _ => Err(format!("unsupported input sample format: {sample_format:?}")),
    }
}

fn interleaved_to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    let frames = data.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for frame in 0..frames {
        let mut sum = 0.0f32;
        for channel in 0..channels {
            sum += data[frame * channels + channel];
        }
        out.push(sum / channels as f32);
    }
    out
}
