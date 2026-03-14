//! Engine installer and local inference server manager
//!
//! Downloads pre-built llama.cpp binaries from GitHub releases and manages
//! the lifecycle of a local llama-server subprocess for inference.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// Progress event emitted during engine installation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstallProgress {
    /// Engine being installed
    pub engine_id: String,
    /// Stage: "fetching_release" | "selecting_asset" | "downloading" | "extracting" | "done" | "error"
    pub stage: String,
    /// 0-100
    pub percentage: f32,
    /// Human-readable status
    pub message: String,
}

/// Result returned after a successful installation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstallResult {
    pub engine_id: String,
    pub binary_path: String,
    pub version: String,
}

/// GitHub release asset (partial deserialization)
#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// GitHub release (partial deserialization)
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

fn emit_install_progress(app: &AppHandle, progress: &EngineInstallProgress) {
    let _ = app.emit("engine:install_progress", progress);
    let msg = format!(
        "[engine-install] {} {} {:.0}% - {}",
        progress.engine_id, progress.stage, progress.percentage, progress.message
    );
    crate::commands::logs::info(&msg);
    log::info!("{}", msg);
}

/// Platform binary name
pub fn get_binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Check if this engine has been installed to the engines directory
pub fn find_engine_binary(engine_id: &str, engines_dir: &Path) -> Option<PathBuf> {
    let engine_dir = engines_dir.join(engine_id);
    find_binary_recursive(&engine_dir, get_binary_filename(), 4)
}

// ── llama-server state file (for cross-session adoption) ─────────────────────

/// Persisted across sessions so the next startup can adopt a still-running server.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ServerStateFile {
    pid: u32,
    port: u16,
    model_path: String,
    n_gpu_layers: u32,
    ctx_size: u32,
    #[serde(default = "default_engine_id")]
    engine_id: String,
    #[serde(default = "default_batch_size")]
    batch_size: u32,
    #[serde(default = "default_ubatch_size")]
    ubatch_size: u32,
    #[serde(default)]
    n_threads: Option<u32>,
    #[serde(default)]
    n_threads_batch: Option<u32>,
    #[serde(default)]
    flash_attn: bool,
    #[serde(default)]
    cache_type_k: Option<String>,
    #[serde(default)]
    cache_type_v: Option<String>,
}

fn default_batch_size() -> u32 {
    512
}

fn default_ubatch_size() -> u32 {
    128
}

fn default_engine_id() -> String {
    "llama.cpp-cpu".to_string()
}

fn write_server_state(state_path: &Path, state: &ServerStateFile) {
    if let Ok(json) = serde_json::to_string(state) {
        let _ = std::fs::write(state_path, json);
    }
}

/// Best-effort check whether a process ID is currently alive.
pub(crate) fn is_pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // kill(pid, 0) performs permission/liveness checks without sending a signal.
        // ESRCH means "no such process".
        let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if rc == 0 {
            return true;
        }
        let err = std::io::Error::last_os_error();
        err.raw_os_error() != Some(libc::ESRCH)
    }
    #[cfg(windows)]
    {
        use sysinfo::{ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, false);
        sys.process(sysinfo::Pid::from(pid as usize)).is_some()
    }
}

/// Best-effort forceful termination for adopted server PIDs.
///
/// Returns true when the PID is confirmed gone after signaling.
pub(crate) fn terminate_pid(pid: u32, grace: std::time::Duration) -> bool {
    if !is_pid_alive(pid) {
        return true;
    }

    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            if !is_pid_alive(pid) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGKILL);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if !is_pid_alive(pid) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        !is_pid_alive(pid)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if !is_pid_alive(pid) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        !is_pid_alive(pid)
    }
}

