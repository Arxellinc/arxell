#![cfg(feature = "tauri-runtime")]

use crate::app_paths;
use crate::contracts::{
    AppEvent, EventSeverity, EventStage, Subsystem, TtsListVoicesRequest, TtsListVoicesResponse, TtsSelfTestRequest,
    TtsSelfTestResponse, TtsSettingsGetRequest, TtsSettingsGetResponse, TtsSettingsSetRequest,
    TtsSettingsSetResponse, TtsSpeakRequest, TtsSpeakResponse, TtsSpeakStreamResponse,
    TtsStatusRequest, TtsStatusResponse, TtsStopRequest, TtsStopResponse,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsMatchaModelConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

mod kokoro_frontend;
mod kokoro_ort;
mod kokoro_voice;
mod phonemizer;
use kokoro_ort::{init_onnxruntime, synthesize_phonemes};
use phonemizer::{EspeakPhonemizer, Phonemizer};

const DEFAULT_VOICE: &str = "af_heart";
const DEFAULT_SPEED: f32 = 1.0;
const DEFAULT_PROVIDER: &str = "cpu";
const DEFAULT_ENGINE: &str = "kokoro";
const DEFAULT_NUM_THREADS: i32 = 4;
const MAX_NUM_THREADS: i32 = 4;

#[derive(Clone)]
pub struct TTSState {
    engine: Arc<Mutex<HashMap<String, SherpaEngine>>>,
    phonemizer: Arc<Mutex<Option<EspeakPhonemizer>>>,
    active_streams: Arc<Mutex<Vec<tokio::task::AbortHandle>>>,
}

impl TTSState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(HashMap::new())),
            phonemizer: Arc::new(Mutex::new(None)),
            active_streams: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.engine.lock() {
            guard.clear();
        }
        if let Ok(mut guard) = self.active_streams.lock() {
            for handle in guard.drain(..) {
                handle.abort();
            }
        }
    }

    fn register_stream(&self, handle: tokio::task::AbortHandle) {
        if let Ok(mut guard) = self.active_streams.lock() {
            guard.push(handle);
        }
    }

    fn unregister_stream(&self, handle: &tokio::task::AbortHandle) {
        if let Ok(mut guard) = self.active_streams.lock() {
            guard.retain(|h| !h.is_finished() && !std::ptr::eq(h, handle));
        }
    }

    fn get_or_create_phonemizer(&self, resources_dir: &Path) -> Result<EspeakPhonemizer, String> {
        {
            let guard = self.phonemizer.lock().map_err(|e| format!("phonemizer lock: {e}"))?;
            if let Some(ref p) = *guard {
                return Ok(p.clone());
            }
        }
        let phonemizer = EspeakPhonemizer::new(resources_dir)?;
        {
            let mut guard = self.phonemizer.lock().map_err(|e| format!("phonemizer lock: {e}"))?;
            *guard = Some(phonemizer.clone());
        }
        Ok(phonemizer)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PersistedTtsSettings {
    #[serde(default = "default_engine")]
    engine: String,
    voice: String,
    speed: f32,
    #[serde(default)]
    engine_settings: HashMap<String, PersistedEnginePaths>,
    provider: Option<String>,
    num_threads: Option<u32>,
    #[serde(default, skip_serializing)]
    model_path: Option<String>,
    #[serde(default, skip_serializing)]
    secondary_path: Option<String>,
    #[serde(default, skip_serializing)]
    voices_path: Option<String>,
    #[serde(default, skip_serializing)]
    tokens_path: Option<String>,
    #[serde(default, skip_serializing)]
    data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedEnginePaths {
    model_path: Option<String>,
    secondary_path: Option<String>,
    voices_path: Option<String>,
    tokens_path: Option<String>,
    data_dir: Option<String>,
}

impl Default for PersistedTtsSettings {
    fn default() -> Self {
        Self {
            engine: default_engine(),
            voice: DEFAULT_VOICE.to_string(),
            speed: DEFAULT_SPEED,
            engine_settings: HashMap::new(),
            provider: Some(DEFAULT_PROVIDER.to_string()),
            num_threads: None,
            model_path: None,
            secondary_path: None,
            voices_path: None,
            tokens_path: None,
            data_dir: None,
        }
    }
}

fn default_engine() -> String {
    DEFAULT_ENGINE.to_string()
}

#[derive(Debug, Clone)]
struct KokoroPaths {
    app_data_dir: PathBuf,
    kokoro_dir: PathBuf,
    model_path: Option<PathBuf>,
    voices_path: Option<PathBuf>,
    tokens_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    dict_dir: Option<PathBuf>,
    lexicon_us_path: Option<PathBuf>,
    lexicon_zh_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct EngineSignature {
    engine: TtsEngine,
    model_path: String,
    voices_path: String,
    tokens_path: String,
    data_dir: String,
    dict_dir: Option<String>,
    lexicon: Option<String>,
    provider: String,
    num_threads: i32,
}

struct SherpaEngine {
    runtime: RuntimeEngine,
    signature: EngineSignature,
    voices: Vec<String>,
}

enum RuntimeEngine {
    Sherpa(OfflineTts),
}

#[derive(Debug, Clone)]
struct SpeakResult {
    audio_bytes: Vec<u8>,
    sample_rate: u32,
    duration_ms: u32,
}

#[derive(Debug, Clone, Copy)]
struct SpeakWorkerTiming {
    engine_prepare_ms: u128,
    synthesis_ms: u128,
    wav_encode_ms: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TtsEngine {
    Kokoro,
    Piper,
    Matcha,
    Kitten,
}

impl TtsEngine {
    fn from_str(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "piper" => Self::Piper,
            "matcha" => Self::Matcha,
            "kitten" | "kittentts" => Self::Kitten,
            _ => Self::Kokoro,
        }
    }

    fn as_key(self) -> &'static str {
        match self {
            Self::Kokoro => "kokoro",
            Self::Piper => "piper",
            Self::Matcha => "matcha",
            Self::Kitten => "kitten",
        }
    }

    fn as_engine_id(self) -> &'static str {
        match self {
            Self::Kokoro => "kokoro",
            Self::Piper => "sherpa-piper",
            Self::Matcha => "sherpa-matcha",
            Self::Kitten => "sherpa-kitten",
        }
    }
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tts-settings.json")
}

fn load_settings(app_data_dir: &Path) -> PersistedTtsSettings {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return PersistedTtsSettings::default();
    }
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<PersistedTtsSettings>(&raw).unwrap_or_default(),
        Err(_) => PersistedTtsSettings::default(),
    }
}

fn save_settings(app_data_dir: &Path, settings: &PersistedTtsSettings) -> Result<(), String> {
    let path = settings_path(app_data_dir);
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed serializing tts settings: {e}"))?;
    fs::write(path, format!("{payload}\n")).map_err(|e| format!("failed saving tts settings: {e}"))
}

fn emit_tts_event(
    app: &AppHandle,
    correlation_id: &str,
    action: &str,
    stage: EventStage,
    severity: EventSeverity,
    payload: serde_json::Value,
) {
    let event = AppEvent {
        timestamp_ms: now_ms(),
        correlation_id: correlation_id.to_string(),
        subsystem: Subsystem::Runtime,
        action: action.to_string(),
        stage,
        severity,
        payload,
    };
    let _ = app.emit("app:event", event);
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn resolve_resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(rd) = app.path().resource_dir().ok() {
        if rd.join("kokoro").join("config.json").is_file() || rd.join("espeak-ng").join("bin").is_file() {
            return Ok(rd);
        }
    }
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let manifest_resources = PathBuf::from(&manifest_dir).join("resources");
    if manifest_resources.join("kokoro").join("config.json").is_file() {
        return Ok(manifest_resources);
    }
    app.path()
        .resource_dir()
        .map(|rd| rd)
        .map_err(|e| format!("failed resolving app resources dir: {e}"))
}

fn ensure_assets(_app: &AppHandle) -> Result<KokoroPaths, String> {
    let app_data_dir = app_paths::app_data_dir();
    let kokoro_dir = app_data_dir.join("kokoro");
    fs::create_dir_all(&kokoro_dir).map_err(|e| format!("failed creating kokoro dir: {e}"))?;

    let settings = load_settings(&app_data_dir);
    let mut resolved = resolve_paths_for_settings(
        app_data_dir,
        kokoro_dir,
        &settings,
    );

    let resources_dir = resolve_resources_dir(_app).ok();

    if resolved.model_path.is_none() {
        resolved.model_path = bundled_kokoro_model_path(_app);
    }
    if resolved.voices_path.is_none() {
        if let Some(ref rd) = resources_dir {
            resolved.voices_path = find_voice_bin_in_dir(&rd.join("kokoro"));
        }
    }

    log::info!(
        "[tts] resolved paths — model: {:?}, voices: {:?}, tokens: {:?}, data_dir: {:?}, \
         resources_dir: {:?}",
        resolved.model_path,
        resolved.voices_path,
        resolved.tokens_path,
        resolved.data_dir,
        resources_dir,
    );

    Ok(resolved)
}

