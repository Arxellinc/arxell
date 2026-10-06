//! WhisperSupervisor manages the whisper.cpp child process lifecycle.
//!
//! INTERFACE CONTRACT — LlamaSupervisor and TTSSupervisor will follow this same pattern:
//!   - new() -> Self  (does not spawn the process)
//!   - async start(app: &AppHandle) -> Result<()>  (spawns, waits for ready)
//!   - async stop() -> Result<()>  (clean shutdown)
//!   - async restart(app: &AppHandle) -> Result<()>  (stop + start)
//!   - async health_check() -> bool
//!   - fn status() -> SupervisorStatus
//!   - fn endpoint() -> Option<String>
//!
//! This ensures all AI supervisors share a common interface for future phases.

use super::runtime_files::{self, StagedWhisper};
#[cfg(feature = "tauri-runtime")]
use crate::app_paths;
#[cfg(feature = "tauri-runtime")]
use crate::stt::events::{PipelineErrorPayload, STTStatusPayload};
use log::{info, warn};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
#[cfg(feature = "tauri-runtime")]
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Child;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::Duration;

/// Platform-specific binary names for whisper.cpp server
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const WHISPER_BINARY: &str = "whisper-server-windows-x86_64.exe";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const WHISPER_BINARY: &str = "whisper-server-macos-aarch64";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const WHISPER_BINARY: &str = "whisper-server-macos-x86_64";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const WHISPER_BINARY: &str = "whisper-server-linux-x86_64";
#[cfg(not(any(
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "x86_64")
)))]
const WHISPER_BINARY: &str = "whisper-server-unknown";

fn strip_unc_prefix(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s))
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}

/// Status of the supervisor
#[derive(Debug, Clone)]
pub enum SupervisorStatus {
    Starting,
    Running,
    Stopped,
    Error(String),
}

/// WhisperSupervisor manages the whisper.cpp server process.
pub struct WhisperSupervisor {
    status: Arc<Mutex<SupervisorStatus>>,
    port: AtomicU32,
    endpoint: Arc<Mutex<Option<String>>>,
    child: Arc<Mutex<Option<Child>>>,
    model_path: Mutex<Option<PathBuf>>,
    staged_runtime: Mutex<Option<StagedWhisper>>,
    lifecycle: Mutex<()>,
    stop_generation: AtomicU64,
    shutdown_requested: Arc<AtomicBool>,
    health_check_task: Mutex<Option<JoinHandle<()>>>,
}

