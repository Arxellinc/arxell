use crate::contracts::{
    EventSeverity, EventStage, LlamaRuntimeEngine, LlamaRuntimeInstallResponse,
    LlamaRuntimePrerequisite, LlamaRuntimeStartRequest, LlamaRuntimeStartResponse,
    LlamaRuntimeStatusResponse, LlamaRuntimeStopResponse, Subsystem,
};
use crate::observability::EventHub;
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_CTX: u32 = 8192;
const DEFAULT_N_GPU_LAYERS: i32 = 999;
const HEALTH_TIMEOUT_SECS: u64 = 45;

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
            let state = self.state.lock().expect("llama runtime lock poisoned");
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
        if target.exists() {
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

        let source = bundled_binary.ok_or_else(|| {
            "No bundled llama-server binary found for this engine/platform. Add a binary under src-tauri/resources/llama-runtime/<engine-id>/."
                .to_string()
        })?;

        if !source.exists() {
            return Err(format!(
                "Bundled binary path does not exist: {}",
                source.to_string_lossy()
            ));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed creating install dir: {e}"))?;
        }
        std::fs::copy(&source, &target).map_err(|e| {
            format!(
                "failed copying bundled runtime {} -> {}: {e}",
                source.to_string_lossy(),
                target.to_string_lossy()
            )
        })?;
        set_executable_if_needed(&target)?;

        self.emit(
            correlation_id,
            "llama.runtime.install",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "engineId": engine_id,
                "sourcePath": source.to_string_lossy(),
                "installedPath": target.to_string_lossy()
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
            }),
        );

        {
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
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
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
            state.status = "failed".to_string();
            return Err(message);
        }

        let port = request.port.unwrap_or(DEFAULT_PORT);
        let ctx = request.ctx_size.unwrap_or(DEFAULT_CTX);
        let ngl = request.n_gpu_layers.unwrap_or(DEFAULT_N_GPU_LAYERS);

        let mut command = Command::new(&binary_path);
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
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
            state.status = "failed".to_string();
            return Err(message);
        }

        {
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
            state.status = "healthy".to_string();
            state.active = Some(ActiveRuntime {
                engine_id: request.engine_id.clone(),
                port,
                _model_path: request.model_path.clone(),
                child,
            });
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
                "endpoint": endpoint
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
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
            state.active.take()
        };
        if let Some(active) = active {
            terminate_process(active.child)?;
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
            state.status = "stopped".to_string();
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

    fn reconcile_process_state(&self, correlation_id: &str) {
        let mut exited: Option<(u32, String)> = None;
        {
            let mut state = self.state.lock().expect("llama runtime lock poisoned");
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
        "cuda" => vec![
            bool_prereq(
                "nvidia-smi",
                command_succeeds("nvidia-smi", &["--query-gpu=name", "--format=csv,noheader"]),
                "NVIDIA driver tooling",
            ),
            bool_prereq(
                "nvcc",
                command_succeeds("nvcc", &["--version"]),
                "CUDA toolkit",
            ),
        ],
        "vulkan" => vec![bool_prereq(
            "vulkaninfo",
            command_succeeds("vulkaninfo", &["--summary"]),
            "Vulkan runtime/driver",
        )],
        "rocm" => vec![bool_prereq(
            "rocminfo",
            std::path::Path::new("/opt/rocm").exists() || command_succeeds("rocminfo", &[]),
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