fn bundled_kokoro_model_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    [
        resource_dir.join("kokoro").join("model_quantized.onnx"),
        resource_dir.join("kokoro-runtime").join("model_quantized.onnx"),
        resource_dir.join("kokoro-runtime").join("onnx").join("model_quantized.onnx"),
        resource_dir.join("kokoro-runtime").join("model_q8f16.onnx"),
        resource_dir.join("kokoro-runtime").join("onnx").join("model_q8f16.onnx"),
        PathBuf::from(&manifest_dir).join("resources").join("kokoro").join("model_quantized.onnx"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn bundled_ort_library_path(resources_dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    let candidates = [
        resources_dir.join("onnxruntime").join("linux-x64").join("libonnxruntime.so"),
        resources_dir.join("onnxruntime").join("linux-x64").join("libonnxruntime.so.1"),
        resources_dir.join("onnxruntime").join("linux-x64").join("libonnxruntime.so.1.20.1"),
    ];
    #[cfg(target_os = "macos")]
    let candidates = [resources_dir.join("onnxruntime").join("macos").join("libonnxruntime.dylib")];
    #[cfg(target_os = "windows")]
    let candidates = [resources_dir.join("onnxruntime").join("win-x64").join("onnxruntime.dll")];
    candidates.into_iter().find(|path| path.is_file())
}

fn first_existing_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn first_existing_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_dir()).cloned()
}

fn find_voice_bin_in_dir(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut named_match: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        if lower == "voices.bin" {
            return Some(path);
        }
        if lower.ends_with(".bin")
            && (lower.starts_with("voices")
                || lower.contains("voice")
                || lower == "af_heart.bin"
                || lower == "af.bin")
        {
            named_match = Some(path);
        }
    }
    named_match
}

fn recursive_find_voice_bin(root: &Path, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    if let Some(found) = find_voice_bin_in_dir(root) {
        return Some(found);
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = recursive_find_voice_bin(&path, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn recursive_find_file_named(root: &Path, file_name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
            {
                return Some(path);
            }
            continue;
        }
        if path.is_dir() {
            if let Some(found) = recursive_find_file_named(&path, file_name, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn recursive_find_file_with_ext(root: &Path, ext: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(ext))
                .unwrap_or(false)
            {
                return Some(path);
            }
            continue;
        }
        if path.is_dir() {
            if let Some(found) = recursive_find_file_with_ext(&path, ext, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn recursive_find_dir_named(root: &Path, dir_name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(dir_name))
            .unwrap_or(false)
        {
            return Some(path);
        }
        if let Some(found) = recursive_find_dir_named(&path, dir_name, max_depth - 1) {
            return Some(found);
        }
    }
    None
}

fn recursive_collect_files_named(
    root: &Path,
    file_names: &[&str],
    max_depth: usize,
    out: &mut BTreeSet<PathBuf>,
) {
    if max_depth == 0 || !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let matches = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|name| {
                    file_names
                        .iter()
                        .any(|candidate| name.eq_ignore_ascii_case(candidate))
                })
                .unwrap_or(false);
            if matches {
                out.insert(path);
            }
            continue;
        }
        if path.is_dir() {
            recursive_collect_files_named(&path, file_names, max_depth - 1, out);
        }
    }
}

fn recursive_collect_files_with_ext(
    root: &Path,
    ext: &str,
    max_depth: usize,
    out: &mut BTreeSet<PathBuf>,
) {
    if max_depth == 0 || !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let matches = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(ext))
                .unwrap_or(false);
            if matches {
                out.insert(path);
            }
            continue;
        }
        if path.is_dir() {
            recursive_collect_files_with_ext(&path, ext, max_depth - 1, out);
        }
    }
}

fn canonicalize_piper_model_path(model_path: PathBuf, engine_dir: &Path) -> PathBuf {
    let Some(parent) = model_path.parent() else {
        return model_path;
    };
    let is_root_piper_model = parent == engine_dir
        && model_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("model.onnx"))
            .unwrap_or(false);
    if !is_root_piper_model {
        return model_path;
    }
    let base_model = engine_dir.join("base").join("model.onnx");
    if base_model.is_file() {
        base_model
    } else {
        model_path
    }
}