impl WhisperSupervisor {
    /// Create a new WhisperSupervisor without spawning the process.
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(SupervisorStatus::Stopped)),
            port: AtomicU32::new(0),
            endpoint: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            model_path: Mutex::new(None),
            staged_runtime: Mutex::new(None),
            lifecycle: Mutex::new(()),
            stop_generation: AtomicU64::new(0),
            shutdown_requested: Arc::new(AtomicBool::new(false)),
            health_check_task: Mutex::new(None),
        }
    }

    /// Get current status.
    pub async fn status(&self) -> SupervisorStatus {
        self.status.lock().await.clone()
    }

    /// Get the server endpoint URL.
    pub async fn endpoint(&self) -> Option<String> {
        self.endpoint.lock().await.clone()
    }

    /// Get the current port.
    pub fn port(&self) -> u32 {
        self.port.load(Ordering::SeqCst)
    }

    /// Start the whisper.cpp server.
    pub async fn start(&self, app: &AppHandle) -> Result<(), String> {
        let generation = self.stop_generation.load(Ordering::SeqCst);
        let _operation = self.lifecycle.lock().await;
        if generation != self.stop_generation.load(Ordering::SeqCst) {
            return Err("Whisper startup cancelled".to_string());
        }
        if !matches!(*self.status.lock().await, SupervisorStatus::Running) {
            self.stop_inner().await?;
        }
        let result = self.start_inner(app, generation).await;
        if let Err(ref message) = result {
            let _ = self.stop_inner().await;
            *self.status.lock().await = SupervisorStatus::Error(message.clone());
            let _ = app.emit(
                "stt://status",
                STTStatusPayload {
                    status: "error".to_string(),
                    message: Some(message.clone()),
                },
            );
        }
        result
    }

    async fn start_inner(&self, app: &AppHandle, generation: u64) -> Result<(), String> {
        if self.stop_generation.load(Ordering::SeqCst) != generation {
            return Err("Whisper startup cancelled".to_string());
        }
        // Check if already running
        {
            let status = self.status.lock().await;
            if matches!(*status, SupervisorStatus::Running) {
                return Ok(());
            }
        }

        // Ensure any stale health-check loop is stopped before starting again.
        if let Some(task) = self.health_check_task.lock().await.take() {
            task.abort();
        }
        self.shutdown_requested.store(false, Ordering::SeqCst);

        // Mark as starting
        *self.status.lock().await = SupervisorStatus::Starting;

        // Emit status event
        let _ = app.emit(
            "stt://status",
            STTStatusPayload {
                status: "starting".to_string(),
                message: None,
            },
        );

        // Find free port
        let port = find_free_port()?;
        self.port.store(port, Ordering::SeqCst);

        // Resolve binary path
        let binary_path = resolve_whisper_binary(app)?;
        let staged = runtime_files::stage(&binary_path)?;
        let launch_binary_path = staged.binary.clone();
        *self.staged_runtime.lock().await = Some(staged);

        // Resolve model path
        let model_path = resolve_model_path(app)?;

        // Store model path for health check logging
        *self.model_path.lock().await = Some(model_path.clone());

        // Pre-spawn platform preparation
        #[cfg(not(target_os = "windows"))]
        {
            // chmod the binary on Unix
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&launch_binary_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                if let Err(e) = std::fs::set_permissions(&launch_binary_path, perms) {
                    warn!("Failed to chmod {}: {}", launch_binary_path.display(), e);
                }
            }
        }

        // Calculate thread count (half of logical CPUs, clamped to [2, 8])
        let threads = num_cpus::get();
        let threads = (threads / 2).max(2).min(8);

        info!(
            "Starting whisper.cpp server: binary={}, port={}, threads={}",
            launch_binary_path.display(),
            port,
            threads
        );
        info!("Model path: {}", model_path.display());

        // Spawn the whisper.cpp server
        let mut command = tokio::process::Command::new(&launch_binary_path);
        let loader_var = if cfg!(target_os = "windows") {
            "PATH"
        } else if cfg!(target_os = "macos") {
            "DYLD_LIBRARY_PATH"
        } else {
            "LD_LIBRARY_PATH"
        };
        command.env(
            loader_var,
            runtime_files::loader_path(&launch_binary_path, std::env::var_os(loader_var))?,
        );
        let mut child = command
            .kill_on_drop(true)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--model",
                &model_path.to_string_lossy(),
                "--threads",
                &threads.to_string(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn whisper.cpp: {}", e))?;

        // Log stderr output in a background task
        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    info!("whisper.cpp: {}", line);
                }
            });
        }

        // Store child process
        *self.child.lock().await = Some(child);

        // Wait for server to be ready
        let endpoint = format!("http://127.0.0.1:{}", port);
        if let Err(e) = self
            .wait_for_ready(&endpoint, generation, Duration::from_secs(60))
            .await
        {
            // The serialized start wrapper cleans up on every failure path.
            *self.status.lock().await = SupervisorStatus::Error(e.clone());

            // Emit error event
            let _ = app.emit(
                "stt://status",
                STTStatusPayload {
                    status: "error".to_string(),
                    message: Some(e.clone()),
                },
            );
            let _ = app.emit(
                "pipeline://error",
                PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: format!("Failed to start whisper.cpp server: {}", e),
                    details: None,
                },
            );

            return Err(e);
        }

        // Update endpoint
        *self.endpoint.lock().await = Some(endpoint.clone());

        // Mark as running
        *self.status.lock().await = SupervisorStatus::Running;

        // Emit status event
        let _ = app.emit(
            "stt://status",
            STTStatusPayload {
                status: "running".to_string(),
                message: None,
            },
        );

        info!("Whisper.cpp server running at {}", endpoint);

        // Start health check background task
        let self_arc = Arc::new(self.clone_inner());
        let app_clone = app.clone();
        let health_task = tokio::spawn(async move {
            health_check_loop(self_arc, app_clone).await;
        });
        *self.health_check_task.lock().await = Some(health_task);

        Ok(())
    }

    /// Stop the whisper.cpp server gracefully.
    pub async fn stop(&self) -> Result<(), String> {
        self.stop_generation.fetch_add(1, Ordering::SeqCst);
        let _operation = self.lifecycle.lock().await;
        self.stop_inner().await
    }

    async fn stop_inner(&self) -> Result<(), String> {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        if let Some(task) = self.health_check_task.lock().await.take() {
            task.abort();
        }

        let mut child_guard = self.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            info!("Stopping whisper.cpp server (PID: {:?})", child.id());

            #[cfg(target_os = "windows")]
            {
                // On Windows, use taskkill for clean termination
                if let Some(pid) = child.id() {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .output();
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                // On Unix, use SIGTERM first via tokio::process::Child
                if let Some(pid) = child.id() {
                    // On Unix, we can use the child itself to handle graceful shutdown
                    // First try graceful termination via kill on the PID
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }

                    // Wait 2 seconds for graceful shutdown
                    tokio::time::sleep(Duration::from_secs(2)).await;

                    // If still running, check and SIGKILL
                    // try_wait is not async in tokio
                    if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
                        unsafe {
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                        let _ = child.wait().await;
                    }
                }
            }

            let _ = child.wait().await;
        }

        *self.endpoint.lock().await = None;
        *self.status.lock().await = SupervisorStatus::Stopped;
        self.staged_runtime.lock().await.take();
        self.port.store(0, Ordering::SeqCst);

        info!("Whisper.cpp server stopped");
        Ok(())
    }

    /// Restart the whisper.cpp server.
    pub async fn restart(&self, app: &AppHandle) -> Result<(), String> {
        info!("Restarting whisper.cpp server");
        self.stop().await?;
        self.start(app).await
    }

    /// Health requires an HTTP /health response, not merely a listening socket.
    pub async fn health_check(&self) -> bool {
        let port = self.port();
        if port == 0 {
            return false;
        }
        server_healthy(port, Duration::from_millis(800)).await
    }

    /// Internal: create a cloneable reference for background tasks
    fn clone_inner(&self) -> WhisperSupervisorInner {
        WhisperSupervisorInner {
            port: self.port.load(Ordering::SeqCst),
            shutdown_requested: Arc::clone(&self.shutdown_requested),
            status: Arc::clone(&self.status),
            endpoint: Arc::clone(&self.endpoint),
            child: Arc::clone(&self.child),
        }
    }

    async fn wait_for_ready(
        &self,
        endpoint: &str,
        generation: u64,
        timeout: Duration,
    ) -> Result<(), String> {
        let port = endpoint
            .rsplit(':')
            .next()
            .and_then(|p| p.parse().ok())
            .ok_or("Invalid Whisper endpoint")?;
        let deadline = tokio::time::Instant::now() + timeout;
        while tokio::time::Instant::now() < deadline {
            if self.stop_generation.load(Ordering::SeqCst) != generation {
                return Err("Whisper startup cancelled".to_string());
            }
            let mut guard = self.child.lock().await;
            let child = guard.as_mut().ok_or("Whisper startup child missing")?;
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("Failed checking Whisper process: {e}"))?
            {
                return Err(format!("Whisper exited during startup ({status})"));
            }
            drop(guard);
            if server_healthy(port, Duration::from_millis(800)).await {
                if self.stop_generation.load(Ordering::SeqCst) != generation {
                    return Err("Whisper startup cancelled".to_string());
                }
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Err(format!("Whisper did not become healthy within {timeout:?}"))
    }
}

