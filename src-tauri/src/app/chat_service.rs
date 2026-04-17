use crate::agent_tools::chart::ChartTool;
use crate::agent_tools::notepad::{NotepadEditLinesTool, NotepadReadTool, NotepadWriteTool};
use crate::agent_tools::web_search::WebSearchTool;
use crate::api_registry::ApiRegistryService;
use crate::app::web_search_service::WebSearchService;
use crate::contracts::{
    ApiConnectionType, ChatAttachment, ChatCancelResponse, ChatDeleteConversationResponse,
    ChatGetMessagesRequest, ChatGetMessagesResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, ChatStreamChunkPayload,
    ChatStreamCompletePayload, ChatStreamReasoningChunkPayload, ChatStreamStartPayload,
    ConversationMessageRecord, EventSeverity, EventStage, MessageRole, Subsystem,
};
use crate::memory::MemoryManager;
use crate::observability::EventHub;
use crate::persistence::ConversationRepository;
use crate::workspace_tools::WorkspaceToolsService;
use arx_rs::events::Event as AgentEvent;
use arx_rs::provider::openai_compatible::OpenAiCompatibleProvider;
use arx_rs::provider::ProviderConfig;
use arx_rs::tools::Tool as AgentTool;
use arx_rs::types::{
    ContentPart as AgentContentPart, Message as AgentMessage, StopReason as AgentStopReason,
    UserContent as AgentUserContent,
};
use arx_rs::{Agent, AgentConfig, Session};
use reqwest::StatusCode;
use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::watch;
use tokio::time::Duration;

pub struct ChatService {
    hub: EventHub,
    memory: Arc<dyn MemoryManager>,
    conversation_repo: Arc<dyn ConversationRepository>,
    api_registry: Arc<ApiRegistryService>,
    workspace_tools: Arc<WorkspaceToolsService>,
    web_search: Arc<WebSearchService>,
    cancelled_correlations: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone, Copy)]
enum ChatRouteMode {
    Auto,
    Agent,
    Legacy,
}

impl ChatRouteMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Agent => "agent",
            Self::Legacy => "legacy",
        }
    }
}

struct AgentToolBinding {
    workspace_tool_id: &'static str,
    bind: fn(&ChatService, &mut Vec<Box<dyn AgentTool>>, &str),
}

fn bind_files_tools(
    _chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    _correlation_id: &str,
) {
    resolved.extend(arx_rs::tools::default_tools().into_iter().filter(|tool| {
        matches!(
            tool.name(),
            "read" | "edit" | "write" | "ls" | "mkdir" | "move" | "chmod" | "grep" | "find"
        )
    }));
}

fn bind_notepad_tools(
    chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    correlation_id: &str,
) {
    resolved.push(Box::new(NotepadReadTool));
    resolved.push(Box::new(NotepadWriteTool::new(
        chat.hub.clone(),
        correlation_id.to_string(),
    )));
    resolved.push(Box::new(NotepadEditLinesTool::new(
        chat.hub.clone(),
        correlation_id.to_string(),
    )));
}

fn bind_terminal_tools(
    _chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    _correlation_id: &str,
) {
    resolved.extend(
        arx_rs::tools::default_tools()
            .into_iter()
            .filter(|tool| matches!(tool.name(), "bash")),
    );
}

fn bind_web_tools(
    chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    _correlation_id: &str,
) {
    resolved.push(Box::new(WebSearchTool::new(Arc::clone(&chat.web_search))));
}

fn bind_chart_tools(
    chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    correlation_id: &str,
) {
    resolved.push(Box::new(ChartTool::new(
        chat.hub.clone(),
        correlation_id.to_string(),
    )));
}

fn agent_tool_bindings() -> &'static [AgentToolBinding] {
    &[
        AgentToolBinding {
            workspace_tool_id: "files",
            bind: bind_files_tools,
        },
        AgentToolBinding {
            workspace_tool_id: "notepad",
            bind: bind_notepad_tools,
        },
        AgentToolBinding {
            workspace_tool_id: "terminal",
            bind: bind_terminal_tools,
        },
        AgentToolBinding {
            workspace_tool_id: "webSearch",
            bind: bind_web_tools,
        },
        AgentToolBinding {
            workspace_tool_id: "chart",
            bind: bind_chart_tools,
        },
    ]
}

