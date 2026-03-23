//! Built-in TTS engines: espeak-ng, Piper, and Kokoro.
//!
//! Both engines are invoked as subprocesses so no extra Rust crates are
//! needed.  The caller is responsible for routing based on the `tts_engine`
//! database setting.
//!
//! ## Kokoro Persistent Daemon
//!
//! The Kokoro TTS engine supports a persistent daemon mode via `tts_kokoro_persistent.py`.
//! This avoids the ~1-2s cold-start penalty of loading the ONNX model on every call.
//! The daemon is spawned once and communicates via a length-prefixed binary protocol:
//!
//! Request:  [4 bytes LE u32 len][JSON {"text": "...", "chunk_id": N, "voice": "..."}]
//! Response: [4 bytes LE u32 meta_len][JSON meta][4 bytes LE u32 audio_len][WAV bytes]

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut Command) {}

/// Result from a Kokoro synthesis call, bundling audio bytes with optional G2P phonemes.
pub struct SpeakResult {
    pub audio: Vec<u8>,
    /// IPA phoneme string extracted by misaki or espeak-ng during synthesis.
    /// `None` when G2P extraction was unavailable (graceful fallback).
    pub phonemes: Option<String>,
}

/// Persistent Kokoro TTS daemon that keeps the ONNX model loaded in memory.
///
/// Spawns `tts_kokoro_persistent.py` once and reuses it for subsequent synthesis calls.
/// If the daemon crashes, it will be restarted on the next call.
pub struct KokoroDaemon {
    child: Option<Child>,
    python_bin: String,
    script_path: String,
    model_path: String,
    voices_path: String,
    default_voice: String,
    chunk_id: u32,
}

impl KokoroDaemon {
    /// Returns the model path this daemon was initialized with.
    pub fn model_path(&self) -> &str {
        &self.model_path
    }

    /// Returns the voices path this daemon was initialized with.
    pub fn voices_path(&self) -> &str {
        &self.voices_path
    }

    /// Create a new daemon handle (does not spawn the process yet).
    pub fn new(
        python_bin: &str,
        script_path: &str,
        model_path: &str,
        voices_path: &str,
        default_voice: &str,
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
            model_path: model_path.to_string(),
            voices_path: voices_path.to_string(),
            default_voice: if default_voice.is_empty() {
                "af_heart"
            } else {
                default_voice
            }
            .to_string(),
            chunk_id: 0,
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
                        "[kokoro-daemon] Process exited with {}, restarting...",
                        status
                    );
                    self.child = None;
                }
                Err(e) => {
                    log::warn!(
                        "[kokoro-daemon] Failed to check process status: {}, restarting...",
                        e
                    );
                    self.child = None;
                }
            }
        }

        // Spawn new daemon process
        log::info!(
            "[kokoro-daemon] Spawning persistent daemon: {} --model {} --voices {}",
            self.script_path,
            self.model_path,
            self.voices_path
        );

        let mut cmd = Command::new(&self.python_bin);
        cmd.args([
            &self.script_path,
            "--model",
            &self.model_path,
            "--voices",
            &self.voices_path,
            "--default-voice",
            &self.default_voice,
        ])
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

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn kokoro daemon: {e}"))?;

        self.child = Some(child);
        log::info!("[kokoro-daemon] Daemon spawned successfully");
        Ok(())
    }

    /// Synthesize text to WAV bytes using the persistent daemon.
    ///
    /// Sends a request via the length-prefixed binary protocol and reads the response.
    /// Falls back to one-shot mode if the daemon fails to start.
    pub fn speak(&mut self, text: &str, voice: Option<&str>) -> Result<SpeakResult, String> {
        if text.is_empty() {
            return Err("Empty text".to_string());
        }

        // Ensure daemon is running
        self.ensure_running()?;

        let child = match self.child.as_mut() {
            Some(c) => c,
            None => return Err("Daemon not running".to_string()),
        };

        let chunk_id = self.chunk_id.wrapping_add(1);
        self.chunk_id = chunk_id;

        // Build request JSON
        let request = serde_json::json!({
            "text": text,
            "chunk_id": chunk_id,
            "voice": voice.unwrap_or(&self.default_voice),
        });
        let payload = request.to_string().into_bytes();

        // Write length-prefixed request
        let stdin = child.stdin.as_mut().ok_or("Daemon stdin not available")?;
        let len_bytes = (payload.len() as u32).to_le_bytes();
        stdin
            .write_all(&len_bytes)
            .map_err(|e| format!("Failed to write length: {e}"))?;
        stdin
            .write_all(&payload)
            .map_err(|e| format!("Failed to write payload: {e}"))?;
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

        // Check status
        let status = meta
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("error");
        if status != "ok" {
            let msg = meta
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("Daemon error: {}", msg));
        }

        // Read audio length
        let mut audio_len_buf = [0u8; 4];
        stdout
            .read_exact(&mut audio_len_buf)
            .map_err(|e| format!("Failed to read audio length: {e}"))?;
        let audio_len = u32::from_le_bytes(audio_len_buf) as usize;

        if audio_len == 0 {
            return Err("Daemon returned zero audio bytes".to_string());
        }

        // Read audio data
        let mut audio_buf = vec![0u8; audio_len];
        stdout
            .read_exact(&mut audio_buf)
            .map_err(|e| format!("Failed to read audio: {e}"))?;

        // Extract optional IPA phoneme string from daemon metadata (for lipsync)
        let phonemes = meta
            .get("phonemes")
            .and_then(|p| p.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        log::debug!(
            "[kokoro-daemon] Received {} bytes audio for chunk {}, phonemes={}",
            audio_len,
            chunk_id,
            phonemes.is_some()
        );
        Ok(SpeakResult {
            audio: audio_buf,
            phonemes,
        })
    }

    /// Kill the daemon process if running.
    pub fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            log::info!("[kokoro-daemon] Daemon killed");
        }
    }
}