fn discover_available_model_paths(
    paths: &KokoroPaths,
    settings: &PersistedTtsSettings,
) -> Vec<String> {
    let engine = resolve_engine(settings);
    let engine_dir = paths.kokoro_dir.join(engine.as_key());
    let tts_engine_dir = paths.app_data_dir.join("tts").join(engine.as_key());
    let file_names: &[&str] = match engine {
        TtsEngine::Kokoro => &[
            "model.int8.onnx",
            "kokoro-v0_19.int8.onnx",
            "model.onnx",
            "model_quantized.onnx",
        ],
        TtsEngine::Piper | TtsEngine::Matcha => &["model.onnx"],
        TtsEngine::Kitten => &["model.fp16.onnx"],
    };
    let mut found = BTreeSet::new();
    if let Some(model_path) = active_engine_paths(settings)
        .model_path
        .filter(|path| !path.trim().is_empty())
    {
        let path = PathBuf::from(model_path);
        found.insert(if matches!(engine, TtsEngine::Piper) {
            canonicalize_piper_model_path(path, &engine_dir)
        } else {
            path
        });
    }
    for root in [&tts_engine_dir, &engine_dir] {
        if matches!(engine, TtsEngine::Piper) {
            recursive_collect_files_with_ext(root, "onnx", 4, &mut found);
        } else {
            recursive_collect_files_named(root, file_names, 4, &mut found);
        }
    }
    if matches!(engine, TtsEngine::Piper) {
        let nested_models: BTreeSet<PathBuf> = found
            .iter()
            .filter(|path| {
                path.parent()
                    .map(|parent| parent != engine_dir)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if !nested_models.is_empty() {
            found = nested_models;
        }
        found = found
            .into_iter()
            .map(|path| canonicalize_piper_model_path(path, &engine_dir))
            .collect();
    }
    found
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn model_parent_dir(model_path: Option<&str>) -> Option<PathBuf> {
    let model = model_path?.trim();
    if model.is_empty() {
        return None;
    }
    let model_path = PathBuf::from(model);
    model_path.parent().map(Path::to_path_buf)
}

fn companion_file_from_model_dirs(
    model_path: Option<&str>,
    candidate_names: &[&str],
) -> Option<PathBuf> {
    let model_dir = model_parent_dir(model_path)?;
    let mut candidates: Vec<PathBuf> = candidate_names
        .iter()
        .map(|name| model_dir.join(name))
        .collect();
    if let Some(parent) = model_dir.parent() {
        candidates.extend(candidate_names.iter().map(|name| parent.join(name)));
    }
    first_existing_file(&candidates)
}

fn companion_dir_from_model_dirs(
    model_path: Option<&str>,
    candidate_names: &[&str],
) -> Option<PathBuf> {
    let model_dir = model_parent_dir(model_path)?;
    let mut candidates: Vec<PathBuf> = candidate_names
        .iter()
        .map(|name| model_dir.join(name))
        .collect();
    if let Some(parent) = model_dir.parent() {
        candidates.extend(candidate_names.iter().map(|name| parent.join(name)));
    }
    first_existing_dir(&candidates)
}

fn discovered_model_candidates(
    engine: TtsEngine,
    tts_engine_dir: &Path,
    engine_dir: &Path,
) -> Option<PathBuf> {
    match engine {
        TtsEngine::Piper => recursive_find_file_with_ext(tts_engine_dir, "onnx", 4)
            .or_else(|| recursive_find_file_with_ext(engine_dir, "onnx", 4)),
        TtsEngine::Kokoro => recursive_find_file_named(tts_engine_dir, "model.int8.onnx", 4)
            .or_else(|| recursive_find_file_named(tts_engine_dir, "kokoro-v0_19.int8.onnx", 4))
            .or_else(|| recursive_find_file_named(tts_engine_dir, "model.onnx", 4))
            .or_else(|| recursive_find_file_named(tts_engine_dir, "model_quantized.onnx", 4))
            .or_else(|| recursive_find_file_named(engine_dir, "model.int8.onnx", 4))
            .or_else(|| recursive_find_file_named(engine_dir, "kokoro-v0_19.int8.onnx", 4))
            .or_else(|| recursive_find_file_named(engine_dir, "model.onnx", 4))
            .or_else(|| recursive_find_file_named(engine_dir, "model_quantized.onnx", 4)),
        TtsEngine::Matcha => recursive_find_file_named(tts_engine_dir, "model.onnx", 4)
            .or_else(|| recursive_find_file_named(engine_dir, "model.onnx", 4)),
        TtsEngine::Kitten => recursive_find_file_named(tts_engine_dir, "model.fp16.onnx", 4)
            .or_else(|| recursive_find_file_named(engine_dir, "model.fp16.onnx", 4)),
    }
}

fn resolve_paths_for_settings(
    app_data_dir: PathBuf,
    kokoro_dir: PathBuf,
    settings: &PersistedTtsSettings,
) -> KokoroPaths {
    let engine = resolve_engine(settings);
    let engine_dir = kokoro_dir.join(engine.as_key());
    let tts_engine_dir = app_data_dir.join("tts").join(engine.as_key());
    let engine_paths = active_engine_paths(settings);
    let configured_voices_path = engine_paths
        .secondary_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            engine_paths
                .voices_path
                .as_ref()
                .map(PathBuf::from)
                .filter(|path| path.is_file())
        });
    let auto_voices_from_model_dir = model_parent_dir(engine_paths.model_path.as_deref())
        .and_then(|dir| find_voice_bin_in_dir(&dir));
    let auto_voices_path = companion_file_from_model_dirs(
        engine_paths.model_path.as_deref(),
        &["voices.bin", "af_heart.bin", "af.bin"],
    );
    let voices_path = if matches!(engine, TtsEngine::Kokoro) {
        configured_voices_path
            .or(auto_voices_path)
            .or(auto_voices_from_model_dir)
            .or_else(|| {
                first_existing_file(&[
                    kokoro_dir.join("voices.bin"),
                    kokoro_dir.join("af_heart.bin"),
                    kokoro_dir.join("af.bin"),
                ])
            })
            .or_else(|| recursive_find_file_named(&kokoro_dir, "voices.bin", 4))
            .or_else(|| recursive_find_voice_bin(&tts_engine_dir, 4))
            .or_else(|| recursive_find_voice_bin(&engine_dir, 4))
            .or_else(|| recursive_find_voice_bin(&kokoro_dir, 4))
    } else {
        configured_voices_path
            .or(auto_voices_path)
            .or(auto_voices_from_model_dir)
    };
    let prefer_v019 = voices_path
        .as_ref()
        .and_then(|p| file_size(p))
        .map(|len| len < 15 * 1024 * 1024)
        .unwrap_or(false);
    let model_candidates = match engine {
        TtsEngine::Kokoro => {
            if prefer_v019 {
                vec![
                    kokoro_dir.join("kokoro-v0_19.int8.onnx"),
                    kokoro_dir.join("model.int8.onnx"),
                    kokoro_dir.join("model.onnx"),
                    kokoro_dir.join("model_quantized.onnx"),
                ]
            } else {
                vec![
                    kokoro_dir.join("model.int8.onnx"),
                    kokoro_dir.join("kokoro-v0_19.int8.onnx"),
                    kokoro_dir.join("model.onnx"),
                    kokoro_dir.join("model_quantized.onnx"),
                ]
            }
        }
        TtsEngine::Piper => vec![
            tts_engine_dir.join("model.onnx"),
            engine_dir.join("model.onnx"),
        ],
        TtsEngine::Matcha => vec![
            tts_engine_dir.join("model.onnx"),
            engine_dir.join("model.onnx"),
        ],
        TtsEngine::Kitten => vec![
            tts_engine_dir.join("model.fp16.onnx"),
            engine_dir.join("model.fp16.onnx"),
        ],
    };
    let configured_model_path = engine_paths
        .model_path
        .as_ref()
        .map(PathBuf::from)
        .map(|path| {
            if matches!(engine, TtsEngine::Piper) {
                canonicalize_piper_model_path(path, &engine_dir)
            } else {
                path
            }
        })
        .filter(|path| path.is_file());
    let model_path = configured_model_path.or_else(|| {
        first_existing_file(&model_candidates)
            .or_else(|| discovered_model_candidates(engine, &tts_engine_dir, &engine_dir))
    });
    let model_path_for_companions = model_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let token_file_names: &[&str] = if matches!(engine, TtsEngine::Kokoro) {
        &["tokenizer.json", "tokens.txt"]
    } else {
        &["tokens.txt"]
    };
    let tokens_path = engine_paths
        .tokens_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            companion_file_from_model_dirs(model_path_for_companions.as_deref(), token_file_names)
        })
        .or_else(|| {
            first_existing_file(&[
                tts_engine_dir.join(token_file_names[0]),
                engine_dir.join(token_file_names[0]),
                kokoro_dir.join(token_file_names[0]),
            ])
            .or_else(|| {
                recursive_find_file_named(&tts_engine_dir, token_file_names[0], 4)
                    .or_else(|| recursive_find_file_named(&engine_dir, token_file_names[0], 4))
                    .or_else(|| recursive_find_file_named(&kokoro_dir, token_file_names[0], 4))
            })
        });
    let data_dir = engine_paths
        .data_dir
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| {
            companion_dir_from_model_dirs(model_path_for_companions.as_deref(), &["espeak-ng-data"])
        })
        .or_else(|| {
            first_existing_dir(&[
                tts_engine_dir.join("espeak-ng-data"),
                engine_dir.join("espeak-ng-data"),
                app_data_dir
                    .join("tts")
                    .join("shared")
                    .join("espeak-ng-data"),
                kokoro_dir.join("espeak-ng-data"),
            ])
            .or_else(|| recursive_find_dir_named(&tts_engine_dir, "espeak-ng-data", 4))
            .or_else(|| recursive_find_dir_named(&engine_dir, "espeak-ng-data", 4))
            .or_else(|| recursive_find_dir_named(&kokoro_dir, "espeak-ng-data", 4))
        });
    let dict_dir = companion_dir_from_model_dirs(model_path_for_companions.as_deref(), &["dict"])
        .or_else(|| first_existing_dir(&[kokoro_dir.join("dict")]));
    let lexicon_us_path = companion_file_from_model_dirs(
        model_path_for_companions.as_deref(),
        &["lexicon-us-en.txt"],
    )
    .or_else(|| first_existing_file(&[kokoro_dir.join("lexicon-us-en.txt")]));
    let lexicon_zh_path =
        companion_file_from_model_dirs(model_path_for_companions.as_deref(), &["lexicon-zh.txt"])
            .or_else(|| first_existing_file(&[kokoro_dir.join("lexicon-zh.txt")]));

    KokoroPaths {
        app_data_dir,
        kokoro_dir,
        model_path,
        voices_path,
        tokens_path,
        data_dir,
        dict_dir,
        lexicon_us_path,
        lexicon_zh_path,
    }
}

fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|m| m.len())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

fn path_lower(path: &str) -> String {
    path.to_lowercase()
}