impl ChatService {
    pub fn new(
        hub: EventHub,
        memory: Arc<dyn MemoryManager>,
        conversation_repo: Arc<dyn ConversationRepository>,
        api_registry: Arc<ApiRegistryService>,
        workspace_tools: Arc<WorkspaceToolsService>,
        web_search: Arc<WebSearchService>,
    ) -> Self {
        Self {
            hub,
            memory,
            conversation_repo,
            api_registry,
            workspace_tools,
            web_search,
            cancelled_correlations: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub async fn send_message(&self, req: ChatSendRequest) -> Result<ChatSendResponse, String> {
        self.clear_cancelled(req.correlation_id.as_str());
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.send_message",
            EventStage::Start,
            EventSeverity::Info,
            json!({"conversationId": req.conversation_id}),
        ));

        self.memory
            .upsert("episodic", "latest_user_message", &req.user_message);
        self.append_message(
            &req.correlation_id,
            &ConversationMessageRecord {
                conversation_id: req.conversation_id.clone(),
                role: MessageRole::User,
                content: req.user_message.clone(),
                correlation_id: req.correlation_id.clone(),
                timestamp_ms: now_ms(),
            },
        )?;

        let thinking_enabled = req.thinking_enabled.unwrap_or(false);
        let route_mode = resolve_chat_route_mode(req.chat_mode.as_deref());
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.route.selected",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "mode": route_mode.as_str(),
                "attachmentCount": req.attachments.as_ref().map(|items| items.len()).unwrap_or(0)
            }),
        ));

        let llm_response = match route_mode {
            ChatRouteMode::Agent => {
                self.request_agent_response(
                    &req.conversation_id,
                    &req.correlation_id,
                    &req.user_message,
                    req.attachments.as_deref(),
                    thinking_enabled,
                    req.model_id.as_deref(),
                    req.model_name.as_deref(),
                    req.max_tokens,
                )
                .await
            }
            ChatRouteMode::Legacy => {
                self.request_local_llama_response(
                    &req.conversation_id,
                    &req.correlation_id,
                    thinking_enabled,
                    req.max_tokens,
                )
                .await
            }
            ChatRouteMode::Auto => {
                match self
                    .request_agent_response(
                        &req.conversation_id,
                        &req.correlation_id,
                        &req.user_message,
                        req.attachments.as_deref(),
                        thinking_enabled,
                        req.model_id.as_deref(),
                        req.model_name.as_deref(),
                        req.max_tokens,
                    )
                    .await
                {
                    Ok(response) => Ok(response),
                    Err(agent_err) => {
                        if self.is_cancelled(req.correlation_id.as_str()) {
                            Err(agent_err)
                        } else {
                            self.hub.emit(self.hub.make_event(
                                &req.correlation_id,
                                Subsystem::Service,
                                "chat.route.fallback",
                                EventStage::Progress,
                                EventSeverity::Warn,
                                json!({
                                    "from": "agent",
                                    "to": "legacy",
                                    "reason": truncate_for_error(agent_err.as_str())
                                }),
                            ));
                            match self
                                .request_local_llama_response(
                                    &req.conversation_id,
                                    &req.correlation_id,
                                    thinking_enabled,
                                    req.max_tokens,
                                )
                                .await
                            {
                                Ok(response) => Ok(response),
                                Err(legacy_err) => Err(format!(
                                    "agent route failed: {}; legacy fallback failed: {}",
                                    agent_err, legacy_err
                                )),
                            }
                        }
                    }
                }
            }
        }
        .map_err(|err| {
            self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Service,
                "chat.stream.error",
                EventStage::Error,
                EventSeverity::Error,
                json!({"message": err}),
            ));
            self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Service,
                "chat.send_message",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": err}),
            ));
            err
        })?;

        let response = ChatSendResponse {
            conversation_id: req.conversation_id,
            assistant_message: llm_response.assistant_message,
            assistant_thinking: llm_response.assistant_thinking,
            correlation_id: req.correlation_id.clone(),
        };
        self.append_message(
            &req.correlation_id,
            &ConversationMessageRecord {
                conversation_id: response.conversation_id.clone(),
                role: MessageRole::Assistant,
                content: response.assistant_message.clone(),
                correlation_id: req.correlation_id.clone(),
                timestamp_ms: now_ms(),
            },
        )?;
        let _ = self
            .maybe_generate_conversation_title(
                response.conversation_id.as_str(),
                req.correlation_id.as_str(),
            )
            .await;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.send_message",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"assistantLength": response.assistant_message.len()}),
        ));

        Ok(response)
    }

    pub async fn cancel_message(
        &self,
        correlation_id: &str,
        target_correlation_id: &str,
    ) -> Result<ChatCancelResponse, String> {
        self.mark_cancelled(target_correlation_id);
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.cancel_message",
            EventStage::Complete,
            EventSeverity::Warn,
            json!({
                "targetCorrelationId": target_correlation_id,
                "cancelled": true
            }),
        ));
        Ok(ChatCancelResponse {
            correlation_id: correlation_id.to_string(),
            target_correlation_id: target_correlation_id.to_string(),
            cancelled: true,
        })
    }

    pub async fn delete_conversation(
        &self,
        correlation_id: &str,
        conversation_id: &str,
    ) -> Result<ChatDeleteConversationResponse, String> {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.delete_conversation",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": conversation_id }),
        ));
        let deleted = self
            .conversation_repo
            .delete_conversation(conversation_id)
            .map_err(|e| {
                self.hub.emit(self.hub.make_event(
                    correlation_id,
                    Subsystem::Service,
                    "chat.delete_conversation",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({ "conversationId": conversation_id, "error": e }),
                ));
                e
            })?;
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.delete_conversation",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "conversationId": conversation_id, "deleted": deleted }),
        ));
        Ok(ChatDeleteConversationResponse {
            conversation_id: conversation_id.to_string(),
            correlation_id: correlation_id.to_string(),
            deleted,
        })
    }

    async fn request_agent_response(
        &self,
        conversation_id: &str,
        correlation_id: &str,
        user_message: &str,
        attachments: Option<&[ChatAttachment]>,
        thinking_enabled: bool,
        requested_model_id: Option<&str>,
        requested_model_name: Option<&str>,
        requested_max_tokens: Option<u32>,
    ) -> Result<LocalLlamaResponse, String> {
        let provider_config = self.resolve_agent_provider_config(
            thinking_enabled,
            requested_model_id,
            requested_model_name,
            requested_max_tokens,
        );

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.agent.request",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "baseUrl": provider_config.base_url,
                "model": provider_config.model,
                "maxTokens": provider_config.max_tokens,
                "attachmentCount": attachments.map(|items| items.len()).unwrap_or(0)
            }),
        ));

        self.hub.emit(
            self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.start",
                EventStage::Start,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamStartPayload {
                    conversation_id: conversation_id.to_string(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );

        let cwd = resolve_agent_cwd();
        let mut session = Session::in_memory(
            cwd.clone(),
            provider_config.provider.clone(),
            Some(provider_config.model.clone()),
            provider_config.thinking_level.clone(),
        );
        self.seed_agent_session_history(
            &mut session,
            conversation_id,
            correlation_id,
            user_message,
        )?;

        let provider = OpenAiCompatibleProvider::new(provider_config);
        let agent_tools = self.resolve_enabled_agent_tools(correlation_id);
        let enabled_tool_names: Vec<String> = agent_tools
            .iter()
            .map(|tool| tool.name().to_string())
            .collect();
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.agent.tools.selected",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "count": enabled_tool_names.len(),
                "tools": enabled_tool_names
            }),
        ));
        let mut agent = Agent::new(
            Box::new(provider),
            agent_tools,
            session,
            AgentConfig {
                max_turns: Some(12),
                context_window: None,
                max_output_tokens: requested_max_tokens.map(|value| value as i64),
            },
            Some(cwd),
        )
        .map_err(|e| format!("failed creating agent runtime: {e}"))?;
        apply_tool_routing_hints(&mut agent.system_prompt, &enabled_tool_names);

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let cancelled_set = Arc::clone(&self.cancelled_correlations);
        let target_correlation = correlation_id.to_string();
        let cancel_task = tokio::spawn(async move {
            loop {
                let cancelled = cancelled_set
                    .lock()
                    .map(|set| set.contains(target_correlation.as_str()))
                    .unwrap_or(false);
                if cancelled {
                    let _ = cancel_tx.send(true);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
        });

        let mut assistant = String::new();
        let mut reasoning = String::new();
        let mut assistant_from_turn_end: Option<String> = None;
        let mut agent_error: Option<String> = None;
        let mut assistant_delta_emitted = false;

        let image_payloads = attachments
            .map(|items| {
                items
                    .iter()
                    .filter(|item| item.kind.eq_ignore_ascii_case("image"))
                    .map(|item| (item.data_base64.clone(), item.mime_type.clone()))
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty());

        let _events = agent
            .run_collect_with_callback(
                user_message.to_string(),
                image_payloads,
                Some(cancel_rx),
                |event| match event {
                    AgentEvent::TextDelta { delta } => {
                        assistant.push_str(delta.as_str());
                        if !delta.is_empty() {
                            assistant_delta_emitted = true;
                        }
                        self.hub.emit(
                            self.hub.make_event(
                                correlation_id,
                                Subsystem::Service,
                                "chat.stream.chunk",
                                EventStage::Progress,
                                EventSeverity::Info,
                                serde_json::to_value(ChatStreamChunkPayload {
                                    conversation_id: conversation_id.to_string(),
                                    delta: delta.clone(),
                                    done: false,
                                })
                                .unwrap_or_else(|_| json!({})),
                            ),
                        );
                    }
                    AgentEvent::ThinkingDelta { delta } if thinking_enabled => {
                        reasoning.push_str(delta.as_str());
                        self.hub.emit(
                            self.hub.make_event(
                                correlation_id,
                                Subsystem::Service,
                                "chat.stream.reasoning_chunk",
                                EventStage::Progress,
                                EventSeverity::Info,
                                serde_json::to_value(ChatStreamReasoningChunkPayload {
                                    conversation_id: conversation_id.to_string(),
                                    delta: delta.clone(),
                                    done: false,
                                })
                                .unwrap_or_else(|_| json!({})),
                            ),
                        );
                    }
                    AgentEvent::ToolStart {
                        tool_call_id,
                        tool_name,
                    } => {
                        self.hub.emit(self.hub.make_event(
                            correlation_id,
                            Subsystem::Tool,
                            "chat.agent.tool.start",
                            EventStage::Start,
                            EventSeverity::Info,
                            json!({ "toolCallId": tool_call_id, "toolName": tool_name }),
                        ));
                    }
                    AgentEvent::ToolEnd {
                        tool_call_id,
                        tool_name,
                        display,
                        ..
                    } => {
                        self.hub.emit(self.hub.make_event(
                            correlation_id,
                            Subsystem::Tool,
                            "chat.agent.tool.end",
                            EventStage::Complete,
                            EventSeverity::Info,
                            json!({
                                "toolCallId": tool_call_id,
                                "toolName": tool_name,
                                "display": display
                            }),
                        ));
                    }
                    AgentEvent::ToolResult {
                        tool_call_id,
                        tool_name,
                        result,
                    } => {
                        let success = result.as_ref().map(|value| value.success).unwrap_or(false);
                        self.hub.emit(self.hub.make_event(
                            correlation_id,
                            Subsystem::Tool,
                            "chat.agent.tool.result",
                            EventStage::Complete,
                            if success {
                                EventSeverity::Info
                            } else {
                                EventSeverity::Warn
                            },
                            json!({
                                "toolCallId": tool_call_id,
                                "toolName": tool_name,
                                "success": success,
                                "display": result.as_ref().and_then(|value| value.display.clone())
                            }),
                        ));
                    }
                    AgentEvent::TurnEnd {
                        assistant_message, ..
                    } => {
                        if let Some(AgentMessage::Assistant { content, .. }) =
                            assistant_message.as_ref()
                        {
                            let mut text = String::new();
                            for part in content {
                                if let AgentContentPart::Text { text: value } = part {
                                    text.push_str(value.as_str());
                                }
                            }
                            if !text.trim().is_empty() {
                                assistant_from_turn_end = Some(text);
                            }
                        }
                    }
                    AgentEvent::Error { error } => {
                        agent_error = Some(error.clone());
                    }
                    _ => {}
                },
            )
            .await;
        cancel_task.abort();

        if assistant.trim().is_empty() {
            if let Some(fallback_assistant) = assistant_from_turn_end {
                assistant = fallback_assistant;
            }
        }

        let assistant = assistant.trim().to_string();
        if assistant.is_empty() {
            let message = agent_error.unwrap_or_else(|| {
                "agent produced no assistant text and no recoverable fallback".to_string()
            });
            return Err(message);
        }
        if !assistant_delta_emitted {
            self.hub.emit(
                self.hub.make_event(
                    correlation_id,
                    Subsystem::Service,
                    "chat.stream.chunk",
                    EventStage::Progress,
                    EventSeverity::Info,
                    serde_json::to_value(ChatStreamChunkPayload {
                        conversation_id: conversation_id.to_string(),
                        delta: assistant.clone(),
                        done: false,
                    })
                    .unwrap_or_else(|_| json!({})),
                ),
            );
        }

        self.hub.emit(
            self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.complete",
                EventStage::Complete,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamCompletePayload {
                    conversation_id: conversation_id.to_string(),
                    assistant_length: assistant.len(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.agent.request",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "assistantLength": assistant.len(),
                "thinkingLength": reasoning.len()
            }),
        ));

        Ok(LocalLlamaResponse {
            assistant_message: assistant,
            assistant_thinking: if thinking_enabled && !reasoning.trim().is_empty() {
                Some(reasoning)
            } else {
                None
            },
        })
    }

    fn seed_agent_session_history(
        &self,
        session: &mut Session,
        conversation_id: &str,
        correlation_id: &str,
        user_message: &str,
    ) -> Result<(), String> {
        let mut history = self
            .conversation_repo
            .list_messages(conversation_id)
            .map_err(|e| format!("failed reading conversation history: {e}"))?;

        if let Some(last) = history.last() {
            if matches!(last.role, MessageRole::User)
                && last.correlation_id == correlation_id
                && last.content == user_message
            {
                history.pop();
            }
        }

        for message in history {
            let converted = match message.role {
                MessageRole::User => AgentMessage::User {
                    content: AgentUserContent::Text(message.content),
                },
                MessageRole::Assistant => AgentMessage::Assistant {
                    content: vec![AgentContentPart::Text {
                        text: message.content,
                    }],
                    usage: None,
                    stop_reason: Some(AgentStopReason::Stop),
                },
            };
            let _ = session
                .append_message(converted)
                .map_err(|e| format!("failed seeding agent session history: {e}"))?;
        }

        Ok(())
    }

    fn resolve_agent_provider_config(
        &self,
        thinking_enabled: bool,
        requested_model_id: Option<&str>,
        requested_model_name: Option<&str>,
        requested_max_tokens: Option<u32>,
    ) -> ProviderConfig {
        let env_endpoint =
            std::env::var("FOUNDATION_LLM_ENDPOINT").unwrap_or_else(|_| "".to_string());
        let env_model =
            std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string());
        let default_base = if env_endpoint.trim().is_empty() {
            "http://127.0.0.1:1420/v1/chat/completions".to_string()
        } else {
            env_endpoint
        };
        let max_tokens = resolve_chat_max_tokens(requested_max_tokens).unwrap_or(8192) as i64;
        let selected_name = requested_model_name
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned);

        if let Some(model_id) = requested_model_id.map(str::trim).filter(|v| !v.is_empty()) {
            if let Some(rest) = model_id.strip_prefix("api:") {
                let id = rest.split(':').next().unwrap_or("").trim();
                if !id.is_empty() {
                    if let Some(conn) =
                        self.api_registry
                            .verified_for_agent()
                            .into_iter()
                            .find(|record| {
                                record.id == id && matches!(record.api_type, ApiConnectionType::Llm)
                            })
                    {
                        let endpoint = resolve_chat_endpoint(
                            conn.api_url.as_str(),
                            conn.api_standard_path.as_deref(),
                        );
                        return ProviderConfig {
                            api_key: Some(conn.api_key),
                            base_url: Some(endpoint),
                            model: selected_name
                                .clone()
                                .or(conn.model_name)
                                .unwrap_or(env_model.clone()),
                            max_tokens,
                            temperature: Some(0.7),
                            thinking_level: if thinking_enabled {
                                "medium".to_string()
                            } else {
                                "none".to_string()
                            },
                            provider: Some("openai-compatible".to_string()),
                        };
                    }
                }
            }

            if model_id.starts_with("local:") {
                return ProviderConfig {
                    api_key: std::env::var("OPENAI_API_KEY").ok(),
                    base_url: Some(default_base.clone()),
                    model: selected_name.clone().unwrap_or(env_model.clone()),
                    max_tokens,
                    temperature: Some(0.7),
                    thinking_level: if thinking_enabled {
                        "medium".to_string()
                    } else {
                        "none".to_string()
                    },
                    provider: Some("openai-compatible".to_string()),
                };
            }
        }

        let verified_llm = self
            .api_registry
            .verified_for_agent()
            .into_iter()
            .find(|record| matches!(record.api_type, ApiConnectionType::Llm));

        match verified_llm {
            Some(conn) => {
                let endpoint =
                    resolve_chat_endpoint(conn.api_url.as_str(), conn.api_standard_path.as_deref());
                ProviderConfig {
                    api_key: Some(conn.api_key),
                    base_url: Some(endpoint),
                    model: selected_name.or(conn.model_name).unwrap_or(env_model),
                    max_tokens,
                    temperature: Some(0.7),
                    thinking_level: if thinking_enabled {
                        "medium".to_string()
                    } else {
                        "none".to_string()
                    },
                    provider: Some("openai-compatible".to_string()),
                }
            }
            None => ProviderConfig {
                api_key: std::env::var("OPENAI_API_KEY").ok(),
                base_url: Some(default_base),
                model: env_model,
                max_tokens,
                temperature: Some(0.7),
                thinking_level: if thinking_enabled {
                    "medium".to_string()
                } else {
                    "none".to_string()
                },
                provider: Some("openai-compatible".to_string()),
            },
        }
    }

    fn resolve_enabled_agent_tools(&self, correlation_id: &str) -> Vec<Box<dyn AgentTool>> {
        let enabled_ids: HashSet<String> = self
            .workspace_tools
            .list()
            .into_iter()
            .filter(|tool| tool.enabled)
            .map(|tool| tool.tool_id)
            .collect();

        let mut resolved = Vec::<Box<dyn AgentTool>>::new();
        for binding in agent_tool_bindings() {
            if enabled_ids.contains(binding.workspace_tool_id) {
                (binding.bind)(self, &mut resolved, correlation_id);
            }
        }
        resolved
    }

    async fn maybe_generate_conversation_title(
        &self,
        conversation_id: &str,
        correlation_id: &str,
    ) -> Result<(), String> {
        let message_count = self
            .conversation_repo
            .conversation_message_count(conversation_id)?;
        if message_count < 3 {
            return Ok(());
        }
        if self
            .conversation_repo
            .get_conversation_title(conversation_id)?
            .is_some()
        {
            return Ok(());
        }

        let history = self.conversation_repo.list_messages(conversation_id)?;
        let title = self
            .generate_title_with_llm(conversation_id, correlation_id, &history)
            .await
            .unwrap_or_else(|_| fallback_title(&history));
        let normalized = normalize_title(title.as_str());
        if normalized.is_empty() {
            return Ok(());
        }
        self.conversation_repo
            .upsert_conversation_title(conversation_id, normalized.as_str())
    }

    async fn generate_title_with_llm(
        &self,
        conversation_id: &str,
        correlation_id: &str,
        history: &[ConversationMessageRecord],
    ) -> Result<String, String> {
        let endpoint = std::env::var("FOUNDATION_LLM_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:1420/v1/chat/completions".to_string());
        let model =
            std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string());

        let mut transcript = String::new();
        for item in history.iter().take(6) {
            let role = match item.role {
                MessageRole::User => "User",
                MessageRole::Assistant => "Assistant",
            };
            if !transcript.is_empty() {
                transcript.push('\n');
            }
            transcript.push_str(role);
            transcript.push_str(": ");
            transcript.push_str(item.content.trim());
        }

        let payload = OpenAiChatRequest {
            model,
            messages: vec![
                OpenAiMessage {
                    role: "system".to_string(),
                    content: "Generate one concise objective title. Use exactly one prefix: 'Casual chat about ...', 'Technical discussion about ...', 'Brainstorming on ...', or 'Research on ...'. Keep it short and neutral. Output title text only, no quotes."
                        .to_string(),
                },
                OpenAiMessage {
                    role: "user".to_string(),
                    content: format!("Conversation id: {conversation_id}\n\n{transcript}"),
                },
            ],
            stream: false,
            max_tokens: Some(24),
            temperature: Some(0.2),
            extra_body: None,
        };

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.title.generate",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": conversation_id }),
        ));

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("failed creating title HTTP client: {e}"))?;
        let response = client
            .post(endpoint.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("failed requesting title from local runtime: {e}"))?;
        if response.status() != StatusCode::OK {
            return Err(format!(
                "title generation failed with status {}",
                response.status()
            ));
        }
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("failed parsing title generation response: {e}"))?;

        let title = body
            .get("choices")
            .and_then(|v| v.get(0))
            .and_then(|choice| {
                choice
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(value_to_text)
                    .or_else(|| choice.get("text").and_then(value_to_text))
            })
            .unwrap_or_default();

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.title.generate",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "conversationId": conversation_id, "titleLength": title.len() }),
        ));
        Ok(title)
    }

    async fn request_local_llama_response(
        &self,
        conversation_id: &str,
        correlation_id: &str,
        thinking_enabled: bool,
        requested_max_tokens: Option<u32>,
    ) -> Result<LocalLlamaResponse, String> {
        let endpoint = std::env::var("FOUNDATION_LLM_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:1420/v1/chat/completions".to_string());
        let model =
            std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string());
        let max_tokens = resolve_chat_max_tokens(requested_max_tokens);

        let history = self
            .conversation_repo
            .list_messages(conversation_id)
            .map_err(|e| format!("failed reading conversation history: {e}"))?;
        let mut messages: Vec<OpenAiMessage> = history
            .iter()
            .rev()
            .take(24)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|item| OpenAiMessage {
                role: match item.role {
                    MessageRole::User => "user".to_string(),
                    MessageRole::Assistant => "assistant".to_string(),
                },
                content: item.content.clone(),
            })
            .collect();
        if let Some(api_context) = self.build_api_registry_context() {
            messages.insert(
                0,
                OpenAiMessage {
                    role: "system".to_string(),
                    content: api_context,
                },
            );
        }
        let model_family = infer_model_family(model.as_str());
        let strategy = if thinking_enabled {
            ThinkingDisableStrategy::None
        } else {
            self.resolve_thinking_strategy(model_family.as_str())
        };

        if matches!(
            strategy,
            ThinkingDisableStrategy::SystemPrompt | ThinkingDisableStrategy::Both
        ) {
            messages.insert(
                0,
                OpenAiMessage {
                    role: "system".to_string(),
                    content: "Return only the final answer. Do not include chain-of-thought, reasoning traces, or <think> tags."
                        .to_string(),
                },
            );
        }

        let payload = OpenAiChatRequest {
            model,
            messages,
            stream: true,
            max_tokens,
            temperature: Some(0.7),
            extra_body: if matches!(
                strategy,
                ThinkingDisableStrategy::ChatTemplate | ThinkingDisableStrategy::Both
            ) {
                Some(json!({
                    "cache_prompt": false,
                    "chat_template_kwargs": {
                        "enable_thinking": false
                    }
                }))
            } else {
                Some(json!({
                    "cache_prompt": false
                }))
            },
        };

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.llm.request",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "endpoint": endpoint,
                "modelFamily": model_family,
                "thinkingDisableStrategy": strategy.as_str(),
                "maxTokens": max_tokens
            }),
        ));

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| format!("failed creating HTTP client: {e}"))?;
        let mut response = client
            .post(endpoint.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "failed calling local llama runtime at {endpoint}: {e}. Is llama.cpp running?"
                )
            })?;
        if response.status() != StatusCode::OK {
            let code = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<unreadable body>".to_string());
            return Err(format!(
                "local llama runtime returned {code}: {}",
                truncate_for_error(body.as_str())
            ));
        }

        self.hub.emit(
            self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.start",
                EventStage::Start,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamStartPayload {
                    conversation_id: conversation_id.to_string(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );

        let mut assistant = String::new();
        let mut reasoning = String::new();
        let mut line_buffer = String::new();
        let mut raw_response_body = String::new();
        let mut stream_done = false;

        while let Some(chunk) = response.chunk().await.map_err(|e| {
            format!("failed reading streaming response from local llama runtime: {e}")
        })? {
            if self.is_cancelled(correlation_id) {
                break;
            }
            let chunk_text = String::from_utf8_lossy(&chunk);
            raw_response_body.push_str(chunk_text.as_ref());
            line_buffer.push_str(chunk_text.as_ref());
            while let Some(pos) = line_buffer.find('\n') {
                let mut line = line_buffer[..pos].to_string();
                line_buffer.drain(..=pos);
                if line.ends_with('\r') {
                    line.pop();
                }
                if handle_stream_line(
                    self,
                    conversation_id,
                    correlation_id,
                    thinking_enabled,
                    line.as_str(),
                    &mut assistant,
                    &mut reasoning,
                )? {
                    stream_done = true;
                    break;
                }
            }
            if stream_done {
                break;
            }
        }

        if !stream_done && !line_buffer.trim().is_empty() {
            let _ = handle_stream_line(
                self,
                conversation_id,
                correlation_id,
                thinking_enabled,
                line_buffer.trim(),
                &mut assistant,
                &mut reasoning,
            )?;
        }

        // Some runtimes reply with JSON/NDJSON despite stream=true.
        if assistant.trim().is_empty() && !raw_response_body.trim().is_empty() {
            if let Some(parsed) =
                extract_assistant_from_non_sse_body(raw_response_body.as_str(), thinking_enabled)
            {
                assistant = parsed.assistant;
                if thinking_enabled && !parsed.reasoning.is_empty() {
                    reasoning.push_str(parsed.reasoning.as_str());
                }
            }
        }

        let assistant_raw = normalize_generated_text(assistant.clone());
        let assistant = normalize_generated_text(if thinking_enabled {
            assistant_raw.clone()
        } else {
            strip_think_blocks(assistant_raw.as_str())
        });
        let mut assistant = assistant.trim().to_string();
        let reasoning_normalized = normalize_generated_text(reasoning.clone());
        if assistant.is_empty() && !assistant_raw.trim().is_empty() {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.think_only_fallback",
                EventStage::Progress,
                EventSeverity::Warn,
                json!({
                    "message": "assistant text empty after think-block stripping; using raw assistant text"
                }),
            ));
            assistant = assistant_raw.trim().to_string();
        }
        if assistant.is_empty() {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.fallback",
                EventStage::Progress,
                EventSeverity::Warn,
                json!({ "message": "streamed response had no assistant text; retrying non-stream request" }),
            ));
            assistant = self
                .request_nonstream_fallback(
                    endpoint.as_str(),
                    payload.model.as_str(),
                    &payload.messages,
                    thinking_enabled,
                    strategy,
                    max_tokens,
                )
                .await?;
        }
        if assistant.is_empty() && !reasoning_normalized.trim().is_empty() {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.reasoning_only",
                EventStage::Progress,
                EventSeverity::Warn,
                json!({
                    "message": "assistant text empty; promoting reasoning content to assistant response"
                }),
            ));
            assistant = if thinking_enabled {
                reasoning_normalized.clone()
            } else {
                strip_think_blocks(reasoning_normalized.as_str())
            };
            assistant = normalize_generated_text(assistant);
        }
        if !thinking_enabled && looks_like_reasoning_trace(assistant.as_str()) {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.no_thinking.rewrite",
                EventStage::Progress,
                EventSeverity::Warn,
                json!({
                    "message": "detected reasoning-style output while thinking is off; rewriting to final answer"
                }),
            ));
            let latest_user_message = payload
                .messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.as_str())
                .unwrap_or("");
            if let Ok(rewritten) = self
                .rewrite_reasoning_to_final_answer(
                    endpoint.as_str(),
                    payload.model.as_str(),
                    latest_user_message,
                    assistant.as_str(),
                )
                .await
            {
                if !rewritten.trim().is_empty() {
                    assistant = rewritten;
                }
            }
        }
        if assistant.is_empty() {
            return Err("local llama response had no assistant text payload".to_string());
        }
        if self.is_cancelled(correlation_id) {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.cancelled",
                EventStage::Complete,
                EventSeverity::Warn,
                json!({ "assistantLength": assistant.len() }),
            ));
        }
        let assistant_thinking = if thinking_enabled {
            let normalized = reasoning_normalized;
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        } else {
            None
        };

        self.hub.emit(
            self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.complete",
                EventStage::Complete,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamCompletePayload {
                    conversation_id: conversation_id.to_string(),
                    assistant_length: assistant.len(),
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.llm.request",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "ok": true,
                "assistantLength": assistant.len(),
                "thinkingLength": assistant_thinking.as_ref().map(|value| value.len()).unwrap_or(0)
            }),
        ));
        Ok(LocalLlamaResponse {
            assistant_message: assistant,
            assistant_thinking,
        })
    }

    fn mark_cancelled(&self, target_correlation_id: &str) {
        if let Ok(mut set) = self.cancelled_correlations.lock() {
            set.insert(target_correlation_id.to_string());
        }
    }

    fn clear_cancelled(&self, target_correlation_id: &str) {
        if let Ok(mut set) = self.cancelled_correlations.lock() {
            set.remove(target_correlation_id);
        }
    }

    fn is_cancelled(&self, target_correlation_id: &str) -> bool {
        self.cancelled_correlations
            .lock()
            .map(|set| set.contains(target_correlation_id))
            .unwrap_or(false)
    }

    async fn request_nonstream_fallback(
        &self,
        endpoint: &str,
        model: &str,
        messages: &[OpenAiMessage],
        thinking_enabled: bool,
        strategy: ThinkingDisableStrategy,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| format!("failed creating fallback HTTP client: {e}"))?;
        let payload = OpenAiChatRequest {
            model: model.to_string(),
            messages: messages.to_vec(),
            stream: false,
            max_tokens,
            temperature: Some(0.7),
            extra_body: if matches!(
                strategy,
                ThinkingDisableStrategy::ChatTemplate | ThinkingDisableStrategy::Both
            ) {
                Some(json!({
                    "cache_prompt": false,
                    "chat_template_kwargs": {
                        "enable_thinking": false
                    }
                }))
            } else {
                Some(json!({
                    "cache_prompt": false
                }))
            },
        };

        let response = client
            .post(endpoint)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("fallback request to local runtime failed: {e}"))?;
        if response.status() != StatusCode::OK {
            return Err(format!(
                "fallback request failed with status {}",
                response.status()
            ));
        }
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("failed parsing fallback response: {e}"))?;
        let text = body
            .get("choices")
            .and_then(|v| v.get(0))
            .and_then(|choice| {
                choice
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(value_to_text)
                    .or_else(|| choice.get("text").and_then(value_to_text))
                    .or_else(|| choice.get("content").and_then(value_to_text))
                    .or_else(|| {
                        choice
                            .get("message")
                            .and_then(|m| m.get("reasoning_content"))
                            .and_then(value_to_text)
                    })
                    .or_else(|| {
                        choice
                            .get("message")
                            .and_then(|m| m.get("reasoning"))
                            .and_then(value_to_text)
                    })
                    .or_else(|| choice.get("reasoning_content").and_then(value_to_text))
                    .or_else(|| choice.get("reasoning").and_then(value_to_text))
            })
            .or_else(|| {
                body.get("message")
                    .and_then(|m| m.get("reasoning_content"))
                    .and_then(value_to_text)
            })
            .or_else(|| {
                body.get("message")
                    .and_then(|m| m.get("reasoning"))
                    .and_then(value_to_text)
            })
            .or_else(|| body.get("reasoning_content").and_then(value_to_text))
            .or_else(|| body.get("reasoning").and_then(value_to_text))
            .unwrap_or_default();
        let normalized_raw = normalize_generated_text(text);
        let normalized = if thinking_enabled {
            normalized_raw.clone()
        } else {
            let stripped = normalize_generated_text(strip_think_blocks(normalized_raw.as_str()));
            if stripped.is_empty() && !normalized_raw.trim().is_empty() {
                normalized_raw
            } else {
                stripped
            }
        };
        Ok(normalized.trim().to_string())
    }

    async fn rewrite_reasoning_to_final_answer(
        &self,
        endpoint: &str,
        model: &str,
        user_prompt: &str,
        reasoning_output: &str,
    ) -> Result<String, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(45))
            .build()
            .map_err(|e| format!("failed creating rewrite HTTP client: {e}"))?;
        let payload = OpenAiChatRequest {
            model: model.to_string(),
            messages: vec![
                OpenAiMessage {
                    role: "system".to_string(),
                    content: "Return only a concise final answer for the user. Do not include analysis, reasoning steps, chain-of-thought, headings, or bullet lists."
                        .to_string(),
                },
                OpenAiMessage {
                    role: "user".to_string(),
                    content: format!(
                        "User prompt:\n{}\n\nDraft output:\n{}\n\nRewrite the draft as final answer only.",
                        user_prompt, reasoning_output
                    ),
                },
            ],
            stream: false,
            max_tokens: Some(256),
            temperature: Some(0.2),
            extra_body: Some(json!({
                "cache_prompt": false,
                "chat_template_kwargs": {
                    "enable_thinking": false
                }
            })),
        };
        let response = client
            .post(endpoint)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("rewrite request to local runtime failed: {e}"))?;
        if response.status() != StatusCode::OK {
            return Err(format!(
                "rewrite request failed with status {}",
                response.status()
            ));
        }
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("failed parsing rewrite response: {e}"))?;
        let rewritten = body
            .get("choices")
            .and_then(|v| v.get(0))
            .and_then(|choice| {
                choice
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(value_to_text)
                    .or_else(|| choice.get("text").and_then(value_to_text))
                    .or_else(|| choice.get("content").and_then(value_to_text))
            })
            .unwrap_or_default();
        Ok(normalize_generated_text(rewritten).trim().to_string())
    }

    fn resolve_thinking_strategy(&self, model_family: &str) -> ThinkingDisableStrategy {
        let raw = self
            .conversation_repo
            .get_model_family_thinking_strategy(model_family)
            .ok()
            .flatten()
            .unwrap_or_else(|| "both".to_string());
        ThinkingDisableStrategy::from_str(raw.as_str())
    }

    pub async fn get_messages(
        &self,
        req: ChatGetMessagesRequest,
    ) -> Result<ChatGetMessagesResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.get_messages",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": req.conversation_id }),
        ));

        let messages = self
            .conversation_repo
            .list_messages(&req.conversation_id)
            .map_err(|e| {
                self.hub.emit(self.hub.make_event(
                    &req.correlation_id,
                    Subsystem::Persistence,
                    "conversation.list",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"error": e}),
                ));
                e
            })?;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.get_messages",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": messages.len() }),
        ));

        Ok(ChatGetMessagesResponse {
            conversation_id: req.conversation_id,
            messages,
            correlation_id: req.correlation_id,
        })
    }

    pub async fn list_conversations(
        &self,
        req: ChatListConversationsRequest,
    ) -> Result<ChatListConversationsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.list_conversations",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let conversations = self.conversation_repo.list_conversations().map_err(|e| {
            self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Persistence,
                "conversation.list",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": e}),
            ));
            e
        })?;

        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Service,
            "chat.list_conversations",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": conversations.len() }),
        ));

        Ok(ChatListConversationsResponse {
            conversations: conversations
                .into_iter()
                .map(|mut item| {
                    if item.title.trim().is_empty() {
                        item.title = truncate_for_error(item.last_message_preview.as_str());
                    }
                    item
                })
                .collect(),
            correlation_id: req.correlation_id,
        })
    }

    fn append_message(
        &self,
        correlation_id: &str,
        message: &ConversationMessageRecord,
    ) -> Result<(), String> {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Persistence,
            "conversation.append",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "conversationId": message.conversation_id, "role": message.role }),
        ));
        self.conversation_repo
            .append_message(message)
            .map_err(|e| {
                self.hub.emit(self.hub.make_event(
                    correlation_id,
                    Subsystem::Persistence,
                    "conversation.append",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({"error": e}),
                ));
                e
            })?;
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Persistence,
            "conversation.append",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "ok": true }),
        ));
        Ok(())
    }

    fn build_api_registry_context(&self) -> Option<String> {
        let apis = self.api_registry.verified_for_agent();
        if apis.is_empty() {
            return None;
        }
        let mut lines = Vec::with_capacity(apis.len() + 2);
        lines.push("Verified API connections available to tools and orchestration:".to_string());
        for api in apis {
            let type_label = match api.api_type {
                ApiConnectionType::Llm => "LLM",
                ApiConnectionType::Search => "Search",
                ApiConnectionType::Stt => "STT",
                ApiConnectionType::Tts => "TTS",
                ApiConnectionType::Image => "Image",
                ApiConnectionType::Other => "Other",
            };
            let display_name = api.name.unwrap_or_else(|| "(unnamed)".to_string());
            lines.push(format!(
                "- type={type_label}, name={display_name}, url={}, key={}",
                api.api_url, api.api_key
            ));
        }
        Some(lines.join("\n"))
    }
}

