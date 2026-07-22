use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Instant};

const DEFAULT_MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_MAX_FINAL_TEXT_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct PiRpcConfig {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub profile_dir: Option<PathBuf>,
    pub session_dir: Option<PathBuf>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tools: Vec<String>,
    pub extensions: Vec<PathBuf>,
    pub environment: HashMap<String, String>,
    pub timeout: Duration,
    pub max_record_bytes: usize,
    pub max_final_text_bytes: usize,
}

impl PiRpcConfig {
    pub fn ephemeral(cwd: PathBuf) -> Self {
        Self {
            executable: pi_executable(),
            cwd,
            profile_dir: None,
            session_dir: None,
            provider: None,
            model: None,
            tools: vec![
                "read".to_string(),
                "write".to_string(),
                "edit".to_string(),
                "bash".to_string(),
            ],
            extensions: Vec::new(),
            environment: HashMap::new(),
            timeout: Duration::from_secs(30 * 60),
            max_record_bytes: DEFAULT_MAX_RECORD_BYTES,
            max_final_text_bytes: DEFAULT_MAX_FINAL_TEXT_BYTES,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PiRpcRunResult {
    pub final_text: String,
    pub event_count: usize,
    pub stderr: String,
}

#[derive(Debug, Clone)]
pub struct PiRpcResponse {
    pub id: Option<String>,
    pub command: String,
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PiRpcEvent {
    pub event_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct PiRpcExtensionUiRequest {
    pub id: String,
    pub method: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub enum PiRpcRecord {
    Response(PiRpcResponse),
    Event(PiRpcEvent),
    ExtensionUiRequest(PiRpcExtensionUiRequest),
    Stderr(String),
}

#[derive(Debug, Error)]
pub enum PiRpcError {
    #[error("failed to start Pi RPC: {0}")]
    Spawn(String),
    #[error("Pi RPC I/O failed: {0}")]
    Io(String),
    #[error("Pi RPC protocol error: {0}")]
    Protocol(String),
    #[error("Pi RPC command {command} failed: {message}")]
    Command { command: String, message: String },
    #[error("Pi agent failed: {0}")]
    Agent(String),
    #[error("Pi RPC timed out after {0:?}")]
    Timeout(Duration),
    #[error("Pi RPC exited unexpectedly ({status}): {stderr}")]
    UnexpectedExit { status: String, stderr: String },
    #[error("Pi RPC record exceeded the {limit}-byte limit")]
    RecordTooLarge { limit: usize },
}

pub struct PiRpcService;

impl PiRpcService {
    pub async fn run_prompt(
        config: PiRpcConfig,
        prompt: String,
        events: Option<mpsc::UnboundedSender<PiRpcRecord>>,
    ) -> Result<PiRpcRunResult, PiRpcError> {
        let run_timeout = config.timeout;
        let mut session = PiRpcSession::spawn(config, events).await?;
        let result = timeout(run_timeout, session.run_prompt(&prompt)).await;

        match result {
            Ok(run_result) => {
                let shutdown_result = session.shutdown().await;
                run_result.and(shutdown_result.map(|_| session.result()))
            }
            Err(_) => {
                session.abort_and_stop().await;
                Err(PiRpcError::Timeout(run_timeout))
            }
        }
    }
}

struct PiRpcSession {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    decoder: JsonlDecoder,
    decoded: VecDeque<Value>,
    responses: HashMap<String, PiRpcResponse>,
    events: VecDeque<PiRpcEvent>,
    event_sink: Option<mpsc::UnboundedSender<PiRpcRecord>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    request_sequence: u64,
    final_text: String,
    event_count: usize,
    max_final_text_bytes: usize,
    agent_error: Option<String>,
}

impl PiRpcSession {
    async fn spawn(
        config: PiRpcConfig,
        event_sink: Option<mpsc::UnboundedSender<PiRpcRecord>>,
    ) -> Result<Self, PiRpcError> {
        let args = build_args(&config);
        let mut command = pi_command(&config.executable, &args);
        command
            .current_dir(&config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("PI_TELEMETRY", "0")
            .env("PI_SKIP_VERSION_CHECK", "1");

        if let Some(profile_dir) = &config.profile_dir {
            command.env("PI_CODING_AGENT_DIR", profile_dir);
        }
        for (key, value) in &config.environment {
            command.env(key, value);
        }

        let mut child = command
            .spawn()
            .map_err(|error| PiRpcError::Spawn(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| PiRpcError::Spawn("Pi stdin was not piped".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PiRpcError::Spawn("Pi stdout was not piped".to_string()))?;
        let mut child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| PiRpcError::Spawn("Pi stderr was not piped".to_string()))?;

        let stderr = Arc::new(Mutex::new(Vec::new()));
        let stderr_buffer = Arc::clone(&stderr);
        let stderr_sink = event_sink.clone();
        tokio::spawn(async move {
            let mut chunk = [0_u8; 4096];
            loop {
                let count = match child_stderr.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => count,
                };
                let bytes = &chunk[..count];
                if let Ok(mut buffer) = stderr_buffer.lock() {
                    append_bounded(&mut buffer, bytes, MAX_STDERR_BYTES);
                }
                if let Some(sink) = &stderr_sink {
                    let text = String::from_utf8_lossy(bytes).into_owned();
                    let _ = sink.send(PiRpcRecord::Stderr(text));
                }
            }
        });

        Ok(Self {
            child,
            stdin: Some(stdin),
            stdout,
            decoder: JsonlDecoder::new(config.max_record_bytes),
            decoded: VecDeque::new(),
            responses: HashMap::new(),
            events: VecDeque::new(),
            event_sink,
            stderr,
            request_sequence: 0,
            final_text: String::new(),
            event_count: 0,
            max_final_text_bytes: config.max_final_text_bytes,
            agent_error: None,
        })
    }

    async fn run_prompt(&mut self, prompt: &str) -> Result<(), PiRpcError> {
        let prompt_id = self
            .send_command(json!({"type": "prompt", "message": prompt}))
            .await?;
        let response = self.wait_response(&prompt_id).await?;
        ensure_success(response)?;

        loop {
            let event = self.next_event().await?;
            self.capture_event(&event);
            if event.event_type == "agent_settled" {
                if let Some(error) = self.agent_error.take() {
                    return Err(PiRpcError::Agent(error));
                }
                return Ok(());
            }
        }
    }

    async fn send_command(&mut self, mut command: Value) -> Result<String, PiRpcError> {
        self.request_sequence += 1;
        let id = format!("arxell-{}", self.request_sequence);
        let object = command
            .as_object_mut()
            .ok_or_else(|| PiRpcError::Protocol("RPC command must be an object".to_string()))?;
        object.insert("id".to_string(), Value::String(id.clone()));
        self.write_value(&command).await?;
        Ok(id)
    }

    async fn write_value(&mut self, value: &Value) -> Result<(), PiRpcError> {
        let mut encoded =
            serde_json::to_vec(value).map_err(|error| PiRpcError::Protocol(error.to_string()))?;
        encoded.push(b'\n');
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| PiRpcError::Io("Pi stdin is closed".to_string()))?;
        stdin
            .write_all(&encoded)
            .await
            .map_err(|error| PiRpcError::Io(error.to_string()))?;
        stdin
            .flush()
            .await
            .map_err(|error| PiRpcError::Io(error.to_string()))
    }

    async fn wait_response(&mut self, id: &str) -> Result<PiRpcResponse, PiRpcError> {
        if let Some(response) = self.responses.remove(id) {
            return Ok(response);
        }

        loop {
            match self.read_record().await? {
                PiRpcRecord::Response(response) => {
                    if response.id.as_deref() == Some(id) {
                        return Ok(response);
                    }
                    if let Some(response_id) = response.id.clone() {
                        self.responses.insert(response_id, response);
                    }
                }
                PiRpcRecord::Event(event) => {
                    self.forward(PiRpcRecord::Event(event.clone()));
                    self.events.push_back(event);
                }
                PiRpcRecord::ExtensionUiRequest(request) => {
                    self.reject_extension_ui(request).await?;
                }
                PiRpcRecord::Stderr(_) => {}
            }
        }
    }

    async fn next_event(&mut self) -> Result<PiRpcEvent, PiRpcError> {
        if let Some(event) = self.events.pop_front() {
            return Ok(event);
        }

        loop {
            match self.read_record().await? {
                PiRpcRecord::Event(event) => {
                    self.forward(PiRpcRecord::Event(event.clone()));
                    return Ok(event);
                }
                PiRpcRecord::Response(response) => {
                    if let Some(id) = response.id.clone() {
                        self.responses.insert(id, response);
                    }
                }
                PiRpcRecord::ExtensionUiRequest(request) => {
                    self.reject_extension_ui(request).await?;
                }
                PiRpcRecord::Stderr(_) => {}
            }
        }
    }

    async fn reject_extension_ui(
        &mut self,
        request: PiRpcExtensionUiRequest,
    ) -> Result<(), PiRpcError> {
        self.forward(PiRpcRecord::ExtensionUiRequest(request.clone()));
        if matches!(
            request.method.as_str(),
            "select" | "confirm" | "input" | "editor"
        ) {
            self.write_value(&json!({
                "type": "extension_ui_response",
                "id": request.id,
                "cancelled": true
            }))
            .await?;
        }
        Ok(())
    }

    async fn read_record(&mut self) -> Result<PiRpcRecord, PiRpcError> {
        loop {
            if let Some(value) = self.decoded.pop_front() {
                return classify_record(value);
            }

            let mut chunk = [0_u8; 8192];
            let count = self
                .stdout
                .read(&mut chunk)
                .await
                .map_err(|error| PiRpcError::Io(error.to_string()))?;
            if count == 0 {
                let status = self
                    .child
                    .wait()
                    .await
                    .map_err(|error| PiRpcError::Io(error.to_string()))?;
                return Err(PiRpcError::UnexpectedExit {
                    status: status.to_string(),
                    stderr: self.stderr_text(),
                });
            }
            self.decoded.extend(self.decoder.push(&chunk[..count])?);
        }
    }

    fn capture_event(&mut self, event: &PiRpcEvent) {
        self.event_count += 1;
        match event.event_type.as_str() {
            "message_update" => {
                let update = &event.payload["assistantMessageEvent"];
                match update["type"].as_str() {
                    Some("text_delta") => {
                        if let Some(delta) = update["delta"].as_str() {
                            append_string_bounded(
                                &mut self.final_text,
                                delta,
                                self.max_final_text_bytes,
                            );
                        }
                    }
                    Some("error") => {
                        self.agent_error = Some(
                            update["error"]
                                .as_str()
                                .or_else(|| update["message"].as_str())
                                .unwrap_or("Pi reported an assistant message error")
                                .to_string(),
                        );
                    }
                    _ => {}
                }
            }
            "message_end" => {
                if let Some(text) = assistant_text(&event.payload["message"]) {
                    self.final_text.clear();
                    append_string_bounded(&mut self.final_text, &text, self.max_final_text_bytes);
                }
            }
            "extension_error" => {
                self.agent_error = Some(
                    event.payload["error"]
                        .as_str()
                        .or_else(|| event.payload["message"].as_str())
                        .unwrap_or("Pi extension failed")
                        .to_string(),
                );
            }
            _ => {}
        }
    }

    async fn abort_and_stop(&mut self) {
        if self.stdin.is_some() {
            let _ = self
                .write_value(&json!({"id": "arxell-abort", "type": "abort"}))
                .await;
        }
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => sleep(Duration::from_millis(25)).await,
                Err(_) => break,
            }
        }
        let _ = self.child.kill().await;
    }

    async fn shutdown(&mut self) -> Result<(), PiRpcError> {
        self.stdin.take();
        match timeout(SHUTDOWN_GRACE, self.child.wait()).await {
            Ok(Ok(status)) if status.success() => Ok(()),
            Ok(Ok(status)) => Err(PiRpcError::UnexpectedExit {
                status: status.to_string(),
                stderr: self.stderr_text(),
            }),
            Ok(Err(error)) => Err(PiRpcError::Io(error.to_string())),
            Err(_) => {
                self.child
                    .kill()
                    .await
                    .map_err(|error| PiRpcError::Io(error.to_string()))?;
                Ok(())
            }
        }
    }

    fn result(&self) -> PiRpcRunResult {
        PiRpcRunResult {
            final_text: self.final_text.clone(),
            event_count: self.event_count,
            stderr: self.stderr_text(),
        }
    }

    fn stderr_text(&self) -> String {
        self.stderr
            .lock()
            .map(|buffer| String::from_utf8_lossy(&buffer).into_owned())
            .unwrap_or_else(|_| "stderr buffer unavailable".to_string())
    }

    fn forward(&self, record: PiRpcRecord) {
        if let Some(sink) = &self.event_sink {
            let _ = sink.send(record);
        }
    }
}

#[derive(Debug)]
struct JsonlDecoder {
    buffer: Vec<u8>,
    max_record_bytes: usize,
}

impl JsonlDecoder {
    fn new(max_record_bytes: usize) -> Self {
        Self {
            buffer: Vec::new(),
            max_record_bytes: max_record_bytes.max(1),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>, PiRpcError> {
        self.buffer.extend_from_slice(bytes);
        let mut records = Vec::new();

        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            if newline > self.max_record_bytes {
                return Err(PiRpcError::RecordTooLarge {
                    limit: self.max_record_bytes,
                });
            }
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            let text = std::str::from_utf8(&line)
                .map_err(|error| PiRpcError::Protocol(format!("invalid UTF-8: {error}")))?;
            let value = serde_json::from_str(text).map_err(|error| {
                PiRpcError::Protocol(format!("malformed JSONL record: {error}"))
            })?;
            records.push(value);
        }

        if self.buffer.len() > self.max_record_bytes {
            return Err(PiRpcError::RecordTooLarge {
                limit: self.max_record_bytes,
            });
        }
        Ok(records)
    }
}

fn classify_record(value: Value) -> Result<PiRpcRecord, PiRpcError> {
    let record_type = value["type"]
        .as_str()
        .ok_or_else(|| PiRpcError::Protocol("RPC record is missing string type".to_string()))?;
    match record_type {
        "response" => Ok(PiRpcRecord::Response(PiRpcResponse {
            id: value["id"].as_str().map(str::to_string),
            command: value["command"].as_str().unwrap_or("unknown").to_string(),
            success: value["success"].as_bool().unwrap_or(false),
            data: value.get("data").cloned(),
            error: response_error(&value),
        })),
        "extension_ui_request" => Ok(PiRpcRecord::ExtensionUiRequest(PiRpcExtensionUiRequest {
            id: value["id"]
                .as_str()
                .ok_or_else(|| {
                    PiRpcError::Protocol("extension_ui_request is missing string id".to_string())
                })?
                .to_string(),
            method: value["method"]
                .as_str()
                .ok_or_else(|| {
                    PiRpcError::Protocol(
                        "extension_ui_request is missing string method".to_string(),
                    )
                })?
                .to_string(),
            payload: value,
        })),
        _ => Ok(PiRpcRecord::Event(PiRpcEvent {
            event_type: record_type.to_string(),
            payload: value,
        })),
    }
}

fn response_error(value: &Value) -> Option<String> {
    value["error"]
        .as_str()
        .map(str::to_string)
        .or_else(|| value["message"].as_str().map(str::to_string))
        .or_else(|| value["error"]["message"].as_str().map(str::to_string))
}

fn ensure_success(response: PiRpcResponse) -> Result<(), PiRpcError> {
    if response.success {
        return Ok(());
    }
    Err(PiRpcError::Command {
        command: response.command,
        message: response
            .error
            .unwrap_or_else(|| "Pi rejected the command".to_string()),
    })
}

fn assistant_text(message: &Value) -> Option<String> {
    if message["role"].as_str() != Some("assistant") {
        return None;
    }
    if let Some(content) = message["content"].as_str() {
        return Some(content.to_string());
    }
    let content = message["content"].as_array()?;
    let text = content
        .iter()
        .filter(|item| item["type"].as_str() == Some("text"))
        .filter_map(|item| item["text"].as_str())
        .collect::<String>();
    (!text.is_empty()).then_some(text)
}

fn build_args(config: &PiRpcConfig) -> Vec<String> {
    let mut args = vec![
        "--mode".to_string(),
        "rpc".to_string(),
        "--no-approve".to_string(),
        "--no-extensions".to_string(),
    ];
    if let Some(session_dir) = &config.session_dir {
        args.push("--session-dir".to_string());
        args.push(session_dir.to_string_lossy().into_owned());
    } else {
        args.push("--no-session".to_string());
    }
    if let Some(provider) = &config.provider {
        args.push("--provider".to_string());
        args.push(provider.clone());
    }
    if let Some(model) = &config.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }
    if !config.tools.is_empty() {
        args.push("--tools".to_string());
        args.push(config.tools.join(","));
    } else {
        args.push("--no-tools".to_string());
    }
    for extension in &config.extensions {
        args.push("--extension".to_string());
        args.push(extension.to_string_lossy().into_owned());
    }
    args
}

fn pi_executable() -> PathBuf {
    std::env::var_os("ARXELL_PI_EXECUTABLE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("pi"))
}

#[cfg(not(target_os = "windows"))]
fn pi_command(executable: &PathBuf, args: &[String]) -> Command {
    let mut command = Command::new(executable);
    command.args(args);
    command
}

#[cfg(target_os = "windows")]
fn pi_command(executable: &PathBuf, args: &[String]) -> Command {
    let extension = executable
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if executable.components().count() > 1 && !matches!(extension, "cmd" | "bat") {
        let mut command = Command::new(executable);
        command.args(args);
        return command;
    }

    let mut command = Command::new("cmd");
    command.args(["/D", "/S", "/C"]);
    command.arg(executable);
    command.args(args);
    command
}

fn append_bounded(target: &mut Vec<u8>, bytes: &[u8], limit: usize) {
    if bytes.len() >= limit {
        target.clear();
        target.extend_from_slice(&bytes[bytes.len() - limit..]);
        return;
    }
    let overflow = target
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(limit);
    if overflow > 0 {
        target.drain(..overflow);
    }
    target.extend_from_slice(bytes);
}

fn append_string_bounded(target: &mut String, text: &str, limit: usize) {
    if target.len() >= limit || text.is_empty() {
        return;
    }
    let remaining = limit - target.len();
    if text.len() <= remaining {
        target.push_str(text);
        return;
    }
    let mut end = remaining;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&text[..end]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonl_decoder_preserves_fragmented_utf8() {
        let encoded = serde_json::to_vec(&json!({"type": "event", "text": "héllo"})).unwrap();
        let split = encoded.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
        let mut decoder = JsonlDecoder::new(1024);

        assert!(decoder.push(&encoded[..split]).unwrap().is_empty());
        let mut remainder = encoded[split..].to_vec();
        remainder.push(b'\n');
        let records = decoder.push(&remainder).unwrap();

        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["text"], "héllo");
    }

    #[test]
    fn jsonl_decoder_returns_multiple_records_and_accepts_crlf() {
        let mut decoder = JsonlDecoder::new(1024);
        let records = decoder
            .push(b"{\"type\":\"one\"}\r\n{\"type\":\"two\"}\n")
            .unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["type"], "one");
        assert_eq!(records[1]["type"], "two");
    }

    #[test]
    fn jsonl_decoder_does_not_split_unicode_line_separators() {
        let mut decoder = JsonlDecoder::new(1024);
        let line = "{\"type\":\"event\",\"text\":\"before\u{2028}middle\u{2029}after\"}\n";
        let records = decoder.push(line.as_bytes()).unwrap();

        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["text"], "before\u{2028}middle\u{2029}after");
    }

    #[test]
    fn jsonl_decoder_rejects_malformed_and_oversized_records() {
        let mut malformed = JsonlDecoder::new(1024);
        assert!(matches!(
            malformed.push(b"not-json\n"),
            Err(PiRpcError::Protocol(_))
        ));

        let mut oversized = JsonlDecoder::new(4);
        assert!(matches!(
            oversized.push(b"12345"),
            Err(PiRpcError::RecordTooLarge { limit: 4 })
        ));
    }

    #[test]
    fn responses_keep_ids_for_out_of_order_correlation() {
        let first = classify_record(json!({
            "id": "request-2",
            "type": "response",
            "command": "get_state",
            "success": true
        }))
        .unwrap();
        let second = classify_record(json!({
            "id": "request-1",
            "type": "response",
            "command": "prompt",
            "success": true
        }))
        .unwrap();

        assert!(matches!(
            first,
            PiRpcRecord::Response(PiRpcResponse { id: Some(id), .. }) if id == "request-2"
        ));
        assert!(matches!(
            second,
            PiRpcRecord::Response(PiRpcResponse { id: Some(id), .. }) if id == "request-1"
        ));
    }

    #[test]
    fn agent_end_is_distinct_from_agent_settled() {
        let end = classify_record(json!({"type": "agent_end", "willRetry": true})).unwrap();
        let settled = classify_record(json!({"type": "agent_settled"})).unwrap();

        assert!(matches!(
            end,
            PiRpcRecord::Event(PiRpcEvent { event_type, .. }) if event_type == "agent_end"
        ));
        assert!(matches!(
            settled,
            PiRpcRecord::Event(PiRpcEvent { event_type, .. }) if event_type == "agent_settled"
        ));
    }

    #[test]
    fn build_args_isolated_automation_from_global_extensions() {
        let mut config = PiRpcConfig::ephemeral(PathBuf::from("/project"));
        config.provider = Some("openai".to_string());
        config.model = Some("gpt-4o".to_string());
        config.extensions = vec![PathBuf::from("/arxell/policy.ts")];
        let args = build_args(&config);

        assert!(args.windows(2).any(|pair| pair == ["--mode", "rpc"]));
        assert!(args.iter().any(|arg| arg == "--no-extensions"));
        assert!(args.iter().any(|arg| arg == "--no-session"));
        assert!(args.windows(2).any(|pair| pair == ["--provider", "openai"]));
        assert!(args.windows(2).any(|pair| pair == ["--model", "gpt-4o"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--extension", "/arxell/policy.ts"]));
    }

    #[test]
    fn assistant_text_collects_only_text_blocks() {
        let message = json!({
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "secret"},
                {"type": "text", "text": "hello"},
                {"type": "toolCall", "name": "read"},
                {"type": "text", "text": " world"}
            ]
        });

        assert_eq!(assistant_text(&message).as_deref(), Some("hello world"));
    }

    #[tokio::test]
    async fn fake_pi_streams_until_settlement_and_returns_final_text() {
        let Some((config, wrapper)) = fake_config("settled", Duration::from_secs(5)) else {
            return;
        };
        let (sender, mut receiver) = mpsc::unbounded_channel();

        let result = PiRpcService::run_prompt(config, "normal".to_string(), Some(sender))
            .await
            .unwrap();
        cleanup_wrapper(wrapper);

        assert_eq!(result.final_text, "hello from fixture");
        assert!(result.event_count >= 6);
        assert!(result.stderr.contains("bounded fixture diagnostic"));
        let mut saw_retrying_end = false;
        let mut saw_settled = false;
        while let Ok(record) = receiver.try_recv() {
            if let PiRpcRecord::Event(event) = record {
                saw_retrying_end |= event.event_type == "agent_end"
                    && event.payload["willRetry"].as_bool() == Some(true);
                saw_settled |= event.event_type == "agent_settled";
            }
        }
        assert!(saw_retrying_end);
        assert!(saw_settled);
    }

    #[tokio::test]
    async fn fake_pi_extension_confirmation_fails_closed() {
        let Some((config, wrapper)) = fake_config("extension", Duration::from_secs(5)) else {
            return;
        };
        let (sender, mut receiver) = mpsc::unbounded_channel();

        let result = PiRpcService::run_prompt(config, "extension".to_string(), Some(sender)).await;
        cleanup_wrapper(wrapper);

        assert!(result.is_ok());
        assert!(
            std::iter::from_fn(|| receiver.try_recv().ok()).any(|record| matches!(
                record,
                PiRpcRecord::ExtensionUiRequest(PiRpcExtensionUiRequest { id, method, .. })
                    if id == "approval-1" && method == "confirm"
            ))
        );
    }

    #[tokio::test]
    async fn fake_pi_timeout_aborts_and_stops_the_child() {
        let Some((config, wrapper)) = fake_config("timeout", Duration::from_millis(100)) else {
            return;
        };

        let result = PiRpcService::run_prompt(config, "timeout".to_string(), None).await;
        cleanup_wrapper(wrapper);

        assert!(matches!(result, Err(PiRpcError::Timeout(_))));
    }

    #[tokio::test]
    async fn fake_pi_malformed_output_is_a_protocol_error() {
        let Some((config, wrapper)) = fake_config("malformed", Duration::from_secs(5)) else {
            return;
        };

        let result = PiRpcService::run_prompt(config, "malformed".to_string(), None).await;
        cleanup_wrapper(wrapper);

        assert!(matches!(result, Err(PiRpcError::Protocol(_))));
    }

    #[tokio::test]
    async fn fake_pi_crash_includes_bounded_stderr() {
        let Some((config, wrapper)) = fake_config("crash", Duration::from_secs(5)) else {
            return;
        };

        let result = PiRpcService::run_prompt(config, "crash".to_string(), None).await;
        cleanup_wrapper(wrapper);

        assert!(matches!(
            result,
            Err(PiRpcError::UnexpectedExit { stderr, .. }) if stderr.contains("fixture crash")
        ));
    }

    fn fake_config(label: &str, run_timeout: Duration) -> Option<(PiRpcConfig, PathBuf)> {
        if std::process::Command::new("node")
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_none()
        {
            return None;
        }

        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("fake_pi_rpc.js");
        let extension = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        static NEXT_WRAPPER_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let wrapper_id = NEXT_WRAPPER_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let wrapper = std::env::temp_dir().join(format!(
            "arxell-fake-pi-{}-{}-{}.{}",
            std::process::id(),
            label,
            wrapper_id,
            extension
        ));
        let script = if cfg!(target_os = "windows") {
            format!("@node \"{}\" %*\r\n", fixture.display())
        } else {
            format!("#!/bin/sh\nexec node \"{}\" \"$@\"\n", fixture.display())
        };
        std::fs::write(&wrapper, script).ok()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&wrapper).ok()?.permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(&wrapper, permissions).ok()?;
        }

        let mut config = PiRpcConfig::ephemeral(std::env::temp_dir());
        config.executable = wrapper.clone();
        config.timeout = run_timeout;
        Some((config, wrapper))
    }

    fn cleanup_wrapper(wrapper: PathBuf) {
        let _ = std::fs::remove_file(wrapper);
    }
}
