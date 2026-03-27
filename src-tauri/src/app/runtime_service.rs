use crate::contracts::{
    EventSeverity, EventStage, LlamaRuntimeEngine, LlamaRuntimeInstallResponse,
    LlamaRuntimePrerequisite, LlamaRuntimeStartRequest, LlamaRuntimeStartResponse,
    LlamaRuntimeStatusResponse, LlamaRuntimeStopResponse, Subsystem,
};
use crate::observability::EventHub;
use flate2::read::GzDecoder;
use serde::Deserialize;
use serde_json::json;
use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_PORT: u16 = 1420;
const DEFAULT_CTX: u32 = 8192;
const DEFAULT_N_GPU_LAYERS: i32 = 999;
const HEALTH_TIMEOUT_SECS: u64 = 45;

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug)]
struct ActiveRuntime {
    engine_id: String,
    port: u16,
    _model_path: String,
    child: Child,
}

#[derive(Debug, Default)]
struct RuntimeState {
    status: String,
    active: Option<ActiveRuntime>,
}

#[derive(Clone)]
pub struct LlamaRuntimeService {
    hub: EventHub,
    state: Arc<Mutex<RuntimeState>>,
}

impl LlamaRuntimeService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            state: Arc::new(Mutex::new(RuntimeState {
                status: "idle".to_string(),
                active: None,
            })),
        }
    }

    pub fn status(&self, correlation_id: &str, app_data_dir: &Path) -> LlamaRuntimeStatusResponse {
        self.reconcile_process_state(correlation_id);
        let engines = detect_engines(app_data_dir);
        let (state, active_engine_id, endpoint, pid) = {
            let state = match self.state.try_lock() {
                Ok(guard) => guard,
                Err(_) => {
                    // Lock poisoned - return default idle state
                    return LlamaRuntimeStatusResponse {
                        correlation_id: correlation_id.to_string(),
                        state: "idle".to_string(),
                        active_engine_id: None,
                        endpoint: None,
                        pid: None,
                        engines,
                    };
                }
            };
            if let Some(active) = state.active.as_ref() {
                (
                    "healthy".to_string(),
                    Some(active.engine_id.clone()),
                    Some(format!("http://127.0.0.1:{}/v1", active.port)),
                    Some(active.child.id()),
                )
            } else {
                (state.status.clone(), None, None, None)
            }
        };
        self.emit(
            correlation_id,
            "llama.runtime.status",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "state": state, "activeEngineId": active_engine_id, "pid": pid }),
        );
        LlamaRuntimeStatusResponse {
            correlation_id: correlation_id.to_string(),
            state,
            active_engine_id,
            endpoint,
            pid,
            engines,
        }
    }

    pub fn install_engine(
        &self,
        correlation_id: &str,
        engine_id: &str,
        app_data_dir: &Path,
        bundled_binary: Option<PathBuf>,
    ) -> Result<LlamaRuntimeInstallResponse, String> {
        self.emit(
            correlation_id,
            "llama.runtime.install",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "engineId": engine_id }),
        );
        let target = engine_binary_path(app_data_dir, engine_id);
        let target_support_count = count_support_files(target.parent());
        let requires_support_files = engine_id != "llama.cpp-cpu";
        let should_repair_support =
            target.exists() && requires_support_files && target_support_count == 0;
        if target.exists() && !should_repair_support {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "engineId": engine_id, "installedPath": target.to_string_lossy() }),
            );
            return Ok(LlamaRuntimeInstallResponse {
                correlation_id: correlation_id.to_string(),
                engine_id: engine_id.to_string(),
                installed_path: target.to_string_lossy().to_string(),
            });
        }
        if should_repair_support {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "engineId": engine_id,
                    "message": "Detected missing runtime support libraries; repairing installation"
                }),
            );
        }

        let source = if let Some(path) = bundled_binary {
            path
        } else if let Some(path) = resolve_system_llama_server() {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "engineId": engine_id,
                    "message": "Using system llama-server binary from PATH",
                    "sourcePath": path.to_string_lossy()
                }),
            );
            path
        } else {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "engineId": engine_id,
                    "message": "No bundled/system binary found; fetching latest llama.cpp release metadata"
                }),
            );
            let downloaded = download_engine_binary(engine_id).map_err(|message| {
                self.emit(
                    correlation_id,
                    "llama.runtime.install",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "engineId": engine_id, "message": message }),
                );
                message
            })?;
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "engineId": engine_id,
                    "message": "Downloaded runtime asset; installing binary",
                    "sourcePath": downloaded.to_string_lossy()
                }),
            );
            downloaded
        };

        if !source.exists() {
            let message = format!(
                "Bundled binary path does not exist: {}",
                source.to_string_lossy()
            );
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": engine_id, "message": message }),
            );
            return Err(message);
        }
        if let Some(parent) = target.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let message = format!("failed creating install dir: {e}");
                self.emit(
                    correlation_id,
                    "llama.runtime.install",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "engineId": engine_id, "message": message }),
                );
                return Err(message);
            }
        }
        if let Err(e) = std::fs::copy(&source, &target) {
            let message = format!(
                "failed copying bundled runtime {} -> {}: {e}",
                source.to_string_lossy(),
                target.to_string_lossy()
            );
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": engine_id, "message": message }),
            );
            return Err(message);
        }
        if let Err(message) = set_executable_if_needed(&target) {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": engine_id, "message": message }),
            );
            return Err(message);
        }
        let support_files = copy_runtime_support_files(&source, &target).map_err(|message| {
            self.emit(
                correlation_id,
                "llama.runtime.install",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": engine_id, "message": message }),
            );
            message
        })?;

        self.emit(
            correlation_id,
            "llama.runtime.install",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "engineId": engine_id,
                "sourcePath": source.to_string_lossy(),
                "installedPath": target.to_string_lossy(),
                "supportFilesCopied": support_files
            }),
        );
        Ok(LlamaRuntimeInstallResponse {
            correlation_id: correlation_id.to_string(),
            engine_id: engine_id.to_string(),
            installed_path: target.to_string_lossy().to_string(),
        })
    }

    pub fn start(
        &self,
        request: &LlamaRuntimeStartRequest,
        app_data_dir: &Path,
    ) -> Result<LlamaRuntimeStartResponse, String> {
        self.emit(
            request.correlation_id.as_str(),
            "llama.runtime.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "engineId": request.engine_id,
                "modelPath": request.model_path,
                "port": request.port.unwrap_or(DEFAULT_PORT),
                "threads": request.threads,
                "batchSize": request.batch_size,
                "ubatchSize": request.ubatch_size,
                "temperature": request.temperature,
                "topP": request.top_p,
                "topK": request.top_k,
                "repeatPenalty": request.repeat_penalty,
                "flashAttn": request.flash_attn,
                "mmap": request.mmap,
                "mlock": request.mlock,
                "seed": request.seed
            }),
        );

        {
            let mut state = match self.state.try_lock() {
                Ok(guard) => guard,
                Err(_) => {
                    eprintln!("Warning: llama runtime lock poisoned, resetting status");
                    return Err("llama runtime lock poisoned".to_string());
                }
            };
            state.status = "starting".to_string();
            if let Some(active) = state.active.take() {
                let _ = terminate_process(active.child);
            }
        }

        let binary_path = engine_binary_path(app_data_dir, request.engine_id.as_str());
        if !binary_path.exists() {
            let message = format!(
                "Runtime engine binary not installed: {}",
                binary_path.to_string_lossy()
            );
            self.emit(
                request.correlation_id.as_str(),
                "llama.runtime.start",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": request.engine_id, "message": message }),
            );
            if let Ok(mut state) = self.state.try_lock() {
                state.status = "failed".to_string();
            } else {
                eprintln!("Warning: llama runtime lock poisoned when setting failed status");
            }
            return Err(message);
        }

        let port = request.port.unwrap_or(DEFAULT_PORT);
        let ctx = request.ctx_size.unwrap_or(DEFAULT_CTX);
        let ngl = request.n_gpu_layers.unwrap_or(DEFAULT_N_GPU_LAYERS);
        let threads = request.threads.filter(|v| *v > 0);
        let batch_size = request.batch_size.filter(|v| *v > 0);
        let ubatch_size = request.ubatch_size.filter(|v| *v > 0);
        let temperature = request.temperature.unwrap_or(0.7).clamp(0.0, 2.0);
        let top_p = request.top_p.unwrap_or(0.95).clamp(0.0, 1.0);
        let top_k = request.top_k.unwrap_or(40).max(1);
        let repeat_penalty = request.repeat_penalty.unwrap_or(1.1).max(0.0);
        let flash_attn = request.flash_attn.unwrap_or(false);
        let mmap = request.mmap.unwrap_or(true);
        let mlock = request.mlock.unwrap_or(false);
        let seed = request.seed;

        let mut command = Command::new(&binary_path);
        let engine_dir = binary_path
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| app_data_dir.to_path_buf());
        let disable_thinking_for_qwen =
            should_disable_thinking_for_model(request.model_path.as_str());
        command
            .arg("--model")
            .arg(request.model_path.as_str())
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg(ctx.to_string())
            .arg("-ngl")
            .arg(ngl.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(v) = threads {
            command.arg("--threads").arg(v.to_string());
        }
        if let Some(v) = batch_size {
            command.arg("--batch-size").arg(v.to_string());
        }
        if let Some(v) = ubatch_size {
            command.arg("--ubatch-size").arg(v.to_string());
        }
        command
            .arg("--temp")
            .arg(temperature.to_string())
            .arg("--top-p")
            .arg(top_p.to_string())
            .arg("--top-k")
            .arg(top_k.to_string())
            .arg("--repeat-penalty")
            .arg(repeat_penalty.to_string());
        if flash_attn {
            command.arg("--flash-attn");
        }
        if !mmap {
            command.arg("--no-mmap");
        }
        if mlock {
            command.arg("--mlock");
        }
        if let Some(v) = seed {
            command.arg("--seed").arg(v.to_string());
        }
        if disable_thinking_for_qwen {
            command
                .arg("--chat-template-kwargs")
                .arg(r#"{"enable_thinking": false}"#);
        }
        #[cfg(target_os = "linux")]
        {
            command.env(
                "LD_LIBRARY_PATH",
                prepend_env_path("LD_LIBRARY_PATH", &engine_dir),
            );
        }
        #[cfg(target_os = "macos")]
        {
            command.env(
                "DYLD_LIBRARY_PATH",
                prepend_env_path("DYLD_LIBRARY_PATH", &engine_dir),
            );
        }
        #[cfg(target_os = "windows")]
        {
            command.env("PATH", prepend_env_path("PATH", &engine_dir));
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to start llama-server: {e}"))?;
        let pid = child.id();

        if let Some(stdout) = child.stdout.take() {
            spawn_output_forwarder(
                self.hub.clone(),
                request.correlation_id.clone(),
                "llama.runtime.process.stdout",
                pid,
                stdout,
            );
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_output_forwarder(
                self.hub.clone(),
                request.correlation_id.clone(),
                "llama.runtime.process.stderr",
                pid,
                stderr,
            );
        }

        self.emit(
            request.correlation_id.as_str(),
            "llama.runtime.health",
            EventStage::Progress,
            EventSeverity::Info,
            json!({ "port": port, "timeoutSec": HEALTH_TIMEOUT_SECS }),
        );

        if !wait_for_port(port, HEALTH_TIMEOUT_SECS) {
            let _ = terminate_process(child);
            let message = format!(
                "llama-server failed health check on port {} within {}s",
                port, HEALTH_TIMEOUT_SECS
            );
            self.emit(
                request.correlation_id.as_str(),
                "llama.runtime.start",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "engineId": request.engine_id, "message": message }),
            );
            if let Ok(mut state) = self.state.try_lock() {
                state.status = "failed".to_string();
            }
            return Err(message);
        }

        {
            if let Ok(mut state) = self.state.try_lock() {
                state.status = "healthy".to_string();
                state.active = Some(ActiveRuntime {
                    engine_id: request.engine_id.clone(),
                    port,
                    _model_path: request.model_path.clone(),
                    child,
                });
            }
        }

        let endpoint = format!("http://127.0.0.1:{}/v1", port);
        self.emit(
            request.correlation_id.as_str(),
            "llama.runtime.start",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "engineId": request.engine_id,
                "pid": pid,
                "endpoint": endpoint,
                "chatTemplateKwargsNoThinking": disable_thinking_for_qwen
            }),
        );
        Ok(LlamaRuntimeStartResponse {
            correlation_id: request.correlation_id.clone(),
            engine_id: request.engine_id.clone(),
            endpoint,
            pid,
        })
    }

    pub fn stop(&self, correlation_id: &str) -> Result<LlamaRuntimeStopResponse, String> {
        self.emit(
            correlation_id,
            "llama.runtime.stop",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        );
        let active = {
            match self.state.try_lock() {
                Ok(mut state) => state.active.take(),
                Err(_) => {
                    return Err("llama runtime state lock poisoned".to_string());
                }
            }
        };
        if let Some(active) = active {
            terminate_process(active.child)?;
            if let Ok(mut state) = self.state.try_lock() {
                state.status = "stopped".to_string();
            }
            self.emit(
                correlation_id,
                "llama.runtime.stop",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "stopped": true }),
            );
            Ok(LlamaRuntimeStopResponse {
                correlation_id: correlation_id.to_string(),
                stopped: true,
            })
        } else {
            self.emit(
                correlation_id,
                "llama.runtime.stop",
                EventStage::Complete,
                EventSeverity::Warn,
                json!({ "stopped": false, "message": "no active runtime process" }),
            );
            Ok(LlamaRuntimeStopResponse {
                correlation_id: correlation_id.to_string(),
                stopped: false,
            })
        }
    }

    pub fn shutdown(&self, correlation_id: &str) {
        let active = {
            match self.state.try_lock() {
                Ok(mut state) => state.active.take(),
                Err(_) => None, // Lock poisoned - can't get active runtime
            }
        };

        if let Some(active) = active {
            let pid = active.child.id();
            match terminate_process(active.child) {
                Ok(()) => {
                    if let Ok(mut state) = self.state.try_lock() {
                        state.status = "stopped".to_string();
                    }
                    self.emit(
                        correlation_id,
                        "llama.runtime.shutdown",
                        EventStage::Complete,
                        EventSeverity::Info,
                        json!({ "stopped": true, "pid": pid }),
                    );
                }
                Err(message) => {
                    if let Ok(mut state) = self.state.try_lock() {
                        state.status = "failed".to_string();
                    }
                    self.emit(
                        correlation_id,
                        "llama.runtime.shutdown",
                        EventStage::Error,
                        EventSeverity::Error,
                        json!({ "stopped": false, "pid": pid, "message": message }),
                    );
                }
            }
        }
    }

    fn reconcile_process_state(&self, correlation_id: &str) {
        let mut exited: Option<(u32, String)> = None;
        {
            let mut state = match self.state.try_lock() {
                Ok(guard) => guard,
                Err(_) => return, // Can't check state if lock is poisoned
            };
            if let Some(active) = state.active.as_mut() {
                if let Ok(Some(exit_status)) = active.child.try_wait() {
                    let code = exit_status
                        .code()
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "signal".to_string());
                    exited = Some((active.child.id(), code));
                }
            }
            if exited.is_some() {
                state.active = None;
                state.status = "failed".to_string();
            }
        }
        if let Some((pid, code)) = exited {
            self.emit(
                correlation_id,
                "llama.runtime.process.exit",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "pid": pid, "exitCode": code }),
            );
        }
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

    /// Acquires the runtime state lock, handling poison gracefully.
    /// Returns None if the lock is poisoned (thread panicked while holding it).
    fn try_lock_state(&self) -> Option<std::sync::MutexGuard<'_, RuntimeState>> {
        match self.state.lock() {
            Ok(guard) => Some(guard),
            Err(_) => {
                // Lock was poisoned - a previous thread panicked while holding the lock.
                // Log this condition but don't panic - allow the application to continue.
                eprintln!("Warning: llama runtime state lock was poisoned; resetting to idle");
                None
            }
        }
    }

    /// Acquires the runtime state lock with a descriptive error.
    /// Use this when you need to propagate errors rather than recover silently.
    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, String> {
        self.state.lock().map_err(|_| "llama runtime state lock poisoned".to_string())
    }
}