fn apply_tool_routing_hints(system_prompt: &mut String, enabled_tool_names: &[String]) {
    if enabled_tool_names.iter().any(|name| name == "notepad_write") {
        system_prompt.push_str(
            "\n\nTool routing hint:\n- If the user asks you to create, draft, revise, or maintain a document in the Notepad workspace tool, prefer the dedicated Notepad tools over generic file tools.\n- Use `notepad_read` to inspect a document or a specific line range.\n- Use `notepad_write` to create or fully replace a document when appropriate.\n- Use `notepad_edit_lines` when the user requests targeted edits to specific lines or a narrow section so you do not rewrite the whole document unnecessarily.",
        );
    }
    if enabled_tool_names.iter().any(|name| name == "chart_set") {
        system_prompt.push_str(
            "\n\nTool routing hint:\n- If the user asks for a flowchart, diagram, architecture map, process map, or system overview, use `chart_set` with a valid Mermaid definition and present the result in the Chart workspace tool.\n- For Mermaid flowcharts, start with `flowchart TD` or `flowchart LR`. Use edge labels like `A -->|label| B`, `A -- text --> B`, or dotted arrows like `A -.->|label| B`. Do not use invalid dotted-label forms such as `A -.|label|-. B`.",
        );
    }
}

fn resolve_chat_endpoint(api_url: &str, api_standard_path: Option<&str>) -> String {
    let base = api_url.trim().trim_end_matches('/');
    let path = api_standard_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("/chat/completions");
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    let lower = base.to_ascii_lowercase();
    if lower.ends_with("/chat/completions") {
        return base.to_string();
    }
    if path.starts_with('/') {
        format!("{base}{path}")
    } else {
        format!("{base}/{path}")
    }
}