struct WhisperSupervisorInner {
    port: u32,
    shutdown_requested: Arc<AtomicBool>,
    status: Arc<Mutex<SupervisorStatus>>,
    endpoint: Arc<Mutex<Option<String>>>,
    child: Arc<Mutex<Option<Child>>>,
}

/// Find a free TCP port by binding to a random port.
fn find_free_port() -> Result<u32, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find free port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?;
    Ok(port.port() as u32)
}

/// Resolve the path to the whisper.cpp binary.
fn resolve_whisper_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_paths::app_data_dir();
    let raw_resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;
    let resource_dir = strip_unc_prefix(&raw_resource_dir);

    let candidates = [
        app_data_dir
            .join("STT")
            .join("whisper-server")
            .join(WHISPER_BINARY),
        app_data_dir.join("STT").join(WHISPER_BINARY),
        app_data_dir
            .join("stt")
            .join("whisper-server")
            .join(WHISPER_BINARY),
        app_data_dir.join("stt").join(WHISPER_BINARY),
        resource_dir.join("whisper-server").join(WHISPER_BINARY),
        resource_dir
            .join("resources")
            .join("whisper-server")
            .join(WHISPER_BINARY),
        resource_dir.join(WHISPER_BINARY),
        {
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
            let src_resources = PathBuf::from(manifest_dir)
                .join("resources")
                .join("whisper-server")
                .join(WHISPER_BINARY);
            src_resources
        },
    ];

    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }

    Err(format!(
        "Whisper binary not found. Searched: {:?}",
        candidates
    ))
}