impl Drop for LlamaRuntimeService {
    fn drop(&mut self) {
        // Last-resort cleanup for app shutdown paths where UI close events are skipped.
        self.shutdown("app-drop");
    }
}

fn set_executable_if_needed(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .map_err(|e| format!("failed reading runtime binary metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("failed setting runtime binary executable bit: {e}"))?;
    }
    Ok(())
}

fn wait_for_port(port: u16, timeout_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(600)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(450));
    }
    false
}

fn should_disable_thinking_for_model(model_path: &str) -> bool {
    let lower = model_path.to_ascii_lowercase();
    lower.contains("qwen")
}

fn terminate_process(mut child: Child) -> Result<(), String> {
    if let Err(e) = child.kill() {
        if let Some(code) = child.try_wait().ok().flatten() {
            let _ = code;
        } else {
            return Err(format!("failed killing llama-server process: {e}"));
        }
    }
    let _ = child.wait();
    Ok(())
}

fn spawn_output_forwarder<R>(
    hub: EventHub,
    correlation_id: String,
    action: &'static str,
    pid: u32,
    reader: R,
) where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = match buf.read_line(&mut line) {
                Ok(v) => v,
                Err(_) => break,
            };
            if bytes == 0 {
                break;
            }
            let payload = json!({
                "pid": pid,
                "line": line.trim_end(),
            });
            hub.emit(hub.make_event(
                correlation_id.as_str(),
                Subsystem::Runtime,
                action,
                EventStage::Progress,
                EventSeverity::Info,
                payload,
            ));
        }
    });
}