fn has_ext(path: &str, ext: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

fn file_contains_bytes(path: &Path, needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut carry: Vec<u8> = Vec::new();

    loop {
        let Ok(read_len) = reader.read(&mut buffer) else {
            return false;
        };
        if read_len == 0 {
            return false;
        }

        let chunk = &buffer[..read_len];
        if carry.is_empty() {
            if chunk.windows(needle.len()).any(|window| window == needle) {
                return true;
            }
        } else {
            let mut joined = Vec::with_capacity(carry.len() + chunk.len());
            joined.extend_from_slice(&carry);
            joined.extend_from_slice(chunk);
            if joined.windows(needle.len()).any(|window| window == needle) {
                return true;
            }
        }

        if needle.len() > 1 {
            let keep = needle.len() - 1;
            if read_len >= keep {
                carry.clear();
                carry.extend_from_slice(&chunk[read_len - keep..]);
            } else {
                let needed_prefix = keep.saturating_sub(read_len);
                let mut next_carry = Vec::with_capacity(keep);
                if carry.len() > needed_prefix {
                    next_carry.extend_from_slice(&carry[carry.len() - needed_prefix..]);
                } else {
                    next_carry.extend_from_slice(&carry);
                }
                next_carry.extend_from_slice(chunk);
                carry = next_carry;
            }
        }
    }
}

fn normalize_speed(speed: f32) -> f32 {
    if !speed.is_finite() {
        return DEFAULT_SPEED;
    }
    speed.clamp(0.5, 2.0)
}

fn stream_sample_rate_hint(engine: TtsEngine) -> u32 {
    match engine {
        TtsEngine::Piper => 22_050,
        TtsEngine::Kokoro | TtsEngine::Matcha | TtsEngine::Kitten => 24_000,
    }
}

fn normalize_provider(provider: Option<&str>) -> String {
    let normalized = provider.unwrap_or(DEFAULT_PROVIDER).trim().to_lowercase();
    if normalized.is_empty() {
        DEFAULT_PROVIDER.to_string()
    } else {
        normalized
    }
}

fn normalize_num_threads(num_threads: Option<u32>) -> i32 {
    match num_threads {
        Some(value) if value > 0 => (value as i32).clamp(1, MAX_NUM_THREADS),
        _ => DEFAULT_NUM_THREADS,
    }
}

fn resolve_engine(settings: &PersistedTtsSettings) -> TtsEngine {
    TtsEngine::from_str(settings.engine.as_str())
}

fn active_engine_paths(settings: &PersistedTtsSettings) -> PersistedEnginePaths {
    let engine = resolve_engine(settings);
    let engine_key = engine.as_key().to_string();
    if let Some(paths) = settings.engine_settings.get(&engine_key) {
        return paths.clone();
    }
    PersistedEnginePaths::default()
}

fn set_active_engine_paths(settings: &mut PersistedTtsSettings, paths: PersistedEnginePaths) {
    let engine_key = resolve_engine(settings).as_key().to_string();
    settings.engine_settings.insert(engine_key, paths);
}

fn resolve_selected_voice(voices: &[String], requested: &str) -> String {
    let requested = requested.trim();
    if !requested.is_empty() && voices.iter().any(|voice| voice == requested) {
        return requested.to_string();
    }
    if voices.iter().any(|voice| voice == DEFAULT_VOICE) {
        return DEFAULT_VOICE.to_string();
    }
    voices
        .first()
        .cloned()
        .unwrap_or_else(|| DEFAULT_VOICE.to_string())
}

fn resolve_voice_file(resources_dir: &Path, voice_name: &str, fallback_path: &str) -> PathBuf {
    let kokoro_dir = resources_dir.join("kokoro");
    let bin_name = format!("{voice_name}.bin");
    let direct = kokoro_dir.join(&bin_name);
    if direct.is_file() {
        return direct;
    }
    let fallback = PathBuf::from(fallback_path);
    if fallback.is_file() {
        return fallback;
    }
    if let Some(first_bin) = fs::read_dir(&kokoro_dir)
        .ok()
        .and_then(|entries| entries.flatten().find(|e| e.path().extension().map(|ext| ext == "bin").unwrap_or(false)))
    {
        return first_bin.path();
    }
    direct
}

fn known_kokoro_voices() -> Vec<String> {
    vec![
        "af_heart",
        "af_alloy",
        "af_aoede",
        "af_bella",
        "af_jessica",
        "af_kore",
        "af_nicole",
        "af_nova",
        "af_river",
        "af_sarah",
        "af_sky",
        "am_adam",
        "am_echo",
        "am_eric",
        "am_fenrir",
        "am_liam",
        "am_michael",
        "am_onyx",
        "am_puck",
        "am_santa",
        "bf_alice",
        "bf_emma",
        "bf_isabella",
        "bf_lily",
        "bm_daniel",
        "bm_fable",
        "bm_george",
        "bm_lewis",
        "jf_alpha",
        "jf_gongitsune",
        "jf_nezumi",
        "jf_tebukuro",
        "jm_kumo",
        "zf_xiaobei",
        "zf_xiaoni",
        "zf_xiaoxiao",
        "zf_xiaoyi",
        "zm_yunjian",
        "zm_yunxi",
        "zm_yunxia",
        "zm_yunyang",
        "ef_dora",
        "em_alex",
        "em_santa",
        "ff_siwis",
        "hf_alpha",
        "hf_beta",
        "if_sara",
        "if_nicola",
        "pf_dora",
        "pm_alex",
        "pm_santa",
    ]
    .into_iter()
    .map(ToString::to_string)
    .collect()
}

fn generic_speaker_voices(num_speakers: Option<usize>) -> Vec<String> {
    let count = num_speakers.filter(|count| *count > 0).unwrap_or(1);
    (0..count).map(|index| format!("speaker_{index}")).collect()
}

fn is_voices_bin(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    name == "voices.bin" || (name.starts_with("voices") && name.ends_with(".bin"))
}

fn is_known_kokoro_voice_pack(signature: &EngineSignature) -> bool {
    if !matches!(signature.engine, TtsEngine::Kokoro) {
        return false;
    }
    let voices_path = Path::new(&signature.voices_path);
    if is_voices_bin(voices_path) {
        let size = file_size(voices_path).unwrap_or(0);
        return size >= 10 * 1024 * 1024;
    }
    voices_path
        .extension()
        .map(|ext| ext == "bin")
        .unwrap_or(false)
        && voices_path.is_file()
}

fn bundled_kokoro_voice_names(resources_dir: &Path) -> Vec<String> {
    let kokoro_dir = resources_dir.join("kokoro");
    let mut names: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&kokoro_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_stem().and_then(|n| n.to_str()) else {
                continue;
            };
            if path.extension().map(|e| e == "bin").unwrap_or(false) {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names
}

fn voices_for_signature(signature: &EngineSignature, num_speakers: Option<usize>) -> Vec<String> {
    if matches!(signature.engine, TtsEngine::Kokoro) {
        let voices_path = Path::new(&signature.voices_path);
        let voices_dir = if voices_path.is_file() {
            voices_path.parent().map(|p| p.to_path_buf()).unwrap_or_default()
        } else {
            Path::new(&signature.model_path)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_default()
        };
        let has_voices_bin = fs::read_dir(&voices_dir)
            .ok()
            .map(|entries| {
                entries.flatten().any(|e| {
                    is_voices_bin(&e.path())
                })
            })
            .unwrap_or(false);
        let mut voices = if has_voices_bin {
            let voices_pack = fs::read_dir(&voices_dir)
                .ok()
                .and_then(|entries| {
                    entries.flatten().find(|e| is_voices_bin(&e.path()))
                })
                .map(|e| e.path());
            if let Some(ref pack_path) = voices_pack {
                kokoro_voice::list_voices_in_pack(pack_path).unwrap_or_else(|_| known_kokoro_voices())
            } else {
                known_kokoro_voices()
            }
        } else {
            bundled_kokoro_voice_names(&voices_dir)
        };
        if voices.is_empty() {
            voices = known_kokoro_voices();
        }
        if let Some(count) = num_speakers.filter(|count| *count > 0) {
            if count < voices.len() {
                voices.truncate(count);
            } else {
                for index in voices.len()..count {
                    voices.push(format!("speaker_{index}"));
                }
            }
        }
        return voices;
    }
    generic_speaker_voices(num_speakers)
}

fn voice_to_sid(voices: &[String], voice: &str) -> i32 {
    voices
        .iter()
        .position(|v| v == voice)
        .map(|idx| idx as i32)
        .unwrap_or(0)
}

pub(crate) fn wav_from_f32_samples(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align as u32;

    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let int = (clamped * 32767.0) as i16;
        pcm.extend_from_slice(&int.to_le_bytes());
    }

    let data_len = pcm.len() as u32;
    let riff_chunk_size = 36 + data_len;
    let mut out = Vec::with_capacity((44 + data_len) as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_chunk_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(&pcm);
    out
}

fn pcm16le_from_f32_samples(samples: &[f32]) -> Vec<u8> {
    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let int = (clamped * 32767.0) as i16;
        pcm.extend_from_slice(&int.to_le_bytes());
    }
    pcm
}

fn build_signature(
    paths: &KokoroPaths,
    settings: &PersistedTtsSettings,
) -> Result<EngineSignature, String> {
    let engine = resolve_engine(settings);
    let model_path = paths.model_path.as_ref().ok_or_else(|| {
        "missing model file (model.onnx/model.int8.onnx/model_quantized.onnx)".to_string()
    })?;
    let tokens_path = if matches!(engine, TtsEngine::Kokoro) {
        None
    } else {
        Some(
            paths
                .tokens_path
                .as_ref()
                .ok_or_else(|| "missing tokens.txt in voice resources".to_string())?,
        )
    };
    let data_dir = if matches!(engine, TtsEngine::Kokoro) {
        paths.data_dir.as_ref()
    } else {
        Some(
            paths
                .data_dir
                .as_ref()
                .ok_or_else(|| "missing espeak-ng-data directory in voice resources".to_string())?,
        )
    };
    let voices_path = paths
        .voices_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    if !has_ext(&model_path.to_string_lossy(), "onnx") {
        return Err("model path must point to an ONNX file".to_string());
    }
    if matches!(engine, TtsEngine::Kokoro | TtsEngine::Kitten) {
        if voices_path.is_empty() {
            return Err("missing voices file (voices.bin/af_heart.bin)".to_string());
        }
    }
    let model_path_str = model_path.to_string_lossy().to_string();
    let model_name = file_name(model_path).to_lowercase();
    let voices_name = file_name(Path::new(&voices_path)).to_lowercase();
    let model_path_l = path_lower(&model_path_str);
    let voices_path_l = path_lower(&voices_path);
    if matches!(engine, TtsEngine::Piper | TtsEngine::Matcha)
        && (model_name.contains("kokoro")
            || model_path_l.contains("/kokoro/")
            || model_path_l.contains("\\kokoro\\"))
    {
        return Err(
            "selected model looks like a Kokoro model. Choose a model compatible with the selected engine."
                .to_string(),
        );
    }
    if matches!(engine, TtsEngine::Piper) && voices_name.ends_with(".bin") {
        return Err(
            "selected secondary asset looks like a Kokoro voices.bin file. Piper does not use Kokoro voice bins."
                .to_string(),
        );
    }
    if matches!(engine, TtsEngine::Matcha)
        && !voices_name.is_empty()
        && !voices_name.ends_with(".onnx")
    {
        return Err("selected vocoder path should be an ONNX vocoder file for Matcha.".to_string());
    }
    if matches!(engine, TtsEngine::Piper)
        && !voices_path.is_empty()
        && voices_path_l.ends_with(".onnx")
    {
        return Err(
            "selected secondary path looks like a vocoder/model file. Piper secondary path should be lexicon text (or unset)."
                .to_string(),
        );
    }
    if matches!(engine, TtsEngine::Kokoro | TtsEngine::Kitten)
        && !voices_path.is_empty()
        && !voices_path_l.ends_with(".bin")
    {
        return Err("voices path must be a .bin file for this engine.".to_string());
    }
    if matches!(engine, TtsEngine::Matcha) {
        if voices_path.trim().is_empty() {
            return Err("missing vocoder file (.onnx) for Matcha.".to_string());
        }
        if !has_ext(&voices_path, "onnx") {
            return Err("Matcha vocoder path must be an ONNX file.".to_string());
        }
    }
    if matches!(engine, TtsEngine::Piper) && has_ext(&voices_path, "bin") {
        return Err("Piper does not support Kokoro-style voices .bin files.".to_string());
    }
    Ok(EngineSignature {
        engine,
        model_path: model_path.to_string_lossy().to_string(),
        voices_path,
        tokens_path: tokens_path
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        data_dir: data_dir
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        dict_dir: paths
            .dict_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        // Keep lexicon disabled for now; some bundles contain tokens that are
        // incompatible with the selected tokens.txt and trigger hard failures.
        lexicon: None,
        provider: normalize_provider(settings.provider.as_deref()),
        num_threads: normalize_num_threads(settings.num_threads),
    })
}

fn validate_signature_runtime_compat(signature: &EngineSignature) -> Result<(), String> {
    if matches!(signature.engine, TtsEngine::Kokoro)
        && !file_contains_bytes(Path::new(&signature.model_path), b"sample_rate")
    {
        return Err(
            "incompatible Kokoro ONNX model: missing required metadata key 'sample_rate'."
                .to_string(),
        );
    }

    if matches!(signature.engine, TtsEngine::Kokoro) {
        let model_name = file_name(Path::new(&signature.model_path));
        let voices_name = file_name(Path::new(&signature.voices_path));
        if model_name == "model.int8.onnx"
            && voices_name == "voices.bin"
            && file_size(Path::new(&signature.voices_path)).unwrap_or(0) < 20 * 1024 * 1024
        {
            return Err(
                "incompatible Kokoro bundle: model.int8.onnx expects a larger matching voices.bin; \
 use voices.bin from the same release or switch to kokoro-v0_19.int8.onnx"
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn build_offline_tts_config(signature: &EngineSignature) -> OfflineTtsConfig {
    let mut model = OfflineTtsModelConfig {
        num_threads: signature.num_threads,
        provider: Some(signature.provider.clone()),
        ..Default::default()
    };
    match signature.engine {
        TtsEngine::Kokoro => {
            model.kokoro = OfflineTtsKokoroModelConfig {
                model: Some(signature.model_path.clone()),
                voices: Some(signature.voices_path.clone()),
                tokens: Some(signature.tokens_path.clone()),
                data_dir: Some(signature.data_dir.clone()),
                dict_dir: signature.dict_dir.clone(),
                lexicon: signature.lexicon.clone(),
                lang: Some("en-us".to_string()),
                ..Default::default()
            };
        }
        TtsEngine::Kitten => {
            model.kitten = OfflineTtsKittenModelConfig {
                model: Some(signature.model_path.clone()),
                voices: Some(signature.voices_path.clone()),
                tokens: Some(signature.tokens_path.clone()),
                data_dir: Some(signature.data_dir.clone()),
                ..Default::default()
            };
        }
        TtsEngine::Piper => {
            model.vits = OfflineTtsVitsModelConfig {
                model: Some(signature.model_path.clone()),
                tokens: Some(signature.tokens_path.clone()),
                data_dir: Some(signature.data_dir.clone()),
                dict_dir: signature.dict_dir.clone(),
                lexicon: signature.lexicon.clone(),
                ..Default::default()
            };
        }
        TtsEngine::Matcha => {
            model.matcha = OfflineTtsMatchaModelConfig {
                acoustic_model: Some(signature.model_path.clone()),
                vocoder: Some(signature.voices_path.clone()),
                tokens: Some(signature.tokens_path.clone()),
                data_dir: Some(signature.data_dir.clone()),
                dict_dir: signature.dict_dir.clone(),
                lexicon: signature.lexicon.clone(),
                ..Default::default()
            };
        }
    }
    OfflineTtsConfig {
        model,
        ..Default::default()
    }
}

fn create_engine(signature: &EngineSignature) -> Result<SherpaEngine, String> {
    validate_signature_runtime_compat(signature)?;
    let config = build_offline_tts_config(signature);
    let tts = OfflineTts::create(&config)
        .ok_or_else(|| "failed creating sherpa tts engine".to_string())?;
    let runtime = RuntimeEngine::Sherpa(tts);
    let voices = voices_for_signature(signature, detect_num_speakers(signature));
    Ok(SherpaEngine {
        runtime,
        signature: signature.clone(),
        voices,
    })
}

fn detect_num_speakers(signature: &EngineSignature) -> Option<usize> {
    if matches!(signature.engine, TtsEngine::Kokoro) {
        return None;
    }
    let config = build_offline_tts_config(signature);
    let tts = OfflineTts::create(&config)?;
    let num_speakers = tts.num_speakers();
    (num_speakers > 0).then_some(num_speakers as usize)
}

pub fn status(app: &AppHandle, request: TtsStatusRequest) -> Result<TtsStatusResponse, String> {
    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.status",
        EventStage::Start,
        EventSeverity::Info,
        json!({}),
    );

    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    let engine = resolve_engine(&settings);
    let signature = build_signature(&paths, &settings).ok();
    let available_voices = signature
        .as_ref()
        .map(|signature| voices_for_signature(signature, detect_num_speakers(signature)))
        .unwrap_or_else(|| {
            if matches!(engine, TtsEngine::Kokoro) {
                known_kokoro_voices()
            } else {
                generic_speaker_voices(None)
            }
        });
    let selected_voice = resolve_selected_voice(&available_voices, &settings.voice);
    let speed = normalize_speed(settings.speed);
    let ready = signature.is_some();
    let lexicon_status = if paths.lexicon_us_path.is_some() || paths.lexicon_zh_path.is_some() {
        "Lexicon files were detected but are disabled by a compatibility guard because lexicon tokens may not match tokens.txt."
            .to_string()
    } else {
        String::new()
    };
    let message = if ready {
        format!("{} TTS ready", engine.as_key())
    } else {
        format!(
            "{} TTS not ready. Required model assets are missing or incompatible.",
            engine.as_key()
        )
    };

    let response = TtsStatusResponse {
        correlation_id: request.correlation_id.clone(),
        engine_id: engine.as_engine_id().to_string(),
        engine: engine.as_key().to_string(),
        ready,
        message: message.clone(),
        model_path: paths
            .model_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        available_voices,
        selected_voice,
        speed,
        lexicon_status,
    };

    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.status",
        EventStage::Complete,
        EventSeverity::Info,
        json!({"ready": response.ready, "message": message}),
    );

    Ok(response)
}

pub fn list_voices(
    app: &AppHandle,
    request: TtsListVoicesRequest,
) -> Result<TtsListVoicesResponse, String> {
    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    let engine = resolve_engine(&settings);
    let voices = build_signature(&paths, &settings)
        .ok()
        .map(|signature| {
            let num_speakers = detect_num_speakers(&signature);
            voices_for_signature(&signature, num_speakers)
        })
        .unwrap_or_else(|| {
            if matches!(engine, TtsEngine::Kokoro) {
                known_kokoro_voices()
            } else {
                generic_speaker_voices(None)
            }
        });
    let selected = resolve_selected_voice(&voices, &settings.voice);
    Ok(TtsListVoicesResponse {
        correlation_id: request.correlation_id,
        voices,
        selected_voice: selected,
    })
}

pub fn settings_get(
    app: &AppHandle,
    request: TtsSettingsGetRequest,
) -> Result<TtsSettingsGetResponse, String> {
    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    let engine = resolve_engine(&settings);
    Ok(TtsSettingsGetResponse {
        correlation_id: request.correlation_id,
        engine_id: engine.as_engine_id().to_string(),
        engine: engine.as_key().to_string(),
        voice: settings.voice,
        speed: normalize_speed(settings.speed),
        model_path: paths
            .model_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    })
}

pub fn settings_set(
    app: &AppHandle,
    tts_state: &TTSState,
    request: TtsSettingsSetRequest,
) -> Result<TtsSettingsSetResponse, String> {
    let paths = ensure_assets(app)?;
    let mut settings = load_settings(&paths.app_data_dir);
    let prev_engine = settings.engine.clone();
    let prev_paths = active_engine_paths(&settings);

    if let Some(engine) = request.engine.as_ref() {
        settings.engine = TtsEngine::from_str(engine).as_key().to_string();
    }
    let mut engine_paths = active_engine_paths(&settings);
    if let Some(voice) = request.voice.as_ref() {
        settings.voice = voice.trim().to_string();
    }
    if let Some(speed) = request.speed {
        settings.speed = normalize_speed(speed);
    }
    if let Some(model_path) = request.model_path.as_ref() {
        let model_path = model_path.trim();
        if !model_path.is_empty() {
            let path = Path::new(model_path);
            if !path.is_file() {
                return Err(format!("selected model file does not exist: {model_path}"));
            }
            engine_paths.model_path = Some(model_path.to_string());
            // Reset stale companion paths; they will be re-resolved from the selected
            // model directory (or fallback kokoro dir) in ensure_assets().
            engine_paths.secondary_path = None;
            engine_paths.voices_path = None;
            engine_paths.tokens_path = None;
            engine_paths.data_dir = None;
        }
    }
    set_active_engine_paths(&mut settings, engine_paths.clone());

    let requested_path_update = request.model_path.is_some();

    // Validate explicit path edits, but do not block engine-only switches on
    // stale or partial assets from that engine. Status will report readiness.
    let preview_paths = resolve_paths_for_settings(
        paths.app_data_dir.clone(),
        paths.kokoro_dir.clone(),
        &settings,
    );
    if requested_path_update && preview_paths.model_path.is_some() {
        let _ = build_signature(&preview_paths, &settings)?;
    }

    save_settings(&paths.app_data_dir, &settings)?;
    let next_paths = active_engine_paths(&settings);
    if settings.engine != prev_engine
        || prev_paths.model_path != next_paths.model_path
        || prev_paths.secondary_path != next_paths.secondary_path
        || prev_paths.voices_path != next_paths.voices_path
        || prev_paths.tokens_path != next_paths.tokens_path
        || prev_paths.data_dir != next_paths.data_dir
    {
        tts_state.shutdown();
    }

    Ok(TtsSettingsSetResponse {
        correlation_id: request.correlation_id,
        ok: true,
        engine: settings.engine,
        voice: settings.voice,
        speed: settings.speed,
    })
}

pub fn stop(request: TtsStopRequest, tts_state: &TTSState) -> Result<TtsStopResponse, String> {
    tts_state.shutdown();
    Ok(TtsStopResponse {
        correlation_id: request.correlation_id,
        stopped: true,
    })
}

pub async fn self_test(
    app: &AppHandle,
    request: TtsSelfTestRequest,
    tts_state: &TTSState,
) -> Result<TtsSelfTestResponse, String> {
    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    let engine = resolve_engine(&settings);
    let speak_request = TtsSpeakRequest {
        correlation_id: request.correlation_id.clone(),
        text: format!(
            "{} runtime self test from Arxell.",
            engine.as_key()
        ),
        voice: None,
        speed: None,
    };

    match speak(app, speak_request, tts_state).await {
        Ok(response) => Ok(TtsSelfTestResponse {
            correlation_id: request.correlation_id,
            ok: !response.audio_bytes.is_empty(),
            message: if response.audio_bytes.is_empty() {
                "Self-test returned empty audio".to_string()
            } else {
                "Self-test succeeded".to_string()
            },
            bytes: response.audio_bytes.len() as u64,
            sample_rate: response.sample_rate,
            duration_ms: response.duration_ms,
        }),
        Err(error) => Ok(TtsSelfTestResponse {
            correlation_id: request.correlation_id,
            ok: false,
            message: error,
            bytes: 0,
            sample_rate: 0,
            duration_ms: 0,
        }),
    }
}

pub(crate) fn split_into_sentences(phonemes: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in phonemes.chars() {
        current.push(ch);
        if matches!(ch, '.' | '?' | '!' | '—' | '\n') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }
    if sentences.is_empty() {
        sentences.push(phonemes.to_string());
    }
    sentences
}

fn phonemize_with_pauses(phonemizer: &dyn Phonemizer, text: &str) -> Result<String, String> {
    const PAUSE_CHARS: &[char] = &[',', ':', ';', '—'];

    let mut result = String::new();
    let mut start = 0usize;
    let chars: Vec<char> = text.chars().collect();

    for (i, &ch) in chars.iter().enumerate() {
        if PAUSE_CHARS.contains(&ch) {
            let segment: String = chars[start..i].iter().collect();
            let trimmed = segment.trim();
            if !trimmed.is_empty() {
                let phonemes = phonemizer.phonemize(trimmed)?;
                if !phonemes.is_empty() {
                    if !result.is_empty() {
                        result.push(' ');
                    }
                    result.push_str(&phonemes);
                }
            }
            if !result.is_empty() {
                result.push(' ');
            }
            result.push(ch);
            start = i + 1;
        }
    }

    let remaining: String = chars[start..].iter().collect();
    let trimmed = remaining.trim();
    if !trimmed.is_empty() {
        let phonemes = phonemizer.phonemize(trimmed)?;
        if !phonemes.is_empty() {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(&phonemes);
        }
    }

    Ok(result)
}

fn split_raw_text_into_sentences(text: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '?' | '!' | '\n') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }
    if sentences.is_empty() {
        sentences.push(text.to_string());
    }
    sentences
}

fn strip_markdown_for_tts(input: &str) -> String {
    let lines: Vec<String> = input.lines().map(|line| strip_markdown_line(line)).collect();
    let result = lines.join(" ");
    collapse_whitespace(&result)
}

fn strip_markdown_line(line: &str) -> String {
    let line = line.trim();

    if matches!(line, "---" | "***" | "___" | "- - -" | "* * *") {
        return String::new();
    }

    let line = line.trim_start_matches('#').trim_start();
    let line = line.trim_start_matches('>').trim_start();

    let line = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))
        .unwrap_or(line);

    let line = if let Some(dot_pos) = line.find(". ") {
        let prefix = &line[..dot_pos];
        if prefix.chars().all(|c| c.is_ascii_digit()) {
            &line[dot_pos + 2..]
        } else {
            line
        }
    } else {
        line
    };

    let line = line
        .replace("**", "")
        .replace("__", "")
        .replace("~~", "");

    let line = strip_lone_sigils(&line, '*');
    let line = strip_lone_sigils(&line, '_');

    let line = strip_links(&line);
    let line = strip_images(&line);

    line.replace('`', "")
}