fn resolve_chat_route_mode(requested: Option<&str>) -> ChatRouteMode {
    let value = requested
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| std::env::var("FOUNDATION_CHAT_MODE").ok())
        .unwrap_or_else(|| "auto".to_string());
    match value.trim().to_ascii_lowercase().as_str() {
        "agent" => ChatRouteMode::Agent,
        "legacy" | "direct" | "llama" | "local" => ChatRouteMode::Legacy,
        _ => ChatRouteMode::Auto,
    }
}

#[derive(Debug, Clone, Copy)]
enum ThinkingDisableStrategy {
    None,
    SystemPrompt,
    ChatTemplate,
    Both,
}

impl ThinkingDisableStrategy {
    fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "system_prompt" | "system" | "prompt" => Self::SystemPrompt,
            "chat_template" | "template" => Self::ChatTemplate,
            "both" => Self::Both,
            _ => Self::Both,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::SystemPrompt => "system_prompt",
            Self::ChatTemplate => "chat_template",
            Self::Both => "both",
        }
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn resolve_agent_cwd() -> String {
    if let Ok(override_cwd) = std::env::var("ARXELL_AGENT_CWD") {
        let trimmed = override_cwd.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let cwd = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();
    if cwd.ends_with("/src-tauri") || cwd.ends_with("\\src-tauri") {
        return std::path::Path::new(cwd.as_str())
            .parent()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or(cwd);
    }
    cwd
}

fn truncate_for_error(input: &str) -> String {
    const MAX: usize = 320;
    if input.chars().count() <= MAX {
        return input.to_string();
    }
    let mut out = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= MAX {
            out.push_str("...");
            return out;
        }
        out.push(ch);
    }
    out
}

