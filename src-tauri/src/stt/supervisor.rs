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

#[cfg(feature = "tauri-runtime")]
use crate::stt::events::{PipelineErrorPayload, STTStatusPayload};
use log::{info, warn};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
#[cfg(feature = "tauri-runtime")]
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpStream;
use tokio::process::Child;
use tokio::sync::Mutex;
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
    status: Mutex<SupervisorStatus>,
    port: AtomicU32,
    endpoint: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    model_path: Mutex<Option<PathBuf>>,
    shutdown_requested: AtomicBool,
}

impl WhisperSupervisor {
    /// Create a new WhisperSupervisor without spawning the process.
    pub fn new() -> Self {
        Self {
            status: Mutex::new(SupervisorStatus::Stopped),
            port: AtomicU32::new(0),
            endpoint: Mutex::new(None),
            child: Mutex::new(None),
            model_path: Mutex::new(None),
            shutdown_requested: AtomicBool::new(false),
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
        // Check if already running
        {
            let status = self.status.lock().await;
            if matches!(*status, SupervisorStatus::Running) {
                return Ok(());
            }
        }

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

        // Resolve model path
        let model_path = resolve_model_path(app)?;

        // Store model path for health check logging
        *self.model_path.lock().await = Some(model_path.clone());

        // Pre-spawn platform preparation
        #[cfg(not(target_os = "windows"))]
        {
            // chmod the binary on Unix
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&binary_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                if let Err(e) = std::fs::set_permissions(&binary_path, perms) {
                    warn!("Failed to chmod {}: {}", binary_path.display(), e);
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            // Remove quarantine attribute on macOS
            let result = std::process::Command::new("xattr")
                .args([
                    "-dr",
                    "com.apple.quarantine",
                    &binary_path.to_string_lossy(),
                ])
                .output();
            if let Err(e) = result {
                warn!("Failed to remove quarantine attribute: {}", e);
            }
        }

        // Calculate thread count (half of logical CPUs, clamped to [2, 8])
        let threads = num_cpus::get();
        let threads = (threads / 2).max(2).min(8);

        info!(
            "Starting whisper.cpp server: binary={}, port={}, threads={}",
            binary_path.display(),
            port,
            threads
        );
        info!("Model path: {}", model_path.display());

        // Spawn the whisper.cpp server
        let mut child = tokio::process::Command::new(&binary_path)
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
        if let Err(e) = wait_for_ready(&endpoint, Duration::from_secs(10)).await {
            // Clean up failed process
            let _ = self.stop().await;
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
        tokio::spawn(async move {
            health_check_loop(self_arc, app_clone).await;
        });

        Ok(())
    }

    /// Stop the whisper.cpp server gracefully.
    pub async fn stop(&self) -> Result<(), String> {
        self.shutdown_requested.store(true, Ordering::SeqCst);

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

        info!("Whisper.cpp server stopped");
        Ok(())
    }

    /// Restart the whisper.cpp server.
    pub async fn restart(&self, app: &AppHandle) -> Result<(), String> {
        info!("Restarting whisper.cpp server");
        self.stop().await?;
        self.start(app).await
    }

    /// Health check - returns true if server is responsive.
    /// Note: whisper.cpp doesn't have a /health endpoint, so we use /inference
    pub async fn health_check(&self) -> bool {
        let port = self.port();
        if port == 0 {
            return false;
        }
        is_port_open(port, Duration::from_millis(800)).await
    }

    /// Internal: create a cloneable reference for background tasks
    fn clone_inner(&self) -> WhisperSupervisorInner {
        WhisperSupervisorInner {
            port: self.port.load(Ordering::SeqCst),
            shutdown_requested: Arc::new(AtomicBool::new(
                self.shutdown_requested.load(Ordering::SeqCst),
            )),
        }
    }
}

struct WhisperSupervisorInner {
    port: u32,
    shutdown_requested: Arc<AtomicBool>,
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
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let candidates = [
        resource_dir.join("whisper-server").join(WHISPER_BINARY),
        resource_dir
            .join("resources")
            .join("whisper-server")
            .join(WHISPER_BINARY),
        resource_dir.join(WHISPER_BINARY),
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
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    // Try different model file naming conventions
    let candidates = [
        resource_dir.join("whisper").join("ggml-base-q8_0.bin"),
        resource_dir.join("whisper").join("ggml-tiny.en-q8_0.bin"),
        resource_dir.join("whisper").join("ggml-base.en-q8_0.bin"),
        resource_dir.join("models").join("ggml-base-q8_0.bin"),
        resource_dir.join("models").join("ggml-tiny.en-q8_0.bin"),
        resource_dir
            .join("resources")
            .join("whisper")
            .join("ggml-base-q8_0.bin"),
    ];

    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }

    Err(format!("Model file not found. Searched: {:?}", candidates))
}

/// Wait for the whisper.cpp server to be ready.
// The whisper.cpp server doesn't have a dedicated /health endpoint.
// Instead, we check if the port is open by making a request to the inference endpoint.
async fn wait_for_ready(endpoint: &str, timeout_duration: Duration) -> Result<(), String> {
    let port = endpoint
        .strip_prefix("http://127.0.0.1:")
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(|| format!("Invalid STT endpoint: {}", endpoint))?;
    let start = std::time::Instant::now();

    while start.elapsed() < timeout_duration {
        if is_port_open(port, Duration::from_millis(500)).await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    Err(format!(
        "Server did not become ready within {:?}",
        timeout_duration
    ))
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
        let healthy = is_port_open(port, Duration::from_millis(800)).await;

        if !healthy {
            warn!("Whisper.cpp health check failed");

            // Emit error event; this implementation does not currently restart automatically.
            let _ = app.emit(
                "pipeline://error",
                PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: "Whisper.cpp server health check failed".to_string(),
                    details: Some(format!("port={}", port)),
                },
            );
        }
    }
}

async fn is_port_open(port: u32, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
        Ok(Ok(_)) => true,
        _ => false,
    }
}
