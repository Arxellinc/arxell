//! Local STT via faster-whisper Python subprocess.
//!
//! ## Whisper Persistent Daemon
//!
//! The STT engine supports a persistent daemon mode via `stt_whisper_persistent.py`.
//! This avoids the ~1-3s cold-start penalty of loading the Whisper model on every call.
//! The daemon is spawned once and communicates via a length-prefixed binary protocol:
//!
//! Request:  [4 bytes LE u32 len][WAV audio data]
//! Response: [4 bytes LE u32 meta_len][JSON {"text": "...", "duration_ms": M}]

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(feature = "whisper-rs-stt")]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut Command) {}

/// Thread-safe handle for a loaded WhisperContext (whisper-rs / whisper.cpp).
///
/// `WhisperContext` wraps `Arc<WhisperInnerContext>` which implements Send + Sync,
/// so it is safe to share across threads via Mutex.  A new `WhisperState` is
/// created per transcription call (state is not thread-safe to reuse across
/// concurrent calls, but that never happens since the Mutex serialises access).
///
/// When the `whisper-rs-stt` feature is not compiled in, this is a dummy type
/// so the rest of the codebase can unconditionally reference `WhisperRsHandle`.
#[cfg(feature = "whisper-rs-stt")]
pub type WhisperRsHandle = Arc<Mutex<Option<WhisperContext>>>;

#[cfg(not(feature = "whisper-rs-stt"))]
pub type WhisperRsHandle = Arc<Mutex<Option<()>>>;

/// Persistent Whisper STT daemon that keeps the model loaded in memory.
///
/// Spawns `stt_whisper_persistent.py` once and reuses it for subsequent transcriptions.
/// If the daemon crashes, it will be restarted on the next call.
pub struct WhisperDaemon {
    child: Option<Child>,
    python_bin: String,
    script_path: String,
    model_size: String,
    model_dir: String,
    language: String,
}

impl WhisperDaemon {
    /// Create a new daemon handle (does not spawn the process yet).
    pub fn new(
        python_bin: &str,
        script_path: &str,
        model_size: &str,
        model_dir: &str,
        language: &str,
    ) -> Self {
        Self {
            child: None,
            python_bin: if python_bin.is_empty() {
                "python3"
            } else {
                python_bin
            }
            .to_string(),
            script_path: script_path.to_string(),
            model_size: if model_size.is_empty() {
                "tiny"
            } else {
                model_size
            }
            .to_string(),
            model_dir: model_dir.to_string(),
            language: if language.is_empty() { "en" } else { language }.to_string(),
        }
    }

    /// Ensure the daemon process is running. Spawns if not alive.
    fn ensure_running(&mut self) -> Result<(), String> {
        // Check if existing child is still alive
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(None) => return Ok(()), // Still running
                Ok(Some(status)) => {
                    log::warn!(
                        "[whisper-daemon] Process exited with {}, restarting...",
                        status
                    );
                    self.child = None;
                }
                Err(e) => {
                    log::warn!(
                        "[whisper-daemon] Failed to check process status: {}, restarting...",
                        e
                    );
                    self.child = None;
                }
            }
        }

        // Spawn new daemon process
        log::info!(
            "[whisper-daemon] Spawning persistent daemon: {} --model {}",
            self.script_path,
            self.model_size
        );

        let mut args = vec![
            self.script_path.clone(),
            "--model".to_string(),
            self.model_size.clone(),
            "--language".to_string(),
            self.language.clone(),
        ];
        if !self.model_dir.is_empty() {
            args.push("--model-dir".to_string());
            args.push(self.model_dir.clone());
        }

        let mut cmd = Command::new(&self.python_bin);
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_no_window(&mut cmd);

        // On Linux: automatically kill this child if the parent exits for any
        // reason (SIGKILL, crash, etc.) so it doesn't outlive the app.
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

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn whisper daemon: {e}"))?;

        // Give the daemon a moment to start and check for early crashes
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Check if it crashed immediately
        match child.try_wait() {
            Ok(Some(status)) => {
                // Daemon exited - read stderr for error message
                let stderr = child
                    .stderr
                    .take()
                    .map(|mut r| {
                        let mut buf = String::new();
                        let _ = r.read_to_string(&mut buf);
                        buf
                    })
                    .unwrap_or_default();
                return Err(format!(
                    "Whisper daemon exited immediately with status {}: {}",
                    status,
                    stderr.trim()
                ));
            }
            Ok(None) => {
                // Still running - good
                log::info!("[whisper-daemon] Daemon spawned successfully");
            }
            Err(e) => {
                log::warn!("[whisper-daemon] Could not check daemon status: {}", e);
            }
        }

        self.child = Some(child);
        Ok(())
    }

    /// Transcribe WAV bytes using the persistent daemon.
    ///
    /// Sends a request via the length-prefixed binary protocol and reads the response.
    pub fn transcribe(&mut self, wav_bytes: &[u8]) -> Result<String, String> {
        if wav_bytes.is_empty() {
            return Err("Empty audio".to_string());
        }

        // Ensure daemon is running
        self.ensure_running()?;

        let child = match self.child.as_mut() {
            Some(c) => c,
            None => return Err("Daemon not running".to_string()),
        };

        // Write length-prefixed request
        let stdin = child.stdin.as_mut().ok_or("Daemon stdin not available")?;
        let len_bytes = (wav_bytes.len() as u32).to_le_bytes();
        stdin
            .write_all(&len_bytes)
            .map_err(|e| format!("Failed to write length: {e}"))?;
        stdin
            .write_all(wav_bytes)
            .map_err(|e| format!("Failed to write WAV data: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {e}"))?;

        // Read response
        let stdout = child.stdout.as_mut().ok_or("Daemon stdout not available")?;

        // Read meta length
        let mut meta_len_buf = [0u8; 4];
        stdout
            .read_exact(&mut meta_len_buf)
            .map_err(|e| format!("Failed to read meta length: {e}"))?;
        let meta_len = u32::from_le_bytes(meta_len_buf) as usize;

        if meta_len > 1024 * 1024 {
            return Err(format!("Meta too large: {} bytes", meta_len));
        }

        // Read meta JSON
        let mut meta_buf = vec![0u8; meta_len];
        stdout
            .read_exact(&mut meta_buf)
            .map_err(|e| format!("Failed to read meta: {e}"))?;
        let meta: serde_json::Value = serde_json::from_slice(&meta_buf)
            .map_err(|e| format!("Failed to parse meta JSON: {e}"))?;

        // Check for error
        if let Some(err) = meta.get("error").and_then(|e| e.as_str()) {
            if !err.is_empty() {
                return Err(format!("Whisper error: {}", err));
            }
        }

        // Extract text
        let text = meta
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        log::debug!(
            "[whisper-daemon] Transcribed: '{}' ({})",
            if text.len() > 50 { &text[..50] } else { &text },
            meta.get("duration_ms")
                .and_then(|d| d.as_u64())
                .unwrap_or(0)
        );

        Ok(text)
    }

    /// Kill the daemon process if running.
    pub fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            log::info!("[whisper-daemon] Daemon killed");
        }
    }
}

