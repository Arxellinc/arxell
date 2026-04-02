#![cfg(feature = "tauri-runtime")]

use crate::app::web_search_service::WebSearchRequest as ServiceWebSearchRequest;
use crate::contracts::{WebSearchRequest, WebSearchResponse};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde_json::{json, Value};

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("webSearch", &["search"], invoke_search);
    registry.register("web", &["search"], invoke_search);
}

fn invoke_search(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let web_search = state.web_search.clone();
    Box::pin(async move {
        let req: WebSearchRequest = decode_payload(payload)?;
        let result = web_search
            .search(ServiceWebSearchRequest {
                query: req.query,
                mode: req.mode,
                num: req.num,
                page: req.page,
            })
            .await?;
        serde_json::to_value(WebSearchResponse {
            correlation_id: req.correlation_id,
            result: serde_json::to_value(result).unwrap_or(json!({})),
        })
        .map_err(|e| format!("failed serializing web search response: {e}"))
    })
}