/// On startup: attempt to adopt an llama-server left running from a previous session.
///
/// Reads `state_file` (written by `start_llama_server`).  If the recorded PID is
/// alive **and** the TCP port responds, a `LocalServerHandle` is returned so the
/// app can route inference to the existing process without reloading the model.
///
/// If the PID is gone or the port is unreachable the stale state file is deleted
/// and `None` is returned so the caller can spawn fresh.
pub fn adopt_or_cleanup_server(state_file: &Path) -> Option<crate::LocalServerHandle> {
    let content = std::fs::read_to_string(state_file).ok()?;
    let state: ServerStateFile = serde_json::from_str(&content).ok()?;

    if !is_pid_alive(state.pid) {
        let _ = std::fs::remove_file(state_file);
        return None;
    }

    // ── Is the port accepting connections? (fast TCP connect, 2 s timeout) ───
    let port_open = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], state.port)),
        std::time::Duration::from_secs(2),
    )
    .is_ok();

    if !port_open {
        // Process is alive but the port is not ready — force-terminate and clean up.
        let killed = terminate_pid(state.pid, std::time::Duration::from_millis(700));
        if !killed {
            log::warn!(
                "[server-adopt] Failed to terminate stale llama-server PID {}",
                state.pid
            );
        }
        let _ = std::fs::remove_file(state_file);
        return None;
    }

    log::info!(
        "[server-adopt] Adopting llama-server PID {} on port {} — model: {}",
        state.pid,
        state.port,
        state.model_path
    );

    Some(crate::LocalServerHandle {
        child: None,
        pid: state.pid,
        url: format!("http://127.0.0.1:{}/v1", state.port),
        port: state.port,
        model_path: state.model_path,
        engine_id: state.engine_id,
        n_gpu_layers: state.n_gpu_layers,
        ctx_size: state.ctx_size,
        batch_size: state.batch_size,
        ubatch_size: state.ubatch_size,
        n_threads: state.n_threads,
        n_threads_batch: state.n_threads_batch,
        flash_attn: state.flash_attn,
        cache_type_k: state.cache_type_k,
        cache_type_v: state.cache_type_v,
        state_file: Some(state_file.to_path_buf()),
    })
}

// ─────────────────────────────────────────────────────────────────────────────

/// Find a free TCP port starting at `start`
pub fn find_free_port(start: u16) -> Option<u16> {
    for port in start..=65535 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Start a llama-server subprocess and return a handle to manage it.
///
/// `state_file` — if provided, a JSON file is written there so the next app
/// startup can call `adopt_or_cleanup_server` to reuse the still-running server
/// instead of killing and reloading the model.
pub fn start_llama_server(
    engine_id: &str,
    binary_path: &Path,
    model_path: &str,
    n_gpu_layers: u32,
    ctx_size: u32,
    batch_size: u32,
    ubatch_size: u32,
    n_threads: Option<u32>,
    n_threads_batch: Option<u32>,
    flash_attn: bool,
    cache_type_k: Option<&str>,
    cache_type_v: Option<&str>,
    port: u16,
    state_file: Option<&Path>,
) -> Result<crate::LocalServerHandle, String> {
    let mut cmd = std::process::Command::new(binary_path);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("--model")
        .arg(model_path)
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("-ngl")
        .arg(n_gpu_layers.to_string())
        .arg("--ctx-size")
        .arg(ctx_size.to_string())
        .arg("-b")
        .arg(batch_size.to_string())
        .arg("-ub")
        .arg(ubatch_size.to_string())
        .arg("--parallel")
        .arg("1")
        // Suppress subprocess output to avoid polluting the app's logs
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    if let Some(v) = n_threads {
        cmd.arg("-t").arg(v.to_string());
    }
    if let Some(v) = n_threads_batch {
        cmd.arg("-tb").arg(v.to_string());
    }
    if flash_attn {
        cmd.arg("-fa");
    }
    if let Some(v) = cache_type_k {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            cmd.arg("-ctk").arg(trimmed);
        }
    }
    if let Some(v) = cache_type_v {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            cmd.arg("-ctv").arg(trimmed);
        }
    }

    // On Linux: tell the kernel to send SIGTERM to this child whenever the
    // parent process exits — for ANY reason, including SIGKILL, panic-abort,
    // or crash.  Without this, llama-server becomes an orphan and holds GPU
    // VRAM indefinitely across multiple open/close cycles.
    //
    // pre_exec runs inside the child process after fork() but before exec(),
    // so it safely sets the death signal on the child side only.
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::prctl(
                    libc::PR_SET_PDEATHSIG,
                    libc::SIGTERM as libc::c_ulong,
                    0,
                    0,
                    0,
                ) != 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

    let pid = child.id();

    // Write state file so the next startup can adopt this server
    let state_file_path = state_file.map(|p| {
        write_server_state(
            p,
            &ServerStateFile {
                pid,
                port,
                model_path: model_path.to_string(),
                n_gpu_layers,
                ctx_size,
                engine_id: engine_id.to_string(),
                batch_size,
                ubatch_size,
                n_threads,
                n_threads_batch,
                flash_attn,
                cache_type_k: cache_type_k.map(|s| s.to_string()),
                cache_type_v: cache_type_v.map(|s| s.to_string()),
            },
        );
        p.to_path_buf()
    });

    Ok(crate::LocalServerHandle {
        child: Some(child),
        pid,
        url: format!("http://127.0.0.1:{}/v1", port),
        port,
        model_path: model_path.to_string(),
        engine_id: engine_id.to_string(),
        n_gpu_layers,
        ctx_size,
        batch_size,
        ubatch_size,
        n_threads,
        n_threads_batch,
        flash_attn,
        cache_type_k: cache_type_k.map(|s| s.to_string()),
        cache_type_v: cache_type_v.map(|s| s.to_string()),
        state_file: state_file_path,
    })
}

