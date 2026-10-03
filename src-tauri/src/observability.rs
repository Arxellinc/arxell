use crate::contracts::{AppEvent, EventSeverity, Subsystem};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

const EVENT_BUFFER_MAX: usize = 2000;

/// Provider call IDs/names are untrusted strings, not safe diagnostic metadata.
/// Allocate stable local IDs for the duration of one direct-chat request.
#[derive(Default)]
pub struct DirectToolEventIds {
    ids: std::collections::HashMap<String, String>,
}

impl DirectToolEventIds {
    pub fn identity(&mut self, call_id: &str, name: &str) -> (String, String) {
        let next = self.ids.len() + 1;
        let id = self
            .ids
            .entry(call_id.into())
            .or_insert_with(|| format!("tool-{next}"))
            .clone();
        (id, safe_tool_name(name).into())
    }
}

fn safe_tool_name(name: &str) -> &'static str {
    match name {
        "read" => "read",
        "ls" => "ls",
        "notepad_read" => "notepad_read",
        "sheets" => "sheets",
        "chart_set" => "chart_set",
        "web_search" => "web_search",
        _ => "unknown",
    }
}

#[derive(Clone)]
pub struct EventHub {
    tx: broadcast::Sender<AppEvent>,
    history: Arc<Mutex<VecDeque<AppEvent>>>,
}

impl EventHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(512);
        Self {
            tx,
            history: Arc::new(Mutex::new(VecDeque::with_capacity(EVENT_BUFFER_MAX))),
        }
    }

    pub fn emit(&self, mut event: AppEvent) {
        // Direct agent diagnostics never carry arguments, commands or tool output.
        if event.action.starts_with("chat.agent.tool.") {
            event.payload = tool_metadata(event.payload);
        }
        event.payload = redact_payload(event.payload);

        if !is_presentation_event(&event.action) {
            let mut history = self.history.lock().expect("event history lock poisoned");
            history.push_back(event.clone());
            if history.len() > EVENT_BUFFER_MAX {
                history.pop_front();
            }
        }

        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.tx.subscribe()
    }

    pub fn recent_events(&self, max: usize) -> Vec<AppEvent> {
        let history = self.history.lock().expect("event history lock poisoned");
        history.iter().rev().take(max).cloned().collect()
    }

    pub fn make_event(
        &self,
        correlation_id: &str,
        subsystem: Subsystem,
        action: &str,
        stage: crate::contracts::EventStage,
        severity: EventSeverity,
        payload: Value,
    ) -> AppEvent {
        AppEvent {
            timestamp_ms: now_ms(),
            correlation_id: correlation_id.to_string(),
            subsystem,
            action: action.to_string(),
            stage,
            severity,
            payload,
        }
    }
}

impl Default for EventHub {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn redact_payload(payload: Value) -> Value {
    match payload {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let normalized: String = key
                        .chars()
                        .filter(|ch| ch.is_ascii_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect();
                    let value = if matches!(
                        normalized.as_str(),
                        "apikey"
                            | "token"
                            | "accesstoken"
                            | "refreshtoken"
                            | "secret"
                            | "clientsecret"
                            | "password"
                            | "authorization"
                            | "credentials"
                            | "privatekey"
                    ) {
                        Value::String("[REDACTED]".into())
                    } else {
                        redact_payload(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(redact_payload).collect()),
        other => other,
    }
}

fn tool_metadata(payload: Value) -> Value {
    let mut safe = serde_json::Map::new();
    if let Value::Object(object) = payload {
        let id = object
            .get("toolCallId")
            .and_then(Value::as_str)
            .filter(|id| {
                id.strip_prefix("tool-").is_some_and(|suffix| {
                    !suffix.is_empty()
                        && suffix.len() <= 10
                        && suffix.bytes().all(|byte| byte.is_ascii_digit())
                })
            })
            .unwrap_or("unavailable");
        safe.insert("toolCallId".into(), Value::String(id.into()));
        safe.insert(
            "toolName".into(),
            Value::String(
                safe_tool_name(object.get("toolName").and_then(Value::as_str).unwrap_or("")).into(),
            ),
        );
        if let Some(success) = object.get("success").and_then(Value::as_bool) {
            safe.insert("success".into(), Value::Bool(success));
        }
    }
    Value::Object(safe)
}

fn is_presentation_event(action: &str) -> bool {
    matches!(
        action,
        "chat.stream.chunk"
            | "chat.stream.reasoning_chunk"
            | "terminal.output"
            | "notepad.document.sync"
            | "chart.definition.set"
            | "pi.message.delta"
            | "pi.message.final"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::EventStage;
    use serde_json::json;

    #[test]
    fn model_controlled_tool_identifiers_cannot_carry_private_text_into_diagnostics() {
        let mut ids = DirectToolEventIds::default();
        assert_eq!(
            ids.identity("private credential", "private file body"),
            ("tool-1".into(), "unknown".into())
        );
        assert_eq!(
            ids.identity("private credential", "read"),
            ("tool-1".into(), "read".into())
        );
        assert_eq!(
            ids.identity("another private credential", "ls"),
            ("tool-2".into(), "ls".into())
        );
        let payload = tool_metadata(
            json!({"toolCallId": "private credential", "toolName": "private file body", "success": "private credential"}),
        );
        assert!(!payload.to_string().contains("private"));
    }

    #[test]
    fn nested_credentials_are_redacted_but_counts_are_preserved() {
        let value = redact_payload(
            json!({"nested": [{"API_KEY": "one", "refreshToken": "two", "Authorization": "three", "tokenCount": 4}]}),
        );
        assert_eq!(value["nested"][0]["API_KEY"], "[REDACTED]");
        assert_eq!(value["nested"][0]["refreshToken"], "[REDACTED]");
        assert_eq!(value["nested"][0]["Authorization"], "[REDACTED]");
        assert_eq!(value["nested"][0]["tokenCount"], 4);
    }

    #[tokio::test]
    async fn tool_commands_and_output_are_removed_before_history_and_broadcast() {
        let hub = EventHub::new();
        let mut rx = hub.subscribe();
        for action in ["chat.agent.tool.end", "chat.agent.tool.result"] {
            hub.emit(hub.make_event("corr", Subsystem::Tool, action, EventStage::Complete, EventSeverity::Info,
                json!({"toolName": "bash", "toolCallId": "1", "success": true, "display": "secret-body-and-token", "arguments": {"command": "secret-command"}, "output": "secret-output"})));
            let event = rx.recv().await.unwrap();
            assert!(!serde_json::to_string(&event).unwrap().contains("secret"));
        }
        assert!(!serde_json::to_string(&hub.recent_events(100))
            .unwrap()
            .contains("secret"));
    }

    #[tokio::test]
    async fn presentation_content_is_delivered_but_not_retained_as_diagnostics() {
        let hub = EventHub::new();
        let mut rx = hub.subscribe();
        hub.emit(hub.make_event(
            "corr",
            Subsystem::Tool,
            "notepad.document.sync",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"content": "private note"}),
        ));
        assert_eq!(rx.recv().await.unwrap().payload["content"], "private note");
        assert!(hub.recent_events(100).is_empty());
    }
}
