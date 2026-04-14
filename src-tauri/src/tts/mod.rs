#![cfg(feature = "tauri-runtime")]

use crate::contracts::{
    AppEvent, EventSeverity, EventStage, Subsystem, TtsDownloadModelRequest,
    TtsDownloadModelResponse, TtsListVoicesRequest, TtsListVoicesResponse, TtsSelfTestRequest,
    TtsSelfTestResponse, TtsSettingsGetRequest, TtsSettingsGetResponse, TtsSettingsSetRequest,
    TtsSettingsSetResponse, TtsSpeakRequest, TtsSpeakResponse, TtsStatusRequest, TtsStatusResponse,
    TtsStopRequest, TtsStopResponse,
};
use bzip2::read::BzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsMatchaModelConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_VOICE: &str = "af_heart";
const DEFAULT_SPEED: f32 = 1.0;
const DEFAULT_PROVIDER: &str = "cpu";
const DEFAULT_ENGINE: &str = "kokoro";
const DEFAULT_NUM_THREADS: i32 = 4;
const MAX_NUM_THREADS: i32 = 4;
const DEFAULT_SHERPA_KOKORO_INT8_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2";
const DOWNLOAD_PROGRESS_INTERVAL_MS: u128 = 250;

#[derive(Default)]
pub struct TTSState {
    engine: Arc<Mutex<HashMap<String, SherpaEngine>>>,
}

impl TTSState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.engine.lock() {
            guard.clear();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTtsSettings {
    #[serde(default = "default_engine")]
    engine: String,
    voice: String,
    speed: f32,
    model_path: Option<String>,
    secondary_path: Option<String>,
    voices_path: Option<String>,
    tokens_path: Option<String>,
    data_dir: Option<String>,
    #[serde(default)]
    engine_settings: HashMap<String, PersistedEnginePaths>,
    provider: Option<String>,
    num_threads: Option<u32>,
    // Backward-compatible field kept for old persisted settings.
    #[serde(default)]
    python_path: Option<String>,
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
            model_path: None,
            secondary_path: None,
            voices_path: None,
            tokens_path: None,
            data_dir: None,
            engine_settings: HashMap::new(),
            provider: Some(DEFAULT_PROVIDER.to_string()),
            num_threads: None,
            python_path: None,
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
    tts: OfflineTts,
    signature: EngineSignature,
    voices: Vec<String>,
}

#[derive(Debug, Clone)]
struct SpeakResult {
    audio_bytes: Vec<u8>,
    sample_rate: u32,
    duration_ms: u32,
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
            Self::Kokoro => "sherpa-kokoro",
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
    let mut settings = match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<PersistedTtsSettings>(&raw).unwrap_or_default(),
        Err(_) => PersistedTtsSettings::default(),
    };
    migrate_legacy_engine_paths(&mut settings);
    settings
}

fn save_settings(app_data_dir: &Path, settings: &PersistedTtsSettings) -> Result<(), String> {
    let path = settings_path(app_data_dir);
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed serializing tts settings: {e}"))?;
    fs::write(path, format!("{payload}\n")).map_err(|e| format!("failed saving tts settings: {e}"))
}