fn detect_engines(app_data_dir: &Path) -> Vec<LlamaRuntimeEngine> {
    let os = std::env::consts::OS;
    let mut engines = Vec::new();

    for (engine_id, backend, label, is_applicable) in [
        ("llama.cpp-cpu", "cpu", "llama.cpp (CPU)", true),
        (
            "llama.cpp-vulkan",
            "vulkan",
            "llama.cpp (Vulkan)",
            matches!(os, "linux" | "windows"),
        ),
        (
            "llama.cpp-cuda",
            "cuda",
            "llama.cpp (CUDA)",
            matches!(os, "linux" | "windows"),
        ),
        (
            "llama.cpp-rocm",
            "rocm",
            "llama.cpp (ROCm)",
            matches!(os, "linux"),
        ),
        (
            "llama.cpp-metal",
            "metal",
            "llama.cpp (Metal)",
            matches!(os, "macos"),
        ),
    ] {
        let binary = engine_binary_path(app_data_dir, engine_id);
        let is_installed = binary.exists();
        let prerequisites = backend_prerequisites(backend);
        let prereqs_ok = prerequisites.iter().all(|p| p.ok);
        engines.push(LlamaRuntimeEngine {
            engine_id: engine_id.to_string(),
            backend: backend.to_string(),
            label: label.to_string(),
            is_applicable,
            is_bundled: false,
            is_installed,
            is_ready: is_applicable && is_installed && prereqs_ok,
            binary_path: is_installed.then(|| binary.to_string_lossy().to_string()),
            prerequisites,
        });
    }

    engines
}

