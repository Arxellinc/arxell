#![cfg(feature = "tauri-runtime")]

use crate::ipc::tauri_bridge::TauriBridgeState;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

pub type ToolInvokeFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;
pub type ToolInvokeHandler = for<'a> fn(&'a TauriBridgeState, Value) -> ToolInvokeFuture<'a>;

pub struct InvokeRegistry {
    handlers: HashMap<(String, String), ToolInvokeHandler>,
}

impl InvokeRegistry {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool_id: &str, actions: &[&str], handler: ToolInvokeHandler) {
        for action in actions {
            self.handlers
                .insert((tool_id.to_string(), (*action).to_string()), handler);
        }
    }

    pub fn get(&self, tool_id: &str, action: &str) -> Option<ToolInvokeHandler> {
        self.handlers
            .get(&(tool_id.to_string(), action.to_string()))
            .copied()
    }
}

pub fn decode_payload<T>(payload: Value) -> Result<T, String>
where
    T: DeserializeOwned,
{
    serde_json::from_value(payload).map_err(|e| format!("invalid tool payload: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    fn ok_handler(_state: &TauriBridgeState, _payload: Value) -> ToolInvokeFuture<'_> {
        Box::pin(async { Ok(json!({"ok": true})) })
    }

    #[test]
    fn registry_dispatch_success() {
        let mut registry = InvokeRegistry::new();
        registry.register("flow", &["start"], ok_handler);
        assert!(registry.get("flow", "start").is_some());
    }

    #[test]
    fn registry_alias_support() {
        let mut registry = InvokeRegistry::new();
        registry.register("flow", &["list-runs", "listRuns"], ok_handler);
        assert!(registry.get("flow", "list-runs").is_some());
        assert!(registry.get("flow", "listRuns").is_some());
    }

    #[test]
    fn registry_unsupported_action_returns_none() {
        let mut registry = InvokeRegistry::new();
        registry.register("files", &["list-directory"], ok_handler);
        assert!(registry.get("files", "delete-directory").is_none());
    }

    #[derive(Debug, Deserialize)]
    struct PayloadShape {
        value: String,
    }

    #[test]
    fn decode_payload_invalid_shape_errors() {
        let result: Result<PayloadShape, String> = decode_payload(json!({"wrong": 1}));
        assert!(result.is_err());
        let message = result.err().unwrap_or_default();
        assert!(message.contains("invalid tool payload"));
    }

    #[test]
    fn decode_payload_valid_shape_succeeds() {
        let result: Result<PayloadShape, String> = decode_payload(json!({"value": "ok"}));
        assert!(result.is_ok());
        assert_eq!(result.ok().map(|v| v.value), Some("ok".to_string()));
    }
}