/// Poll the llama-server health endpoint until it responds or times out
pub async fn wait_for_server_ready(port: u16, timeout_secs: u64) -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if std::time::Instant::now() > deadline {
            return false;
        }
        let ok = client
            .get(format!("http://127.0.0.1:{}/health", port))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            return true;
        }
    }
}

/// Select the best GitHub release asset for the current platform and engine.
///
/// Uses explicit per-OS/backend patterns derived from the actual asset naming
/// conventions used by ggml-org/llama.cpp releases:
///   Linux Vulkan:   llama-bXXXX-bin-ubuntu-vulkan-x64.tar.gz
///   Linux ROCm:     llama-bXXXX-bin-ubuntu-rocm-7.2-x64.tar.gz
///   Linux CPU:      llama-bXXXX-bin-ubuntu-x64.tar.gz
///   macOS arm64:    llama-bXXXX-bin-macos-arm64.tar.gz
///   macOS x64:      llama-bXXXX-bin-macos-x64.tar.gz
///   Windows Vulkan: llama-bXXXX-bin-win-vulkan-x64.zip
///   Windows CUDA:   llama-bXXXX-bin-win-cuda-*-x64.zip
///   Windows ROCm:   llama-bXXXX-bin-win-hip-radeon-x64.zip
///   Windows CPU:    llama-bXXXX-bin-win-cpu-x64.zip
fn select_asset<'a>(assets: &'a [GithubAsset], engine_id: &str) -> Option<&'a GithubAsset> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let arch_str = match arch {
        "x86_64" => "x64",
        "aarch64" | "arm64" => "arm64",
        _ => "x64",
    };

    // Backend derived from engine_id
    let backend = if engine_id.contains("vulkan") {
        "vulkan"
    } else if engine_id.contains("cuda") {
        "cuda"
    } else if engine_id.contains("rocm") {
        "rocm"
    } else if engine_id.contains("metal") {
        "metal"
    } else {
        "cpu"
    };

    // (required keywords, forbidden keywords) — all lowercase, matched against asset name
    let (required, forbidden): (Vec<&str>, Vec<&str>) = match (os, backend) {
        ("linux", "vulkan") => (
            vec!["ubuntu", "vulkan", arch_str],
            vec!["rocm", "cuda", "hip", "aclgraph", "s390x"],
        ),
        ("linux", "rocm") => (
            vec!["ubuntu", "rocm", arch_str],
            vec!["vulkan", "cuda", "hip", "aclgraph"],
        ),
        ("linux", "cpu") => (
            vec!["ubuntu", arch_str],
            vec!["vulkan", "rocm", "cuda", "hip", "aclgraph", "s390x"],
        ),
        ("macos", _) => (vec!["macos", arch_str], vec!["xcframework"]),
        ("windows", "vulkan") => (vec!["win", "vulkan", arch_str], vec!["cuda", "hip"]),
        ("windows", "cuda") => (vec!["win", "cuda", arch_str], vec!["vulkan", "hip"]),
        ("windows", "rocm") => (vec!["win", "hip", arch_str], vec!["vulkan", "cuda"]),
        ("windows", "cpu") => (vec!["win", "cpu", arch_str], vec!["vulkan", "cuda", "hip"]),
        _ => return None,
    };

    assets
        .iter()
        .filter(|a| {
            let n = a.name.to_lowercase();
            a.size > 0
                && (n.ends_with(".tar.gz") || n.ends_with(".zip"))
                && n.starts_with("llama-")
                && required.iter().all(|kw| n.contains(kw))
                && !forbidden.iter().any(|kw| n.contains(kw))
                && !n.contains("cudart")
        })
        // Among matches prefer a longer name (more specific, e.g. ROCm 7.2 > ROCm generic)
        .max_by_key(|a| a.name.len())
}