fn migrate_legacy_engine_paths(settings: &mut PersistedTtsSettings) {
    if settings.engine_settings.contains_key("kokoro") {
        return;
    }
    let has_legacy = settings.model_path.is_some()
        || settings.secondary_path.is_some()
        || settings.voices_path.is_some()
        || settings.tokens_path.is_some()
        || settings.data_dir.is_some();
    if !has_legacy {
        return;
    }
    settings.engine_settings.insert(
        "kokoro".to_string(),
        PersistedEnginePaths {
            model_path: settings.model_path.clone(),
            secondary_path: settings.secondary_path.clone(),
            voices_path: settings.voices_path.clone(),
            tokens_path: settings.tokens_path.clone(),
            data_dir: settings.data_dir.clone(),
        },
    );
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

fn copy_response_with_progress(
    app: &AppHandle,
    correlation_id: &str,
    response: &mut reqwest::blocking::Response,
    out: &mut fs::File,
    url: &str,
) -> Result<(), String> {
    let total_bytes = response.content_length();
    let mut received_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut last_emit = Instant::now();

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("failed reading downloaded archive: {e}"))?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read])
            .map_err(|e| format!("failed writing downloaded archive: {e}"))?;
        received_bytes = received_bytes.saturating_add(read as u64);

        if last_emit.elapsed().as_millis() >= DOWNLOAD_PROGRESS_INTERVAL_MS {
            emit_tts_event(
                app,
                correlation_id,
                "tts.download_model",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "url": url,
                    "receivedBytes": received_bytes,
                    "totalBytes": total_bytes,
                    "percent": total_bytes
                        .filter(|total| *total > 0)
                        .map(|total| (received_bytes as f64 / total as f64 * 100.0).min(100.0)),
                }),
            );
            last_emit = Instant::now();
        }
    }

    emit_tts_event(
        app,
        correlation_id,
        "tts.download_model",
        EventStage::Progress,
        EventSeverity::Info,
        json!({
            "url": url,
            "receivedBytes": received_bytes,
            "totalBytes": total_bytes,
            "percent": total_bytes
                .filter(|total| *total > 0)
                .map(|total| (received_bytes as f64 / total as f64 * 100.0).min(100.0)),
        }),
    );
    Ok(())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn resolve_resource_path(app: &AppHandle, rel_candidates: &[&str]) -> Option<PathBuf> {
    for rel in rel_candidates {
        if let Ok(path) = app
            .path()
            .resolve(rel, tauri::path::BaseDirectory::Resource)
        {
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

fn copy_file_if_changed(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed creating directory: {e}"))?;
    }
    if to.exists() {
        let src = fs::read(from).map_err(|e| format!("failed reading source file: {e}"))?;
        let dst = fs::read(to).map_err(|e| format!("failed reading destination file: {e}"))?;
        if src == dst {
            return Ok(());
        }
    }
    fs::copy(from, to)
        .map_err(|e| format!("failed copying {} -> {}: {e}", from.display(), to.display()))?;
    Ok(())
}

fn copy_tree_if_needed(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    if from.is_file() {
        return copy_file_if_changed(from, to);
    }
    fs::create_dir_all(to).map_err(|e| format!("failed creating destination dir: {e}"))?;
    let entries = fs::read_dir(from).map_err(|e| format!("failed reading source dir: {e}"))?;
    for entry in entries.flatten() {
        let src_path = entry.path();
        let dst_path = to.join(entry.file_name());
        if src_path.is_dir() {
            copy_tree_if_needed(&src_path, &dst_path)?;
        } else if src_path.is_file() {
            copy_file_if_changed(&src_path, &dst_path)?;
        }
    }
    Ok(())
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
        if lower.ends_with(".bin") && (lower.starts_with("voices") || lower.contains("voice")) {
            named_match = Some(path);
        }
    }
    named_match
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
        .filter(|path| path.is_file());
    let model_path = configured_model_path.or_else(|| first_existing_file(&model_candidates));
    let tokens_path = engine_paths
        .tokens_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            companion_file_from_model_dirs(engine_paths.model_path.as_deref(), &["tokens.txt"])
        })
        .or_else(|| {
            first_existing_file(&[
                tts_engine_dir.join("tokens.txt"),
                engine_dir.join("tokens.txt"),
                kokoro_dir.join("tokens.txt"),
            ])
            .or_else(|| {
                if matches!(engine, TtsEngine::Kokoro) {
                    recursive_find_file_named(&kokoro_dir, "tokens.txt", 4)
                } else {
                    None
                }
            })
        });
    let data_dir = engine_paths
        .data_dir
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| {
            companion_dir_from_model_dirs(engine_paths.model_path.as_deref(), &["espeak-ng-data"])
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
        });
    let dict_dir = first_existing_dir(&[kokoro_dir.join("dict")]);
    let lexicon_us_path = first_existing_file(&[kokoro_dir.join("lexicon-us-en.txt")]);
    let lexicon_zh_path = first_existing_file(&[kokoro_dir.join("lexicon-zh.txt")]);

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
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    bytes.windows(needle.len()).any(|window| window == needle)
}

fn normalize_speed(speed: f32) -> f32 {
    if !speed.is_finite() {
        return DEFAULT_SPEED;
    }
    speed.clamp(0.5, 2.0)
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
    if matches!(engine, TtsEngine::Kokoro) {
        return PersistedEnginePaths {
            model_path: settings.model_path.clone(),
            secondary_path: settings.secondary_path.clone(),
            voices_path: settings.voices_path.clone(),
            tokens_path: settings.tokens_path.clone(),
            data_dir: settings.data_dir.clone(),
        };
    }
    PersistedEnginePaths::default()
}