fn strip_lone_sigils(input: &str, sigil: char) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    for (i, &ch) in chars.iter().enumerate() {
        if ch == sigil {
            let prev_alnum = i > 0 && chars[i - 1].is_alphanumeric();
            let next_alnum = i + 1 < chars.len() && chars[i + 1].is_alphanumeric();
            if prev_alnum && next_alnum {
                out.push(ch);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn strip_links(input: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after_open = &rest[open + 1..];
        if let Some(close_bracket) = after_open.find("](") {
            let label = &after_open[..close_bracket];
            let after_label = &after_open[close_bracket + 2..];
            if let Some(close_paren) = after_label.find(')') {
                out.push_str(label);
                rest = &after_label[close_paren + 1..];
                continue;
            }
        }
        out.push('[');
        rest = after_open;
    }
    out.push_str(rest);
    out
}

fn strip_images(input: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(bang) = rest.find("![") {
        out.push_str(&rest[..bang]);
        let after = &rest[bang + 2..];
        if let Some(close_bracket) = after.find("](") {
            let alt = &after[..close_bracket];
            let after_alt = &after[close_bracket + 2..];
            if let Some(close_paren) = after_alt.find(')') {
                out.push_str(alt);
                rest = &after_alt[close_paren + 1..];
                continue;
            }
        }
        out.push_str("![");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn collapse_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_space = false;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !last_was_space && !out.is_empty() {
                out.push(' ');
            }
            last_was_space = true;
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    out.trim_end().to_string()
}

pub async fn speak(
    app: &AppHandle,
    request: TtsSpeakRequest,
    tts_state: &TTSState,
) -> Result<TtsSpeakResponse, String> {
    let total_start = Instant::now();
    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.request",
        EventStage::Start,
        EventSeverity::Info,
        json!({"chars": request.text.len()}),
    );

    let text = strip_markdown_for_tts(request.text.trim());
    if text.is_empty() {
        return Err("text is required".to_string());
    }

    let ensure_assets_start = Instant::now();
    let paths = ensure_assets(app)?;
    let ensure_assets_ms = ensure_assets_start.elapsed().as_millis();
    let settings = load_settings(&paths.app_data_dir);
    let signature_start = Instant::now();
    let signature = build_signature(&paths, &settings)?;
    let build_signature_ms = signature_start.elapsed().as_millis();
    let engine = signature.engine;
    let selectable_voices = voices_for_signature(&signature, None);
    let selected_voice = resolve_selected_voice(
        &selectable_voices,
        request.voice.as_deref().unwrap_or(settings.voice.as_str()),
    );
    let speed = normalize_speed(request.speed.unwrap_or(settings.speed));

    if matches!(engine, TtsEngine::Kokoro) {
        let resources_dir = resolve_resources_dir(app)?;
        let ort_path = bundled_ort_library_path(&resources_dir)
            .ok_or_else(|| format!("bundled ONNX Runtime library not found under {}", resources_dir.join("onnxruntime").display()))?;
        init_onnxruntime(&ort_path)?;
        let phonemizer = tts_state.get_or_create_phonemizer(&resources_dir)?;
        let config_path = resources_dir.join("kokoro").join("config.json");
        let voice_file = resolve_voice_file(&resources_dir, &selected_voice, &signature.voices_path);
        let model_path = PathBuf::from(&signature.model_path);
        let voice_name_for_task = selected_voice.clone();
        let text_for_task = text.clone();
        let engine_prepare_start = Instant::now();
        let (samples, sample_rate) = tokio::task::spawn_blocking(move || {
            let phonemes = phonemize_with_pauses(&phonemizer, &text_for_task)?;
            synthesize_phonemes(&model_path, &config_path, &voice_file, Some(&voice_name_for_task), &phonemes, speed)
        })
        .await
        .map_err(|e| format!("tts worker join error: {e}"))??;
        let engine_prepare_ms = engine_prepare_start.elapsed().as_millis();
        let duration_ms = ((samples.len() as f64 / sample_rate as f64) * 1000.0).round() as u32;
        let wav_encode_start = Instant::now();
        let audio_bytes = wav_from_f32_samples(&samples, sample_rate);
        let wav_encode_ms = wav_encode_start.elapsed().as_millis();
        emit_tts_event(
            app,
            &request.correlation_id,
            "tts.request",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "bytes": audio_bytes.len(),
                "durationMs": duration_ms,
                "voice": selected_voice,
                "timingsMs": {
                    "total": total_start.elapsed().as_millis(),
                    "ensureAssets": ensure_assets_ms,
                    "buildSignature": build_signature_ms,
                    "enginePrepare": engine_prepare_ms,
                    "wavEncode": wav_encode_ms,
                },
            }),
        );
        return Ok(TtsSpeakResponse {
            correlation_id: request.correlation_id,
            engine_id: engine.as_engine_id().to_string(),
            voice: selected_voice,
            speed,
            sample_rate,
            duration_ms,
            audio_bytes,
        });
    }

    let engine_state = Arc::clone(&tts_state.engine);
    let text_clone = text.clone();
    let selected_voice_clone = selected_voice.clone();
    let signature_clone = signature.clone();
    let engine_key = engine.as_key().to_string();

    let worker_wait_start = Instant::now();
    let (result, worker_timing) = tokio::task::spawn_blocking(move || {
        let mut guard = engine_state
            .lock()
            .map_err(|_| "sherpa tts engine lock poisoned".to_string())?;
        let engine_prepare_start = Instant::now();
        let needs_rebuild = guard
            .get(engine_key.as_str())
            .map(|engine| {
                engine.signature.model_path != signature_clone.model_path
                    || engine.signature.voices_path != signature_clone.voices_path
                    || engine.signature.tokens_path != signature_clone.tokens_path
                    || engine.signature.data_dir != signature_clone.data_dir
                    || engine.signature.dict_dir != signature_clone.dict_dir
                    || engine.signature.lexicon != signature_clone.lexicon
                    || engine.signature.provider != signature_clone.provider
                    || engine.signature.num_threads != signature_clone.num_threads
                    || engine.signature.engine != signature_clone.engine
            })
            .unwrap_or(true);
        if needs_rebuild {
            guard.insert(engine_key.clone(), create_engine(&signature_clone)?);
        }
        let engine_prepare_ms = engine_prepare_start.elapsed().as_millis();
        let engine = guard
            .get_mut(engine_key.as_str())
            .ok_or_else(|| "sherpa engine unavailable".to_string())?;

        let synthesis_start = Instant::now();
        let (samples, sample_rate) = match &mut engine.runtime {
            RuntimeEngine::Sherpa(tts) => {
                let mut gen_config = GenerationConfig::default();
                gen_config.speed = speed;
                gen_config.sid = voice_to_sid(&engine.voices, &selected_voice_clone);
                let generated = tts
                    .generate_with_config::<fn(&[f32], f32) -> bool>(&text_clone, &gen_config, None)
                    .ok_or_else(|| "sherpa synthesis returned no audio".to_string())?;
                (generated.samples().to_vec(), generated.sample_rate() as u32)
            }
        };
        let synthesis_ms = synthesis_start.elapsed().as_millis();
        let duration_ms = if sample_rate == 0 {
            0
        } else {
            ((samples.len() as f64 / sample_rate as f64) * 1000.0).round() as u32
        };
        let wav_encode_start = Instant::now();
        let audio_bytes = wav_from_f32_samples(&samples, sample_rate.max(1));
        let wav_encode_ms = wav_encode_start.elapsed().as_millis();
        Ok::<(SpeakResult, SpeakWorkerTiming), String>((
            SpeakResult {
                audio_bytes,
                sample_rate: sample_rate.max(1),
                duration_ms,
            },
            SpeakWorkerTiming {
                engine_prepare_ms,
                synthesis_ms,
                wav_encode_ms,
            },
        ))
    })
    .await
    .map_err(|e| format!("tts worker join error: {e}"))??;
    let worker_wait_ms = worker_wait_start.elapsed().as_millis();
    let ipc_marshal_start = Instant::now();

    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.request",
        EventStage::Complete,
        EventSeverity::Info,
        json!({
            "bytes": result.audio_bytes.len(),
            "durationMs": result.duration_ms,
            "voice": selected_voice,
            "timingsMs": {
                "total": total_start.elapsed().as_millis(),
                "ensureAssets": ensure_assets_ms,
                "buildSignature": build_signature_ms,
                "saveSettings": 0,
                "enginePrepare": worker_timing.engine_prepare_ms,
                "synthesis": worker_timing.synthesis_ms,
                "wavEncode": worker_timing.wav_encode_ms,
                "workerWait": worker_wait_ms,
                "ipcMarshal": ipc_marshal_start.elapsed().as_millis(),
            },
        }),
    );

    Ok(TtsSpeakResponse {
        correlation_id: request.correlation_id,
        engine_id: engine.as_engine_id().to_string(),
        voice: selected_voice,
        speed,
        sample_rate: result.sample_rate,
        duration_ms: result.duration_ms,
        audio_bytes: result.audio_bytes,
    })
}

