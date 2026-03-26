#![cfg(feature = "tauri-runtime")]

use crate::contracts::{EventSeverity, EventStage, Subsystem, TtsEngineStatusResponse, TtsSpeakResponse};
use crate::observability::EventHub;
use serde_json::json;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut Command) {}

#[derive(Clone)]
pub struct TtsService {
    hub: EventHub,
    daemon: Arc<Mutex<Option<KokoroDaemon>>>,
}

impl TtsService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            daemon: Arc::new(Mutex::new(None)),
        }
    }

    pub fn check_engine_status(&self, app: &AppHandle, correlation_id: &str) -> TtsEngineStatusResponse {
        let resolved = resolve_paths(app);
        let mut reason = None;

        let ready = match resolved {
            Ok(paths) => {
                if let Err(err) = deploy_kokoro_assets(app, &paths.kokoro_dir) {
                    reason = Some(format!("asset_deploy_failed: {err}"));
                    false
                } else if !paths.model_path.exists() {
                    reason = Some(format!("model_missing: {}", paths.model_path.display()));
                    false
                } else if !paths.voice_path.exists() {
                    reason = Some(format!("voice_missing: {}", paths.voice_path.display()));
                    false
                } else if !python_has_runtime(&paths.python_bin) {
                    reason = Some(format!("runtime_import_failed: {}", paths.python_bin.display()));
                    false
                } else {
                    true
                }
            }
            Err(err) => {
                reason = Some(err);
                false
            }
        };

        let response = TtsEngineStatusResponse {
            correlation_id: correlation_id.to_string(),
            engine: "kokoro".to_string(),
            ready,
            reason,
        };

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "tts.engine.status",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "engine": response.engine, "ready": response.ready, "reason": response.reason }),
        ));

        response
    }

    pub fn speak(
        &self,
        app: &AppHandle,
        correlation_id: &str,
        text: &str,
        voice: Option<&str>,
        language: Option<&str>,
        speed: Option<f32>,
    ) -> Result<TtsSpeakResponse, String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("text is empty".to_string());
        }

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "tts.request",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "engine": "kokoro", "chars": trimmed.len() }),
        ));

        let paths = resolve_paths(app)?;
        deploy_kokoro_assets(app, &paths.kokoro_dir)?;

        let mut guard = self.daemon.lock().map_err(|_| "tts daemon lock poisoned".to_string())?;
        let needs_new = guard
            .as_ref()
            .map(|d| d.model_path != paths.model_path || d.voice_path != paths.voice_path || d.python_bin != paths.python_bin)
            .unwrap_or(true);
        if needs_new {
            *guard = Some(KokoroDaemon::new(&paths));
        }

        let daemon = guard
            .as_mut()
            .ok_or_else(|| "failed to initialize kokoro daemon".to_string())?;
        let selected_voice = voice
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .unwrap_or("af_heart");
        let selected_language = language
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .unwrap_or("en-us");
        let selected_speed = speed.unwrap_or(1.0).clamp(0.7, 1.4);
        let audio = daemon.speak(trimmed, selected_voice, selected_language, selected_speed)?;

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "tts.request",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "engine": "kokoro", "audioBytes": audio.len(), "voice": selected_voice, "language": selected_language, "speed": selected_speed }),
        ));

        Ok(TtsSpeakResponse {
            correlation_id: correlation_id.to_string(),
            engine: "kokoro".to_string(),
            audio_bytes: audio,
        })
    }

    pub fn list_voices(&self, app: &AppHandle, correlation_id: &str) -> Result<Vec<String>, String> {
        let paths = resolve_paths(app)?;
        deploy_kokoro_assets(app, &paths.kokoro_dir)?;

        let mut voices = Vec::new();
        let entries = std::fs::read_dir(&paths.kokoro_dir)
            .map_err(|e| format!("failed to list kokoro dir: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("bin") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                voices.push(stem.to_string());
            }
        }
        voices.sort();
        voices.dedup();
        if !voices.iter().any(|v| v == "af_heart") {
            voices.insert(0, "af_heart".to_string());
        }

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "tts.voices.list",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": voices.len() }),
        ));

        Ok(voices)
    }
}