fn fallback_title(history: &[ConversationMessageRecord]) -> String {
    let first_user = history
        .iter()
        .find(|item| matches!(item.role, MessageRole::User))
        .map(|item| item.content.as_str())
        .unwrap_or("New Chat");
    let core = truncate_for_error(first_user)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace('\n', " ");
    format!("Casual chat about {}", core)
}

fn normalize_title(input: &str) -> String {
    let cleaned = input
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace('\n', " ");
    let compact = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for (i, ch) in compact.chars().enumerate() {
        if i >= 72 {
            break;
        }
        out.push(ch);
    }
    enforce_title_prefix(out)
}

fn infer_model_family(model: &str) -> String {
    let lower = model.trim().to_ascii_lowercase();
    if lower.contains("qwen") {
        return "qwen".to_string();
    }
    if lower.contains("deepseek") {
        return "deepseek".to_string();
    }
    if lower.contains("llama") {
        return "llama".to_string();
    }
    if lower.contains("mistral") {
        return "mistral".to_string();
    }
    if lower.contains("gemma") {
        return "gemma".to_string();
    }
    if lower.contains("phi") {
        return "phi".to_string();
    }
    lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .find(|token| !token.is_empty())
        .unwrap_or("default")
        .to_string()
}

fn enforce_title_prefix(input: String) -> String {
    let value = input.trim();
    if value.is_empty() {
        return String::new();
    }
    let allowed = [
        "Casual chat about ",
        "Technical discussion about ",
        "Brainstorming on ",
        "Research on ",
    ];
    for prefix in allowed {
        if value.starts_with(prefix) {
            return value.to_string();
        }
    }
    format!("Casual chat about {}", value)
}