fn backend_prerequisites(backend: &str) -> Vec<LlamaRuntimePrerequisite> {
    match backend {
        "cuda" => vec![bool_prereq(
            "nvidia-smi",
            command_succeeds("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"]),
            "NVIDIA driver tooling",
        )],
        "vulkan" => vec![bool_prereq(
            "vulkan-runtime",
            detect_vulkan_runtime(),
            "Vulkan runtime/driver",
        )],
        "rocm" => vec![bool_prereq(
            "rocminfo",
            command_succeeds("rocminfo", &[]),
            "ROCm runtime",
        )],
        "metal" => vec![bool_prereq(
            "metal",
            cfg!(target_os = "macos"),
            "macOS Metal-capable runtime",
        )],
        _ => Vec::new(),
    }
}

fn detect_vulkan_runtime() -> bool {
    if command_succeeds("vulkaninfo", &["--summary"]) {
        return true;
    }

    #[cfg(target_os = "linux")]
    {
        let has_loader_lib = [
            "/usr/lib/libvulkan.so.1",
            "/usr/lib64/libvulkan.so.1",
            "/usr/lib/x86_64-linux-gnu/libvulkan.so.1",
            "/lib/x86_64-linux-gnu/libvulkan.so.1",
        ]
        .iter()
        .any(|p| std::path::Path::new(p).exists());

        let has_icd = ["/usr/share/vulkan/icd.d", "/etc/vulkan/icd.d"]
            .iter()
            .any(|p| {
                std::fs::read_dir(p)
                    .ok()
                    .map(|mut it| it.next().is_some())
                    .unwrap_or(false)
            });

        if has_loader_lib && has_icd {
            return true;
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(windir) = std::env::var("WINDIR") {
            let dll = std::path::Path::new(&windir)
                .join("System32")
                .join("vulkan-1.dll");
            if dll.exists() {
                return true;
            }
        }
    }

    false
}

fn bool_prereq(key: &str, ok: bool, message: &str) -> LlamaRuntimePrerequisite {
    LlamaRuntimePrerequisite {
        key: key.to_string(),
        ok,
        message: if ok {
            format!("Detected {}", message)
        } else {
            format!("Missing {}", message)
        },
    }
}

fn command_succeeds(program: &str, args: &[&str]) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        return Command::new(program)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

fn resolve_system_llama_server() -> Option<PathBuf> {
    let candidate_names: &[&str] = if cfg!(target_os = "windows") {
        &["llama-server.exe", "llama-server"]
    } else {
        &["llama-server"]
    };
    let path_os = std::env::var_os("PATH")?;
    for base in std::env::split_paths(&path_os) {
        for name in candidate_names {
            let candidate = base.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn prepend_env_path(var: &str, first: &Path) -> OsString {
    let mut parts = vec![first.to_path_buf()];
    if let Some(existing) = std::env::var_os(var) {
        parts.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(parts).unwrap_or_else(|_| first.as_os_str().to_os_string())
}

fn count_support_files(dir: Option<&Path>) -> usize {
    let Some(dir) = dir else { return 0 };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = path.file_name()?.to_str()?;
            is_runtime_support_file(name).then_some(())
        })
        .count()
}

fn copy_runtime_support_files(source_binary: &Path, target_binary: &Path) -> Result<usize, String> {
    let Some(source_dir) = source_binary.parent() else {
        return Ok(0);
    };
    let Some(target_dir) = target_binary.parent() else {
        return Ok(0);
    };

    let mut copied = 0usize;
    let entries = std::fs::read_dir(source_dir)
        .map_err(|e| format!("failed listing runtime support files: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path == source_binary {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_runtime_support_file(name) {
            continue;
        }
        let dest = target_dir.join(name);
        std::fs::copy(&path, &dest).map_err(|e| {
            format!(
                "failed copying runtime support file {} -> {}: {e}",
                path.to_string_lossy(),
                dest.to_string_lossy()
            )
        })?;
        copied += 1;
    }
    Ok(copied)
}

fn is_runtime_support_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    {
        return lower.ends_with(".dll");
    }
    #[cfg(target_os = "macos")]
    {
        return lower.ends_with(".dylib");
    }
    #[cfg(target_os = "linux")]
    {
        return lower.ends_with(".so")
            || lower.contains(".so.")
            || lower.ends_with(".bin")
            || lower.ends_with(".dat");
    }
    #[allow(unreachable_code)]
    false
}

fn download_engine_binary(engine_id: &str) -> Result<PathBuf, String> {
    let release: GithubRelease = http_client(10)?
        .get("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest")
        .header("User-Agent", "arxell-lite-runtime-installer")
        .send()
        .map_err(|e| {
            format!(
                "failed requesting llama.cpp releases (network/proxy/firewall issue likely): {e}"
            )
        })?
        .error_for_status()
        .map_err(|e| format!("failed fetching llama.cpp release metadata: {e}"))?
        .json()
        .map_err(|e| format!("failed parsing llama.cpp release metadata: {e}"))?;

    let asset = select_release_asset(
        engine_id,
        std::env::consts::OS,
        std::env::consts::ARCH,
        release.assets.as_slice(),
    )
    .ok_or_else(|| {
        format!(
            "No compatible llama.cpp release asset found for engine {} on {}-{} (release {}).",
            engine_id,
            std::env::consts::OS,
            std::env::consts::ARCH,
            release.tag_name
        )
    })?;

    let download_root = std::env::temp_dir()
        .join("arxell-lite")
        .join("llama-runtime-downloads")
        .join(engine_id)
        .join(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|_| "now".to_string()),
        );
    std::fs::create_dir_all(&download_root)
        .map_err(|e| format!("failed creating runtime download directory: {e}"))?;
    let archive_path = download_root.join(asset.name.as_str());
    let mut response = http_client(90)?
        .get(asset.browser_download_url.as_str())
        .header("User-Agent", "arxell-lite-runtime-installer")
        .send()
        .map_err(|e| format!("failed downloading runtime asset {}: {e}", asset.name))?
        .error_for_status()
        .map_err(|e| format!("failed downloading runtime asset {}: {e}", asset.name))?;
    let mut out = std::fs::File::create(&archive_path)
        .map_err(|e| format!("failed creating runtime archive file: {e}"))?;
    std::io::copy(&mut response, &mut out)
        .map_err(|e| format!("failed writing runtime archive file: {e}"))?;

    let extract_dir = download_root.join("extract");
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("failed creating extraction directory: {e}"))?;
    extract_archive(&archive_path, &extract_dir)?;
    let binary_name = engine_binary_filename();
    find_binary_recursive(&extract_dir, binary_name).ok_or_else(|| {
        format!(
            "Downloaded asset {} did not contain {}",
            asset.name, binary_name
        )
    })
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("failed creating HTTP client: {e}"))
}