struct KokoroPaths {
    kokoro_dir: PathBuf,
    model_path: PathBuf,
    voice_path: PathBuf,
    script_path: PathBuf,
    python_bin: PathBuf,
}

fn resolve_paths(app: &AppHandle) -> Result<KokoroPaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let kokoro_dir = app_data_dir.join("kokoro");
    std::fs::create_dir_all(&kokoro_dir).map_err(|e| format!("failed to create kokoro dir: {e}"))?;

    let model_path = kokoro_dir.join("model_quantized.onnx");
    let voice_path = kokoro_dir.join("af_heart.bin");

    let script_path = resolve_existing_resource_path(
        app,
        &[
            "resources/scripts/voice/tts_kokoro_persistent.py",
            "scripts/voice/tts_kokoro_persistent.py",
        ],
    )
    .ok_or_else(|| "unable to resolve bundled tts_kokoro_persistent.py".to_string())?;

    let python_bin = resolve_python_bin(app, &kokoro_dir)?;

    Ok(KokoroPaths {
        kokoro_dir,
        model_path,
        voice_path,
        script_path,
        python_bin,
    })
}

fn deploy_kokoro_assets(app: &AppHandle, kokoro_dir: &Path) -> Result<(), String> {
    let model_dest = kokoro_dir.join("model_quantized.onnx");
    if !model_dest.exists() {
        let src = resolve_existing_resource_path(
            app,
            &[
                "resources/voice/model_quantized.onnx",
                "voice/model_quantized.onnx",
            ],
        )
        .ok_or_else(|| "bundled model_quantized.onnx not found".to_string())?;
        std::fs::copy(src, &model_dest)
            .map_err(|e| format!("failed to copy model_quantized.onnx into app data: {e}"))?;
    }

    if let Some(voice_dir) = resolve_existing_resource_path(app, &["resources/voice", "voice"]) {
        if let Ok(entries) = std::fs::read_dir(&voice_dir) {
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let src = entry.path();
                if !src.is_file() {
                    continue;
                }
                if src.extension().and_then(|e| e.to_str()) != Some("bin") {
                    continue;
                }
                let Some(name) = src.file_name() else { continue };
                let dest = kokoro_dir.join(name);
                if !dest.exists() {
                    std::fs::copy(&src, &dest).map_err(|e| {
                        format!(
                            "failed to copy {} into app data: {e}",
                            src.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("voice asset")
                        )
                    })?;
                }
            }
        }
    }

    let voice_dest = kokoro_dir.join("af_heart.bin");
    if !voice_dest.exists() {
        return Err("bundled af_heart.bin not found".to_string());
    }

    Ok(())
}

fn resolve_python_bin(app: &AppHandle, kokoro_dir: &Path) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("ARXELL_KOKORO_PYTHON") {
        let path = PathBuf::from(raw.trim());
        if path.exists() && python_has_runtime(&path) {
            return Ok(path);
        }
    }

    let runtime_candidates = kokoro_runtime_python_candidates(kokoro_dir);
    for candidate in &runtime_candidates {
        if candidate.exists() && python_has_runtime(candidate) {
            return Ok(candidate.clone());
        }
    }

    if let Some(extracted_python) = ensure_runtime_extracted(app, kokoro_dir)? {
        if python_has_runtime(&extracted_python) {
            return Ok(extracted_python);
        }
    }

    let fallback = default_python_bin();
    if python_has_runtime(&fallback) {
        return Ok(fallback);
    }

    Err(format!(
        "python runtime missing: set ARXELL_KOKORO_PYTHON or bundle kokoro runtime archive ({})",
        kokoro_runtime_archive_name()
    ))
}

fn default_python_bin() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from("python")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("python3")
    }
}