impl Drop for WhisperDaemon {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Thread-safe wrapper for WhisperDaemon that can be stored in AppState.
pub type WhisperDaemonHandle = Arc<Mutex<Option<WhisperDaemon>>>;

/// Transcribe WAV bytes using faster-whisper via Python subprocess.
///
/// `script_path` — path to `stt_whisper.py`  
/// `model_size`  — "tiny", "base", "small", "medium", "large-v3"  
/// `model_dir`   — directory for model cache ("" = HuggingFace default)
pub fn transcribe_whisper(
    wav_bytes: &[u8],
    python_bin: &str,
    script_path: &str,
    model_size: &str,
    model_dir: &str,
) -> Result<String, String> {
    let model = if model_size.is_empty() {
        "tiny"
    } else {
        model_size
    };

    let mut args = vec![
        script_path.to_string(),
        "--model".to_string(),
        model.to_string(),
    ];
    if !model_dir.is_empty() {
        args.push("--model-dir".to_string());
        args.push(model_dir.to_string());
    }

    let python_bin = if python_bin.is_empty() {
        "python3"
    } else {
        python_bin
    };

    let mut cmd = Command::new(python_bin);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start stt_whisper.py: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(wav_bytes)
            .map_err(|e| format!("Failed to write WAV to whisper stdin: {e}"))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("stt_whisper.py wait failed: {e}"))?;