fn select_release_asset(
    engine_id: &str,
    os_key: &str,
    arch_key: &str,
    assets: &[GithubAsset],
) -> Option<GithubAsset> {
    let arch_keywords = match arch_key {
        "x86_64" => vec!["x64", "x86_64"],
        "aarch64" => vec!["arm64", "aarch64"],
        other => vec![other],
    };

    let mut required = Vec::new();
    let mut forbidden = Vec::new();
    match (os_key, engine_id) {
        ("linux", "llama.cpp-cpu") => {
            required.extend(["ubuntu"]);
            forbidden.extend([
                "vulkan", "cuda", "rocm", "hip", "aclgraph", "s390x", "cudart",
            ]);
        }
        ("linux", "llama.cpp-vulkan") => {
            required.extend(["ubuntu", "vulkan"]);
            forbidden.extend(["cuda", "rocm", "hip", "aclgraph", "s390x", "cudart"]);
        }
        ("linux", "llama.cpp-cuda") => {
            required.extend(["ubuntu", "cuda"]);
            forbidden.extend(["vulkan", "rocm", "hip", "aclgraph", "s390x"]);
        }
        ("linux", "llama.cpp-rocm") => {
            required.extend(["ubuntu", "rocm"]);
            forbidden.extend(["vulkan", "cuda", "aclgraph", "s390x"]);
        }
        ("windows", "llama.cpp-cpu") => {
            required.extend(["win", "cpu"]);
            forbidden.extend(["vulkan", "cuda", "hip", "cudart"]);
        }
        ("windows", "llama.cpp-vulkan") => {
            required.extend(["win", "vulkan"]);
            forbidden.extend(["cuda", "hip", "cudart"]);
        }
        ("windows", "llama.cpp-cuda") => {
            required.extend(["win", "cuda"]);
            forbidden.extend(["vulkan", "hip"]);
        }
        ("windows", "llama.cpp-rocm") => {
            required.extend(["win", "hip"]);
            forbidden.extend(["vulkan", "cuda", "cudart"]);
        }
        ("macos", "llama.cpp-metal") => {
            required.extend(["macos"]);
            forbidden.extend(["xcframework"]);
        }
        ("macos", "llama.cpp-cpu") => {
            required.extend(["macos"]);
            forbidden.extend(["xcframework"]);
        }
        _ => return None,
    }

    let mut candidates = Vec::new();
    for asset in assets {
        let name = asset.name.to_lowercase();
        if !required.iter().all(|key| name.contains(key)) {
            continue;
        }
        if forbidden.iter().any(|key| name.contains(key)) {
            continue;
        }
        if !arch_keywords.iter().any(|key| name.contains(key)) {
            continue;
        }
        candidates.push(asset.clone());
    }
    candidates.sort_by_key(|asset| asset.name.len());
    candidates.pop()
}

