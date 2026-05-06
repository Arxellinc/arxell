use crate::agent_tools::chart::ChartTool;
use crate::agent_tools::notepad::{
    NotepadEditLinesTool, NotepadInspectTool, NotepadReadTool, NotepadSyncRegistry,
    NotepadWriteTool,
};
use crate::agent_tools::sheets::SheetsTool;
use crate::agent_tools::web_search::WebSearchTool;
use crate::api_registry::ApiRegistryService;
use crate::app::web_search_service::WebSearchService;
use crate::contracts::{
    ApiConnectionType, ChatAttachment, ChatCancelResponse, ChatContextBreakdownItem,
    ChatDeleteConversationResponse, ChatGetMessagesRequest, ChatGetMessagesResponse,
    ChatInspectContextRequest, ChatInspectContextResponse, ChatListConversationsRequest,
    ChatListConversationsResponse, ChatSendRequest, ChatSendResponse, ChatStreamChunkPayload,
    ChatStreamCompletePayload, ChatStreamReasoningChunkPayload, ChatStreamStartPayload,
    ChatStructuredPayload, ChatWorkflowMode, ChatWorkflowState, ClarificationOption,
    ClarificationQuestion, ConversationMessageRecord, ConversationSummaryRecord,
    CustomItemDeleteRequest, CustomItemDeleteResponse, CustomItemUpsertRequest,
    CustomItemUpsertResponse, EventSeverity, EventStage, MemoryDeleteRequest, MemoryDeleteResponse,
    LooperLoopRecord, LooperLoopStatus, LooperLoopType, LooperQuestion, LooperQuestionAnswer,
    LooperStartRequest, LooperStatusRequest, LooperSubmitQuestionsRequest, MemoryUpsertRequest,
    MemoryUpsertResponse, MessageRole, ReferenceFileSetRequest, ReferenceFileSetResponse,
    PlanArtifact, PlanDelegationMode, PlanRiskTier, SkillCreateRequest, SkillCreateResponse,
    Subsystem, SystemPromptSetRequest, SystemPromptSetResponse,
};
use crate::memory::MemoryManager;
use crate::observability::EventHub;
use crate::persistence::ConversationRepository;
use crate::services::sheets_service::SheetsService;
use crate::tools::looper_handler::LooperHandler;
use crate::workspace_tools::WorkspaceToolsService;
use arx_rs::context::skills::format_skills_for_prompt;
use arx_rs::events::Event as AgentEvent;
use arx_rs::provider::openai_compatible::OpenAiCompatibleProvider;
use arx_rs::provider::ProviderConfig;
use arx_rs::tools::{tool_definitions, Tool as AgentTool};
use arx_rs::types::{
    ContentPart as AgentContentPart, Message as AgentMessage, StopReason as AgentStopReason,
    UserContent as AgentUserContent,
};
use arx_rs::{Agent, AgentConfig, Session};
use reqwest::StatusCode;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use tokio::time::Duration;