    // Log stderr from the Python script
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        log::debug!("[stt_whisper] {}", line);
    }

    if !out.status.success() {
        return Err(format!(
            "stt_whisper.py exited with status {}: {}",
            out.status,
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stdout = stdout.trim();

    // Parse JSON: {"text": "..."} or {"text": "", "error": "..."}
    #[derive(serde::Deserialize)]
    struct WhisperOut {
        text: String,
        error: Option<String>,
    }

    match serde_json::from_str::<WhisperOut>(stdout) {
        Ok(r) => {
            if let Some(err) = r.error {
                if !err.is_empty() {
                    return Err(format!("Whisper error: {err}"));
                }
            }
            Ok(r.text)
        }
        Err(e) => Err(format!("Failed to parse whisper output {:?}: {e}", stdout)),
    }
}

/// Check whether Python3 + faster-whisper are available.
pub fn check_whisper(python_bin: &str) -> bool {
    let python_bin = if python_bin.is_empty() {
        "python3"
    } else {
        python_bin
    };
    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", "import faster_whisper"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    cmd.status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Transcribe using a shared persistent WhisperContext.
///
/// Lazy-initialises the context from `model_path` on first call and reuses it
/// on subsequent calls, avoiding the ~1-3 s model-load penalty per utterance.
/// A fresh `WhisperState` is created per call (states are not reusable across
/// concurrent invocations, but the Mutex ensures calls are serialised).
#[cfg(feature = "whisper-rs-stt")]
pub fn transcribe_whisper_rs_persistent(
    handle: &WhisperRsHandle,
    wav_bytes: &[u8],
    model_path: &str,
    language: &str,
) -> Result<String, String> {
    if model_path.is_empty() {
        return Err("whisper-rs model path not configured".to_string());
    }

    let mut guard = handle.lock().unwrap();

    // Lazy-init: load model once and keep it alive for the session.
    if guard.is_none() {
        if !std::path::Path::new(model_path).exists() {
            return Err(format!("whisper-rs model file not found: {}", model_path));
        }
        log::info!("[whisper-rs] Loading model from {}", model_path);
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| format!("Failed to load whisper-rs model: {e}"))?;
        log::info!("[whisper-rs] Model loaded successfully");
        *guard = Some(ctx);
    }

    let ctx = guard.as_ref().unwrap();
    let pcm = wav_to_pcm(wav_bytes)?;

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create whisper-rs state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    if !language.trim().is_empty() {
        params.set_language(Some(language));
    }
    params.set_translate(false);
    params.set_n_threads(4);

    state
        .full(params, &pcm)
        .map_err(|e| format!("whisper-rs transcription failed: {e}"))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("whisper-rs segment query failed: {e}"))?;
    let mut out = String::new();
    for i in 0..num_segments {
        let seg = state
            .full_get_segment_text(i)
            .map_err(|e| format!("whisper-rs segment read failed: {e}"))?;
        out.push_str(&seg);
    }
    Ok(out.trim().to_string())
}

#[cfg(not(feature = "whisper-rs-stt"))]
pub fn transcribe_whisper_rs_persistent(
    _handle: &WhisperRsHandle,
    _wav_bytes: &[u8],
    _model_path: &str,
    _language: &str,
) -> Result<String, String> {
    Err("whisper-rs backend is not compiled in. Rebuild with --features whisper-rs-stt".to_string())
}

/// Extract mono 16 kHz PCM f32 samples from a WAV byte slice.
#[cfg(feature = "whisper-rs-stt")]
fn wav_to_pcm(wav_bytes: &[u8]) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::new(std::io::Cursor::new(wav_bytes))
        .map_err(|e| format!("Invalid WAV input for whisper-rs: {e}"))?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 {
        return Err(format!(
            "whisper-rs expects 16kHz WAV input, got {}Hz",
            spec.sample_rate
        ));
    }
    let channels = spec.channels.max(1) as usize;
    let mut pcm: Vec<f32> = Vec::new();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            let mut idx = 0usize;
            for sample in reader.samples::<f32>() {
                let s = sample.map_err(|e| format!("WAV decode error: {e}"))?;
                if idx % channels == 0 {
                    pcm.push(s);
                }
                idx += 1;
            }
        }
        hound::SampleFormat::Int => {
            if spec.bits_per_sample <= 16 {
                let mut idx = 0usize;
                for sample in reader.samples::<i16>() {
                    let s = sample.map_err(|e| format!("WAV decode error: {e}"))?;
                    if idx % channels == 0 {
                        pcm.push(s as f32 / i16::MAX as f32);
                    }
                    idx += 1;
                }
            } else {
                let mut idx = 0usize;
                for sample in reader.samples::<i32>() {
                    let s = sample.map_err(|e| format!("WAV decode error: {e}"))?;
                    if idx % channels == 0 {
                        pcm.push(s as f32 / i32::MAX as f32);
                    }
                    idx += 1;
                }
            }
        }
    }
    Ok(pcm)
}

#[cfg(feature = "whisper-rs-stt")]
pub fn transcribe_whisper_rs(
    wav_bytes: &[u8],
    model_path: &str,
    language: &str,
) -> Result<String, String> {
    if model_path.is_empty() {
        return Err("whisper-rs model path not configured".to_string());
    }
    if !std::path::Path::new(model_path).exists() {
        return Err(format!("whisper-rs model file not found: {}", model_path));
    }
    let pcm = wav_to_pcm(wav_bytes)?;
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load whisper-rs model: {e}"))?;
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create whisper-rs state: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    if !language.trim().is_empty() {
        params.set_language(Some(language));
    }
    params.set_translate(false);
    params.set_n_threads(4);
    state
        .full(params, &pcm)
        .map_err(|e| format!("whisper-rs transcription failed: {e}"))?;
    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("whisper-rs segment query failed: {e}"))?;
    let mut out = String::new();
    for i in 0..num_segments {
        let seg = state
            .full_get_segment_text(i)
            .map_err(|e| format!("whisper-rs segment read failed: {e}"))?;
        out.push_str(&seg);
    }
    Ok(out.trim().to_string())
}

#[cfg(not(feature = "whisper-rs-stt"))]
pub fn transcribe_whisper_rs(
    _wav_bytes: &[u8],
    _model_path: &str,
    _language: &str,
) -> Result<String, String> {
    Err("whisper-rs backend is not compiled in. Rebuild with --features whisper-rs-stt".to_string())
}

#[cfg(feature = "whisper-rs-stt")]
pub fn check_whisper_rs(model_path: &str) -> bool {
    !model_path.trim().is_empty() && std::path::Path::new(model_path).exists()
}

#[cfg(not(feature = "whisper-rs-stt"))]
pub fn check_whisper_rs(_model_path: &str) -> bool {
    false
}
