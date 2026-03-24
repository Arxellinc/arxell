use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use super::types::{ChatMessage, ChatRequest, ChunkEvent, StreamChunk};

pub struct AiClient {
    pub client: Client,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn has_version_suffix(base: &str) -> bool {
    base.rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.as_bytes()[0].eq_ignore_ascii_case(&b'v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false)
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if has_version_suffix(base) {
        format!("{}/chat/completions", base)
    } else {
        format!("{}/v1/chat/completions", base)
    }
}

fn model_supports_thinking_param(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("glm")
        || m.contains("qwen")
        || m.contains("qwq")
        || m.contains("reasoner")
        || m.contains("thinking")
}

impl AiClient {
    pub fn new(client: Client, base_url: String, api_key: String, model: String) -> Self {
        Self {
            client,
            base_url,
            api_key,
            model,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn stream_chat(
        &self,
        app: AppHandle,
        msg_id: String,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        cancel: Arc<AtomicBool>,
        enable_thinking: Option<bool>,
        screenshot_b64: Option<String>,
    ) -> Result<String> {
        let mut all_messages: Vec<serde_json::Value> = Vec::new();

        if let Some(sys) = system_prompt {
            if !sys.is_empty() {
                all_messages.push(serde_json::json!({"role": "system", "content": sys}));
            }
        }

        // Convert history messages, injecting screenshot into the last user message
        let msg_count = messages.len();
        for (i, msg) in messages.into_iter().enumerate() {
            let is_last_user = i + 1 == msg_count && msg.role == "user";
            if is_last_user {
                if let Some(ref b64) = screenshot_b64 {
                    // Vision format: text + image_url
                    all_messages.push(serde_json::json!({
                        "role": "user",
                        "content": [
                            {"type": "text", "text": msg.content},
                            {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", b64)}}
                        ]
                    }));
                } else {
                    all_messages
                        .push(serde_json::json!({"role": msg.role, "content": msg.content}));
                }
            } else {
                all_messages.push(serde_json::json!({"role": msg.role, "content": msg.content}));
            }
        }

        // For thinking-capable model families, forward enable_thinking.
        // Handles IDs like "zai-org/glm-4.6v-flash" (not just "glm*").
        let thinking_param = if model_supports_thinking_param(&self.model) {
            enable_thinking
        } else {
            None // Other models don't support this parameter
        };

        let request = ChatRequest {
            model: self.model.clone(),
            messages: all_messages,
            stream: true,
            temperature: Some(0.7),
            max_tokens: None,
            enable_thinking: thinking_param,
        };

        // Ensure the URL has /v1 prefix for OpenAI-compatible endpoints
        let url = chat_completions_url(&self.base_url);
        let wait_start = Instant::now();
        let max_loading_wait = Duration::from_secs(150);
        let mut loading_retry = 0u32;
        let response = loop {
            let response = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await?;

            if response.status().is_success() {
                break response;
            }

            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let body_lc = body.to_ascii_lowercase();
            let loading_503 = status.as_u16() == 503
                && (body_lc.contains("loading model")
                    || body_lc.contains("unavailable_error")
                    || body_lc.contains("\"code\":503"));

            if loading_503 && wait_start.elapsed() < max_loading_wait {
                loading_retry = loading_retry.saturating_add(1);
                // Short bounded backoff: 500ms, 1s, ... up to 3s.
                let backoff_ms = u64::from((loading_retry.min(6)) * 500);
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                continue;
            }

            return Err(anyhow!("API error {}: {}", status, body));
        };

        let mut stream = response.bytes_stream();
        let mut full_content = String::new();
        let mut buffer = String::new();
        let mut cancelled = false;
        let mut done_emitted = false;

        let mut push_content = |delta: &str| {
            if delta.is_empty() {
                return;
            }
            full_content.push_str(delta);
            let _ = app.emit(
                "chat:chunk",
                ChunkEvent {
                    id: msg_id.clone(),
                    delta: delta.to_string(),
                    done: false,
                },
            );
        };

        let mut emit_done = || {
            if done_emitted {
                return;
            }
            let _ = app.emit(
                "chat:chunk",
                ChunkEvent {
                    id: msg_id.clone(),
                    delta: String::new(),
                    done: true,
                },
            );
            done_emitted = true;
        };

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
            let chunk = chunk?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            // Process all complete SSE lines in the buffer
            while let Some(newline_pos) = buffer.find('\n') {
                // Drain one full line (including '\n') without cloning the remaining buffer.
                let mut line = buffer.drain(..=newline_pos).collect::<String>();
                if line.ends_with('\n') {
                    line.pop();
                }
                if line.ends_with('\r') {
                    line.pop();
                }
                let line = line.trim();

                if line.is_empty() {
                    continue;
                }

                // Handle SSE data lines (support both "data: " and "data:")
                if let Some(json_payload) = line.strip_prefix("data:") {
                    let json_str = json_payload.trim_start();
                    if json_str == "[DONE]" {
                        emit_done();
                        continue;
                    }

                    // Log raw response for debugging
                    log::debug!("SSE data: {}", json_str);

                    if let Ok(chunk_data) = serde_json::from_str::<StreamChunk>(json_str) {
                        if let Some(choice) = chunk_data.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                if let Some(text) = content_value_to_text(content) {
                                    push_content(&text);
                                }
                            }
                            if choice.finish_reason.is_some() {
                                emit_done();
                            }
                        }
                    } else {
                        log::warn!("Failed to parse SSE JSON: {}", json_str);
                    }
                }
            }
        }

        // Some providers return a final non-SSE JSON body even when stream=true.
        // If so, parse it and emit as a normal chunk so the UI still gets a response.
        let trailing = buffer.trim();
        if !trailing.is_empty() {
            if trailing.starts_with('{') {
                if let Some(text) = extract_content_from_chat_json(trailing) {
                    if !text.is_empty() {
                        push_content(&text);
                    }
                } else {
                    log::warn!("Unable to parse trailing non-SSE chat payload");
                }
            } else if trailing.starts_with("data:") {
                for line in trailing.lines() {
                    if let Some(payload) = line.trim().strip_prefix("data:") {
                        let payload = payload.trim_start();
                        if payload == "[DONE]" {
                            emit_done();
                            continue;
                        }
                        if let Ok(chunk_data) = serde_json::from_str::<StreamChunk>(payload) {
                            if let Some(choice) = chunk_data.choices.first() {
                                if let Some(content) = &choice.delta.content {
                                    if let Some(text) = content_value_to_text(content) {
                                        push_content(&text);
                                    }
                                }
                                if choice.finish_reason.is_some() {
                                    emit_done();
                                }
                            }
                        } else if let Some(text) = extract_content_from_chat_json(payload) {
                            if !text.is_empty() {
                                push_content(&text);
                            }
                        }
                    }
                }
            }
        }

        // Ensure the frontend always receives stream completion.
        // Skip this when the stream was cancelled — the frontend already cleared
        // streaming state via finishStreaming() and a late done event would
        // re-trigger tool calls, TTS, and other post-completion side-effects.
        if !cancelled {
            emit_done();
        }

        Ok(full_content)
    }

    /// Send a minimal 1-token request to warm the backend's KV cache with the given context.
    /// Failures are non-fatal — backends that don't support prefix caching simply respond normally.
    pub async fn prefill_warmup(
        &self,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }

        let mut all_messages: Vec<serde_json::Value> = Vec::new();
        if let Some(sys) = system_prompt {
            if !sys.is_empty() {
                all_messages.push(serde_json::json!({"role": "system", "content": sys}));
            }
        }
        for msg in messages {
            all_messages.push(serde_json::json!({"role": msg.role, "content": msg.content}));
        }

        if all_messages.is_empty() {
            return Ok(());
        }

        let request = ChatRequest {
            model: self.model.clone(),
            messages: all_messages,
            stream: false,
            temperature: Some(0.7),
            max_tokens: Some(1),
            enable_thinking: None, // Prefill warmup doesn't need thinking
        };

        let url = chat_completions_url(&self.base_url);

        // Fire-and-forget with short timeout — we only care about priming the cache, not the reply
        let _ = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(8))
            .json(&request)
            .send()
            .await;

        Ok(())
    }

