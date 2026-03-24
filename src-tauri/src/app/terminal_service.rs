use crate::contracts::{
    EventSeverity, EventStage, Subsystem, TerminalCloseSessionRequest, TerminalCloseSessionResponse,
    TerminalInputRequest, TerminalInputResponse, TerminalOpenSessionRequest,
    TerminalOpenSessionResponse, TerminalResizeRequest, TerminalResizeResponse,
};
use crate::observability::EventHub;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
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

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take PTY writer: {e}"))?;

        let session = Arc::new(TerminalSession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        });

        self.sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?
            .insert(session_id.clone(), session);

        let hub = self.hub.clone();
        let correlation = format!("terminal-{session_id}");
        let session_for_thread = session_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0_u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        hub.emit(hub.make_event(
                            &correlation,
                            Subsystem::Service,
                            "terminal.output",
                            EventStage::Progress,
                            EventSeverity::Info,
                            json!({"sessionId": session_for_thread, "data": chunk}),
                        ));
                    }
                    Err(_) => break,
                }
            }
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

    fn session_by_id(&self, session_id: &str) -> Result<Arc<TerminalSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "terminal sessions lock poisoned".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {session_id}"))
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
