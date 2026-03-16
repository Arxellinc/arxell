use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ApiType {
    OpenAiCompletions,
    OpenAiResponses,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub provider: String,
    pub api: ApiType,
    pub base_url: String,
    pub max_tokens: i64,
    pub supports_images: bool,
    pub supports_thinking: bool,
    pub context_window: Option<i64>,
}

pub fn default_models() -> Vec<Model> {
    vec![
        Model {
            id: "gpt-4.1".to_string(),
            provider: "openai".to_string(),
            api: ApiType::OpenAiResponses,
            base_url: "https://api.openai.com/v1".to_string(),
            max_tokens: 8192,
            supports_images: true,
            supports_thinking: true,
            context_window: Some(200000),
        },
        Model {
            id: "gpt-4.1-mini".to_string(),
            provider: "openai".to_string(),
            api: ApiType::OpenAiResponses,
            base_url: "https://api.openai.com/v1".to_string(),
            max_tokens: 8192,
            supports_images: true,
            supports_thinking: true,
            context_window: Some(128000),
        },
    ]
}

pub fn get_model(model_id: &str, provider: Option<&str>) -> Option<Model> {
    let models = default_models();
    if let Some(p) = provider {
        if let Some(m) = models
            .iter()
            .find(|m| m.id == model_id && m.provider == p)
            .cloned()
        {
            return Some(m);
        }
    }
    models.into_iter().find(|m| m.id == model_id)
}

pub fn get_max_tokens(model_id: &str) -> i64 {
    get_model(model_id, None).map(|m| m.max_tokens).unwrap_or(8192)
}

pub fn resolve_provider_api_type(provider: Option<&str>) -> Result<ApiType, String> {
    match provider {
        None => Ok(ApiType::OpenAiResponses),
        Some("openai-compatible") => Ok(ApiType::OpenAiResponses),
        Some("openai") => Ok(ApiType::OpenAiResponses),
        Some("openai-responses") => Ok(ApiType::OpenAiResponses),
        Some("openai-completions") => Ok(ApiType::OpenAiCompletions),
        Some(other) => Err(format!(
            "Unknown provider '{}'. Valid providers: openai-compatible, openai, openai-responses, openai-completions",
            other
        )),
    }
}