#[derive(Debug, Clone, serde::Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, serde::Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    stream: bool,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extra_body: Option<serde_json::Value>,
}

fn strip_think_blocks(input: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    loop {
        let Some(start) = rest.find("<think>") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after_start = &rest[start + "<think>".len()..];
        if let Some(end) = after_start.find("</think>") {
            rest = &after_start[end + "</think>".len()..];
        } else {
            // Malformed/incomplete block; drop remainder after opening tag.
            break;
        }
    }
    out.lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_generated_text(input: String) -> String {
    input
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn looks_like_reasoning_trace(input: &str) -> bool {
    let lower = input.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    lower.starts_with("thinking process")
        || lower.starts_with("reasoning:")
        || lower.starts_with("analysis:")
        || lower.contains("final answer:")
        || lower.contains("step-by-step")
}

fn resolve_chat_max_tokens(requested: Option<u32>) -> Option<u32> {
    if let Some(value) = requested {
        return Some(value.clamp(128, 4096));
    }
    std::env::var("FOUNDATION_LLM_MAX_TOKENS")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .map(|value| value.clamp(128, 4096))
}

fn handle_stream_line(
    service: &ChatService,
    conversation_id: &str,
    correlation_id: &str,
    thinking_enabled: bool,
    line: &str,
    assistant: &mut String,
    reasoning: &mut String,
) -> Result<bool, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let Some(data) = trimmed.strip_prefix("data:") else {
        return Ok(false);
    };
    let data = data.trim();
    if data.is_empty() {
        return Ok(false);
    }
    if data.eq("[DONE]") {
        return Ok(true);
    }

    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let Some(choice) = parsed
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|value| value.as_object())
    else {
        return Ok(false);
    };

    let mut assistant_delta = String::new();
    if let Some(delta) = choice.get("delta").and_then(|v| v.as_object()) {
        if let Some(content) = delta.get("content").and_then(value_to_text) {
            assistant_delta.push_str(content.as_str());
        }
        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
            assistant_delta.push_str(text);
        }
        if let Some(reasoning_delta) = delta
            .get("reasoning_content")
            .and_then(value_to_text)
            .or_else(|| delta.get("reasoning").and_then(value_to_text))
        {
            if thinking_enabled {
                push_reasoning_delta(
                    service,
                    conversation_id,
                    correlation_id,
                    reasoning,
                    reasoning_delta.as_str(),
                );
            } else if !reasoning_delta.is_empty() {
                reasoning.push_str(reasoning_delta.as_str());
            }
            if assistant_delta.is_empty() {
                assistant_delta.push_str(reasoning_delta.as_str());
            }
        }
    }
    if assistant_delta.is_empty() {
        if let Some(text) = choice.get("text").and_then(|v| v.as_str()) {
            assistant_delta.push_str(text);
        } else if let Some(content) = choice.get("content").and_then(value_to_text) {
            assistant_delta.push_str(content.as_str());
        }
    }
    if !assistant_delta.is_empty() {
        assistant.push_str(assistant_delta.as_str());
        service.hub.emit(
            service.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.stream.chunk",
                EventStage::Progress,
                EventSeverity::Info,
                serde_json::to_value(ChatStreamChunkPayload {
                    conversation_id: conversation_id.to_string(),
                    delta: assistant_delta,
                    done: false,
                })
                .unwrap_or_else(|_| json!({})),
            ),
        );
    }
    Ok(false)
}