/// Download and install a llama.cpp engine from GitHub releases.
/// Emits `engine:install_progress` events throughout.
pub async fn install_engine(
    engine_id: &str,
    engines_dir: &Path,
    app: &AppHandle,
) -> Result<EngineInstallResult, String> {
    #[cfg(target_os = "ios")]
    {
        return Err(format!(
            "Runtime download/install is not supported on iOS for '{}'.",
            engine_id
        ));
    }

    let result: Result<EngineInstallResult, String> = async {
        let engine_dir = engines_dir.join(engine_id);
        std::fs::create_dir_all(&engine_dir)
            .map_err(|e| format!("Failed to create engine directory: {}", e))?;

        // Stage 1 — fetch release metadata
        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "fetching_release".to_string(),
                percentage: 5.0,
                message: "Fetching latest llama.cpp release info...".to_string(),
            },
        );

        let client = reqwest::Client::builder()
            .user_agent("arx/0.8 (local-llm-desktop)")
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let release: GithubRelease = client
            .get("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest")
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch release info: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse release info: {}", e))?;

        let version = release.tag_name.clone();

        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "selecting_asset".to_string(),
                percentage: 10.0,
                message: format!("Found release {}. Selecting compatible binary...", version),
            },
        );

        let asset = select_asset(&release.assets, engine_id).ok_or_else(|| {
            format!(
                "No compatible llama.cpp binary found for '{}' on {}/{}. \
                 Check https://github.com/ggml-org/llama.cpp/releases for available builds.",
                engine_id,
                std::env::consts::OS,
                std::env::consts::ARCH
            )
        })?;

        let download_url = asset.browser_download_url.clone();
        let asset_name = asset.name.clone();
        let total_size = asset.size;

        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "downloading".to_string(),
                percentage: 15.0,
                message: format!("Downloading {}...", asset_name),
            },
        );

        // Stage 2 — download the archive (.zip or .tar.gz)
        let archive_path = engine_dir.join(&asset_name);
        download_with_progress(
            &client,
            &download_url,
            &archive_path,
            total_size,
            engine_id,
            app,
        )
        .await?;

        // Stage 3 — extract
        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "extracting".to_string(),
                percentage: 87.0,
                message: "Extracting binary...".to_string(),
            },
        );

        let binary_path = extract_archive(&archive_path, &engine_dir)?;

        // Stage 4 — make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&binary_path)
                .map_err(|e| format!("Failed to read binary metadata: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&binary_path, perms)
                .map_err(|e| format!("Failed to set executable permission: {}", e))?;
        }

        // Clean up the downloaded archive
        let _ = std::fs::remove_file(&archive_path);

        let binary_path_str = binary_path.to_string_lossy().to_string();

        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "done".to_string(),
                percentage: 100.0,
                message: format!("Engine installed successfully at {}", binary_path_str),
            },
        );

        Ok(EngineInstallResult {
            engine_id: engine_id.to_string(),
            binary_path: binary_path_str,
            version,
        })
    }
    .await;

    if let Err(err) = &result {
        emit_install_progress(
            app,
            &EngineInstallProgress {
                engine_id: engine_id.to_string(),
                stage: "error".to_string(),
                percentage: 100.0,
                message: err.clone(),
            },
        );
        let msg = format!("[engine-install] {} failed: {}", engine_id, err);
        crate::commands::logs::error(&msg);
        log::error!("{}", msg);
    }

    result
}