impl Drop for KokoroDaemon {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Thread-safe wrapper for KokoroDaemon that can be stored in AppState.
/// Uses Arc for cheap cloning across async boundaries.
pub type KokoroDaemonHandle = Arc<Mutex<Option<KokoroDaemon>>>;

pub fn known_kokoro_voices() -> Vec<String> {
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
    .map(|s| s.to_string())
    .collect()
}

// ── espeak-ng ─────────────────────────────────────────────────────────────────

/// Synthesise `text` with espeak-ng and return WAV bytes.
///
/// `voice` accepts any espeak voice name (e.g. "en-us", "en", "en-gb").
/// Falls back to "en-us" if empty.
pub fn speak_espeak(text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let voice = if voice.is_empty() { "en-us" } else { voice };

    let mut cmd = Command::new("espeak-ng");
    cmd.args(["-v", voice, "--stdout", text])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run espeak-ng: {e}"))?;

    if output.stdout.is_empty() {
        return Err(format!(
            "espeak-ng produced no output (exit {}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(output.stdout)
}

/// List voices available in espeak-ng.
pub fn list_espeak_voices() -> Vec<String> {
    let mut cmd = Command::new("espeak-ng");
    cmd.args(["--voices=en"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    let output = cmd.output();

    let Ok(out) = output else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);

    // espeak-ng --voices=en prints lines like:
    //  5  en             en/en         (en)
    //  5  en-us          en/en-us      (en-us)
    // We want the second column (language code / voice name).
    let mut voices: Vec<String> = text
        .lines()
        .skip(1) // header
        .filter_map(|line| line.split_whitespace().nth(1))
        .map(|s| s.to_string())
        .collect();

    voices.sort();
    voices.dedup();
    voices
}

/// Check whether espeak-ng is on PATH.
pub fn check_espeak() -> bool {
    let mut cmd = Command::new("espeak-ng");
    cmd.arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    cmd.status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ── Kokoro ────────────────────────────────────────────────────────────────────

/// Synthesise `text` with Kokoro ONNX TTS via Python subprocess.
/// Returns WAV bytes.
pub fn speak_kokoro(
    python_bin: &str,
    text: &str,
    script_path: &str,
    model_path: &str,
    voices_path: &str,
    voice: &str,
) -> Result<Vec<u8>, String> {
    if model_path.is_empty() {
        return Err("Kokoro model path not configured".to_string());
    }
    if voices_path.is_empty() {
        return Err("Kokoro voices path not configured".to_string());
    }
    let voice = if voice.is_empty() { "af_heart" } else { voice };

    let python_bin = if python_bin.is_empty() {
        "python3"
    } else {
        python_bin
    };
    let mut cmd = Command::new(python_bin);
    cmd.args([
        script_path,
        "--model",
        model_path,
        "--voices",
        voices_path,
        "--voice",
        voice,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start tts_kokoro.py: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }

    let out = child.wait_with_output().map_err(|e| e.to_string())?;

    // Log Python stderr
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        log::debug!("[kokoro] {}", line);
    }

    if !out.status.success() {
        return Err(format!(
            "tts_kokoro.py exited {}: {}",
            out.status,
            stderr.trim()
        ));
    }

    if out.stdout.is_empty() {
        return Err("Kokoro produced no audio output".to_string());
    }

    Ok(out.stdout)
}

/// Check whether Python3 + kokoro-onnx + soundfile are installed.
pub fn check_kokoro(script_path: &str, python_bin: &str) -> bool {
    let python_bin = if python_bin.is_empty() {
        "python3"
    } else {
        python_bin
    };
    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", "import kokoro_onnx, soundfile, onnxruntime"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    cmd.status()
        .map(|s| s.success())
        .unwrap_or(false)
        && !script_path.is_empty()
}

/// Attempt to list available Kokoro voices by inspecting the loaded model object.
///
/// Returns an empty list when Kokoro isn't available or introspection fails.
pub fn list_kokoro_voices(model_path: &str, voices_path: &str, python_bin: &str) -> Vec<String> {
    if model_path.is_empty() || voices_path.is_empty() {
        return vec![];
    }
    let python_bin = if python_bin.is_empty() {
        "python3"
    } else {
        python_bin
    };

    // Keep this self-contained to avoid shipping another script file.
    let script = r#"
import sys
try:
    from kokoro_onnx import Kokoro
except Exception:
    sys.exit(2)

model_path = sys.argv[1]
voices_path = sys.argv[2]

try:
    k = Kokoro(model_path, voices_path)
except Exception:
    sys.exit(3)

names = []
for attr in ("voices", "voice_names", "speakers", "speaker_names"):
    v = getattr(k, attr, None)
    if isinstance(v, dict):
        names.extend(list(v.keys()))
    elif isinstance(v, (list, tuple, set)):
        names.extend(list(v))

for method in ("get_voices", "list_voices"):
    fn = getattr(k, method, None)
    if callable(fn):
        try:
            v = fn()
            if isinstance(v, dict):
                names.extend(list(v.keys()))
            elif isinstance(v, (list, tuple, set)):
                names.extend(list(v))
        except Exception:
            pass

seen = set()
clean = []
for n in names:
    s = str(n).strip()
    if s and s not in seen:
        seen.add(s)
        clean.append(s)

for n in sorted(clean):
    print(n)
"#;

    let mut cmd = Command::new(python_bin);
    cmd.args(["-c", script, model_path, voices_path])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    let output = cmd.output();

    let Ok(out) = output else { return vec![] };
    if !out.status.success() {
        return vec![];
    }

    let mut voices: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    voices.sort();
    voices.dedup();
    voices
}