fn set_active_engine_paths(settings: &mut PersistedTtsSettings, paths: PersistedEnginePaths) {
    let engine_key = resolve_engine(settings).as_key().to_string();
    settings.engine_settings.insert(engine_key, paths.clone());
    // Mirror legacy fields for backwards compatibility.
    settings.model_path = paths.model_path;
    settings.secondary_path = paths.secondary_path;
    settings.voices_path = paths.voices_path;
    settings.tokens_path = paths.tokens_path;
    settings.data_dir = paths.data_dir;
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

fn is_known_kokoro_voice_pack(signature: &EngineSignature) -> bool {
    if !matches!(signature.engine, TtsEngine::Kokoro) {
        return false;
    }
    let voices_path = Path::new(&signature.voices_path);
    if file_name(voices_path) != "voices.bin" {
        return false;
    }
    let size = file_size(voices_path).unwrap_or(0);
    // Known sherpa Kokoro bundles currently ship either a compact v0.19 voice
    // pack or a larger multi-language v1.1 pack. Unknown custom packs should
    // not inherit these labels just because they have the same speaker count.
    (10 * 1024 * 1024..=15 * 1024 * 1024).contains(&size) || size >= 20 * 1024 * 1024
}

fn voices_for_signature(signature: &EngineSignature, num_speakers: Option<usize>) -> Vec<String> {
    if is_known_kokoro_voice_pack(signature) {
        let mut voices = known_kokoro_voices();
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

fn wav_from_f32_samples(samples: &[f32], sample_rate: u32) -> Vec<u8> {
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

fn ensure_assets(app: &AppHandle) -> Result<KokoroPaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed resolving app data dir: {e}"))?;
    let kokoro_dir = app_data_dir.join("kokoro");
    fs::create_dir_all(&kokoro_dir).map_err(|e| format!("failed creating kokoro dir: {e}"))?;

    if let Some(source_voice_dir) = resolve_resource_path(app, &["resources/voice", "voice"]) {
        copy_tree_if_needed(&source_voice_dir, &kokoro_dir)?;
    }

    let settings = load_settings(&app_data_dir);
    Ok(resolve_paths_for_settings(
        app_data_dir,
        kokoro_dir,
        &settings,
    ))
}

fn build_signature(
    paths: &KokoroPaths,
    settings: &PersistedTtsSettings,
) -> Result<EngineSignature, String> {
    let engine = resolve_engine(settings);
    let model_path = paths.model_path.as_ref().ok_or_else(|| {
        "missing model file (model.onnx/model.int8.onnx/model_quantized.onnx)".to_string()
    })?;
    let tokens_path = paths
        .tokens_path
        .as_ref()
        .ok_or_else(|| "missing tokens.txt in voice resources".to_string())?;
    let data_dir = paths
        .data_dir
        .as_ref()
        .ok_or_else(|| "missing espeak-ng-data directory in voice resources".to_string())?;
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
    if matches!(engine, TtsEngine::Kokoro) && !file_contains_bytes(model_path, b"sample_rate") {
        return Err(
            "incompatible Kokoro ONNX model for sherpa-onnx: missing required metadata key \
'sample_rate'. Use a sherpa-onnx Kokoro model bundle (k2-fsa release)."
                .to_string(),
        );
    }
    if matches!(engine, TtsEngine::Kokoro) {
        // Guard against a known hard crash path in sherpa when model/voices bundles are mismatched.
        let model_name = file_name(model_path);
        let voices_name = file_name(Path::new(&voices_path));
        if model_name == "model.int8.onnx"
            && voices_name == "voices.bin"
            && file_size(Path::new(&voices_path)).unwrap_or(0) < 20 * 1024 * 1024
        {
            return Err(
                "incompatible Kokoro bundle: model.int8.onnx expects a larger matching voices.bin; \
use voices.bin from the same sherpa release tarball or switch to kokoro-v0_19.int8.onnx"
                    .to_string(),
            );
        }
    }

    Ok(EngineSignature {
        engine,
        model_path: model_path.to_string_lossy().to_string(),
        voices_path,
        tokens_path: tokens_path.to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
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

fn create_sherpa_engine(signature: &EngineSignature) -> Result<SherpaEngine, String> {
    let config = build_offline_tts_config(signature);
    let tts = OfflineTts::create(&config)
        .ok_or_else(|| "failed creating sherpa tts engine".to_string())?;
    let num_speakers = tts.num_speakers();
    let voices = voices_for_signature(
        signature,
        (num_speakers > 0).then_some(num_speakers as usize),
    );
    Ok(SherpaEngine {
        tts,
        signature: signature.clone(),
        voices,
    })
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
        .map(|signature| voices_for_signature(signature, None))
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
        "Lexicon files were detected but are disabled by a compatibility guard because some sherpa-onnx bundles crash when lexicon tokens do not match tokens.txt."
            .to_string()
    } else {
        String::new()
    };
    let message = if ready {
        format!("Sherpa ONNX {} ready", engine.as_key())
    } else {
        format!(
            "Sherpa ONNX {} not ready. Required model assets are missing or incompatible.",
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
        secondary_path: paths
            .voices_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        voices_path: paths
            .voices_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        tokens_path: paths
            .tokens_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        data_dir: paths
            .data_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        python_path: String::new(),
        script_path: String::new(),
        runtime_archive_present: false,
        available_model_paths: paths
            .model_path
            .as_ref()
            .map(|p| vec![p.to_string_lossy().to_string()])
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
        .map(|signature| voices_for_signature(&signature, None))
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
        secondary_path: paths
            .voices_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        voices_path: paths
            .voices_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        tokens_path: paths
            .tokens_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        data_dir: paths
            .data_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        python_path: String::new(),
    })
}

pub fn settings_set(
    app: &AppHandle,
    tts_state: &TTSState,
    request: TtsSettingsSetRequest,
) -> Result<TtsSettingsSetResponse, String> {
    let paths = ensure_assets(app)?;
    let mut settings = load_settings(&paths.app_data_dir);
    migrate_legacy_engine_paths(&mut settings);
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
            if request.secondary_path.is_none() && request.voices_path.is_none() {
                engine_paths.secondary_path = None;
                engine_paths.voices_path = None;
            }
            engine_paths.tokens_path = None;
            engine_paths.data_dir = None;
        }
    }
    if let Some(secondary_path) = request.secondary_path.as_ref() {
        let secondary_path = secondary_path.trim();
        if !secondary_path.is_empty() {
            engine_paths.secondary_path = Some(secondary_path.to_string());
            engine_paths.voices_path = Some(secondary_path.to_string());
        }
    }
    if let Some(voices_path) = request.voices_path.as_ref() {
        let voices_path = voices_path.trim();
        if !voices_path.is_empty() {
            engine_paths.voices_path = Some(voices_path.to_string());
            if engine_paths.secondary_path.is_none() {
                engine_paths.secondary_path = Some(voices_path.to_string());
            }
        }
    }
    if let Some(tokens_path) = request.tokens_path.as_ref() {
        let tokens_path = tokens_path.trim();
        if !tokens_path.is_empty() {
            engine_paths.tokens_path = Some(tokens_path.to_string());
        }
    }
    if let Some(data_dir) = request.data_dir.as_ref() {
        let data_dir = data_dir.trim();
        if !data_dir.is_empty() {
            engine_paths.data_dir = Some(data_dir.to_string());
        }
    }
    // python_path field is intentionally ignored in sherpa-only mode.
    if request.python_path.is_some() {
        settings.python_path = None;
    }
    set_active_engine_paths(&mut settings, engine_paths.clone());

    // Validate explicit or preconfigured bundle when a model is present.
    let preview_paths = resolve_paths_for_settings(
        paths.app_data_dir.clone(),
        paths.kokoro_dir.clone(),
        &settings,
    );
    if preview_paths.model_path.is_some() {
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
            "Sherpa ONNX {} runtime self test from Arxell Lite.",
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

pub async fn speak(
    app: &AppHandle,
    request: TtsSpeakRequest,
    tts_state: &TTSState,
) -> Result<TtsSpeakResponse, String> {
    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.request",
        EventStage::Start,
        EventSeverity::Info,
        json!({"chars": request.text.len()}),
    );

    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err("text is required".to_string());
    }

    let paths = ensure_assets(app)?;
    let mut settings = load_settings(&paths.app_data_dir);
    let signature = build_signature(&paths, &settings)?;
    let engine = signature.engine;
    let selectable_voices = voices_for_signature(&signature, None);
    let selected_voice = resolve_selected_voice(
        &selectable_voices,
        request.voice.as_deref().unwrap_or(settings.voice.as_str()),
    );
    let speed = normalize_speed(request.speed.unwrap_or(settings.speed));

    settings.voice = selected_voice.clone();
    settings.engine = engine.as_key().to_string();
    settings.speed = speed;
    set_active_engine_paths(
        &mut settings,
        PersistedEnginePaths {
            model_path: Some(signature.model_path.clone()),
            secondary_path: Some(signature.voices_path.clone()),
            voices_path: Some(signature.voices_path.clone()),
            tokens_path: Some(signature.tokens_path.clone()),
            data_dir: Some(signature.data_dir.clone()),
        },
    );
    settings.provider = Some(signature.provider.clone());
    settings.num_threads = Some(signature.num_threads as u32);
    settings.python_path = None;
    save_settings(&paths.app_data_dir, &settings)?;

    let engine_state = Arc::clone(&tts_state.engine);
    let text_clone = text.clone();
    let selected_voice_clone = selected_voice.clone();
    let signature_clone = signature.clone();
    let engine_key = engine.as_key().to_string();

    let result = tokio::task::spawn_blocking(move || {
        let mut guard = engine_state
            .lock()
            .map_err(|_| "sherpa tts engine lock poisoned".to_string())?;
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
            guard.insert(engine_key.clone(), create_sherpa_engine(&signature_clone)?);
        }
        let engine = guard
            .get_mut(engine_key.as_str())
            .ok_or_else(|| "sherpa engine unavailable".to_string())?;

        let mut gen_config = GenerationConfig::default();
        gen_config.speed = speed;
        gen_config.sid = voice_to_sid(&engine.voices, &selected_voice_clone);
        let generated = engine
            .tts
            .generate_with_config::<fn(&[f32], f32) -> bool>(&text_clone, &gen_config, None)
            .ok_or_else(|| "sherpa synthesis returned no audio".to_string())?;
        let samples = generated.samples().to_vec();
        let sample_rate = generated.sample_rate() as u32;
        let duration_ms = if sample_rate == 0 {
            0
        } else {
            ((samples.len() as f64 / sample_rate as f64) * 1000.0).round() as u32
        };
        let audio_bytes = wav_from_f32_samples(&samples, sample_rate.max(1));
        Ok::<SpeakResult, String>(SpeakResult {
            audio_bytes,
            sample_rate: sample_rate.max(1),
            duration_ms,
        })
    })
    .await
    .map_err(|e| format!("tts worker join error: {e}"))??;

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

pub async fn download_model(
    app: &AppHandle,
    request: TtsDownloadModelRequest,
    tts_state: &TTSState,
) -> Result<TtsDownloadModelResponse, String> {
    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.download_model",
        EventStage::Start,
        EventSeverity::Info,
        json!({ "url": request.url.clone().unwrap_or_default() }),
    );

    let paths = ensure_assets(app)?;
    let settings = load_settings(&paths.app_data_dir);
    if !matches!(resolve_engine(&settings), TtsEngine::Kokoro) {
        return Ok(TtsDownloadModelResponse {
            correlation_id: request.correlation_id,
            ok: false,
            message: "Model bundle download is currently available for Kokoro only.".to_string(),
            model_path: String::new(),
            voices_path: String::new(),
            tokens_path: String::new(),
            data_dir: String::new(),
        });
    }
    let target_url = request
        .url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_SHERPA_KOKORO_INT8_URL)
        .to_string();
    let archive_path = paths.kokoro_dir.join("model-download.tar.bz2");
    let extract_dir = paths.kokoro_dir.clone();
    let app_for_download = app.clone();
    let correlation_id = request.correlation_id.clone();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut response = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(15 * 60))
            .build()
            .map_err(|e| format!("failed creating HTTP client: {e}"))?
            .get(&target_url)
            .send()
            .map_err(|e| format!("failed downloading model bundle: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("download failed with HTTP {}", response.status()));
        }

        let mut out = fs::File::create(&archive_path)
            .map_err(|e| format!("failed creating archive path: {e}"))?;
        copy_response_with_progress(
            &app_for_download,
            &correlation_id,
            &mut response,
            &mut out,
            &target_url,
        )?;

        let archive_file = fs::File::open(&archive_path)
            .map_err(|e| format!("failed opening downloaded archive: {e}"))?;
        let decompressed = BzDecoder::new(archive_file);
        let mut archive = Archive::new(decompressed);
        archive
            .unpack(&extract_dir)
            .map_err(|e| format!("failed extracting model archive: {e}"))?;

        let _ = fs::remove_file(&archive_path);
        Ok(())
    })
    .await
    .map_err(|e| format!("download worker join error: {e}"))??;

    tts_state.shutdown();
    let refreshed_paths = ensure_assets(app)?;
    let settings = load_settings(&refreshed_paths.app_data_dir);
    let signature = build_signature(&refreshed_paths, &settings)?;

    emit_tts_event(
        app,
        &request.correlation_id,
        "tts.download_model",
        EventStage::Complete,
        EventSeverity::Info,
        json!({
            "ok": true,
            "modelPath": signature.model_path,
            "voicesPath": signature.voices_path,
            "tokensPath": signature.tokens_path,
            "dataDir": signature.data_dir,
        }),
    );

    Ok(TtsDownloadModelResponse {
        correlation_id: request.correlation_id,
        ok: true,
        message: "Downloaded and installed sherpa Kokoro model bundle.".to_string(),
        model_path: signature.model_path,
        voices_path: signature.voices_path,
        tokens_path: signature.tokens_path,
        data_dir: signature.data_dir,
    })
}