fn kokoro_runtime_python_candidates(kokoro_dir: &Path) -> Vec<PathBuf> {
    let venv_dir = kokoro_dir.join("runtime").join("venv");
    #[cfg(target_os = "windows")]
    {
        vec![venv_dir.join("Scripts").join("python.exe"), venv_dir.join("python.exe")]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![venv_dir.join("bin").join("python3"), venv_dir.join("bin").join("python")]
    }
}

fn ensure_runtime_extracted(app: &AppHandle, kokoro_dir: &Path) -> Result<Option<PathBuf>, String> {
    let archive_name = kokoro_runtime_archive_name();
    let archive_path = resolve_existing_resource_path(
        app,
        &[
            &format!("resources/kokoro-runtime/{archive_name}"),
            &format!("kokoro-runtime/{archive_name}"),
        ],
    );

    let Some(archive_path) = archive_path else {
        return Ok(None);
    };

    let runtime_dir = kokoro_dir.join("runtime").join("venv");
    if !runtime_dir.exists() {
        extract_zip_archive(&archive_path, &runtime_dir)?;
        #[cfg(unix)]
        chmod_runtime_binaries(&runtime_dir)?;
    }

    for candidate in kokoro_runtime_python_candidates(kokoro_dir) {
        if candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    Ok(None)
}

fn kokoro_runtime_archive_name() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-linux-x86_64.zip";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-linux-aarch64.zip";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-macos-x86_64.zip";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-macos-aarch64.zip";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "kokoro-runtime-windows-x86_64.zip";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "kokoro-runtime-windows-aarch64.zip";
    }
    #[allow(unreachable_code)]
    "kokoro-runtime-unknown.zip"
}

fn extract_zip_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path)
        .map_err(|e| format!("failed to open runtime archive {}: {e}", archive_path.display()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("failed to parse runtime archive: {e}"))?;

    let tmp_dir = dest_dir.with_extension("tmp-extract");
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("failed to create temp dir: {e}"))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("failed to read runtime archive entry {idx}: {e}"))?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = tmp_dir.join(rel_path);
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("failed to create runtime dir {}: {e}", out_path.display()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create runtime path {}: {e}", parent.display()))?;
        }
        let mut out_file = std::fs::File::create(&out_path)
            .map_err(|e| format!("failed to create runtime file {}: {e}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("failed to extract runtime file {}: {e}", out_path.display()))?;
    }

    let extract_root = if tmp_dir.join("venv").is_dir() {
        tmp_dir.join("venv")
    } else {
        tmp_dir.clone()
    };

    if dest_dir.exists() {
        std::fs::remove_dir_all(dest_dir)
            .map_err(|e| format!("failed to replace runtime directory {}: {e}", dest_dir.display()))?;
    }
    std::fs::rename(&extract_root, dest_dir).map_err(|e| {
        format!(
            "failed to finalize runtime extraction {} -> {}: {e}",
            extract_root.display(),
            dest_dir.display()
        )
    })?;

    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    Ok(())
}

#[cfg(unix)]
fn chmod_runtime_binaries(runtime_dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let bin_dir = runtime_dir.join("bin");
    if !bin_dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&bin_dir).map_err(|e| format!("failed to read runtime bin/: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let mut perm = std::fs::metadata(&path)
            .map_err(|e| format!("failed to read permissions for {}: {e}", path.display()))?
            .permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&path, perm)
            .map_err(|e| format!("failed to set executable permission on {}: {e}", path.display()))?;
    }
    Ok(())
}