pub async fn speak_stream(
    app: &AppHandle,
    request: TtsSpeakRequest,
    tts_state: &TTSState,
) -> Result<TtsSpeakStreamResponse, String> {
    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.request",
        EventStage::Start,
        EventSeverity::Info,
        json!({"chars": request.text.len(), "streaming": true}),
    );

    let text = strip_markdown_for_tts(request.text.trim());
    if text.is_empty() {
        return Err("text is required".to_string());
    }

    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    let signature = build_signature(&paths, &settings)?;
    let engine = signature.engine;
    let selectable_voices = voices_for_signature(&signature, None);
    let selected_voice = resolve_selected_voice(
        &selectable_voices,
        request.voice.as_deref().unwrap_or(settings.voice.as_str()),
    );
    let speed = normalize_speed(request.speed.unwrap_or(settings.speed));

    if matches!(engine, TtsEngine::Kokoro) {
        let resources_dir = resolve_resources_dir(app)?;
        let ort_path = bundled_ort_library_path(&resources_dir)
            .ok_or_else(|| format!("bundled ONNX Runtime library not found under {}", resources_dir.join("onnxruntime").display()))?;
        init_onnxruntime(&ort_path)?;
        let phonemizer = tts_state.get_or_create_phonemizer(&resources_dir)?;
        let config_path = resources_dir.join("kokoro").join("config.json");
        let voice_file = resolve_voice_file(&resources_dir, &selected_voice, &signature.voices_path);
        let model_path = PathBuf::from(&signature.model_path);
        let app_for_task = app.clone();
        let corr = request.correlation_id.clone();
        let stream_voice = selected_voice.clone();
        let raw_sentences = split_raw_text_into_sentences(&text);
        let handle = tokio::spawn(async move {
            let total_start = Instant::now();
            let mut seq: u32 = 0;
            let mut all_samples: Vec<f32> = Vec::new();
            let sample_rate: u32 = 24_000;

            let mut phoneme_fut: Option<tokio::task::JoinHandle<Result<String, String>>> = None;
            let mut synth_fut: Option<tokio::task::JoinHandle<Result<(Vec<f32>, u32), String>>> = None;
            let mut sentence_idx = 0usize;

            while sentence_idx < raw_sentences.len() || phoneme_fut.is_some() || synth_fut.is_some() {
                if synth_fut.is_none() {
                    let phonemes = if let Some(handle) = phoneme_fut.take() {
                        sentence_idx += 1;
                        match handle.await {
                            Ok(Ok(p)) => p,
                            Ok(Err(e)) => {
                                emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message":e}));
                                return;
                            }
                            Err(e) => {
                                emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message": format!("phonemize worker error: {e}")}));
                                return;
                            }
                        }
                    } else if sentence_idx < raw_sentences.len() {
                        let raw = raw_sentences[sentence_idx].clone();
                        sentence_idx += 1;
                        let ph = phonemizer.clone();
                        match tokio::task::spawn_blocking(move || phonemize_with_pauses(&ph, &raw)).await {
                            Ok(Ok(p)) => p,
                            Ok(Err(e)) => {
                                emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message":e}));
                                return;
                            }
                            Err(e) => {
                                emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message": format!("phonemize worker error: {e}")}));
                                return;
                            }
                        }
                    } else {
                        break;
                    };

                    if phonemes.trim().is_empty() {
                        continue;
                    }

                    let mp = model_path.clone();
                    let cp = config_path.clone();
                    let vf = voice_file.clone();
                    let vn = stream_voice.clone();
                    synth_fut = Some(tokio::task::spawn_blocking(move || {
                        synthesize_phonemes(&mp, &cp, &vf, Some(&vn), &phonemes, speed)
                    }));

                    if sentence_idx < raw_sentences.len() {
                        let raw = raw_sentences[sentence_idx].clone();
                        let ph = phonemizer.clone();
                        phoneme_fut = Some(tokio::task::spawn_blocking(move || phonemize_with_pauses(&ph, &raw)));
                    }
                }

                if let Some(handle) = synth_fut.take() {
                    match handle.await {
                        Ok(Ok((samples, _sr))) => {
                            let pcm = pcm16le_from_f32_samples(&samples);
                            let pcm_b64 = base64::engine::general_purpose::STANDARD.encode(&pcm);
                            emit_tts_event(&app_for_task, &corr, "tts.stream.chunk", EventStage::Progress, EventSeverity::Info, json!({
                                "seq": seq, "sampleRate": sample_rate, "pcm16Base64": pcm_b64, "final": false,
                            }));
                            seq += 1;
                            all_samples.extend_from_slice(&samples);
                        }
                        Ok(Err(error)) => {
                            emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message":error}));
                            return;
                        }
                        Err(error) => {
                            emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Error, EventSeverity::Error, json!({"message": format!("tts worker join error: {error}")}));
                            return;
                        }
                    }
                }
            }

            emit_tts_event(&app_for_task, &corr, "tts.stream.chunk", EventStage::Progress, EventSeverity::Info, json!({"final":true}));
            let duration_ms = ((all_samples.len() as f64 / sample_rate as f64) * 1000.0).round() as u32;
            emit_tts_event(&app_for_task, &corr, "tts.request", EventStage::Complete, EventSeverity::Info, json!({
                "bytes": all_samples.len() * 2,
                "durationMs": duration_ms,
                "voice": stream_voice,
                "timingsMs": {"total": total_start.elapsed().as_millis()},
            }));
        });
        let abort_handle = handle.abort_handle();
        tts_state.register_stream(abort_handle.clone());
        let tts_state_for_cleanup = tts_state.clone();
        let cleanup_stream = async move {
            let _ = handle.await;
            tts_state_for_cleanup.unregister_stream(&abort_handle);
        };
        tokio::spawn(cleanup_stream);
        return Ok(TtsSpeakStreamResponse {
            correlation_id: request.correlation_id,
            accepted: true,
            engine_id: engine.as_engine_id().to_string(),
            voice: selected_voice,
            speed,
        });
    }

    let app_for_task = app.clone();
    let request_correlation_id = request.correlation_id.clone();
    let engine_state = Arc::clone(&tts_state.engine);
    let signature_clone = signature.clone();
    let selected_voice_clone = selected_voice.clone();
    let selected_voice_for_task = selected_voice.clone();
    let text_clone = text.clone();
    let engine_key = engine.as_key().to_string();
    let stream_sample_rate = stream_sample_rate_hint(engine);

    let handle = tokio::spawn(async move {
        let total_start = Instant::now();
        let total_start_ms = now_ms();
        let first_chunk_ms_shared = Arc::new(Mutex::new(None::<u128>));
        let first_chunk_ms_shared_for_blocking = Arc::clone(&first_chunk_ms_shared);
        let app_for_blocking = app_for_task.clone();
        let corr_for_blocking = request_correlation_id.clone();
        let worker = tokio::task::spawn_blocking(move || {
            let mut guard = engine_state
                .lock()
                .map_err(|_| "sherpa tts engine lock poisoned".to_string())?;
            let engine_prepare_start = Instant::now();
            let needs_rebuild = guard
                .get(engine_key.as_str())
                .map(|engine| {
                    engine.signature.model_path != signature_clone.model_path
                        || engine.signature.voices_path != signature_clone.voices_path
                        || engine.signature.tokens_path != signature_clone.tokens_path
                        || engine.signature.data_dir != signature_clone.data_dir
                        || engine.signature.dict_dir != signature_clone.dict_dir
                        || engine.signature.lexicon != signature_clone.lexicon
                        || engine.signature.provider != signature_clone.provider
                        || engine.signature.num_threads != signature_clone.num_threads
                        || engine.signature.engine != signature_clone.engine
                })
                .unwrap_or(true);
            if needs_rebuild {
                guard.insert(engine_key.clone(), create_engine(&signature_clone)?);
            }
            let engine_prepare_ms = engine_prepare_start.elapsed().as_millis();
            let engine = guard
                .get_mut(engine_key.as_str())
                .ok_or_else(|| "sherpa engine unavailable".to_string())?;

            let synthesis_start = Instant::now();
            let (samples, sample_rate) = match &mut engine.runtime {
                RuntimeEngine::Sherpa(tts) => {
                    let mut gen_config = GenerationConfig::default();
                    gen_config.speed = speed;
                    gen_config.sid = voice_to_sid(&engine.voices, &selected_voice_clone);

                    let sample_rate_hint = Arc::new(Mutex::new(0_u32));
                    let chunk_seq = Arc::new(Mutex::new(0_u32));
                    let emitted_sample_count = Arc::new(Mutex::new(0_usize));
                    let first_chunk_ms_for_callback = Arc::clone(&first_chunk_ms_shared_for_blocking);
                    let app_for_callback = app_for_blocking.clone();
                    let corr_for_callback = corr_for_blocking.clone();
                    let sr_for_callback = Arc::clone(&sample_rate_hint);
                    let seq_for_callback = Arc::clone(&chunk_seq);
                    let emitted_for_callback = Arc::clone(&emitted_sample_count);

                    let generated = tts
                        .generate_with_config(
                            &text_clone,
                            &gen_config,
                            Some(move |samples: &[f32], _progress: f32| {
                                if samples.is_empty() {
                                    return true;
                                }
                                let delta_samples = {
                                    let mut emitted_guard = emitted_for_callback.lock().ok();
                                    let already_emitted = emitted_guard.as_ref().map(|v| **v).unwrap_or(0);
                                    if already_emitted >= samples.len() {
                                        return true;
                                    }
                                    if let Some(ref mut guard) = emitted_guard {
                                        **guard = samples.len();
                                    }
                                    samples[already_emitted..].to_vec()
                                };
                                if delta_samples.is_empty() {
                                    return true;
                                }
                                let sample_rate = {
                                    let mut guard = sr_for_callback.lock().ok();
                                    let current = guard.as_ref().map(|v| **v).unwrap_or(0);
                                    if current == 0 {
                                        if let Some(ref mut g) = guard {
                                            **g = stream_sample_rate;
                                        }
                                        stream_sample_rate
                                    } else {
                                        current
                                    }
                                };
                                let pcm = pcm16le_from_f32_samples(&delta_samples);
                                let pcm_b64 = base64::engine::general_purpose::STANDARD.encode(pcm);
                                let seq = {
                                    let mut seq_guard = seq_for_callback.lock().ok();
                                    let next = seq_guard.as_ref().map(|v| **v).unwrap_or(0);
                                    if let Some(ref mut g) = seq_guard {
                                        **g = next.saturating_add(1);
                                    }
                                    next
                                };
                                if let Ok(mut first_chunk_guard) = first_chunk_ms_for_callback.lock() {
                                    if first_chunk_guard.is_none() {
                                        let elapsed_ms = (now_ms() - total_start_ms).max(0) as u128;
                                        *first_chunk_guard = Some(elapsed_ms);
                                    }
                                }
                                emit_tts_event(
                                    &app_for_callback,
                                    &corr_for_callback,
                                    "tts.stream.chunk",
                                    EventStage::Progress,
                                    EventSeverity::Info,
                                    json!({
                                        "seq": seq,
                                        "sampleRate": sample_rate,
                                        "pcm16Base64": pcm_b64,
                                        "final": false,
                                    }),
                                );
                                true
                            }),
                        )
                        .ok_or_else(|| "sherpa synthesis returned no audio".to_string())?;
                    (generated.samples().to_vec(), generated.sample_rate() as u32)
                }
            };
            let synthesis_ms = synthesis_start.elapsed().as_millis();
            let duration_ms = if sample_rate == 0 {
                0
            } else {
                ((samples.len() as f64 / sample_rate as f64) * 1000.0).round() as u32
            };
            let wav_encode_start = Instant::now();
            let audio_bytes = wav_from_f32_samples(&samples, sample_rate.max(1));
            let wav_encode_ms = wav_encode_start.elapsed().as_millis();
            Ok::<(SpeakResult, SpeakWorkerTiming), String>((
                SpeakResult {
                    audio_bytes,
                    sample_rate: sample_rate.max(1),
                    duration_ms,
                },
                SpeakWorkerTiming {
                    engine_prepare_ms,
                    synthesis_ms,
                    wav_encode_ms,
                },
            ))
        })
        .await;

        match worker {
            Ok(Ok((result, worker_timing))) => {
                let first_chunk_ms = first_chunk_ms_shared
                    .lock()
                    .ok()
                    .and_then(|guard| *guard)
                    .unwrap_or(0);
                emit_tts_event(
                    &app_for_task,
                    &request_correlation_id,
                    "tts.stream.chunk",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({
                        "final": true,
                    }),
                );
                emit_tts_event(
                    &app_for_task,
                    &request_correlation_id,
                    "tts.request",
                    EventStage::Complete,
                    EventSeverity::Info,
                    json!({
                        "bytes": result.audio_bytes.len(),
                        "durationMs": result.duration_ms,
                        "voice": selected_voice_for_task,
                        "timingsMs": {
                            "total": total_start.elapsed().as_millis(),
                            "firstChunk": first_chunk_ms,
                            "ttfa": first_chunk_ms,
                            "enginePrepare": worker_timing.engine_prepare_ms,
                            "synthesis": worker_timing.synthesis_ms,
                            "wavEncode": worker_timing.wav_encode_ms,
                        },
                    }),
                );
            }
            Ok(Err(error)) => {
                emit_tts_event(
                    &app_for_task,
                    &request_correlation_id,
                    "tts.request",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "message": error }),
                );
            }
            Err(error) => {
                emit_tts_event(
                    &app_for_task,
                    &request_correlation_id,
                    "tts.request",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "message": format!("tts worker join error: {error}") }),
                );
            }
        }
    });
    let abort_handle = handle.abort_handle();
    tts_state.register_stream(abort_handle.clone());
    let tts_state_for_cleanup = tts_state.clone();
    let ah = abort_handle.clone();
    tokio::spawn(async move {
        let _ = handle.await;
        tts_state_for_cleanup.unregister_stream(&ah);
    });

    Ok(TtsSpeakStreamResponse {
        correlation_id: request.correlation_id,
        accepted: true,
        engine_id: engine.as_engine_id().to_string(),
        voice: selected_voice,
        speed,
    })
}