/// Resolve the path to the Whisper model file.
fn resolve_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_paths::app_data_dir();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let mut candidates =
        runtime_files::model_candidates(&app_data_dir, &strip_unc_prefix(&resource_dir));
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.extend(runtime_files::MODEL_NAMES.iter().map(|name| {
            PathBuf::from(&manifest_dir)
                .join("resources/whisper")
                .join(name)
        }));
    }

    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }

    Err(format!("Model file not found. Searched: {:?}", candidates))
}

/// Background health check loop.
async fn health_check_loop(supervisor: Arc<WhisperSupervisorInner>, app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;

        // Check if shutdown was requested
        if supervisor.shutdown_requested.load(Ordering::SeqCst) {
            break;
        }

        // Perform health check via HTTP
        let port = supervisor.port;
        let exited = match supervisor.child.lock().await.as_mut() {
            Some(child) => !matches!(child.try_wait(), Ok(None)),
            None => true,
        };
        let healthy = !exited && server_healthy(port, Duration::from_millis(800)).await;

        if !healthy {
            warn!("Whisper.cpp health check failed");
            *supervisor.status.lock().await =
                SupervisorStatus::Error("Whisper server is unavailable".to_string());
            *supervisor.endpoint.lock().await = None;
            let _ = app.emit(
                "stt://status",
                STTStatusPayload {
                    status: "error".to_string(),
                    message: Some("Whisper server is unavailable".to_string()),
                },
            );

            // Emit error event; this implementation does not currently restart automatically.
            let _ = app.emit(
                "pipeline://error",
                PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: "Whisper.cpp server health check failed".to_string(),
                    details: Some(format!("port={}", port)),
                },
            );
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_rejects_loading_and_accepts_ready() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        async fn response(body: &'static str) -> u32 {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                let _ = stream.read(&mut request).await;
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(reply.as_bytes()).await.unwrap();
            });
            port as u32
        }
        assert!(
            !server_healthy(
                response(r#"{"status":"loading"}"#).await,
                Duration::from_secs(1)
            )
            .await
        );
        assert!(server_healthy(response(r#"{"status":"ok"}"#).await, Duration::from_secs(1)).await);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn readiness_detects_child_exit_and_stop_cancels_loading() {
        let supervisor = Arc::new(WhisperSupervisor::new());
        let mut exited = tokio::process::Command::new("sh")
            .args(["-c", "exit 7"])
            .spawn()
            .unwrap();
        exited.wait().await.unwrap();
        *supervisor.child.lock().await = Some(exited);
        assert!(supervisor
            .wait_for_ready("http://127.0.0.1:1", 0, Duration::from_secs(1))
            .await
            .unwrap_err()
            .contains("exited"));
        let child = tokio::process::Command::new("sleep")
            .arg("60")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let pid = child.id().unwrap();
        *supervisor.child.lock().await = Some(child);
        let (started, ready) = tokio::sync::oneshot::channel();
        let worker = Arc::clone(&supervisor);
        let task = tokio::spawn(async move {
            let _operation = worker.lifecycle.lock().await;
            started.send(()).unwrap();
            worker
                .wait_for_ready("http://127.0.0.1:1", 0, Duration::from_secs(60))
                .await
        });
        ready.await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), supervisor.stop())
            .await
            .unwrap()
            .unwrap();
        assert!(task.await.unwrap().unwrap_err().contains("cancelled"));
        assert!(supervisor.child.lock().await.is_none());
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert!(matches!(
            supervisor.status().await,
            SupervisorStatus::Stopped
        ));
    }
}

async fn server_healthy(port: u32, timeout: Duration) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(timeout).build() else {
        return false;
    };
    let Ok(response) = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .await
    else {
        return false;
    };
    response.status().is_success()
        && response
            .json::<serde_json::Value>()
            .await
            .map(|body| body.get("status").and_then(|v| v.as_str()) == Some("ok"))
            .unwrap_or(false)
}
