use crate::contracts::{AppEvent, EventSeverity, Subsystem};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

const EVENT_BUFFER_MAX: usize = 2000;

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
        event.payload = redact_payload(event.payload);

        {
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
        Value::Object(mut map) => {
            for key in ["api_key", "token", "secret", "password", "authorization"] {
                if map.contains_key(key) {
                    map.insert(key.to_string(), Value::String("[REDACTED]".to_string()));
                }
            }
            Value::Object(map)
        }
        other => other,
    }
}