fn resolve_existing_resource_path(app: &AppHandle, candidates: &[&str]) -> Option<PathBuf> {
    for rel in candidates {
        if let Ok(path) = app.path().resolve(rel, tauri::path::BaseDirectory::Resource) {
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

fn python_has_runtime(python_bin: &Path) -> bool {
    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", "import kokoro_onnx, onnxruntime, numpy"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

struct KokoroDaemon {
    child: Option<Child>,
    python_bin: PathBuf,
    script_path: PathBuf,
    model_path: PathBuf,
    voice_path: PathBuf,
    chunk_id: u32,
}

impl KokoroDaemon {
    fn new(paths: &KokoroPaths) -> Self {
        Self {
            child: None,
            python_bin: paths.python_bin.clone(),
            script_path: paths.script_path.clone(),
            model_path: paths.model_path.clone(),
            voice_path: paths.voice_path.clone(),
            chunk_id: 0,
        }
    }

    fn ensure_running(&mut self) -> Result<(), String> {
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => {
                    self.child = None;
                }
            }
        }

        let mut cmd = Command::new(&self.python_bin);
        cmd.args([
            self.script_path.to_string_lossy().as_ref(),
            "--model",
            self.model_path.to_string_lossy().as_ref(),
            "--voices",
            self.voice_path.to_string_lossy().as_ref(),
            "--default-voice",
            "af_heart",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        apply_no_window(&mut cmd);

        let child = cmd
            .spawn()
            .map_err(|e| format!("failed to start kokoro daemon: {e}"))?;
        self.child = Some(child);
        Ok(())
    }

    fn speak(&mut self, text: &str, voice: &str, language: &str, speed: f32) -> Result<Vec<u8>, String> {
        self.ensure_running()?;

        let result = self.speak_inner(text, voice, language, speed);
        if let Err(err) = &result {
            if is_transport_error(err) {
                if let Some(mut child) = self.child.take() {
                    let _ = child.kill();
                }
            }
        }
        result
    }

    fn speak_inner(&mut self, text: &str, voice: &str, language: &str, speed: f32) -> Result<Vec<u8>, String> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| "kokoro daemon unavailable".to_string())?;

        self.chunk_id = self.chunk_id.wrapping_add(1);
        let payload = serde_json::json!({
            "text": text,
            "chunk_id": self.chunk_id,
            "voice": voice,
            "lang": language,
            "speed": speed
        })
        .to_string()
        .into_bytes();

        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "daemon stdin unavailable".to_string())?;
        stdin
            .write_all(&(payload.len() as u32).to_le_bytes())
            .map_err(|e| format!("failed to write request length: {e}"))?;
        stdin
            .write_all(&payload)
            .map_err(|e| format!("failed to write request payload: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("failed to flush request payload: {e}"))?;

        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| "daemon stdout unavailable".to_string())?;

        let mut len_buf = [0u8; 4];
        stdout
            .read_exact(&mut len_buf)
            .map_err(|e| format!("failed to read metadata length: {e}"))?;
        let meta_len = u32::from_le_bytes(len_buf) as usize;
        if meta_len > 1024 * 1024 {
            return Err(format!("daemon metadata too large: {meta_len}"));
        }

        let mut meta_buf = vec![0u8; meta_len];
        stdout
            .read_exact(&mut meta_buf)
            .map_err(|e| format!("failed to read metadata payload: {e}"))?;
        let meta: serde_json::Value = serde_json::from_slice(&meta_buf)
            .map_err(|e| format!("failed to parse metadata payload: {e}"))?;

        let status = meta
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("error");
        if status != "ok" {
            let msg = meta
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown daemon error");
            return Err(format!("daemon synthesis error: {msg}"));
        }

        stdout
            .read_exact(&mut len_buf)
            .map_err(|e| format!("failed to read audio length: {e}"))?;
        let audio_len = u32::from_le_bytes(len_buf) as usize;
        if audio_len == 0 {
            return Err("daemon returned empty audio".to_string());
        }

        let mut audio = vec![0u8; audio_len];
        stdout
            .read_exact(&mut audio)
            .map_err(|e| format!("failed to read audio payload: {e}"))?;
        Ok(audio)
    }
}

fn is_transport_error(err: &str) -> bool {
    err.contains("failed to write")
        || err.contains("failed to read")
        || err.contains("metadata")
        || err.contains("daemon stdout unavailable")
        || err.contains("daemon stdin unavailable")
}
