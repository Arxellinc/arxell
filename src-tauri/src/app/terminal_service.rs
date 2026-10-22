use crate::contracts::{
    EventSeverity, EventStage, Subsystem, TerminalCloseSessionRequest,
    TerminalCloseSessionResponse, TerminalInputRequest, TerminalInputResponse,
    TerminalOpenSessionRequest, TerminalOpenSessionResponse, TerminalResizeRequest,
    TerminalResizeResponse,
};
use crate::observability::EventHub;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const OUTPUT_READ_BYTES: usize = 8192;
const OUTPUT_QUEUE_CHUNKS: usize = 16;
const OUTPUT_BATCH_BYTES: usize = 64 * 1024;
const OUTPUT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
    output_finished: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct TerminalService {
    hub: EventHub,
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    next_id: Arc<AtomicU64>,
}

impl TerminalService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn open_session(
        &self,
        req: TerminalOpenSessionRequest,
    ) -> Result<TerminalOpenSessionResponse, String> {
        let session_id = format!("term-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: req.rows.unwrap_or(36),
                cols: req.cols.unwrap_or(120),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {e}"))?;

        let shell = req.shell.unwrap_or_else(default_shell);
        let mut command = CommandBuilder::new(shell);
        if let Some(cwd) = req.cwd {
            command.cwd(PathBuf::from(cwd));
        }
        #[cfg(not(target_os = "windows"))]
        command.arg("-i");
        command.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("failed to spawn terminal shell: {e}"))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take PTY writer: {e}"))?;

        let output_finished = Arc::new(AtomicBool::new(false));
        let session = Arc::new(TerminalSession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            output_finished: Arc::clone(&output_finished),
        });

        self.sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?
            .insert(session_id.clone(), session);

        let hub = self.hub.clone();
        let correlation = format!("terminal-{session_id}");
        let session_for_thread = session_id.clone();
        // A bounded queue applies backpressure without growing memory when the
        // publisher is busy. The reader never sleeps per PTY read.
        let (tx, rx) = mpsc::sync_channel(OUTPUT_QUEUE_CHUNKS);
        std::thread::spawn(move || read_terminal_output(reader, tx));
        std::thread::spawn(move || {
            publish_terminal_output(rx, |chunk| {
                hub.emit(hub.make_event(
                    &correlation,
                    Subsystem::Service,
                    "terminal.output",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({"sessionId": session_for_thread, "data": chunk}),
                ));
            });
            // Authoritative stream completion is visible even if the exit event
            // is subsequently dropped by a lagging subscriber.
            output_finished.store(true, Ordering::Release);
            hub.emit(hub.make_event(
                &correlation,
                Subsystem::Service,
                "terminal.exit",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"sessionId": session_for_thread}),
            ));
        });

        Ok(TerminalOpenSessionResponse {
            session_id,
            correlation_id: req.correlation_id,
        })
    }

    pub fn send_input(&self, req: TerminalInputRequest) -> Result<TerminalInputResponse, String> {
        let session = self.session_by_id(&req.session_id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "terminal writer lock poisoned".to_string())?;
        writer
            .write_all(req.input.as_bytes())
            .map_err(|e| format!("failed to write terminal input: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("failed to flush terminal input: {e}"))?;

        Ok(TerminalInputResponse {
            session_id: req.session_id,
            accepted: true,
            correlation_id: req.correlation_id,
        })
    }

    pub fn resize(&self, req: TerminalResizeRequest) -> Result<TerminalResizeResponse, String> {
        let session = self.session_by_id(&req.session_id)?;
        session
            .master
            .lock()
            .map_err(|_| "terminal pty lock poisoned".to_string())?
            .resize(PtySize {
                rows: req.rows,
                cols: req.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to resize terminal pty: {e}"))?;

        Ok(TerminalResizeResponse {
            session_id: req.session_id,
            correlation_id: req.correlation_id,
        })
    }

    pub fn close_session(
        &self,
        req: TerminalCloseSessionRequest,
    ) -> Result<TerminalCloseSessionResponse, String> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?
            .remove(&req.session_id);

        if let Some(session) = removed {
            let _ = session
                .child
                .lock()
                .map_err(|_| "terminal child lock poisoned".to_string())?
                .kill();
            Ok(TerminalCloseSessionResponse {
                session_id: req.session_id,
                closed: true,
                correlation_id: req.correlation_id,
            })
        } else {
            Ok(TerminalCloseSessionResponse {
                session_id: req.session_id,
                closed: false,
                correlation_id: req.correlation_id,
            })
        }
    }

    /// Used to reconcile preview lifecycle after a lost terminal.exit event.
    /// Explicitly closed (removed) sessions are also finished.
    pub fn output_finished(&self, session_id: &str) -> Result<bool, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?;
        Ok(sessions
            .get(session_id)
            .is_none_or(|session| session.output_finished.load(Ordering::Acquire)))
    }

    fn session_by_id(&self, session_id: &str) -> Result<Arc<TerminalSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {session_id}"))
    }
}

fn read_terminal_output(mut reader: impl Read, tx: mpsc::SyncSender<Vec<u8>>) {
    let mut buf = [0_u8; OUTPUT_READ_BYTES];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            // PTYs may report an I/O error rather than EOF when their slave closes.
            Err(_) => break,
        }
    }
}