fn push_reasoning_delta(
    service: &ChatService,
    conversation_id: &str,
    correlation_id: &str,
    reasoning: &mut String,
    delta: &str,
) {
    if delta.is_empty() {
        return;
    }
    reasoning.push_str(delta);
    service.hub.emit(
        service.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.stream.reasoning_chunk",
            EventStage::Progress,
            EventSeverity::Info,
            serde_json::to_value(ChatStreamReasoningChunkPayload {
                conversation_id: conversation_id.to_string(),
                delta: delta.to_string(),
                done: false,
            })
            .unwrap_or_else(|_| json!({})),
        ),
    );
}

struct LocalLlamaResponse {
    assistant_message: String,
    assistant_thinking: Option<String>,
}

struct ParsedAssistantBody {
    assistant: String,
    reasoning: String,
}

fn value_to_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(items) => {
            let mut out = String::new();
            for item in items {
                match item {
                    serde_json::Value::String(s) => {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(s);
                    }
                    serde_json::Value::Object(obj) => {
                        if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                            if !out.is_empty() {
                                out.push('\n');
                            }
                            out.push_str(text);
                        } else if let Some(content) = obj.get("content").and_then(|v| v.as_str()) {
                            if !out.is_empty() {
                                out.push('\n');
                            }
                            out.push_str(content);
                        }
                    }
                    _ => {}
                }
            }
            if out.trim().is_empty() {
                None
            } else {
                Some(out)
            }
        }
        serde_json::Value::Object(obj) => obj
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                obj.get("content")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            }),
        _ => None,
    }
}