pub struct ChatService {
    hub: EventHub,
    memory: Arc<dyn MemoryManager>,
    conversation_repo: Arc<dyn ConversationRepository>,
    api_registry: Arc<ApiRegistryService>,
    workspace_tools: Arc<WorkspaceToolsService>,
    sheets: Arc<SheetsService>,
    web_search: Arc<WebSearchService>,
    looper: Arc<LooperHandler>,
    cancelled_correlations: Arc<Mutex<HashSet<String>>>,
    notepad_registry: NotepadSyncRegistry,
    tool_focus_by_conversation: Arc<Mutex<HashMap<String, HashMap<String, f32>>>>,
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
    let registry = chat.notepad_registry.clone_registry();
    resolved.push(Box::new(NotepadInspectTool::new(registry.clone_registry())));
    resolved.push(Box::new(NotepadReadTool));
    resolved.push(Box::new(NotepadWriteTool::new(
        chat.hub.clone(),
        correlation_id.to_string(),
        registry.clone_registry(),
    )));
    resolved.push(Box::new(NotepadEditLinesTool::new(
        chat.hub.clone(),
        correlation_id.to_string(),
        registry.clone_registry(),
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

fn bind_sheets_tools(
    chat: &ChatService,
    resolved: &mut Vec<Box<dyn AgentTool>>,
    correlation_id: &str,
) {
    resolved.push(Box::new(SheetsTool::new(
        Arc::clone(&chat.sheets),
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
        AgentToolBinding {
            workspace_tool_id: "sheets",
            bind: bind_sheets_tools,
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
        sheets: Arc<SheetsService>,
        web_search: Arc<WebSearchService>,
        looper: Arc<LooperHandler>,
    ) -> Self {
        Self {
            hub,
            memory,
            conversation_repo,
            api_registry,
            workspace_tools,
            sheets,
            web_search,
            looper,
            cancelled_correlations: Arc::new(Mutex::new(HashSet::new())),
            notepad_registry: NotepadSyncRegistry::new(),
            tool_focus_by_conversation: Arc::new(Mutex::new(HashMap::new())),
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
        self.decay_tool_focus(req.conversation_id.as_str());
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

        let workflow_response = self
            .maybe_handle_planning_workflow(
                &req.conversation_id,
                &req.correlation_id,
                &req.user_message,
                req.attachments.as_deref(),
            )
            .await?;

        let llm_response = if let Some(response) = workflow_response {
            Ok(response)
        } else {
            match route_mode {
                ChatRouteMode::Agent => {
                    self.request_agent_response(
                        &req.conversation_id,
                        &req.correlation_id,
                        &req.user_message,
                        req.always_load_tool_keys.as_deref(),
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
                            req.always_load_tool_keys.as_deref(),
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
            structured_payload: llm_response.structured_payload,
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

    async fn maybe_handle_planning_workflow(
        &self,
        conversation_id: &str,
        correlation_id: &str,
        user_message: &str,
        attachments: Option<&[ChatAttachment]>,
    ) -> Result<Option<LocalLlamaResponse>, String> {
        if !chat_planning_delegation_enabled() {
            self.hub.emit(self.hub.make_event(
                correlation_id,
                Subsystem::Service,
                "chat.workflow.preflight",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "conversationId": conversation_id,
                    "planningRequired": false,
                    "disabled": true,
                }),
            ));
            return Ok(None);
        }

        let current_state = self
            .conversation_repo
            .get_chat_workflow_state(conversation_id)?;
        if let Some(state) = current_state.as_ref() {
            let normalized = normalize_workflow_command(user_message);
            if is_workflow_stop(&normalized) {
                let next_state = ChatWorkflowState {
                    conversation_id: conversation_id.to_string(),
                    mode: ChatWorkflowMode::Normal,
                    original_user_message: None,
                    active_plan_id: None,
                    active_plan_hash: None,
                    active_loop_id: None,
                    pending_reason: None,
                    updated_at_ms: now_ms(),
                };
                self.conversation_repo
                    .upsert_chat_workflow_state(&next_state)?;
                self.emit_workflow_state_event(
                    correlation_id,
                    &next_state,
                    "chat.workflow.stopped",
                );
                return Ok(Some(LocalLlamaResponse {
                    assistant_message: "Planning workflow stopped. Normal chat and direct tool routing are available again.".to_string(),
                    assistant_thinking: None,
                    structured_payload: None,
                }));
            }
            match state.mode {
                ChatWorkflowMode::PlanningOffered => {
                    if is_planner_acceptance(&normalized) {
                        let next_state = ChatWorkflowState {
                            conversation_id: conversation_id.to_string(),
                            mode: ChatWorkflowMode::Discovery,
                            original_user_message: state.original_user_message.clone(),
                            active_plan_id: None,
                            active_plan_hash: None,
                            active_loop_id: None,
                            pending_reason: Some(start_discovery_answers(
                                state.pending_reason.as_deref(),
                            )),
                            updated_at_ms: now_ms(),
                        };
                        self.conversation_repo
                            .upsert_chat_workflow_state(&next_state)?;
                        self.emit_workflow_state_event(
                            correlation_id,
                            &next_state,
                            "chat.workflow.discovery_started",
                        );
                        let original = state
                            .original_user_message
                            .as_deref()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or(user_message);
                        let preflight = preflight_from_pending_reason(state.pending_reason.as_deref());
                        return Ok(Some(LocalLlamaResponse {
                            assistant_message: render_discovery_questions(original, &preflight),
                            assistant_thinking: None,
                            structured_payload: Some(build_discovery_structured_payload(0)),
                        }));
                    }
                    if is_planner_decline(&normalized) {
                        let next_state = ChatWorkflowState {
                            conversation_id: conversation_id.to_string(),
                            mode: ChatWorkflowMode::Normal,
                            original_user_message: None,
                            active_plan_id: None,
                            active_plan_hash: None,
                            active_loop_id: None,
                            pending_reason: Some("planner declined".to_string()),
                            updated_at_ms: now_ms(),
                        };
                        self.conversation_repo
                            .upsert_chat_workflow_state(&next_state)?;
                        self.emit_workflow_state_event(
                            correlation_id,
                            &next_state,
                            "chat.workflow.planner_declined",
                        );
                        return Ok(Some(LocalLlamaResponse {
                            assistant_message: "Planner skipped. Send the request again and I will answer directly with normal tool routing.".to_string(),
                            assistant_thinking: None,
                            structured_payload: None,
                        }));
                    }
                    return Ok(Some(LocalLlamaResponse {
                        assistant_message: "This looks like a larger task. Choose `Use Planner` to lock the planning workflow, or `Quick Answer` to skip it for now.".to_string(),
                        assistant_thinking: None,
                        structured_payload: Some(build_planner_offer_structured_payload(
                            state.pending_reason.as_deref(),
                        )),
                    }));
                }
                ChatWorkflowMode::Discovery => {
                    let original = state
                        .original_user_message
                        .as_deref()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(user_message);
                    let updated_answers = append_discovery_answer(
                        state.pending_reason.as_deref(),
                        user_message,
                    );
                    let answer_count = discovery_answer_count(&updated_answers);
                    if answer_count < discovery_question_count() {
                        let next_state = ChatWorkflowState {
                            conversation_id: conversation_id.to_string(),
                            mode: ChatWorkflowMode::Discovery,
                            original_user_message: Some(original.to_string()),
                            active_plan_id: None,
                            active_plan_hash: None,
                            active_loop_id: None,
                            pending_reason: Some(updated_answers.clone()),
                            updated_at_ms: now_ms(),
                        };
                        self.conversation_repo
                            .upsert_chat_workflow_state(&next_state)?;
                        return Ok(Some(LocalLlamaResponse {
                            assistant_message: render_next_discovery_question_text(
                                original,
                                answer_count,
                            ),
                            assistant_thinking: None,
                            structured_payload: Some(build_discovery_structured_payload(
                                answer_count,
                            )),
                        }));
                    }
                    let plan_id = format!("plan-{}", now_ms());
                    let plan_hash =
                        stable_plan_hash(conversation_id, &plan_id, original, &updated_answers);
                    let next_state = ChatWorkflowState {
                        conversation_id: conversation_id.to_string(),
                        mode: ChatWorkflowMode::AwaitingPlanApproval,
                        original_user_message: Some(original.to_string()),
                        active_plan_id: Some(plan_id.clone()),
                        active_plan_hash: Some(plan_hash.clone()),
                        active_loop_id: None,
                        pending_reason: Some(updated_answers.clone()),
                        updated_at_ms: now_ms(),
                    };
                    self.conversation_repo
                        .upsert_chat_workflow_state(&next_state)?;
                    self.hub.emit(self.hub.make_event(
                        correlation_id,
                        Subsystem::Service,
                        "chat.workflow.clarification_submitted",
                        EventStage::Complete,
                        EventSeverity::Info,
                        json!({
                            "conversationId": conversation_id,
                            "answerLength": user_message.len(),
                        }),
                    ));
                    self.emit_workflow_state_event(correlation_id, &next_state, "chat.workflow.plan_created");
                    return Ok(Some(LocalLlamaResponse {
                        assistant_message: render_initial_plan_text(original, &updated_answers, &plan_id, &plan_hash),
                        assistant_thinking: None,
                        structured_payload: Some(ChatStructuredPayload::PlanApproval {
                            plan: build_plan_artifact(
                                conversation_id,
                                &plan_id,
                                &plan_hash,
                                original,
                                &updated_answers,
                            ),
                        }),
                    }));
                }
                ChatWorkflowMode::AwaitingPlanApproval => {
                    if is_plan_approval(&normalized) {
                        let loop_id = format!("chat-loop-{}", now_ms());
                        let plan_id = state
                            .active_plan_id
                            .clone()
                            .unwrap_or_else(|| format!("plan-{}", now_ms()));
                        let plan_hash = state
                            .active_plan_hash
                            .clone()
                            .unwrap_or_else(|| "unhashed".to_string());
                        let original = state
                            .original_user_message
                            .clone()
                            .unwrap_or_else(|| "Approved chat plan".to_string());
                        let discovery_answers = state.pending_reason.clone().unwrap_or_default();
                        let project_folder = validate_project_folder(
                            infer_project_folder_with_answers(&original, &discovery_answers)
                                .as_str(),
                        )?;
                        let handoff = build_chat_looper_start_request(
                            correlation_id,
                            &loop_id,
                            &plan_id,
                            &plan_hash,
                            &project_folder,
                            &original,
                            &discovery_answers,
                        );
                        let start_response = self.looper.start(handoff).await?;
                        let next_state = ChatWorkflowState {
                            conversation_id: conversation_id.to_string(),
                            mode: ChatWorkflowMode::DelegatedExecution,
                            original_user_message: state.original_user_message.clone(),
                            active_plan_id: state.active_plan_id.clone(),
                            active_plan_hash: state.active_plan_hash.clone(),
                            active_loop_id: Some(start_response.loop_id.clone()),
                            pending_reason: Some("delegated execution started".to_string()),
                            updated_at_ms: now_ms(),
                        };
                        self.conversation_repo
                            .upsert_chat_workflow_state(&next_state)?;
                        self.emit_workflow_state_event(
                            correlation_id,
                            &next_state,
                            "chat.workflow.plan_approved",
                        );
                        self.emit_workflow_state_event(
                            correlation_id,
                            &next_state,
                            "chat.workflow.delegation_started",
                        );
                        return Ok(Some(LocalLlamaResponse {
                            assistant_message: format!(
                                "Plan approved. Delegated execution started in Looper as `{}`. I will track this run against the approved plan acceptance checks.",
                                start_response.loop_id
                            ),
                            assistant_thinking: None,
                            structured_payload: None,
                        }));
                    }
                    if is_plan_revision_request(&normalized) {
                        let next_state = ChatWorkflowState {
                            conversation_id: conversation_id.to_string(),
                            mode: ChatWorkflowMode::Discovery,
                            original_user_message: state.original_user_message.clone(),
                            active_plan_id: state.active_plan_id.clone(),
                            active_plan_hash: state.active_plan_hash.clone(),
                            active_loop_id: None,
                            pending_reason: Some("plan revision requested".to_string()),
                            updated_at_ms: now_ms(),
                        };
                        self.conversation_repo
                            .upsert_chat_workflow_state(&next_state)?;
                        self.emit_workflow_state_event(
                            correlation_id,
                            &next_state,
                            "chat.workflow.plan_revised",
                        );
                        return Ok(Some(LocalLlamaResponse {
                            assistant_message: "What should change in the plan? Share the revised scope, folder, deliverables, data source, or acceptance criteria, and I will regenerate the plan for approval.".to_string(),
                            assistant_thinking: None,
                            structured_payload: None,
                        }));
                    }
                    return Ok(Some(LocalLlamaResponse {
                        assistant_message: "This workflow is waiting on plan approval. Reply `Approve Plan` to proceed, or `Revise Plan` with the changes you want.".to_string(),
                        assistant_thinking: None,
                        structured_payload: None,
                    }));
                }
                ChatWorkflowMode::Blocked => {
                    if let Some(loop_id) = state.active_loop_id.as_deref() {
                        let status = self
                            .looper
                            .status(LooperStatusRequest {
                                correlation_id: correlation_id.to_string(),
                                loop_id: loop_id.to_string(),
                            })
                            .await?;
                        if let Some(loop_record) = status.loop_record {
                            if !loop_record.pending_questions.is_empty() {
                                let answers = loop_record
                                    .pending_questions
                                    .iter()
                                    .map(|question| LooperQuestionAnswer {
                                        question_id: question.id.clone(),
                                        selected_option_id: String::new(),
                                        freeform_text: Some(user_message.to_string()),
                                    })
                                    .collect::<Vec<_>>();
                                self.looper
                                    .submit_questions(LooperSubmitQuestionsRequest {
                                        correlation_id: correlation_id.to_string(),
                                        loop_id: loop_id.to_string(),
                                        answers,
                                    })
                                    .await?;
                                let next_state = ChatWorkflowState {
                                    conversation_id: conversation_id.to_string(),
                                    mode: ChatWorkflowMode::DelegatedExecution,
                                    original_user_message: state.original_user_message.clone(),
                                    active_plan_id: state.active_plan_id.clone(),
                                    active_plan_hash: state.active_plan_hash.clone(),
                                    active_loop_id: state.active_loop_id.clone(),
                                    pending_reason: Some("blocker answered".to_string()),
                                    updated_at_ms: now_ms(),
                                };
                                self.conversation_repo
                                    .upsert_chat_workflow_state(&next_state)?;
                                self.emit_workflow_state_event(
                                    correlation_id,
                                    &next_state,
                                    "chat.workflow.delegation_unblocked",
                                );
                                return Ok(Some(LocalLlamaResponse {
                                    assistant_message: format!(
                                        "Submitted your answer to Looper run `{loop_id}` and resumed delegated execution."
                                    ),
                                    assistant_thinking: None,
                                    structured_payload: None,
                                }));
                            }
                        }
                    }
                    return Ok(Some(LocalLlamaResponse {
                        assistant_message: "This delegated workflow is blocked, but I could not find active Looper questions to answer. Reply `Stop Plan` to cancel the workflow or inspect the Looper tool directly.".to_string(),
                        assistant_thinking: None,
                        structured_payload: None,
                    }));
                }
                ChatWorkflowMode::DelegatedExecution => {
                    if let Some(loop_id) = state.active_loop_id.as_deref() {
                        let status = self
                            .looper
                            .status(LooperStatusRequest {
                                correlation_id: correlation_id.to_string(),
                                loop_id: loop_id.to_string(),
                            })
                            .await?;
                        if let Some(loop_record) = status.loop_record {
                            if loop_record.status == LooperLoopStatus::Blocked {
                                let next_state = ChatWorkflowState {
                                    conversation_id: conversation_id.to_string(),
                                    mode: ChatWorkflowMode::Blocked,
                                    original_user_message: state.original_user_message.clone(),
                                    active_plan_id: state.active_plan_id.clone(),
                                    active_plan_hash: state.active_plan_hash.clone(),
                                    active_loop_id: state.active_loop_id.clone(),
                                    pending_reason: Some("looper questions pending".to_string()),
                                    updated_at_ms: now_ms(),
                                };
                                self.conversation_repo
                                    .upsert_chat_workflow_state(&next_state)?;
                                self.emit_workflow_state_event(
                                    correlation_id,
                                    &next_state,
                                    "chat.workflow.delegation_blocked",
                                );
                                return Ok(Some(LocalLlamaResponse {
                                    assistant_message: render_looper_questions_text(
                                        loop_id,
                                        &loop_record.pending_questions,
                                    ),
                                    assistant_thinking: None,
                                    structured_payload: None,
                                }));
                            }
                            if loop_record.status == LooperLoopStatus::Completed {
                                let next_state = ChatWorkflowState {
                                    conversation_id: conversation_id.to_string(),
                                    mode: ChatWorkflowMode::Completed,
                                    original_user_message: state.original_user_message.clone(),
                                    active_plan_id: state.active_plan_id.clone(),
                                    active_plan_hash: state.active_plan_hash.clone(),
                                    active_loop_id: state.active_loop_id.clone(),
                                    pending_reason: Some("delegation completed".to_string()),
                                    updated_at_ms: now_ms(),
                                };
                                self.conversation_repo
                                    .upsert_chat_workflow_state(&next_state)?;
                                self.emit_workflow_state_event(
                                    correlation_id,
                                    &next_state,
                                    "chat.workflow.delegation_completed",
                                );
                                self.hub.emit(self.hub.make_event(
                                    correlation_id,
                                    Subsystem::Service,
                                    "chat.workflow.acceptance_checked",
                                    EventStage::Complete,
                                    EventSeverity::Info,
                                    json!({
                                        "conversationId": conversation_id,
                                        "loopId": loop_id,
                                        "planId": next_state.active_plan_id,
                                        "status": "completed",
                                    }),
                                ));
                                return Ok(Some(LocalLlamaResponse {
                                    assistant_message: render_delegation_completion_text(
                                        loop_id,
                                        &loop_record,
                                    ),
                                    assistant_thinking: None,
                                    structured_payload: None,
                                }));
                            }
                            if loop_record.status == LooperLoopStatus::Failed {
                                let next_state = ChatWorkflowState {
                                    conversation_id: conversation_id.to_string(),
                                    mode: ChatWorkflowMode::Failed,
                                    original_user_message: state.original_user_message.clone(),
                                    active_plan_id: state.active_plan_id.clone(),
                                    active_plan_hash: state.active_plan_hash.clone(),
                                    active_loop_id: state.active_loop_id.clone(),
                                    pending_reason: Some("delegation failed".to_string()),
                                    updated_at_ms: now_ms(),
                                };
                                self.conversation_repo
                                    .upsert_chat_workflow_state(&next_state)?;
                                return Ok(Some(LocalLlamaResponse {
                                    assistant_message: format!(
                                        "Looper run `{loop_id}` failed. Open the Looper tool for phase logs, or reply `Revise Plan` to adjust the task."
                                    ),
                                    assistant_thinking: None,
                                    structured_payload: None,
                                }));
                            }
                            return Ok(Some(LocalLlamaResponse {
                                assistant_message: format!(
                                    "Looper run `{loop_id}` is `{}` in phase `{}`.",
                                    serde_json::to_string(&loop_record.status)
                                        .unwrap_or_else(|_| "running".to_string())
                                        .trim_matches('"'),
                                    loop_record
                                        .active_phase
                                        .as_deref()
                                        .unwrap_or("unknown")
                                ),
                                assistant_thinking: None,
                                structured_payload: None,
                            }));
                        }
                    }
                    return Ok(Some(LocalLlamaResponse {
                        assistant_message: "This planned task is in delegated execution, but no Looper run id is available yet.".to_string(),
                        assistant_thinking: None,
                        structured_payload: None,
                    }));
                }
                ChatWorkflowMode::Normal | ChatWorkflowMode::Completed | ChatWorkflowMode::Failed => {}
            }
        }

        let normalized = normalize_workflow_command(user_message);
        let explicit_planner_request = explicitly_requests_planner(user_message, &normalized);
        let mut preflight = planning_preflight(user_message, attachments);
        if explicit_planner_request && !preflight.planning_required {
            preflight.planning_required = true;
            preflight.forced = true;
            preflight
                .reasons
                .push("user explicitly requested planned workflow".to_string());
        }
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "chat.workflow.preflight",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "conversationId": conversation_id,
                "score": preflight.score,
                "planningRequired": preflight.planning_required,
                "forced": preflight.forced,
                "reasons": preflight.reasons,
            }),
        ));
        if !preflight.planning_required {
            return Ok(None);
        }

        if explicit_planner_request {
            let next_state = ChatWorkflowState {
                conversation_id: conversation_id.to_string(),
                mode: ChatWorkflowMode::Discovery,
                original_user_message: Some(user_message.to_string()),
                active_plan_id: None,
                active_plan_hash: None,
                active_loop_id: None,
                pending_reason: Some(start_discovery_answers(Some(
                    preflight.reasons.join(", ").as_str(),
                ))),
                updated_at_ms: now_ms(),
            };
            self.conversation_repo
                .upsert_chat_workflow_state(&next_state)?;
            self.emit_workflow_state_event(
                correlation_id,
                &next_state,
                "chat.workflow.discovery_started",
            );
            return Ok(Some(LocalLlamaResponse {
                assistant_message: render_discovery_questions(user_message, &preflight),
                assistant_thinking: None,
                structured_payload: Some(build_discovery_structured_payload(0)),
            }));
        }

        let next_state = ChatWorkflowState {
            conversation_id: conversation_id.to_string(),
            mode: ChatWorkflowMode::PlanningOffered,
            original_user_message: Some(user_message.to_string()),
            active_plan_id: None,
            active_plan_hash: None,
            active_loop_id: None,
            pending_reason: Some(preflight.reasons.join(", ")),
            updated_at_ms: now_ms(),
        };
        self.conversation_repo
            .upsert_chat_workflow_state(&next_state)?;
        self.emit_workflow_state_event(
            correlation_id,
            &next_state,
            "chat.workflow.planner_offered",
        );
        Ok(Some(LocalLlamaResponse {
            assistant_message: render_planner_offer_text(&preflight),
            assistant_thinking: None,
            structured_payload: Some(build_planner_offer_structured_payload(Some(
                next_state.pending_reason.as_deref().unwrap_or_default(),
            ))),
        }))
    }

    fn emit_workflow_state_event(
        &self,
        correlation_id: &str,
        state: &ChatWorkflowState,
        action: &str,
    ) {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "conversationId": state.conversation_id,
                "mode": state.mode,
                "activePlanId": state.active_plan_id,
                "activeLoopId": state.active_loop_id,
            }),
        ));
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
        always_load_tool_keys: Option<&[String]>,
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

        let recent_history = self
            .conversation_repo
            .list_messages(conversation_id)
            .unwrap_or_default();
        let provider = OpenAiCompatibleProvider::new(provider_config);
        let available_tools = self.resolve_enabled_agent_tools(correlation_id);
        let agent_tools = self.select_agent_tools_for_request(
            available_tools,
            user_message,
            &recent_history,
            always_load_tool_keys,
            conversation_id,
        );
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
                        self.record_tool_focus(conversation_id, tool_name.as_str(), success);
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
            structured_payload: None,
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

    fn select_agent_tools_for_request(
        &self,
        available_tools: Vec<Box<dyn AgentTool>>,
        user_message: &str,
        history: &[ConversationMessageRecord],
        always_load_tool_keys: Option<&[String]>,
        conversation_id: &str,
    ) -> Vec<Box<dyn AgentTool>> {
        let focus = self
            .tool_focus_by_conversation
            .lock()
            .ok()
            .and_then(|map| map.get(conversation_id).cloned())
            .unwrap_or_default();
        let selected = select_agent_tool_names(
            user_message,
            history,
            &available_tools,
            always_load_tool_keys,
            &focus,
        );
        if selected.is_empty() {
            return Vec::new();
        }
        available_tools
            .into_iter()
            .filter(|tool| selected.contains(tool.name()))
            .collect()
    }

    fn decay_tool_focus(&self, conversation_id: &str) {
        let Ok(mut map) = self.tool_focus_by_conversation.lock() else {
            return;
        };
        let focus = map.entry(conversation_id.to_string()).or_default();
        for value in focus.values_mut() {
            *value = (*value - 0.05).clamp(0.0, 1.0);
        }
    }

    fn record_tool_focus(&self, conversation_id: &str, tool_name: &str, success: bool) {
        let Some(domain) = tool_family_for_name(tool_name) else {
            return;
        };
        let Ok(mut map) = self.tool_focus_by_conversation.lock() else {
            return;
        };
        let focus = map.entry(conversation_id.to_string()).or_default();
        let keys: Vec<String> = focus.keys().cloned().collect();
        let value = focus.entry(domain.to_string()).or_insert(0.0);
        if success {
            *value = (*value + 0.30).clamp(0.0, 1.0);
            for key in keys {
                if key != domain {
                    if let Some(other) = focus.get_mut(key.as_str()) {
                        *other = (*other - 0.08).clamp(0.0, 1.0);
                    }
                }
            }
        } else {
            *value = (*value - 0.40).clamp(0.0, 1.0);
        }
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
            structured_payload: None,
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

    pub async fn inspect_context(
        &self,
        req: ChatInspectContextRequest,
    ) -> Result<ChatInspectContextResponse, String> {
        let route_mode = resolve_chat_route_mode(req.chat_mode.as_deref());
        let history = self
            .conversation_repo
            .list_messages(req.conversation_id.as_str())
            .map_err(|e| format!("failed reading conversation history: {e}"))?;
        let conversations = self
            .conversation_repo
            .list_conversations()
            .map_err(|e| format!("failed reading conversations: {e}"))?;
        let custom_history_items = self.collect_custom_history_items();
        let all_conversations = conversations
            .into_iter()
            .chain(custom_history_items.into_iter())
            .map(|mut item| {
                if item.title.trim().is_empty() {
                    item.title = truncate_for_error(item.last_message_preview.as_str());
                }
                item
            })
            .collect::<Vec<_>>();
        let memory_items = self.collect_memory_items();
        let skills_items =
            self.collect_skills_items(history.as_slice(), req.always_load_skill_keys.as_deref());
        let tools_items = self.collect_tools_items(
            req.correlation_id.as_str(),
            history.as_slice(),
            req.always_load_tool_keys.as_deref(),
        );
        let items = match route_mode {
            ChatRouteMode::Legacy => self.inspect_legacy_context(&history),
            ChatRouteMode::Agent | ChatRouteMode::Auto => self.inspect_agent_context(
                req.correlation_id.as_str(),
                &history,
                all_conversations.as_slice(),
                req.always_load_tool_keys.as_deref(),
            ),
        };
        let total_token_estimate = items
            .iter()
            .chain(skills_items.iter())
            .chain(tools_items.iter())
            .filter(|item| item.load_method == "default")
            .map(|item| item.token_estimate)
            .sum();
        Ok(ChatInspectContextResponse {
            conversation_id: req.conversation_id,
            correlation_id: req.correlation_id,
            route_mode: route_mode.as_str().to_string(),
            total_token_estimate,
            items,
            conversations: all_conversations,
            memory_items,
            skills_items,
            tools_items,
        })
    }

    pub async fn upsert_memory(
        &self,
        req: MemoryUpsertRequest,
    ) -> Result<MemoryUpsertResponse, String> {
        self.memory
            .upsert(req.namespace.as_str(), req.key.as_str(), req.value.as_str());
        Ok(MemoryUpsertResponse {
            namespace: req.namespace,
            key: req.key,
            correlation_id: req.correlation_id,
            ok: true,
        })
    }

    pub async fn delete_memory(
        &self,
        req: MemoryDeleteRequest,
    ) -> Result<MemoryDeleteResponse, String> {
        let deleted = self.memory.delete(req.namespace.as_str(), req.key.as_str());
        Ok(MemoryDeleteResponse {
            namespace: req.namespace,
            key: req.key,
            correlation_id: req.correlation_id,
            deleted,
        })
    }

    pub async fn set_system_prompt(
        &self,
        req: SystemPromptSetRequest,
    ) -> Result<SystemPromptSetResponse, String> {
        let mut config = arx_rs::Config::load().map_err(|err| err.to_string())?;
        config.llm.system_prompt = req.value.clone();
        config.save().map_err(|err| err.to_string())?;
        Ok(SystemPromptSetResponse {
            value: req.value,
            correlation_id: req.correlation_id,
            ok: true,
        })
    }

    pub async fn upsert_custom_item(
        &self,
        req: CustomItemUpsertRequest,
    ) -> Result<CustomItemUpsertResponse, String> {
        let namespace = custom_item_namespace(req.section.as_str())?;
        self.memory
            .upsert(namespace, req.key.as_str(), req.value.as_str());
        Ok(CustomItemUpsertResponse {
            section: req.section,
            key: req.key,
            correlation_id: req.correlation_id,
            ok: true,
        })
    }

    pub async fn delete_custom_item(
        &self,
        req: CustomItemDeleteRequest,
    ) -> Result<CustomItemDeleteResponse, String> {
        let namespace = custom_item_namespace(req.section.as_str())?;
        let deleted = self.memory.delete(namespace, req.key.as_str());
        Ok(CustomItemDeleteResponse {
            section: req.section,
            key: req.key,
            correlation_id: req.correlation_id,
            deleted,
        })
    }

    pub async fn create_skill(
        &self,
        req: SkillCreateRequest,
    ) -> Result<SkillCreateResponse, String> {
        let cwd = resolve_agent_cwd();
        let root = resolve_local_skills_dir(Path::new(&cwd));
        let slug = slugify_skill_name(req.name.as_str());
        if slug.is_empty() {
            return Err("skill name is required".to_string());
        }
        let skill_dir = root.join(slug);
        std::fs::create_dir_all(&skill_dir)
            .map_err(|err| format!("failed creating skill dir: {err}"))?;
        let skill_path = skill_dir.join("SKILL.md");
        if skill_path.exists() {
            return Err(format!("skill already exists: {}", skill_path.display()));
        }
        let content = format!(
            "---\nname: {}\ndescription: {}\n---\n\n{}\n",
            req.name.trim(),
            req.description.trim(),
            req.content.trim()
        );
        std::fs::write(&skill_path, content)
            .map_err(|err| format!("failed writing skill file: {err}"))?;
        Ok(SkillCreateResponse {
            name: req.name,
            file_path: skill_path.display().to_string(),
            correlation_id: req.correlation_id,
            ok: true,
        })
    }

    pub async fn set_reference_file(
        &self,
        req: ReferenceFileSetRequest,
    ) -> Result<ReferenceFileSetResponse, String> {
        std::fs::write(req.path.as_str(), req.value.as_bytes())
            .map_err(|err| format!("failed writing reference file: {err}"))?;
        Ok(ReferenceFileSetResponse {
            path: req.path,
            correlation_id: req.correlation_id,
            ok: true,
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

    fn inspect_agent_context(
        &self,
        correlation_id: &str,
        history: &[ConversationMessageRecord],
        conversations: &[ConversationSummaryRecord],
        always_load_tool_keys: Option<&[String]>,
    ) -> Vec<ChatContextBreakdownItem> {
        let cwd = resolve_agent_cwd();
        let all_tools = self.resolve_enabled_agent_tools(correlation_id);
        let user_message = history
            .iter()
            .rev()
            .find(|item| matches!(item.role, MessageRole::User))
            .map(|item| item.content.as_str())
            .unwrap_or("");
        let tools = self.select_agent_tools_for_request(
            all_tools,
            user_message,
            history,
            always_load_tool_keys,
            history
                .first()
                .map(|item| item.conversation_id.as_str())
                .unwrap_or(""),
        );
        let enabled_tool_names: Vec<String> =
            tools.iter().map(|tool| tool.name().to_string()).collect();
        let available_tool_defs =
            tool_definitions(&self.resolve_enabled_agent_tools(correlation_id));
        let context = arx_rs::context::Context::load(cwd.clone());
        let app_config = arx_rs::Config::load().unwrap_or_default();

        let mut items = Vec::new();
        push_context_item(
            &mut items,
            "context",
            "system",
            "Base system prompt",
            None,
            "default",
            "runtime",
            app_config.llm.system_prompt,
        );
        for (key, value) in self.memory.list_namespace("custom-context") {
            push_context_item(
                &mut items,
                "context",
                "custom-context",
                key,
                None,
                "default",
                "always",
                value,
            );
        }
        if !context.skills.is_empty() {
            push_context_item(
                &mut items,
                "context",
                "system",
                "Skill Index",
                None,
                "default",
                "runtime",
                format_skills_for_prompt(&context.skills),
            );
        }
        if !available_tool_defs.is_empty() {
            let tools_catalog = available_tool_defs
                .iter()
                .map(|tool_def| format!("- {}: {}", tool_def.name, tool_def.description))
                .collect::<Vec<_>>()
                .join("\n");
            push_context_item(
                &mut items,
                "context",
                "system",
                "Tool Index",
                None,
                "default",
                "runtime",
                format!("# Tools\n\n{}", tools_catalog),
            );
        }
        if !conversations.is_empty() {
            push_context_item(
                &mut items,
                "context",
                "system",
                "History Index",
                None,
                "default",
                "runtime",
                format_history_index(conversations),
            );
        }
        push_context_item(
            &mut items,
            "context",
            "system",
            "Runtime metadata",
            None,
            "default",
            "runtime",
            format!("User workspace directory: {cwd}"),
        );
        let mut routing_hints = String::new();
        apply_tool_routing_hints(&mut routing_hints, &enabled_tool_names);
        if !routing_hints.trim().is_empty() {
            push_context_item(
                &mut items,
                "context",
                "system",
                "Tool routing hints",
                None,
                "default",
                "runtime",
                routing_hints.trim().to_string(),
            );
        }
        if let Some(api_context) = self.build_api_registry_context() {
            push_context_item(
                &mut items,
                "context",
                "system",
                "Verified API registry context",
                None,
                "default",
                "runtime",
                api_context,
            );
        }
        extend_history_items(
            &mut items,
            history
                .iter()
                .rev()
                .take(24)
                .collect::<Vec<_>>()
                .into_iter()
                .rev(),
            "default",
        );
        items
    }

    fn inspect_legacy_context(
        &self,
        history: &[ConversationMessageRecord],
    ) -> Vec<ChatContextBreakdownItem> {
        let model =
            std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string());
        let model_family = infer_model_family(model.as_str());
        let strategy = self.resolve_thinking_strategy(model_family.as_str());
        let mut items = Vec::new();
        if matches!(
            strategy,
            ThinkingDisableStrategy::SystemPrompt | ThinkingDisableStrategy::Both
        ) {
            push_context_item(
                &mut items,
                "context",
                "system",
                "Thinking suppression instruction",
                None,
                "default",
                "runtime",
                "Return only the final answer. Do not include chain-of-thought, reasoning traces, or <think> tags.".to_string(),
            );
        }
        if let Some(api_context) = self.build_api_registry_context() {
            push_context_item(
                &mut items,
                "context",
                "system",
                "Verified API registry context",
                None,
                "default",
                "runtime",
                api_context,
            );
        }
        extend_history_items(
            &mut items,
            history
                .iter()
                .rev()
                .take(24)
                .collect::<Vec<_>>()
                .into_iter()
                .rev(),
            "default",
        );
        items
    }

    fn collect_memory_items(&self) -> Vec<ChatContextBreakdownItem> {
        let namespaces = [
            ("episodic", "other"),
            ("fact", "fact"),
            ("user", "user"),
            ("personality", "personality"),
            ("directive", "directive"),
            ("other", "other"),
        ];
        let mut items = Vec::new();
        for (namespace, category) in namespaces {
            for (key, value) in self.memory.list_namespace(namespace) {
                push_context_item(
                    &mut items,
                    "memory",
                    category,
                    format!("{namespace}:{key}"),
                    None,
                    "dynamic",
                    "on_demand",
                    value,
                );
            }
        }
        items
    }

    fn collect_skills_items(
        &self,
        history: &[ConversationMessageRecord],
        always_load_skill_keys: Option<&[String]>,
    ) -> Vec<ChatContextBreakdownItem> {
        let cwd = resolve_agent_cwd();
        let context = arx_rs::context::Context::load(cwd);
        let selected = select_skill_names(
            history
                .iter()
                .rev()
                .find(|item| matches!(item.role, MessageRole::User))
                .map(|item| item.content.as_str())
                .unwrap_or(""),
            history,
            &context.skills,
            always_load_skill_keys,
        );
        let mut items = Vec::new();
        for file in &context.agents_files {
            push_context_item(
                &mut items,
                "skills",
                "project-instructions",
                format!(
                    "Project instructions: {}",
                    Path::new(&file.path)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| file.path.clone())
                ),
                Some(file.path.clone()),
                "dynamic",
                "on_demand",
                file.content.clone(),
            );
        }
        if !context.skills.is_empty() {
            push_context_item(
                &mut items,
                "skills",
                "skill-index",
                "Skill Index",
                None,
                "default",
                "index",
                format_skills_for_prompt(&context.skills),
            );
        }
        for skill in &context.skills {
            let detail = std::fs::read_to_string(skill.file_path.as_str())
                .unwrap_or_else(|_| format!("Unable to read {}", skill.file_path));
            push_context_item(
                &mut items,
                "skills",
                "skill-detail",
                skill.name.clone(),
                Some(skill.file_path.clone()),
                if selected.contains(skill.name.as_str()) {
                    "default"
                } else {
                    "dynamic"
                },
                if always_load_skill_keys
                    .unwrap_or(&[])
                    .iter()
                    .any(|item| item == &skill.name)
                {
                    "always"
                } else if selected.contains(skill.name.as_str()) {
                    "keyword_match"
                } else {
                    "on_demand"
                },
                detail,
            );
        }
        items
    }

    fn collect_custom_history_items(&self) -> Vec<ConversationSummaryRecord> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        self.memory
            .list_namespace("custom-history")
            .into_iter()
            .map(|(key, value)| ConversationSummaryRecord {
                conversation_id: format!("custom-history:{key}"),
                title: key,
                message_count: 1,
                last_message_preview: truncate_for_error(value.as_str()),
                updated_at_ms: now_ms,
            })
            .collect()
    }

    fn collect_tools_items(
        &self,
        correlation_id: &str,
        history: &[ConversationMessageRecord],
        always_load_tool_keys: Option<&[String]>,
    ) -> Vec<ChatContextBreakdownItem> {
        let tools = self.resolve_enabled_agent_tools(correlation_id);
        let selected = select_agent_tool_names(
            history
                .iter()
                .rev()
                .find(|item| matches!(item.role, MessageRole::User))
                .map(|item| item.content.as_str())
                .unwrap_or(""),
            history,
            &tools,
            always_load_tool_keys,
            &HashMap::new(),
        );
        let tool_defs = tool_definitions(&tools);
        let mut items = Vec::new();
        for (key, value) in self.memory.list_namespace("custom-tools") {
            push_context_item(
                &mut items,
                "tools",
                "tool-note",
                key,
                None,
                "dynamic",
                "on_demand",
                value,
            );
        }
        if !tool_defs.is_empty() {
            let index_value = tool_defs
                .iter()
                .map(|tool_def| format!("- {}: {}", tool_def.name, tool_def.description))
                .collect::<Vec<_>>()
                .join("\n");
            push_context_item(
                &mut items,
                "tools",
                "tool-index",
                "Tool Index",
                None,
                "default",
                "index",
                format!("# Tools\n\n{}", index_value),
            );
        }
        for tool_def in tool_defs {
            let detail_load_method = if selected.contains(tool_def.name.as_str()) {
                "default"
            } else {
                "dynamic"
            };
            let schema = serde_json::to_string_pretty(&tool_def.parameters)
                .unwrap_or_else(|_| "{}".to_string());
            push_context_item(
                &mut items,
                "tools",
                "tool-detail",
                tool_def.name.clone(),
                None,
                detail_load_method,
                if always_load_tool_keys
                    .unwrap_or(&[])
                    .iter()
                    .any(|item| item == &tool_def.name)
                {
                    "always"
                } else if selected.contains(tool_def.name.as_str()) {
                    "keyword_match"
                } else {
                    "on_demand"
                },
                format!("{}\n{}\n{}", tool_def.name, tool_def.description, schema),
            );
        }
        items
    }
}

fn estimate_token_count(text: &str) -> i64 {
    if text.is_empty() {
        return 0;
    }
    let char_count = text.chars().count() as f64;
    let word_count = count_words(text) as f64;
    ((0.25 * char_count) + (0.5 * word_count)).round() as i64
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn push_context_item(
    items: &mut Vec<ChatContextBreakdownItem>,
    section: &str,
    category: &str,
    key: impl Into<String>,
    source_path: Option<String>,
    load_method: &str,
    load_reason: &str,
    value: String,
) {
    let char_count = value.chars().count();
    let word_count = count_words(value.as_str());
    items.push(ChatContextBreakdownItem {
        section: section.to_string(),
        category: category.to_string(),
        key: key.into(),
        source_path,
        load_method: load_method.to_string(),
        load_reason: load_reason.to_string(),
        token_estimate: estimate_token_count(value.as_str()),
        char_count,
        word_count,
        value,
    });
}

fn extend_history_items<'a>(
    items: &mut Vec<ChatContextBreakdownItem>,
    history: impl IntoIterator<Item = &'a ConversationMessageRecord>,
    load_method: &str,
) {
    let messages: Vec<&'a ConversationMessageRecord> = history.into_iter().collect();
    let count = messages.len();
    if count == 0 {
        return;
    }
    let combined = messages
        .iter()
        .map(|msg| {
            let role = match msg.role {
                MessageRole::User => "User",
                MessageRole::Assistant => "Assistant",
            };
            format!("{role}: {}", msg.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    push_context_item(
        items,
        "history",
        "history-conversation",
        format!("Conversation ({count} message{})", if count == 1 { "" } else { "s" }),
        None,
        load_method,
        "runtime",
        combined,
    );
}

fn select_agent_tool_names(
    user_message: &str,
    history: &[ConversationMessageRecord],
    available_tools: &[Box<dyn AgentTool>],
    always_load_tool_keys: Option<&[String]>,
    tool_focus: &HashMap<String, f32>,
) -> HashSet<String> {
    if is_chat_only_message(user_message) {
        return always_load_tool_keys
            .unwrap_or(&[])
            .iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }
    let mut selected: HashSet<String> = always_load_tool_keys
        .unwrap_or(&[])
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let tool_names: HashSet<&str> = available_tools.iter().map(|tool| tool.name()).collect();
    let recent_user_text = history
        .iter()
        .rev()
        .filter(|item| matches!(item.role, MessageRole::User))
        .take(3)
        .map(|item| item.content.as_str())
        .collect::<Vec<_>>();
    let mut text = user_message.to_ascii_lowercase();
    if !recent_user_text.is_empty() {
        text.push('\n');
        text.push_str(&recent_user_text.join("\n").to_ascii_lowercase());
    }

    if matches_any(
        &text,
        &[
            "bash", "shell", "command", "terminal", "git", "npm", "cargo", "docker", "run ",
            "build", "install",
        ],
    ) {
        selected.insert("bash".to_string());
    }
    if matches_any(
        &text,
        &[
            "file",
            "files",
            "folder",
            "directory",
            "path",
            "code",
            "source",
            "repo",
            "project",
            "read",
            "edit",
            "write",
            "search",
            "grep",
            "find",
            "rename",
            "move",
        ],
    ) {
        selected.extend(
            [
                "read", "edit", "write", "ls", "mkdir", "move", "grep", "find",
            ]
            .iter()
            .map(|item| item.to_string()),
        );
    }
    if matches_any(
        &text,
        &[
            "document", "notepad", "draft", "spec", "markdown", "write-up", "notes",
            "write a", "create a", "compose", "note", "memo",
        ],
    ) {
        selected.extend(
            ["notepad_inspect", "notepad_read", "notepad_write", "notepad_edit_lines"]
                .iter()
                .map(|item| item.to_string()),
        );
    }
    if matches_any(
        &text,
        &[
            "web",
            "search",
            "google",
            "url",
            "http",
            "https",
            "docs",
            "documentation",
            "research",
            "latest",
        ],
    ) {
        selected.insert("web_search".to_string());
    }
    if matches_any(
        &text,
        &[
            "diagram",
            "chart",
            "flowchart",
            "mermaid",
            "architecture",
            "sequence diagram",
            "graph",
        ],
    ) {
        selected.insert("chart_set".to_string());
    }
    if matches_any(
        &text,
        &[
            "sheet",
            "spreadsheet",
            "cell",
            "row",
            "column",
            "csv",
            "table",
            "formula",
        ],
    ) {
        selected.insert("sheets".to_string());
    }
    if is_ambiguous_followup(user_message) {
        if let Some(family) = top_focus_family(tool_focus, 0.45, 0.10) {
            select_tools_for_family(family, &mut selected);
        }
    }

    if matches_any(
        &text,
        &["that doc", "this doc", "that document", "this document", "add a line", "append", "update that note"],
    ) && recent_user_text
        .iter()
        .any(|msg| matches_any(&msg.to_ascii_lowercase(), &["notepad", "document", "note", "draft", "memo"]))
    {
        selected.extend(
            ["notepad_inspect", "notepad_read", "notepad_edit_lines"]
                .iter()
                .map(|item| item.to_string()),
        );
    }
    if matches_any(&text, &["that sheet", "this sheet", "that spreadsheet", "this spreadsheet", "add a row", "update cell"]) 
        && recent_user_text
            .iter()
            .any(|msg| matches_any(&msg.to_ascii_lowercase(), &["sheet", "spreadsheet", "cell", "row", "column"]))
    {
        selected.insert("sheets".to_string());
    }

    selected.retain(|name| tool_names.contains(name.as_str()));
    selected
}

fn select_skill_names(
    user_message: &str,
    history: &[ConversationMessageRecord],
    available_skills: &[arx_rs::context::skills::Skill],
    always_load_skill_keys: Option<&[String]>,
) -> HashSet<String> {
    let mut selected: HashSet<String> = always_load_skill_keys
        .unwrap_or(&[])
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let skill_names: HashSet<&str> = available_skills
        .iter()
        .map(|skill| skill.name.as_str())
        .collect();
    let recent_user_text = history
        .iter()
        .rev()
        .filter(|item| matches!(item.role, MessageRole::User))
        .take(3)
        .map(|item| item.content.as_str())
        .collect::<Vec<_>>();
    let mut text = user_message.to_ascii_lowercase();
    if !recent_user_text.is_empty() {
        text.push('\n');
        text.push_str(&recent_user_text.join("\n").to_ascii_lowercase());
    }

    for skill in available_skills {
        let skill_name = skill.name.to_ascii_lowercase();
        if text.contains(skill_name.as_str()) {
            selected.insert(skill.name.clone());
            continue;
        }
        let keywords = skill
            .description
            .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
            .map(|item| item.trim().to_ascii_lowercase())
            .filter(|item| item.len() >= 5)
            .collect::<Vec<_>>();
        if keywords
            .iter()
            .any(|keyword| text.contains(keyword.as_str()))
        {
            selected.insert(skill.name.clone());
        }
    }

    selected.retain(|name| skill_names.contains(name.as_str()));
    selected
}

fn matches_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn tool_family_for_name(tool_name: &str) -> Option<&'static str> {
    if tool_name.starts_with("notepad_") {
        return Some("notepad");
    }
    if tool_name == "sheets" {
        return Some("sheets");
    }
    if tool_name == "bash" {
        return Some("terminal");
    }
    if tool_name == "web_search" {
        return Some("web");
    }
    if tool_name == "chart_set" {
        return Some("chart");
    }
    if ["read", "edit", "write", "ls", "mkdir", "move", "grep", "find", "chmod"].contains(&tool_name) {
        return Some("files");
    }
    None
}

fn is_ambiguous_followup(user_message: &str) -> bool {
    let text = user_message.to_ascii_lowercase();
    matches_any(
        &text,
        &["this", "that", "it", "there", "update", "edit", "add", "append"],
    )
}

fn top_focus_family<'a>(focus: &'a HashMap<String, f32>, min_score: f32, min_margin: f32) -> Option<&'a str> {
    let mut scores: Vec<(&str, f32)> = focus.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let (top_family, top_score) = *scores.first()?;
    if top_score < min_score {
        return None;
    }
    let second_score = scores.get(1).map(|(_, v)| *v).unwrap_or(0.0);
    if top_score - second_score < min_margin {
        return None;
    }
    Some(top_family)
}

fn select_tools_for_family(family: &str, selected: &mut HashSet<String>) {
    match family {
        "notepad" => {
            selected.extend(["notepad_inspect", "notepad_read", "notepad_edit_lines"].iter().map(|v| v.to_string()));
        }
        "sheets" => {
            selected.insert("sheets".to_string());
        }
        "files" => {
            selected.extend(["read", "edit", "write", "ls", "mkdir", "move", "grep", "find"].iter().map(|v| v.to_string()));
        }
        "terminal" => {
            selected.insert("bash".to_string());
        }
        "web" => {
            selected.insert("web_search".to_string());
        }
        "chart" => {
            selected.insert("chart_set".to_string());
        }
        _ => {}
    }
}

fn is_chat_only_message(text: &str) -> bool {
    let normalized = text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    let compact = normalized
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace())
        .collect::<String>();
    let compact = compact.split_whitespace().collect::<Vec<_>>().join(" ");
    matches!(
        compact.as_str(),
        "hi"
            | "hello"
            | "hey"
            | "good morning"
            | "good afternoon"
            | "good evening"
            | "are you there"
            | "you there"
            | "thanks"
            | "thank you"
            | "ok"
            | "okay"
            | "cool"
            | "got it"
    )
}

#[derive(Debug, Clone)]
struct WorkflowPreflightDecision {
    planning_required: bool,
    score: u8,
    forced: bool,
    reasons: Vec<String>,
}

fn planning_preflight(
    user_message: &str,
    attachments: Option<&[ChatAttachment]>,
) -> WorkflowPreflightDecision {
    let normalized = normalize_workflow_command(user_message);
    if is_chat_only_message(user_message)
        || is_plan_approval(&normalized)
        || is_plan_revision_request(&normalized)
    {
        return WorkflowPreflightDecision {
            planning_required: false,
            score: 0,
            forced: false,
            reasons: Vec::new(),
        };
    }

    let text = user_message.to_ascii_lowercase();
    let mut score = 0u8;
    let mut forced = false;
    let mut reasons = Vec::<String>::new();

    if matches_any(
        &text,
        &[
            "full",
            "complete",
            "large",
            "larger",
            "end-to-end",
            "end to end",
            "larger research project",
            "large research project",
            "research report",
            "research project",
            "financial analysis",
            "market analysis",
            "market research",
            "spreadsheet analysis",
            "dashboard",
            "multi-tab",
            "workbook",
            "prd",
        ],
    ) {
        score += 1;
        reasons.push("multi-artifact or substantial deliverable".to_string());
    }
    if matches_any(
        &text,
        &[
            "build",
            "implement",
            "refactor",
            "migrate",
            "integrate",
            "set up",
            "setup",
            "develop",
            "create an app",
        ],
    ) {
        score += 1;
        reasons.push("likely multi-step implementation".to_string());
    }
    if matches_any(
        &text,
        &[
            "autonomously",
            "agent",
            "long task",
            "thorough",
            "deep dive",
            "comprehensive",
            "think critically",
            "critical analysis",
            "accurate forecast",
            "accurate forecasts",
            "forecast",
            "forecasts",
            "fully",
        ],
    ) {
        score += 1;
        reasons.push("user requested thorough or autonomous work".to_string());
    }
    if matches_any(
        &text,
        &[
            "research",
            "market research",
            "latest",
            "verify",
            "web",
            "sources",
            "market",
            "competitor",
            "forecast",
            "forecasts",
            "future of",
            "financial",
            "data source",
        ],
    ) {
        score += 1;
        reasons.push("external data or verification likely required".to_string());
    }
    if matches_any(
        &text,
        &[
            "spreadsheet",
            "sheet",
            "report",
            "market research",
            "forecast",
            "forecasts",
            "chart",
            "files",
            "code",
            "tests",
            "web search",
        ],
    ) {
        score += 1;
        reasons.push("multiple tool families may be needed".to_string());
    }
    if missing_common_scope(&text, attachments) {
        score += 1;
        reasons.push("missing scope, folder, data source, or output constraints".to_string());
    }
    if matches_any(
        &text,
        &[
            "delete",
            "remove all",
            "drop table",
            "production",
            "deploy",
            "credential",
            "secret",
            "token",
            "payment",
            "billing",
            "security",
            "chmod",
            "migration",
        ],
    ) {
        forced = true;
        reasons.push("high-risk or destructive class requires planning".to_string());
    }

    reasons.sort();
    reasons.dedup();
    WorkflowPreflightDecision {
        planning_required: forced || score >= 3,
        score,
        forced,
        reasons,
    }
}

fn chat_planning_delegation_enabled() -> bool {
    std::env::var("ARXELL_CHAT_PLANNING_DELEGATION")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "off" | "disabled")
        })
        .unwrap_or(true)
}

fn explicitly_requests_planner(user_message: &str, normalized: &str) -> bool {
    is_planner_acceptance(normalized)
        || matches_any(
            &user_message.to_ascii_lowercase(),
            &[
                "use planner",
                "use the planner",
                "plan this first",
                "planning workflow",
                "make a prd",
                "create a prd",
                "delegate this",
            ],
        )
}

fn is_planner_acceptance(normalized: &str) -> bool {
    matches!(
        normalized,
        "use planner"
            | "use the planner"
            | "planner"
            | "yes use planner"
            | "yes use the planner"
            | "plan this"
            | "plan this first"
            | "use planned workflow"
            | "use the planned workflow"
            | "use planning workflow"
            | "use the planning workflow"
    )
}

fn is_planner_decline(normalized: &str) -> bool {
    matches!(
        normalized,
        "quick answer"
            | "answer directly"
            | "skip planner"
            | "skip the planner"
            | "do not use planner"
            | "dont use planner"
            | "don t use planner"
            | "no planner"
    )
}

fn preflight_from_pending_reason(pending_reason: Option<&str>) -> WorkflowPreflightDecision {
    let reasons = pending_reason
        .unwrap_or_default()
        .lines()
        .next()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    WorkflowPreflightDecision {
        planning_required: true,
        score: reasons.len().min(u8::MAX as usize) as u8,
        forced: reasons
            .iter()
            .any(|reason| reason.contains("high-risk") || reason.contains("destructive")),
        reasons,
    }
}

fn start_discovery_answers(pending_reason: Option<&str>) -> String {
    format!(
        "{}\n\nDiscovery answers:",
        pending_reason.unwrap_or_default().trim()
    )
}

fn append_discovery_answer(existing: Option<&str>, user_message: &str) -> String {
    let base = existing
        .filter(|value| value.contains("Discovery answers:"))
        .map(ToString::to_string)
        .unwrap_or_else(|| start_discovery_answers(existing));
    let answer = user_message.trim();
    if answer.is_empty() {
        return base;
    }
    format!("{}\n- {}", base.trim_end(), normalize_discovery_answer(answer))
}

fn normalize_discovery_answer(answer: &str) -> String {
    answer
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn discovery_answer_count(answers: &str) -> usize {
    answers
        .lines()
        .filter(|line| line.trim_start().starts_with("- "))
        .count()
}

fn discovery_question_count() -> usize {
    3
}

fn render_next_discovery_question_text(original_user_message: &str, answered_count: usize) -> String {
    match answered_count {
        1 => "Good. Next, what should the research emphasize most?".to_string(),
        2 => "Last setup choice: who is the report primarily for? I’ll tune the framing and evidence level around that audience.".to_string(),
        _ => render_discovery_questions(
            original_user_message,
            &WorkflowPreflightDecision {
                planning_required: true,
                score: 0,
                forced: false,
                reasons: Vec::new(),
            },
        ),
    }
}

fn missing_common_scope(text: &str, attachments: Option<&[ChatAttachment]>) -> bool {
    let has_attachment = attachments.map(|items| !items.is_empty()).unwrap_or(false);
    let mentions_folder = matches_any(
        text,
        &[
            "folder",
            "directory",
            "project folder",
            "project directory",
            "project_folder",
            "repo",
            "/home/",
            "./",
            "../",
            "workspace",
        ],
    );
    let mentions_output = matches_any(
        text,
        &[
            "markdown",
            "pdf",
            "csv",
            "spreadsheet",
            "workbook",
            "report",
            "dashboard",
            "code",
            "app",
        ],
    );
    let asks_broad_work = matches_any(
        text,
        &[
            "analysis",
            "report",
            "build",
            "research",
            "financial",
            "spreadsheet",
            "refactor",
            "migrate",
        ],
    );
    asks_broad_work && (!mentions_folder || (!mentions_output && !has_attachment))
}

fn normalize_workflow_command(input: &str) -> String {
    input
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_plan_approval(normalized: &str) -> bool {
    matches!(
        normalized,
        "approve"
            | "approved"
            | "approve plan"
            | "proceed"
            | "proceed with plan"
            | "run it"
            | "start"
            | "start execution"
            | "execute"
            | "execute plan"
    )
}

fn is_plan_revision_request(normalized: &str) -> bool {
    normalized == "revise"
        || normalized == "revise plan"
        || normalized == "change plan"
        || normalized.starts_with("revise plan ")
        || normalized.starts_with("change the plan")
}

fn is_workflow_stop(normalized: &str) -> bool {
    matches!(
        normalized,
        "stop"
            | "stop plan"
            | "stop planning"
            | "cancel"
            | "cancel plan"
            | "cancel planning"
            | "abort"
            | "abort plan"
    )
}

fn stable_plan_hash(
    conversation_id: &str,
    plan_id: &str,
    original_user_message: &str,
    discovery_answer: &str,
) -> String {
    let mut hasher = DefaultHasher::new();
    conversation_id.hash(&mut hasher);
    plan_id.hash(&mut hasher);
    original_user_message.hash(&mut hasher);
    discovery_answer.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn validate_project_folder(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("project folder is required before delegated execution".to_string());
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("failed resolving current directory: {e}"))?
            .join(path)
    };
    if is_unsafe_project_folder(&absolute) {
        return Err(format!(
            "refusing to delegate work in unsafe project folder: {}",
            absolute.to_string_lossy()
        ));
    }
    if !absolute.exists() {
        std::fs::create_dir_all(&absolute)
            .map_err(|e| format!("failed creating project folder: {e}"))?;
    }
    let canonical = absolute
        .canonicalize()
        .map_err(|e| format!("failed canonicalizing project folder: {e}"))?;
    if is_unsafe_project_folder(&canonical) {
        return Err(format!(
            "refusing to delegate work in unsafe project folder: {}",
            canonical.to_string_lossy()
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn is_unsafe_project_folder(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }
    let normalized = path.to_string_lossy();
    let raw = normalized.as_ref();
    if matches!(raw, "/" | "/home" | "/Users" | "/tmp" | "/var" | "/etc" | "/usr" | "/bin" | "/sbin") {
        return true;
    }
    if let Some(home) = dirs::home_dir() {
        if path == home {
            return true;
        }
    }
    false
}

fn infer_project_folder(user_message: &str) -> String {
    let slug = infer_project_slug(user_message);
    PathBuf::from(resolve_agent_cwd())
        .join(slug)
        .to_string_lossy()
        .to_string()
}

fn infer_project_folder_with_answers(user_message: &str, discovery_answers: &str) -> String {
    if let Some(path) = extract_folder_override(discovery_answers) {
        return path;
    }
    infer_project_folder(user_message)
}

fn extract_folder_override(discovery_answers: &str) -> Option<String> {
    for token in discovery_answers.split_whitespace() {
        let trimmed = token.trim_matches(|ch: char| {
            matches!(ch, '`' | '"' | '\'' | ',' | ';' | ')' | '(')
        });
        if trimmed.starts_with("/home/") || trimmed.starts_with("~/") {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn infer_project_slug(user_message: &str) -> String {
    let text = user_message.to_ascii_lowercase();
    if text.contains("digital identity") || text.contains("digitial identity") {
        return "digital-identity-age-verification".to_string();
    }
    if text.contains("age verification") {
        return "age-verification-research".to_string();
    }
    let stop_words: HashSet<&str> = [
        "the", "and", "for", "with", "that", "this", "from", "into", "your", "help", "larger",
        "large", "project", "research", "report", "analysis", "future", "accurate", "market",
    ]
    .into_iter()
    .collect();
    let mut words = Vec::<String>::new();
    for raw in text
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
    {
        if raw.len() < 4 || stop_words.contains(raw) {
            continue;
        }
        words.push(raw.to_string());
        if words.len() >= 5 {
            break;
        }
    }
    if words.is_empty() {
        "planned-research".to_string()
    } else {
        words.join("-")
    }
}

fn render_discovery_questions(
    user_message: &str,
    preflight: &WorkflowPreflightDecision,
) -> String {
    let reason_text = if preflight.reasons.is_empty() {
        "this looks like a larger task".to_string()
    } else {
        preflight.reasons.join("; ")
    };
    let project_folder = infer_project_folder(user_message);
    format!(
        "I’ll treat this as a delegated research project. First I’ll draft a PRD/spec for Looper; the actual deliverable will be a source-backed markdown report, with supporting notes/files as needed.\n\nI’ll use external sources by default because the request depends on current law, market activity, and forecasts.\n\nProject folder: `{project_folder}`. If you prefer a different folder name, type it instead of choosing an option.\n\nReason: {reason_text}."
    )
}

fn render_planner_offer_text(preflight: &WorkflowPreflightDecision) -> String {
    let reason_text = if preflight.reasons.is_empty() {
        "this looks like a larger task".to_string()
    } else {
        preflight.reasons.join("; ")
    };
    format!(
        "This looks like a larger task. Do you want me to use the planned workflow before running tools?\n\nReason: {reason_text}.\n\nChoose `Use Planner` to clarify scope and produce a PRD for approval, or `Quick Answer` to skip the planner."
    )
}

fn build_planner_offer_structured_payload(pending_reason: Option<&str>) -> ChatStructuredPayload {
    let reasons = pending_reason
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    ChatStructuredPayload::PlannerOffer {
        title: "Use Planned Workflow?".to_string(),
        prompt: "This request may benefit from clarification, a PRD, approval, and delegated execution before tools run.".to_string(),
        reasons,
    }
}

fn build_discovery_structured_payload(question_index: usize) -> ChatStructuredPayload {
    let question = match question_index {
        0 => ClarificationQuestion {
            id: "time-budget".to_string(),
            title: "Time Budget".to_string(),
            prompt: "How much research time should I plan for?".to_string(),
            options: vec![
                ClarificationOption { id: "0-30".to_string(), label: "0:30".to_string(), summary: Some("Fast scan with a concise forecast.".to_string()) },
                ClarificationOption { id: "0-15".to_string(), label: "0:15".to_string(), summary: Some("Brief orientation only.".to_string()) },
                ClarificationOption { id: "1-00".to_string(), label: "1:00".to_string(), summary: Some("Standard report with sourced market view.".to_string()) },
                ClarificationOption { id: "2-00".to_string(), label: "2:00".to_string(), summary: Some("Deeper report with scenarios and vendor landscape.".to_string()) },
                ClarificationOption { id: "4-00".to_string(), label: "4:00".to_string(), summary: Some("Deep research brief with stronger evidence review.".to_string()) },
                ClarificationOption { id: "8-plus".to_string(), label: "8:00+".to_string(), summary: Some("Full research project scope.".to_string()) },
            ],
            recommended_option_id: None,
            allow_custom: true,
            required: true,
        },
        1 => ClarificationQuestion {
            id: "research-emphasis".to_string(),
            title: "Research Emphasis".to_string(),
            prompt: "What should the research emphasize most?".to_string(),
            options: vec![
                ClarificationOption { id: "forecast".to_string(), label: "Market forecast".to_string(), summary: Some("Adoption, winners, risks, and timing.".to_string()) },
                ClarificationOption { id: "regulatory".to_string(), label: "Regulatory landscape".to_string(), summary: Some("State mandates, litigation, and compliance paths.".to_string()) },
                ClarificationOption { id: "vendors".to_string(), label: "Vendor landscape".to_string(), summary: Some("Identity, age assurance, wallets, and platform players.".to_string()) },
                ClarificationOption { id: "privacy".to_string(), label: "Privacy/security".to_string(), summary: Some("Civil liberties, data minimization, and ZK/credential approaches.".to_string()) },
            ],
            recommended_option_id: None,
            allow_custom: true,
            required: true,
        },
        _ => ClarificationQuestion {
            id: "audience".to_string(),
            title: "Audience".to_string(),
            prompt: "Who is the report primarily for?".to_string(),
            options: vec![
                ClarificationOption { id: "operator".to_string(), label: "Operator/strategy".to_string(), summary: Some("Business and product implications.".to_string()) },
                ClarificationOption { id: "investor".to_string(), label: "Investor".to_string(), summary: Some("Market sizing, growth, and competitive positioning.".to_string()) },
                ClarificationOption { id: "policy".to_string(), label: "Policy/legal".to_string(), summary: Some("Regulation, constitutional risk, and enforcement.".to_string()) },
                ClarificationOption { id: "technical".to_string(), label: "Technical".to_string(), summary: Some("Architecture, protocols, assurance methods.".to_string()) },
            ],
            recommended_option_id: None,
            allow_custom: true,
            required: true,
        },
    };
    ChatStructuredPayload::Clarification {
        title: "Research Setup".to_string(),
        questions: vec![question],
    }
}

fn build_plan_artifact(
    conversation_id: &str,
    plan_id: &str,
    plan_hash: &str,
    original_user_message: &str,
    discovery_answer: &str,
) -> PlanArtifact {
    PlanArtifact {
        id: plan_id.to_string(),
        version: 1,
        objective: original_user_message.trim().to_string(),
        project_folder: infer_project_folder_with_answers(original_user_message, discovery_answer),
        scope: vec![
            "Use the approved discovery answers as execution constraints.".to_string(),
            "Stay within the approved project folder.".to_string(),
        ],
        non_goals: vec!["Do not expand scope without a plan delta.".to_string()],
        assumptions: vec![discovery_answer.trim().to_string()],
        deliverables: vec![
            "Final source-backed markdown report.".to_string(),
            "Supporting notes, source list, and intermediate files as needed.".to_string(),
            "Completion summary with validation evidence.".to_string(),
        ],
        allowed_tools: vec!["looper".to_string(), "opencode".to_string()],
        data_policy: "External sources are allowed and expected unless the approved plan says otherwise.".to_string(),
        acceptance_checks: vec![
            "Project folder is explicit and validated.".to_string(),
            "Looper receives the approved brief.".to_string(),
            "Completion is summarized against validation artifacts.".to_string(),
        ],
        risk_tier: PlanRiskTier::Medium,
        delegation_mode: PlanDelegationMode::Looper,
        created_at_ms: now_ms(),
        source_conversation_id: conversation_id.to_string(),
        plan_hash: plan_hash.to_string(),
    }
}

fn render_initial_plan_text(
    original_user_message: &str,
    discovery_answer: &str,
    plan_id: &str,
    plan_hash: &str,
) -> String {
    let project_folder = infer_project_folder_with_answers(original_user_message, discovery_answer);
    format!(
        "## Proposed Plan\n\nPlan id: `{plan_id}`\nPlan hash: `{plan_hash}`\n\nObjective: produce a source-backed research report that answers the original request with critical forecasts, market analysis, and clear evidence boundaries.\n\nProject folder: `{project_folder}`\n\nExpected outputs:\n- Final markdown report.\n- Supporting source notes and intermediate files as needed.\n- Completion summary mapped to validation checks.\n\nAcceptance checks:\n- Report cites current external sources where claims depend on law, market activity, or forecasts.\n- Forecasts distinguish evidence, assumptions, and uncertainty.\n- Work stays within the approved project folder.\n- Results are validated before final completion.\n\nOriginal request:\n{original}\n\nDiscovery answers:\n{answers}\n\nReply `Approve Plan` to proceed, or `Revise Plan` with the changes you want.",
        original = original_user_message.trim(),
        answers = discovery_answer.trim()
    )
}

fn render_looper_questions_text(loop_id: &str, questions: &[LooperQuestion]) -> String {
    if questions.is_empty() {
        return format!(
            "Looper run `{loop_id}` is blocked, but it did not provide a specific question."
        );
    }
    let mut out = format!(
        "Looper run `{loop_id}` needs input before it can continue.\n\nReply with your answers in one message.\n"
    );
    for (idx, question) in questions.iter().enumerate() {
        out.push_str(&format!(
            "\n{}. {}\n{}\n",
            idx + 1,
            question.title.trim(),
            question.prompt.trim()
        ));
        for option in &question.options {
            out.push_str(&format!("- {}", option.label.trim()));
            if let Some(summary) = option.summary.as_deref().filter(|value| !value.trim().is_empty()) {
                out.push_str(&format!(": {}", summary.trim()));
            }
            out.push('\n');
        }
    }
    out
}

fn render_delegation_completion_text(loop_id: &str, record: &LooperLoopRecord) -> String {
    let root = Path::new(&record.cwd);
    let review_result = read_small_artifact(root.join("review_result.txt"));
    let work_summary = read_small_artifact(root.join("work_summary.txt"));
    let validation_report = read_small_artifact(root.join("validation_report.txt"));
    let review_feedback = read_small_artifact(root.join("review_feedback.txt"));
    let decision = review_result
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(record.review_result.as_deref().unwrap_or("unknown"));
    let mut out = format!(
        "Looper run `{loop_id}` completed.\n\nDecision: `{}`\nProject folder: `{}`\n\nAcceptance summary:\n- Delegated run reached completed state.\n- Validator/Critic artifacts were checked when available.\n- Review decision: `{}`.",
        truncate_for_completion(decision),
        record.cwd,
        truncate_for_completion(decision)
    );
    if let Some(summary) = work_summary {
        out.push_str("\n\nWork summary:\n");
        out.push_str(&summary);
    }
    if let Some(report) = validation_report {
        out.push_str("\n\nValidation report:\n");
        out.push_str(&report);
    }
    if let Some(feedback) = review_feedback {
        out.push_str("\n\nReview feedback:\n");
        out.push_str(&feedback);
    }
    out
}

fn read_small_artifact(path: PathBuf) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_for_completion(trimmed))
}

fn truncate_for_completion(input: &str) -> String {
    const MAX_CHARS: usize = 1800;
    let mut out = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= MAX_CHARS {
            out.push_str("\n...[truncated]");
            return out;
        }
        out.push(ch);
    }
    out
}

fn build_chat_looper_start_request(
    correlation_id: &str,
    loop_id: &str,
    plan_id: &str,
    plan_hash: &str,
    project_folder: &str,
    original_user_message: &str,
    discovery_answers: &str,
) -> LooperStartRequest {
    let brief = format!(
        "Approved chat plan\n\nPlan id: {plan_id}\nPlan hash: {plan_hash}\nProject folder constraint: {project_folder}\n\nOriginal request:\n{original}\n\nDiscovery answers:\n{answers}\n\nRules:\n- Work only inside the project folder constraint.\n- If the requested work requires changing scope or working outside that folder, stop and ask for a plan delta.\n- Validate results against the approved plan before completion.",
        original = original_user_message.trim(),
        answers = discovery_answers.trim()
    );
    let planner = format!(
        "You are the Planner agent for an approved chat plan. Convert this brief into implementation_plan.md. Do not ask broad prerequisite questions; the user already approved the plan. If the brief is impossible or unsafe, write a blocker summary instead.\n\n{brief}"
    );
    let executor = format!(
        "You are the Executor agent for an approved chat plan. Read implementation_plan.md and complete the top unfinished task. Stay inside the project folder constraint. Write work_summary.txt with files changed and any deviations.\n\n{brief}"
    );
    let validator = format!(
        "You are the Validator agent for an approved chat plan. Run appropriate checks for the work performed and write validation_report.txt. Validate against the approved acceptance checks and folder constraint.\n\n{brief}"
    );
    let critic = format!(
        "You are the Critic agent for an approved chat plan. Read validation_report.txt and work_summary.txt. Write SHIP or REVISE to review_result.txt and explain gaps in review_feedback.txt.\n\n{brief}"
    );
    let mut phase_prompts = HashMap::new();
    phase_prompts.insert("planner".to_string(), planner);
    phase_prompts.insert("executor".to_string(), executor);
    phase_prompts.insert("validator".to_string(), validator);
    phase_prompts.insert("critic".to_string(), critic);

    LooperStartRequest {
        correlation_id: correlation_id.to_string(),
        loop_id: loop_id.to_string(),
        iteration: 1,
        loop_type: LooperLoopType::Build,
        cwd: project_folder.to_string(),
        task_path: "task.md".to_string(),
        specs_glob: "specs/*.md".to_string(),
        max_iterations: 3,
        phase_models: None,
        phase_prompts: Some(phase_prompts),
        project_name: format!("Chat Plan {plan_id}"),
        project_type: "other".to_string(),
        project_icon: "brain".to_string(),
        project_description: brief,
        review_before_execute: false,
    }
}

fn apply_tool_routing_hints(system_prompt: &mut String, enabled_tool_names: &[String]) {
    if enabled_tool_names
        .iter()
        .any(|name| name == "notepad_write" || name == "notepad_edit_lines" || name == "notepad_inspect")
    {
        system_prompt.push_str(
            "\n\nNotepad tool workflow:\n\
            1. Call notepad_inspect to see which documents are open and find the active path and line count.\n\
            2. For NEW documents: call notepad_write with content. The `path` parameter is optional — if omitted a draft path is auto-generated.\n\
            3. For EDITS to existing documents:\n\
               a. First notepad_read the document to see current content and exact line numbers.\n\
               b. Then notepad_edit_lines with the specific line range and replacement text.\n\
               c. NEVER use notepad_write to edit an existing document — always use notepad_edit_lines.\n\
            4. notepad_edit_lines replaces lines start_line through end_line (inclusive, 1-indexed). The replacement text can contain multiple lines.",
        );
    }
    if enabled_tool_names.iter().any(|name| name == "chart_set") {
        system_prompt.push_str(
            "\n\nTool routing hint:\n- If the user asks for a flowchart, diagram, architecture map, process map, or system overview, use `chart_set` with a valid Mermaid definition and present the result in the Chart workspace tool.\n- For Mermaid flowcharts, start with `flowchart TD` or `flowchart LR`. Use edge labels like `A -->|label| B`, `A -- text --> B`, or dotted arrows like `A -.->|label| B`. Do not use invalid dotted-label forms such as `A -.|label|-. B`.",
        );
    }
    if enabled_tool_names.iter().any(|name| name == "sheets") {
        system_prompt.push_str(
            "\n\nSheets tool workflow:\n\
            1. If the user asks to create a sheet, call `sheets` with `action: create_sheet`.\n\
            2. If the user asks to edit cells/rows/columns and no sheet is open, first call `sheets` with `action: create_sheet` (or `open_sheet` only when the user explicitly references an existing file path), then continue with edits.\n\
            3. To view the full current sheet contents, call `action: read_sheet` (it returns metadata plus cells for the active used range).\n\
            4. If formula support is unclear, call `action: list_formula_signatures` (or `list_formula_functions`) before generating formulas.\n\
            5. For one-cell edits use `action: set_cell` with `row`, `col`, and `input`.\n\
            6. For row-level edits use `action: write_range` (for value updates) or `action: insert_rows` / `action: delete_rows` (for structure changes).\n\
            7. Use zero-based indexes for `row`, `col`, `startRow`, `startCol`, `endRow`, `endCol`, and `index`.\n\
            8. Relative sheet paths resolve under the user's `Documents/Arxell/Files` directory.\n\
            9. For arbitrary spreadsheet tasks, ALWAYS follow this sequence: (a) plan the table schema first (columns, row groups, and required fields), (b) gather any factual data needed, (c) write data in larger contiguous 2D blocks, (d) read back and validate completeness, then (e) repair gaps before finishing.\n\
            10. If factual data is requested (for example populations, country lists, market stats), use `web_search` to gather/verify source data before filling the sheet, and avoid fabricating numbers unless the user explicitly asks for mock/sample values.\n\
            11. For multi-section outputs (financial analysis, plans, reports), prefer fewer large `write_range` calls with full 2D blocks instead of many tiny writes.\n\
            12. Before finishing a sheets task, call `action: read_sheet` and verify: headers exist, expected sections/columns exist, and row count is materially larger than a stub. If incomplete, continue editing instead of concluding.\n\
            13. Save explicit changes with `action: save_sheet` when the user asks to persist them.",
        );
    }
}

fn format_history_index(conversations: &[ConversationSummaryRecord]) -> String {
    let rows = conversations
        .iter()
        .take(10)
        .map(|item| {
            let date = format_timestamp_yy_mm_dd_hh_mm(item.updated_at_ms);
            let title = truncate_for_error(item.title.as_str());
            let preview = truncate_for_error(item.last_message_preview.as_str());
            format!(
                "- {date} | {title} | {} msgs | {preview}",
                item.message_count
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("# History\n\n{}", rows)
}

fn format_timestamp_yy_mm_dd_hh_mm(timestamp_ms: i64) -> String {
    if timestamp_ms <= 0 {
        return "--".to_string();
    }
    let secs = timestamp_ms / 1000;
    format!("{}", secs)
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

    if let Some(workspace_dir) = resolve_default_user_workspace_dir() {
        return workspace_dir;
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

fn resolve_default_user_workspace_dir() -> Option<String> {
    let workspace_dir = dirs::home_dir()?.join("Documents").join("Arxell");
    if workspace_dir.is_dir() {
        Some(workspace_dir.to_string_lossy().to_string())
    } else {
        None
    }
}

fn custom_item_namespace(section: &str) -> Result<&'static str, String> {
    match section {
        "context" => Ok("custom-context"),
        "history" => Ok("custom-history"),
        "tools" => Ok("custom-tools"),
        _ => Err(format!("unsupported custom item section: {section}")),
    }
}

fn resolve_local_skills_dir(cwd: &Path) -> PathBuf {
    if let Ok(local_override) = std::env::var(arx_rs::config::LOCAL_SKILLS_DIR_ENV) {
        let trimmed = local_override.trim();
        if !trimmed.is_empty() {
            let override_path = PathBuf::from(trimmed);
            return if override_path.is_absolute() {
                override_path
            } else {
                cwd.join(override_path)
            };
        }
    }
    cwd.join(arx_rs::config::DEFAULT_LOCAL_SKILLS_DIR)
}

fn slugify_skill_name(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.trim().chars() {
        let next = if ch.is_ascii_alphanumeric() {
            prev_dash = false;
            ch.to_ascii_lowercase()
        } else {
            if prev_dash {
                continue;
            }
            prev_dash = true;
            '-'
        };
        out.push(next);
    }
    out.trim_matches('-').to_string()
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
    structured_payload: Option<ChatStructuredPayload>,
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

#[cfg(test)]
mod tests {
    use super::{
        explicitly_requests_planner, is_chat_only_message, is_plan_approval,
        is_plan_revision_request, is_planner_acceptance, is_planner_decline,
        is_unsafe_project_folder, is_workflow_stop, normalize_workflow_command,
        planning_preflight,
    };
    use std::path::Path;

    #[test]
    fn chat_only_message_detection_matches_greetings() {
        assert!(is_chat_only_message("are you there?"));
        assert!(is_chat_only_message("hello"));
        assert!(is_chat_only_message("Thanks!"));
    }

    #[test]
    fn chat_only_message_detection_skips_action_requests() {
        assert!(!is_chat_only_message("create a spreadsheet"));
        assert!(!is_chat_only_message("edit this note"));
    }

    #[test]
    fn preflight_bypasses_small_clear_chat() {
        let decision = planning_preflight("hello", None);
        assert!(!decision.planning_required);
        assert_eq!(decision.score, 0);
    }

    #[test]
    fn preflight_routes_large_ambiguous_work_to_planning() {
        let decision = planning_preflight(
            "Create a full financial analysis spreadsheet with research and a report",
            None,
        );
        assert!(decision.planning_required);
        assert!(decision.score >= 3);
        assert!(!decision.reasons.is_empty());
    }

    #[test]
    fn preflight_routes_large_forecasting_research_to_planning() {
        let decision = planning_preflight(
            "i'd like your help with a larger research project on the future of digitial identity solutions in light of many states now requiring Age verification for everything from operating systems to adult content. I want you to think critically though and come up with accurate forecasts and market research.",
            None,
        );
        assert!(decision.planning_required);
        assert!(decision.score >= 3);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("external data")));
    }

    #[test]
    fn preflight_forces_high_risk_work_to_planning() {
        let decision = planning_preflight("Deploy this to production and update secrets", None);
        assert!(decision.planning_required);
        assert!(decision.forced);
    }

    #[test]
    fn workflow_command_detection_handles_approval_revision_and_stop() {
        assert!(is_plan_approval(&normalize_workflow_command("Approve Plan")));
        assert!(is_plan_revision_request(&normalize_workflow_command(
            "Revise Plan: use a different folder"
        )));
        assert!(is_workflow_stop(&normalize_workflow_command("Cancel planning")));
    }

    #[test]
    fn planner_choice_commands_are_explicit() {
        assert!(is_planner_acceptance(&normalize_workflow_command("Use Planner")));
        assert!(is_planner_decline(&normalize_workflow_command("Quick Answer")));
        assert!(explicitly_requests_planner(
            "Please plan this first before using tools",
            &normalize_workflow_command("Please plan this first before using tools")
        ));
        let mut decision = planning_preflight("use planner for a short note", None);
        if explicitly_requests_planner(
            "use planner for a short note",
            &normalize_workflow_command("use planner for a short note"),
        ) && !decision.planning_required
        {
            decision.planning_required = true;
        }
        assert!(decision.planning_required);
    }

    #[test]
    fn unsafe_project_folder_rejects_roots_and_home() {
        assert!(is_unsafe_project_folder(Path::new("/")));
        if let Some(home) = dirs::home_dir() {
            assert!(is_unsafe_project_folder(home.as_path()));
        }
    }

    #[test]
    fn planning_delegation_feature_flag_defaults_on() {
        std::env::remove_var("ARXELL_CHAT_PLANNING_DELEGATION");
        assert!(super::chat_planning_delegation_enabled());
    }
}
