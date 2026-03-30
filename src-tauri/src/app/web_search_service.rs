use crate::api_registry::ApiRegistryService;
use crate::contracts::ApiConnectionAgentRecord;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub query: String,
    pub mode: Option<String>,
    pub num: Option<u32>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub query: String,
    pub mode: String,
    pub items: Vec<serde_json::Value>,
    pub organic: Vec<serde_json::Value>,
    pub answer_box: Option<serde_json::Value>,
    pub knowledge_graph: Option<serde_json::Value>,
    pub people_also_ask: Vec<serde_json::Value>,
    pub related_searches: Vec<String>,
    pub raw: serde_json::Value,
}

#[async_trait]
pub trait SearchProvider: Send + Sync {
    async fn search(
        &self,
        connection: &ApiConnectionAgentRecord,
        request: &WebSearchRequest,
    ) -> Result<WebSearchResult, String>;
}

pub struct SerperSearchProvider;

#[async_trait]
impl SearchProvider for SerperSearchProvider {
    async fn search(
        &self,
        connection: &ApiConnectionAgentRecord,
        request: &WebSearchRequest,
    ) -> Result<WebSearchResult, String> {
        let query = request.query.trim().to_string();
        if query.is_empty() {
            return Err("web_search requires a non-empty query".to_string());
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("failed creating search HTTP client: {e}"))?;

        let normalized_mode = normalize_mode(request.mode.as_deref());
        let endpoint_path = connection
            .api_standard_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(match normalized_mode {
                "images" => "/images",
                "news" => "/news",
                "maps" | "places" => "/places",
                "videos" => "/videos",
                "shopping" => "/shopping",
                "scholar" => "/scholar",
                _ => "/search",
            });
        let endpoint = join_base_and_path(connection.api_url.as_str(), endpoint_path);

        let mut payload = json!({ "q": query });
        if let Some(num) = request.num {
            payload["num"] = json!(num.clamp(1, 20));
        }
        if let Some(page) = request.page {
            payload["page"] = json!(page.max(1));
        }

        let response = client
            .post(endpoint)
            .header("X-API-KEY", connection.api_key.as_str())
            .header("Authorization", format!("Bearer {}", connection.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("search request failed: {e}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("failed reading search response body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "search request failed (HTTP {}): {}",
                status.as_u16(),
                body
            ));
        }

        let parsed: serde_json::Value = serde_json::from_str(body.as_str())
            .map_err(|e| format!("search response is not valid JSON: {e}"))?;

        let primary_items = parsed
            .get(match normalized_mode {
                "images" => "images",
                "news" => "news",
                "videos" => "videos",
                "shopping" => "shopping",
                "places" | "maps" => "places",
                "scholar" => "organic",
                _ => "organic",
            })
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let organic = parsed
            .get("organic")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let people_also_ask = parsed
            .get("peopleAlsoAsk")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let related_searches = parsed
            .get("relatedSearches")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("query").and_then(|value| value.as_str()))
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(WebSearchResult {
            query: request.query.trim().to_string(),
            mode: normalized_mode.to_string(),
            items: primary_items,
            organic,
            answer_box: parsed.get("answerBox").cloned(),
            knowledge_graph: parsed.get("knowledgeGraph").cloned(),
            people_also_ask,
            related_searches,
            raw: parsed,
        })
    }
}

pub struct WebSearchService {
    api_registry: Arc<ApiRegistryService>,
    provider: Arc<dyn SearchProvider>,
}

impl WebSearchService {
    pub fn new(api_registry: Arc<ApiRegistryService>) -> Self {
        Self {
            api_registry,
            provider: Arc::new(SerperSearchProvider),
        }
    }

    pub async fn search(&self, request: WebSearchRequest) -> Result<WebSearchResult, String> {
        let Some(connection) = self.api_registry.primary_verified_search_for_agent() else {
            return Err(
                "No verified Search API configured. Add one in APIs panel (type=Search)."
                    .to_string(),
            );
        };
        if appears_masked_api_key(connection.api_key.as_str()) {
            return Err(
                "Search API key appears masked/placeholder. Open APIs panel, edit Search connection, and paste the full key."
                    .to_string(),
            );
        }
        self.provider.search(&connection, &request).await
    }
}

impl Default for WebSearchService {
    fn default() -> Self {
        Self::new(Arc::new(ApiRegistryService::new()))
    }
}

fn normalize_mode(value: Option<&str>) -> &'static str {
    match value
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("images") => "images",
        Some("news") => "news",
        Some("maps") => "maps",
        Some("places") => "places",
        Some("videos") => "videos",
        Some("shopping") => "shopping",
        Some("scholar") => "scholar",
        _ => "search",
    }
}

fn join_base_and_path(base: &str, path: &str) -> String {
    let normalized_base = base.trim_end_matches('/');
    if path.starts_with('/') {
        format!("{normalized_base}{path}")
    } else {
        format!("{normalized_base}/{path}")
    }
}

fn appears_masked_api_key(api_key: &str) -> bool {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.contains("***") || trimmed.ends_with("******")
}