fn extract_assistant_from_non_sse_body(
    body: &str,
    thinking_enabled: bool,
) -> Option<ParsedAssistantBody> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(parsed) = extract_assistant_from_json_value(&json, thinking_enabled) {
            return Some(parsed);
        }
    }

    // NDJSON fallback: parse each line and accumulate delta/content.
    let mut assistant = String::new();
    let mut reasoning = String::new();
    for line in trimmed.lines() {
        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(parsed) = extract_assistant_from_json_value(&json, thinking_enabled) {
            assistant.push_str(parsed.assistant.as_str());
            reasoning.push_str(parsed.reasoning.as_str());
        }
    }
    if assistant.trim().is_empty() {
        None
    } else {
        Some(ParsedAssistantBody {
            assistant,
            reasoning,
        })
    }
}

fn extract_assistant_from_json_value(
    json: &serde_json::Value,
    thinking_enabled: bool,
) -> Option<ParsedAssistantBody> {
    let mut assistant = String::new();
    let mut reasoning = String::new();

    if let Some(choice) = json
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|value| value.as_object())
    {
        if let Some(delta) = choice.get("delta").and_then(|v| v.as_object()) {
            if let Some(text) = delta.get("content").and_then(value_to_text) {
                assistant.push_str(text.as_str());
            }
            if let Some(text) = delta.get("text").and_then(value_to_text) {
                assistant.push_str(text.as_str());
            }
            if thinking_enabled {
                if let Some(text) = delta.get("reasoning_content").and_then(value_to_text) {
                    reasoning.push_str(text.as_str());
                } else if let Some(text) = delta.get("reasoning").and_then(value_to_text) {
                    reasoning.push_str(text.as_str());
                }
            }
        }

        if assistant.is_empty() {
            if let Some(text) = choice
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(value_to_text)
            {
                assistant.push_str(text.as_str());
                if thinking_enabled {
                    if let Some(thinking) = choice
                        .get("message")
                        .and_then(|m| m.get("reasoning_content"))
                        .and_then(value_to_text)
                    {
                        reasoning.push_str(thinking.as_str());
                    } else if let Some(thinking) = choice
                        .get("message")
                        .and_then(|m| m.get("reasoning"))
                        .and_then(value_to_text)
                    {
                        reasoning.push_str(thinking.as_str());
                    }
                }
            } else if let Some(text) = choice.get("text").and_then(value_to_text) {
                assistant.push_str(text.as_str());
            } else if let Some(text) = choice.get("content").and_then(value_to_text) {
                assistant.push_str(text.as_str());
            }
        }
        if let Some(text) = choice
            .get("message")
            .and_then(|m| m.get("reasoning_content"))
            .and_then(value_to_text)
            .or_else(|| {
                choice
                    .get("message")
                    .and_then(|m| m.get("reasoning"))
                    .and_then(value_to_text)
            })
            .or_else(|| choice.get("reasoning_content").and_then(value_to_text))
            .or_else(|| choice.get("reasoning").and_then(value_to_text))
        {
            reasoning.push_str(text.as_str());
            if assistant.is_empty() {
                assistant.push_str(text.as_str());
            }
        }
    }

    if assistant.is_empty() {
        if let Some(text) = json
            .get("message")
            .and_then(|v| v.get("content"))
            .and_then(value_to_text)
        {
            assistant.push_str(text.as_str());
        } else if let Some(text) = json.get("content").and_then(value_to_text) {
            assistant.push_str(text.as_str());
        } else if let Some(text) = json.get("response").and_then(value_to_text) {
            assistant.push_str(text.as_str());
        }
    }
    if let Some(text) = json
        .get("message")
        .and_then(|m| m.get("reasoning_content"))
        .and_then(value_to_text)
        .or_else(|| {
            json.get("message")
                .and_then(|m| m.get("reasoning"))
                .and_then(value_to_text)
        })
        .or_else(|| json.get("reasoning_content").and_then(value_to_text))
        .or_else(|| json.get("reasoning").and_then(value_to_text))
    {
        reasoning.push_str(text.as_str());
        if assistant.is_empty() {
            assistant.push_str(text.as_str());
        }
    }

    if assistant.trim().is_empty() {
        None
    } else {
        Some(ParsedAssistantBody {
            assistant,
            reasoning,
        })
    }
}