/// Download a URL to a file path, emitting progress events every ~2 MB
async fn download_with_progress(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    total_size: u64,
    engine_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    // Use content-length if our metadata size was 0
    let total = if total_size > 0 {
        total_size
    } else {
        response.content_length().unwrap_or(0)
    };

    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create download file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;
    let emit_interval: u64 = 2 * 1024 * 1024; // 2 MB

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if downloaded - last_emitted >= emit_interval {
            last_emitted = downloaded;
            let pct = if total > 0 {
                15.0 + (downloaded as f32 / total as f32) * 70.0
            } else {
                50.0
            };
            let dl_mb = downloaded / (1024 * 1024);
            let total_str = if total > 0 {
                format!("{} MB", total / (1024 * 1024))
            } else {
                "? MB".to_string()
            };
            emit_install_progress(
                app,
                &EngineInstallProgress {
                    engine_id: engine_id.to_string(),
                    stage: "downloading".to_string(),
                    percentage: pct,
                    message: format!("Downloading... {} MB / {}", dl_mb, total_str),
                },
            );
        }
    }

    Ok(())
}

/// Dispatch extraction to the right handler based on file extension.
/// Returns the path to the llama-server binary.
fn extract_archive(archive: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let name = archive.to_str().unwrap_or("");
    if name.ends_with(".tar.gz") {
        extract_tar_gz(archive, dest_dir)
    } else {
        extract_zip_archive(archive, dest_dir)
    }
}

/// Extract a .tar.gz archive using the system `tar` command (available on Linux and macOS).
fn extract_tar_gz(archive: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let status = std::process::Command::new("tar")
        .arg("xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest_dir)
        .status()
        .map_err(|e| format!("Failed to run tar: {}", e))?;

    if !status.success() {
        return Err(format!("tar extraction failed (exit {:?})", status.code()));
    }

    find_binary_in_dir(dest_dir, get_binary_filename()).ok_or_else(|| {
        format!(
            "'{}' not found after extraction. \
             The release package may have a different structure.",
            get_binary_filename()
        )
    })
}

/// Recursively search `dir` (one level deep) for a file named `name`.
fn find_binary_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.exists() {
        return Some(direct);
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let nested = entry.path().join(name);
                if nested.exists() {
                    return Some(nested);
                }
            }
        }
    }
    None
}

/// Recursively search `dir` up to `max_depth` for a file named `name`.
fn find_binary_recursive(dir: &Path, name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !dir.exists() {
        return None;
    }

    let direct = dir.join(name);
    if direct.exists() {
        return Some(direct);
    }

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(found) = find_binary_recursive(&entry.path(), name, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

/// Extract all files from a .zip archive to a directory.
/// Returns the path to the llama-server binary found inside.
fn extract_zip_archive(zip_path: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let file =
        std::fs::File::open(zip_path).map_err(|e| format!("Failed to open zip archive: {}", e))?;

    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    let binary_name = get_binary_filename();
    let mut found_binary: Option<PathBuf> = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry {}: {}", i, e))?;

        // Sanitize the entry path (guard against zip slip)
        let entry_name = entry.name().replace('\\', "/");
        let outpath = dest_dir.join(&entry_name);

        if entry.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }
            let mut out = std::fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Failed to extract file: {}", e))?;

            // Track the binary (match on just the filename portion)
            if outpath
                .file_name()
                .map(|n| n == binary_name)
                .unwrap_or(false)
            {
                found_binary = Some(outpath);
            }
        }
    }

    found_binary.ok_or_else(|| {
        format!(
            "'{}' not found in the downloaded archive. \
             The release package may have a different structure.",
            binary_name
        )
    })
}
