use chrono::Utc;
use rusqlite::OptionalExtension;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::ai::{client::AiClient, types::ChatMessage};
use crate::db::models::Message;
use crate::model_manager::ModelManagerState;
use crate::AppState;

fn get_setting(state: &AppState, key: &str, default: &str) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| default.to_string())
}

fn is_managed_local_server_active(state: &AppState) -> bool {
    let srv = state.local_server.lock().unwrap();
    if let Some(ref handle) = *srv {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], handle.port)),
            std::time::Duration::from_millis(250),
        )
        .is_ok()
    } else {
        false
    }
}

fn primary_llm_source_is_api(state: &AppState) -> bool {
    let setting = get_setting(state, "primary_llm_source", "")
        .trim()
        .to_ascii_lowercase();
    if setting == "api" {
        return true;
    }
    if setting == "local" {
        return false;
    }

    // Back-compat fallback for older installs: if an API model config is marked
    // primary, treat API as source unless explicitly overridden by setting.
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT 1 FROM model_configs WHERE is_primary = 1 LIMIT 1",
        [],
        |_row| Ok(1i64),
    )
    .optional()
    .map(|v| v.is_some())
    .unwrap_or(false)
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

fn load_history(
    db: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let mut stmt = db
        .prepare(
            "SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let v: Vec<ChatMessage> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(ChatMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(v)
}

#[tauri::command]
pub async fn cmd_chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    model_state: State<'_, ModelManagerState>,
    conversation_id: String,
    content: String,
    extra_context: Option<String>,
    thinking_enabled: Option<bool>,
    assistant_msg_id: Option<String>,
    screenshot_base64: Option<String>,
) -> Result<Message, String> {
    let prefer_api_source = primary_llm_source_is_api(&state);

    // Prefer a running local llama-server over the settings base_url.
    // If the tracked local server port is no longer reachable, drop the stale
    // handle and fall back to configured base_url so chat doesn't hard-fail.
    let base_url = if prefer_api_source {
        get_setting(&state, "base_url", "http://localhost:11434/v1")
    } else {
        let mut srv = state.local_server.lock().unwrap();
        if let Some(ref handle) = *srv {
            let local_alive = std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([127, 0, 0, 1], handle.port)),
                std::time::Duration::from_millis(250),
            )
            .is_ok();
            if local_alive {
                handle.url.clone()
            } else {
                log::warn!(
                    "[chat] local server handle stale (pid={}, port={}); falling back to settings base_url",
                    handle.pid, handle.port
                );
                if let Some(stale) = srv.take() {
                    drop(stale);
                }
                get_setting(&state, "base_url", "http://localhost:11434/v1")
            }
        } else {
            get_setting(&state, "base_url", "http://localhost:11434/v1")
        }
    };
    let api_key = get_setting(&state, "api_key", "ollama");
    // Keep the configured model ID even with a local server so feature flags like
    // enable_thinking can still be forwarded based on model family.
    let model = get_setting(&state, "model", "llama3.2");
    let base_system_prompt = get_setting(&state, "system_prompt", "");

    let system_prompt = match extra_context {
        Some(ctx) if !ctx.is_empty() => {
            if base_system_prompt.is_empty() {
                ctx
            } else {
                format!("{}\n\n{}", base_system_prompt, ctx)
            }
        }
        _ => base_system_prompt,
    };

    let user_msg = Message {
        id: Uuid::new_v4().to_string(),
        conversation_id: conversation_id.clone(),
        role: "user".to_string(),
        content: content.clone(),
        created_at: Utc::now().timestamp_millis(),
    };

    // Save user message and load history in one lock scope
    let history = {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![user_msg.id, user_msg.conversation_id, user_msg.role, user_msg.content, user_msg.created_at],
        )
        .map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![Utc::now().timestamp_millis(), conversation_id],
        )
        .ok();
        load_history(&db, &conversation_id)?
    };

    // Cancel any in-flight speculative prefill warmup
    state.speculative_cancel.store(true, Ordering::SeqCst);

    // Reset cancel flag and bump generation ID before starting a new stream
    state.chat_cancel.store(false, Ordering::SeqCst);
    let cancel = state.chat_cancel.clone();
    let my_gen = state.generation_id.fetch_add(1, Ordering::SeqCst) + 1;

    // Snapshot settings needed inside async tasks (avoids holding locks across await)
    // Prefill warmup is only useful for the managed local server KV cache; it can
    // add avoidable latency/load for remote API providers.
    let prefill_enabled = (get_setting(&state, "prefill_enabled", "true") == "true")
        && !prefer_api_source
        && is_managed_local_server_active(&state);
    let system_prompt_clone = system_prompt.clone();
    let thinking = thinking_enabled; // Capture for move into spawn

    let assistant_id = assistant_msg_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // If an in-process local model is loaded, stream directly from local inference
    // and emit chat:chunk events with the assistant message id.
    if !prefer_api_source {
        let manager = model_state.0.read().await;
        if let (Some(model), Some(model_info)) = (manager.model.clone(), manager.model_info.clone())
        {
            let gen_config = manager.generation_config.clone();
            drop(manager);

            let local_messages: Vec<crate::model_manager::ChatMessage> = history
                .iter()
                .map(|m| crate::model_manager::ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect();
            let cancel = state.chat_cancel.clone();
            let app_clone = app.clone();
            let assistant_id_local = assistant_id.clone();
            tokio::task::spawn_blocking(move || {
                let result = crate::model_manager::inference::run_inference_stream(
                    model,
                    &model_info,
                    &gen_config,
                    &local_messages,
                    if system_prompt.is_empty() {
                        None
                    } else {
                        Some(system_prompt.as_str())
                    },
                    thinking,
                    cancel,
                    &app_clone,
                    Some(assistant_id_local.as_str()),
                );
                if let Err(e) = result {
                    let _ = app_clone.emit(
                        "chat:error",
                        serde_json::json!({ "message": e.to_string() }),
                    );
                }
            });
            return Ok(user_msg);
        }
    }

    let http_client = state.http_client.clone();
    let client = AiClient::new(
        http_client.clone(),
        base_url.clone(),
        api_key.clone(),
        model.clone(),
    );
    let warmup_client = AiClient::new(http_client, base_url, api_key, model);
    let assistant_id_clone = assistant_id.clone();
    let conversation_id_clone = conversation_id.clone();

    tokio::spawn(async move {
        match client
            .stream_chat(
                app.clone(),
                assistant_id_clone.clone(),
                history,
                Some(system_prompt),
                cancel,
                thinking,
                screenshot_base64,
            )
            .await
        {
            Ok(full_content) => {
                // Discard stale responses that arrived after a newer stream started
                let cur_gen = app.state::<AppState>().generation_id.load(Ordering::SeqCst);
                if cur_gen != my_gen {
                    log::debug!(
                        "Discarding stale stream (gen {} != current {})",
                        my_gen,
                        cur_gen
                    );
                    return;
                }

                let msg = Message {
                    id: assistant_id_clone,
                    conversation_id: conversation_id_clone.clone(),
                    role: "assistant".to_string(),
                    content: full_content,
                    created_at: Utc::now().timestamp_millis(),
                };
                {
                    let db_state = app.state::<AppState>();
                    let db = db_state.db.lock().unwrap();
                    let _ = db.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,?3,?4,?5)",
                        rusqlite::params![msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at],
                    );
                } // db lock released

                // Post-turn KV cache warmup — prime backend with updated history so next user
                // message benefits from prefix caching
                if prefill_enabled {
                    let db_state = app.state::<AppState>();
                    let updated_history = {
                        let db = db_state.db.lock().unwrap();
                        load_history(&db, &conversation_id_clone).unwrap_or_default()
                    };
                    let spec_cancel = db_state.speculative_cancel.clone();
                    spec_cancel.store(false, Ordering::SeqCst);
                    let sp_opt = if system_prompt_clone.is_empty() {
                        None
                    } else {
                        Some(system_prompt_clone)
                    };
                    tokio::spawn(async move {
                        if let Err(e) = warmup_client
                            .prefill_warmup(updated_history, sp_opt, spec_cancel)
                            .await
                        {
                            log::debug!("Post-turn warmup: {}", e);
                        }
                    });
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "chat:error",
                    serde_json::json!({ "message": e.to_string() }),
                );
            }
        }
    });

    Ok(user_msg)
}

