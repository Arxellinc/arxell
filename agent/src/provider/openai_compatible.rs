use async_trait::async_trait;
use futures_util::stream::BoxStream;
use std::collections::HashSet;

use crate::provider::{Provider, ProviderConfig, ProviderStream};
use crate::types::{Message, StreamPart, ToolDefinition};

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    pub config: ProviderConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    fn chat_completions_url(base_url: &str) -> String {
        let b = base_url.trim_end_matches('/');
        if b.ends_with("/chat/completions") {
            b.to_string()
        } else if b.ends_with("/v1") {
            format!("{}/chat/completions", b)
        } else {
            format!("{}/v1/chat/completions", b)
        }
    }
}

#[async_trait]
impl Provider for OpenAiCompatibleProvider {
    fn name(&self) -> &'static str {
        "openai-compatible"
    }

    fn config(&self) -> &ProviderConfig {
        &self.config
    }

    fn config_mut(&mut self) -> &mut ProviderConfig {
        &mut self.config
    }

    fn should_retry_for_error(&self, error: &str) -> bool {
        error.contains("429") || error.contains("timeout") || error.contains("temporar")
    }

    async fn stream(
        &self,
        messages: Vec<Message>,
        system_prompt: Option<String>,
        tools: Option<Vec<ToolDefinition>>,
        temperature: Option<f64>,
        max_tokens: Option<i64>,
    ) -> Result<ProviderStream, String> {
        let base_url = self
            .config
            .base_url
            .clone()
            .unwrap_or_else(|| "http://127.0.0.1:8765".to_string());

        let api_key = self
            .config
            .api_key
            .clone()
            .or_else(|| std::env::var("OPENAI_API_KEY").ok());

        let url = Self::chat_completions_url(&base_url);

        let mut body = serde_json::json!({
            "model": self.config.model,
            "messages": convert_messages(messages, system_prompt),
            "stream": true,
            "max_tokens": max_tokens.unwrap_or(self.config.max_tokens),
        });

        if let Some(t) = temperature {
            body["temperature"] = serde_json::json!(t);
        }

        if let Some(tool_defs) = tools {
            body["tools"] = serde_json::json!(tool_defs.into_iter().map(|t| {
                serde_json::json!({"type":"function","function":{"name":t.name,"description":t.description,"parameters":t.parameters}})
            }).collect::<Vec<_>>());
            body["tool_choice"] = serde_json::json!("auto");
        }

        let mut req = self.client.post(url).json(&body);
        if let Some(key) = api_key {
            if !key.trim().is_empty() {
                req = req.bearer_auth(key);
            }
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("openai error {}: {}", status, text));
        }

        let mut bytes_stream = resp.bytes_stream();
        let stream = async_stream::stream! {
            let mut buf = String::new();
            let mut started_tool_indices: HashSet<usize> = HashSet::new();

            use futures_util::StreamExt;
            while let Some(chunk) = bytes_stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => {
                        yield Err(e.to_string());
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].trim().to_string();
                    buf = buf[pos + 1..].to_string();
                    if !line.starts_with("data:") {
                        continue;
                    }
                    let data = line.trim_start_matches("data:").trim();
                    if data.is_empty() {
                        continue;
                    }
                    if data == "[DONE]" {
                        yield Ok(StreamPart::Done {
                            stop_reason: crate::types::StopReason::Stop,
                        });
                        continue;
                    }

                    let v = match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if let Some(choice) = v.get("choices").and_then(|c| c.get(0)) {
                        if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                            let stop_reason = match reason {
                                "tool_calls" => crate::types::StopReason::ToolUse,
                                "length" => crate::types::StopReason::Length,
                                "stop" => crate::types::StopReason::Stop,
                                _ => crate::types::StopReason::Stop,
                            };
                            yield Ok(StreamPart::Done { stop_reason });
                        }

                        if let Some(delta) = choice.get("delta") {
                            if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                if !content.is_empty() {
                                    yield Ok(StreamPart::Text { text: content.to_string() });
                                }
                            }

                            if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                                for call in tool_calls {
                                    let index = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                                    let id = call
                                        .get("id")
                                        .and_then(|x| x.as_str())
                                        .map(|s| s.to_string())
                                        .unwrap_or_else(|| format!("call-{}", index));
                                    let name = call
                                        .get("function")
                                        .and_then(|f| f.get("name"))
                                        .and_then(|n| n.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    if !started_tool_indices.contains(&index) {
                                        started_tool_indices.insert(index);
                                        yield Ok(StreamPart::ToolCallStart {
                                            id: id.clone(),
                                            name,
                                            index,
                                        });
                                    }

                                    if let Some(delta_args) = call
                                        .get("function")
                                        .and_then(|f| f.get("arguments"))
                                        .and_then(|a| a.as_str())
                                    {
                                        if !delta_args.is_empty() {
                                            yield Ok(StreamPart::ToolCallDelta {
                                                index,
                                                arguments_delta: delta_args.to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        Ok(ProviderStream {
            stream: Box::pin(stream) as BoxStream<'static, Result<StreamPart, String>>,
            usage: Default::default(),
            id: None,
        })
    }
}

fn convert_messages(
    messages: Vec<Message>,
    system_prompt: Option<String>,
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Some(sp) = system_prompt {
        if !sp.is_empty() {
            out.push(serde_json::json!({"role":"system","content":sp}));
        }
    }

    for msg in messages {
        match msg {
            Message::User { content } => match content {
                crate::types::UserContent::Text(t) => {
                    out.push(serde_json::json!({"role":"user","content":t}))
                }
                crate::types::UserContent::Parts(parts) => {
                    let mut user_content_parts: Vec<serde_json::Value> = Vec::new();
                    for p in parts {
                        match p {
                            crate::types::ContentPart::Text { text: t } => {
                                user_content_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": t
                                }));
                            }
                            crate::types::ContentPart::Image { data, mime_type } => {
                                let data_uri = format!("data:{mime_type};base64,{data}");
                                user_content_parts.push(serde_json::json!({
                                    "type": "image_url",
                                    "image_url": { "url": data_uri }
                                }));
                            }
                            _ => {}
                        }
                    }
                    if user_content_parts.is_empty() {
                        out.push(serde_json::json!({"role":"user","content":""}));
                    } else {
                        out.push(serde_json::json!({"role":"user","content":user_content_parts}));
                    }
                }
            },
            Message::Assistant { content, .. } => {
                let mut text = String::new();
                for p in content {
                    match p {
                        crate::types::ContentPart::Text { text: t } => text.push_str(&t),
                        crate::types::ContentPart::Thinking { thinking, .. } => {
                            text.push_str(&thinking)
                        }
                        _ => {}
                    }
                }
                out.push(serde_json::json!({"role":"assistant","content":text}));
            }
            Message::ToolResult {
                tool_call_id,
                tool_name,
                content,
                ..
            } => {
                let mut text = String::new();
                for p in content {
                    if let crate::types::ContentPart::Text { text: t } = p {
                        text.push_str(&t);
                    }
                }
                out.push(serde_json::json!({"role":"tool","tool_call_id":tool_call_id,"name":tool_name,"content":text}));
            }
        }
    }

    out
}
