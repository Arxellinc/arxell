use crate::app::web_search_service::{WebSearchRequest, WebSearchService};
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;

pub struct WebSearchTool {
    service: Arc<WebSearchService>,
}

impl WebSearchTool {
    pub fn new(service: Arc<WebSearchService>) -> Self {
        Self { service }
    }
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &'static str {
        "web_search"
    }

    fn description(&self) -> &'static str {
        "Search the web using the configured Search API and return ranked results."
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "mode": { "type": "string", "enum": ["search", "images", "news", "maps", "places", "videos", "shopping", "scholar"] },
                "num": { "type": "integer" },
                "page": { "type": "integer" }
            },
            "required": ["query"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let query = params
            .get("query")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if query.is_empty() {
            "web_search(query=<missing>)".to_string()
        } else {
            format!("web_search(query={query})")
        }
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let query = params
            .get("query")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if query.is_empty() {
            return ToolResult {
                success: false,
                result: Some("web_search requires a non-empty query".to_string()),
                images: None,
                display: Some("web_search requires a non-empty query".to_string()),
            };
        }

        let mode = params
            .get("mode")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);
        let num = params
            .get("num")
            .and_then(|value| value.as_u64())
            .map(|value| value as u32);
        let page = params
            .get("page")
            .and_then(|value| value.as_u64())
            .map(|value| value as u32);

        match self
            .service
            .search(WebSearchRequest {
                query,
                mode,
                num,
                page,
            })
            .await
        {
            Ok(result) => {
                let serialized =
                    serde_json::to_string(&result).unwrap_or_else(|_| "{\"items\":[]}".to_string());
                ToolResult {
                    success: true,
                    result: Some(serialized),
                    images: None,
                    display: Some(format!(
                        "web_search returned {} items for '{}'",
                        result.items.len(),
                        result.query
                    )),
                }
            }
            Err(error) => ToolResult {
                success: false,
                result: Some(error.clone()),
                images: None,
                display: Some(error),
            },
        }
    }
}