#[tauri::command]
pub fn cmd_chat_get_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let messages: Vec<Message> = stmt
        .query_map(rusqlite::params![conversation_id], Message::from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(messages)
}

#[tauri::command]
pub fn cmd_chat_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.chat_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// Fire a speculative KV-cache warmup request with the current conversation history plus an
/// optional partial transcript (stable zone) prepended as a pending user message.
/// Non-blocking — spawns a background task and returns immediately.
#[tauri::command]
pub async fn cmd_prefill_warmup(
    state: State<'_, AppState>,
    conversation_id: String,
    partial_text: Option<String>,
) -> Result<(), String> {
    let enabled = get_setting(&state, "prefill_enabled", "true") == "true";
    if !enabled {
        return Ok(());
    }
    if primary_llm_source_is_api(&state) {
        return Ok(());
    }
    if !is_managed_local_server_active(&state) {
        return Ok(());
    }

    let base_url = get_setting(&state, "base_url", "http://localhost:11434/v1");
    let api_key = get_setting(&state, "api_key", "ollama");
    let model = get_setting(&state, "model", "llama3.2");
    let sys_prompt = get_setting(&state, "system_prompt", "");

    let mut history = {
        let db = state.db.lock().unwrap();
        load_history(&db, &conversation_id).unwrap_or_default()
    };

    if let Some(ref text) = partial_text {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            history.push(crate::ai::types::ChatMessage {
                role: "user".to_string(),
                content: trimmed.to_string(),
            });
        }
    }

    // Cancel any previous warmup and start a fresh one
    state.speculative_cancel.store(true, Ordering::SeqCst);
    let spec_cancel = state.speculative_cancel.clone();
    spec_cancel.store(false, Ordering::SeqCst);

    let client = AiClient::new(state.http_client.clone(), base_url, api_key, model);
    let sp_opt = if sys_prompt.is_empty() {
        None
    } else {
        Some(sys_prompt)
    };

    tokio::spawn(async move {
        if let Err(e) = client.prefill_warmup(history, sp_opt, spec_cancel).await {
            log::debug!("Stable-zone warmup: {}", e);
        }
    });

    Ok(())
}