fn publish_terminal_output(rx: mpsc::Receiver<Vec<u8>>, mut emit: impl FnMut(String)) {
    let mut pending = Vec::with_capacity(OUTPUT_BATCH_BYTES + OUTPUT_READ_BYTES);
    while let Ok(chunk) = rx.recv() {
        pending.extend_from_slice(&chunk);
        let deadline = Instant::now() + OUTPUT_FLUSH_INTERVAL;
        let mut finished = false;
        while pending.len() < OUTPUT_BATCH_BYTES && Instant::now() < deadline {
            match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(chunk) => pending.extend_from_slice(&chunk),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    finished = true;
                    break;
                }
            }
        }
        let output = take_output(&mut pending, finished);
        if !output.is_empty() {
            emit(output);
        }
        if finished {
            return;
        }
    }
    // A size/time flush may retain an incomplete UTF-8 suffix before EOF.
    let output = take_output(&mut pending, true);
    if !output.is_empty() {
        emit(output);
    }
}

/// Preserve incomplete UTF-8 across batches, replacing truly invalid bytes only.
fn take_output(pending: &mut Vec<u8>, finished: bool) -> String {
    let mut end = pending.len();
    if !finished {
        let mut start = 0;
        while let Err(error) = std::str::from_utf8(&pending[start..]) {
            match error.error_len() {
                Some(invalid_len) => start += error.valid_up_to() + invalid_len,
                None => {
                    end = start + error.valid_up_to();
                    break;
                }
            }
        }
    }
    let output = String::from_utf8_lossy(&pending[..end]).into_owned();
    pending.drain(..end);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_bursts_are_coalesced_in_order_and_flushed_at_eof() {
        let (tx, rx) = mpsc::channel();
        let expected = "terminal output 😀\r\n".repeat(10000);
        for chunk in expected.as_bytes().chunks(7) {
            tx.send(chunk.to_vec()).unwrap();
        }
        drop(tx);
        let mut chunks = Vec::new();
        publish_terminal_output(rx, |chunk| chunks.push(chunk));
        assert_eq!(chunks.concat(), expected);
        assert!(chunks.len() >= 3, "size limit must flush a large burst");
        assert!(
            chunks.len() < 100,
            "PTY reads must be batched, not emitted individually"
        );
        assert!(chunks
            .iter()
            .all(|chunk| chunk.len() <= OUTPUT_BATCH_BYTES + OUTPUT_READ_BYTES));
    }

    #[test]
    fn output_is_flushed_while_the_terminal_is_still_open() {
        let (tx, rx) = mpsc::channel();
        let (output_tx, output_rx) = mpsc::channel();
        let task = std::thread::spawn(move || {
            publish_terminal_output(rx, |chunk| output_tx.send(chunk).unwrap())
        });
        tx.send(b"prompt> ".to_vec()).unwrap();
        assert_eq!(
            output_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            "prompt> "
        );
        drop(tx);
        task.join().unwrap();
    }

    #[test]
    fn utf8_suffixes_survive_batch_boundaries_and_invalid_bytes_are_replaced() {
        let mut pending = vec![b'a', 0xff, 0xf0, 0x9f];
        assert_eq!(take_output(&mut pending, false), "a\u{fffd}");
        assert_eq!(pending, [0xf0, 0x9f]);
        pending.extend_from_slice(&[0x98, 0x80, 0xe2]);
        assert_eq!(take_output(&mut pending, false), "😀");
        assert_eq!(take_output(&mut pending, true), "\u{fffd}");
        assert!(pending.is_empty());
    }

    #[test]
    fn bounded_reader_preserves_bytes_and_retries_interrupted_reads() {
        struct InterruptedOnce(u8);
        impl Read for InterruptedOnce {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += 1;
                match self.0 {
                    1 => Err(std::io::ErrorKind::Interrupted.into()),
                    2 => {
                        buf[0] = b'x';
                        Ok(1)
                    }
                    _ => Ok(0),
                }
            }
        }
        let (tx, rx) = mpsc::sync_channel(OUTPUT_QUEUE_CHUNKS);
        read_terminal_output(InterruptedOnce(0), tx);
        assert_eq!(rx.into_iter().flatten().collect::<Vec<_>>(), b"x");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pty_flushes_output_before_exit_and_records_finished_state() {
        let hub = EventHub::new();
        let mut events = hub.subscribe_resilient("pty-test");
        let service = TerminalService::new(hub);
        let opened = service
            .open_session(TerminalOpenSessionRequest {
                shell: Some("/bin/sh".into()),
                model: None,
                cwd: None,
                cols: Some(80),
                rows: Some(24),
                correlation_id: "pty-open".into(),
            })
            .unwrap();
        service
            .send_input(TerminalInputRequest {
                session_id: opened.session_id.clone(),
                input: "printf 'final-output\\n'; exit\n".into(),
                correlation_id: "pty-input".into(),
            })
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut output = String::new();
            loop {
                let event = events.recv().await.unwrap();
                assert_eq!(event.payload["sessionId"], opened.session_id);
                match event.action.as_str() {
                    "terminal.output" => output.push_str(event.payload["data"].as_str().unwrap()),
                    "terminal.exit" => {
                        assert!(output.contains("final-output"));
                        assert!(service.output_finished(&opened.session_id).unwrap());
                        break;
                    }
                    _ => panic!("unexpected terminal event"),
                }
            }
        })
        .await
        .unwrap();
        // Reap the fixture process and release its PTY resources.
        service
            .session_by_id(&opened.session_id)
            .unwrap()
            .child
            .lock()
            .unwrap()
            .wait()
            .unwrap();
        service
            .close_session(TerminalCloseSessionRequest {
                session_id: opened.session_id.clone(),
                correlation_id: "pty-close".into(),
            })
            .unwrap();
        assert!(service.output_finished(&opened.session_id).unwrap());
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