fn extract_archive(archive_path: &Path, out_dir: &Path) -> Result<(), String> {
    let name = archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".zip") {
        let file = std::fs::File::open(archive_path)
            .map_err(|e| format!("failed opening zip archive: {e}"))?;
        let mut zip =
            zip::ZipArchive::new(file).map_err(|e| format!("failed reading zip archive: {e}"))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| format!("failed reading zip entry {i}: {e}"))?;
            let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let target = out_dir.join(rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&target)
                    .map_err(|e| format!("failed creating extracted directory: {e}"))?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("failed creating extracted parent directory: {e}"))?;
            }
            let mut out = std::fs::File::create(&target)
                .map_err(|e| format!("failed creating extracted file: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("failed extracting zip entry: {e}"))?;
        }
        return Ok(());
    }
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let file = std::fs::File::open(archive_path)
            .map_err(|e| format!("failed opening tar archive: {e}"))?;
        let gz = GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive
            .unpack(out_dir)
            .map_err(|e| format!("failed extracting tar archive: {e}"))?;
        return Ok(());
    }
    Err(format!(
        "unsupported runtime archive format: {}",
        archive_path.to_string_lossy()
    ))
}

fn find_binary_recursive(root: &Path, binary_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_binary_recursive(&path, binary_name) {
                return Some(found);
            }
            continue;
        }
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case(binary_name))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

pub fn engine_binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

pub fn engine_binary_path(app_data_dir: &Path, engine_id: &str) -> PathBuf {
    app_data_dir
        .join("llama-runtime")
        .join(engine_id)
        .join(engine_binary_filename())
}