/// Stream a query to an external OpenAI-compatible model and emit
/// `delegate:chunk { delegation_id, delta, done, error? }` events.
#[tauri::command]
pub async fn cmd_delegate_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    delegation_id: String,
    model_id: String,
    base_url: String,
    api_key: String,
    prompt: String,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let http_client = state.http_client.clone();

    let url = chat_completions_url(&base_url);

    let request_body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "stream": true,
        "max_tokens": 2048,
    });

    let app_clone = app.clone();
    let did = delegation_id.clone();

    tokio::spawn(async move {
        macro_rules! emit_done {
            ($err:expr) => {{
                let payload: serde_json::Value = if let Some(e) = $err {
                    serde_json::json!({
                        "delegation_id": &did,
                        "delta": "",
                        "done": true,
                        "error": e,
                    })
                } else {
                    serde_json::json!({
                        "delegation_id": &did,
                        "delta": "",
                        "done": true,
                    })
                };
                let _ = app_clone.emit("delegate:chunk", payload);
            }};
        }

        let response = match http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                emit_done!(Some(e.to_string()));
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            emit_done!(Some(format!("API error {}: {}", status, body)));
            return;
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut done_emitted = false;

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    emit_done!(Some(e.to_string()));
                    return;
                }
            };

            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(newline_pos) = buffer.find('\n') {
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

                if let Some(json_payload) = line.strip_prefix("data:") {
                    let json_str = json_payload.trim_start();
                    if json_str == "[DONE]" {
                        if !done_emitted {
                            let _ = app_clone.emit(
                                "delegate:chunk",
                                serde_json::json!({
                                    "delegation_id": &did,
                                    "delta": "",
                                    "done": true,
                                }),
                            );
                            done_emitted = true;
                        }
                        continue;
                    }

                    if let Ok(chunk_data) =
                        serde_json::from_str::<crate::ai::types::StreamChunk>(json_str)
                    {
                        if let Some(choice) = chunk_data.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                let _ = app_clone.emit(
                                    "delegate:chunk",
                                    serde_json::json!({
                                        "delegation_id": &did,
                                        "delta": content,
                                        "done": false,
                                    }),
                                );
                            }
                            if choice.finish_reason.is_some() && !done_emitted {
                                let _ = app_clone.emit(
                                    "delegate:chunk",
                                    serde_json::json!({
                                        "delegation_id": &did,
                                        "delta": "",
                                        "done": true,
                                    }),
                                );
                                done_emitted = true;
                            }
                        }
                    }
                }
            }
        }

        if !done_emitted {
            emit_done!(None::<String>);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cmd_chat_clear(state: State<'_, AppState>, conversation_id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        rusqlite::params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete the latest assistant response in a conversation and return the
/// corresponding last user prompt so the frontend can re-run it.
#[tauri::command]
pub fn cmd_chat_regenerate_last_prompt(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<String, String> {
    let db = state.db.lock().unwrap();

    // Find the latest assistant response in this conversation.
    let latest_assistant: Option<(String, i64)> = db
        .query_row(
            "SELECT id, created_at
             FROM messages
             WHERE conversation_id = ?1 AND role = 'assistant'
             ORDER BY created_at DESC
             LIMIT 1",
            rusqlite::params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // If there is an assistant response, get the nearest user prompt before it.
    // If not, fall back to the latest user prompt in the conversation.
    let prompt = if let Some((assistant_id, assistant_created_at)) = latest_assistant {
        let prompt: Option<String> = db
            .query_row(
                "SELECT content
                 FROM messages
                 WHERE conversation_id = ?1
                   AND role = 'user'
                   AND created_at <= ?2
                 ORDER BY created_at DESC
                 LIMIT 1",
                rusqlite::params![conversation_id, assistant_created_at],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        db.execute(
            "DELETE FROM messages WHERE id = ?1",
            rusqlite::params![assistant_id],
        )
        .map_err(|e| e.to_string())?;

        prompt
    } else {
        db.query_row(
            "SELECT content
             FROM messages
             WHERE conversation_id = ?1 AND role = 'user'
             ORDER BY created_at DESC
             LIMIT 1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let prompt = prompt
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "No user prompt found to regenerate".to_string())?;

    db.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![Utc::now().timestamp_millis(), conversation_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(prompt)
}