    pub async fn transcribe_audio(&self, stt_url: &str, wav_bytes: Vec<u8>) -> Result<String> {
        let part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name("audio.wav")
            .mime_str("audio/wav")?;

        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", "whisper-1");

        let response = self
            .client
            .post(stt_url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("STT error: {}", response.status()));
        }

        #[derive(serde::Deserialize)]
        struct TranscribeResponse {
            text: String,
        }

        let resp: TranscribeResponse = response.json().await?;
        Ok(resp.text)
    }
}

fn extract_content_from_chat_json(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let choices = value.get("choices")?.as_array()?;
    let first = choices.first()?;
    if let Some(content) = first
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(content_value_to_text)
    {
        return Some(content);
    }
    first
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(content_value_to_text)
}

fn content_value_to_text(value: &Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(obj) = value.as_object() {
        if let Some(s) = obj.get("text").and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        if let Some(s) = obj.get("content").and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        if let Some(s) = obj.get("value").and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
    }
    let arr = value.as_array()?;
    let mut out = String::new();
    for item in arr {
        let text = item
            .get("text")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("content").and_then(|v| v.as_str()))
            .or_else(|| item.get("value").and_then(|v| v.as_str()));
        if let Some(t) = text {
            out.push_str(t);
        }
    }
    Some(out)
}
