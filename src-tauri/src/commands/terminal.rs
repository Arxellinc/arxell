use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::process::Command;
use tokio::time::{timeout, Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u128,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionStartResult {
    pub session_id: u64,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionReadResult {
    pub output: String,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

struct TerminalSession {
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    output: Arc<Mutex<Vec<u8>>>,
    closed: Arc<AtomicBool>,
}

static TERMINAL_SESSIONS: OnceLock<Mutex<HashMap<u64, Arc<TerminalSession>>>> = OnceLock::new();
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

fn sessions() -> &'static Mutex<HashMap<u64, Arc<TerminalSession>>> {
    TERMINAL_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", path.display(), e))?;
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", canon.display()));
    }
    Ok(canon)
}

fn ensure_within_root(cwd: &Path, root: &Path) -> Result<(), String> {
    let cwd_canon = canonical_dir(cwd)?;
    let root_canon = canonical_dir(root)?;
    if !cwd_canon.starts_with(&root_canon) {
        return Err(format!(
            "Path '{}' is outside allowed root '{}'",
            cwd_canon.display(),
            root_canon.display()
        ));
    }
    Ok(())
}

fn shell_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("bash");
        cmd.arg("-lc").arg(command);
        cmd
    }
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn session_by_id(session_id: u64) -> Result<Arc<TerminalSession>, String> {
    let guard = sessions()
        .lock()
        .map_err(|_| "Failed to lock terminal session map".to_string())?;
    guard
        .get(&session_id)
        .cloned()
        .ok_or_else(|| format!("Unknown terminal session id: {}", session_id))
}

#[tauri::command]
pub fn cmd_terminal_resolve_path(
    path: String,
    cwd: Option<String>,
    root_guard: Option<String>,
) -> Result<String, String> {
    let base = if let Some(cwd_raw) = cwd {
        canonical_dir(Path::new(&cwd_raw))?
    } else {
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?
    };

    let candidate = {
        let p = Path::new(&path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            base.join(p)
        }
    };

    let resolved = canonical_dir(&candidate)?;

    if let Some(root) = root_guard {
        ensure_within_root(&resolved, Path::new(&root))?;
    }

    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cmd_terminal_exec(
    command: String,
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<TerminalExecResult, String> {
    let workdir = if let Some(cwd_raw) = cwd {
        canonical_dir(Path::new(&cwd_raw))?
    } else {
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?
    };

    if let Some(root) = root_guard {
        ensure_within_root(&workdir, Path::new(&root))?;
    }

    let mut cmd = shell_command(&command);
    cmd.current_dir(&workdir);

    let start = Instant::now();
    let output = timeout(
        Duration::from_millis(timeout_ms.unwrap_or(120_000).clamp(1000, 600_000)),
        cmd.output(),
    )
    .await
    .map_err(|_| "Command timed out".to_string())?
    .map_err(|e| format!("Failed to run command: {}", e))?;

    let duration_ms = start.elapsed().as_millis();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(TerminalExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code,
        duration_ms,
        cwd: workdir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn cmd_terminal_session_start(
    cwd: Option<String>,
    root_guard: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    env_overrides: Option<HashMap<String, String>>,
) -> Result<TerminalSessionStartResult, String> {
    let workdir = if let Some(cwd_raw) = cwd {
        canonical_dir(Path::new(&cwd_raw))?
    } else {
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?
    };

    if let Some(root) = root_guard.as_ref() {
        ensure_within_root(&workdir, Path::new(root))?;
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(28).clamp(10, 200),
            cols: cols.unwrap_or(120).clamp(20, 400),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    let shell = default_shell();
    let mut builder = CommandBuilder::new(shell);
    #[cfg(not(target_os = "windows"))]
    {
        builder.arg("-i");
    }
    builder.cwd(workdir.clone());
    builder.env("TERM", "xterm-256color");
    if let Some(envs) = env_overrides {
        for (key, value) in envs {
            builder.env(key, value);
        }
    }

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("Failed to spawn shell in PTY: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let output = Arc::new(Mutex::new(Vec::<u8>::new()));
    let closed = Arc::new(AtomicBool::new(false));

    let output_clone = output.clone();
    let closed_clone = closed.clone();

    std::thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    closed_clone.store(true, Ordering::SeqCst);
                    break;
                }
                Ok(n) => {
                    if let Ok(mut out) = output_clone.lock() {
                        out.extend_from_slice(&buf[..n]);
                        if out.len() > 1_000_000 {
                            let drain = out.len() - 800_000;
                            out.drain(..drain);
                        }
                    }
                }
                Err(_) => {
                    closed_clone.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    });

    let session = Arc::new(TerminalSession {
        child: Mutex::new(child),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        output,
        closed,
    });

    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);

    let mut guard = sessions()
        .lock()
        .map_err(|_| "Failed to lock terminal session map".to_string())?;
    guard.insert(session_id, session);

    Ok(TerminalSessionStartResult {
        session_id,
        cwd: workdir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn cmd_terminal_session_write(session_id: u64, input: String) -> Result<(), String> {
    let session = session_by_id(session_id)?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Failed to lock terminal session writer".to_string())?;
    writer
        .write_all(input.as_bytes())
        .map_err(|e| format!("Failed to write to terminal session: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal session: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_terminal_session_read(session_id: u64) -> Result<TerminalSessionReadResult, String> {
    let session = session_by_id(session_id)?;

    let mut output = session
        .output
        .lock()
        .map_err(|_| "Failed to lock terminal session output".to_string())?;
    let chunk = std::mem::take(&mut *output);
    drop(output);

    let mut exit_code = None;
    let mut exited = session.closed.load(Ordering::SeqCst);

    let mut child = session
        .child
        .lock()
        .map_err(|_| "Failed to lock terminal session child".to_string())?;
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("Failed to query terminal session status: {}", e))?
    {
        exited = true;
        exit_code = i32::try_from(status.exit_code()).ok();
    }

    Ok(TerminalSessionReadResult {
        output: String::from_utf8_lossy(&chunk).to_string(),
        exited,
        exit_code,
    })
}

#[tauri::command]
pub fn cmd_terminal_session_resize(session_id: u64, cols: u16, rows: u16) -> Result<(), String> {
    let session = session_by_id(session_id)?;
    let master = session
        .master
        .lock()
        .map_err(|_| "Failed to lock terminal session pty".to_string())?;
    master
        .resize(PtySize {
            rows: rows.clamp(10, 200),
            cols: cols.clamp(20, 400),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal session: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_terminal_session_close(session_id: u64) -> Result<(), String> {
    let session = {
        let mut guard = sessions()
            .lock()
            .map_err(|_| "Failed to lock terminal session map".to_string())?;
        guard.remove(&session_id)
    }
    .ok_or_else(|| format!("Unknown terminal session id: {}", session_id))?;

    session.closed.store(true, Ordering::SeqCst);
    let mut child = session
        .child
        .lock()
        .map_err(|_| "Failed to lock terminal session child".to_string())?;
    child
        .kill()
        .map_err(|e| format!("Failed to stop terminal session: {}", e))?;

    Ok(())
}
