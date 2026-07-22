//! LooperHandler — core service for multi-agent loop orchestration
//!
//! This service owns the lifecycle of Looper loops, which consist of 4 phases:
//!   Planner → Executor → Validator → Critic
//!
//! ## Architecture
//!
//! The backend owns:
//!   - Headless Pi RPC runs for each phase
//!   - Phase state machine transitions
//!   - Loop iteration control
//!   - Pi CLI availability checking
//!
//! The frontend observes state through events emitted by this handler:
//!   - `looper.loop.start` — iteration begins
//!   - `looper.loop.complete` — iteration ends (SHIP or REVISE decision)
//!   - `looper.loop.failed` — iteration failed
//!   - `looper.phase.start` — phase begins
//!   - `looper.phase.progress` — phase emits output
//!   - `looper.phase.complete` — phase reaches Pi's `agent_settled` event
//!   - `looper.phase.error` — phase encountered an error
//!
//! ## Phase Flow
//!
//! Each phase runs in a dedicated headless Pi RPC process. When Pi emits
//! `agent_settled`, the handler advances to the next phase. The critic phase
//! produces a `SHIP` or `REVISE` decision which controls iteration looping.

use crate::api_registry::ApiRegistryService;
use crate::app::pi_rpc_service::{PiRpcConfig, PiRpcError, PiRpcEvent, PiRpcRecord, PiRpcService};
use crate::app::terminal_service::TerminalService;
use crate::app::web_search_service::{
    WebSearchRequest as ServiceWebSearchRequest, WebSearchResult, WebSearchService,
};
use crate::contracts::{
    ApiConnectionType, EventSeverity, EventStage, LooperAdvanceRequest, LooperAdvanceResponse,
    LooperCheckPiRequest, LooperCheckPiResponse, LooperCloseAllRequest, LooperCloseAllResponse,
    LooperCloseRequest, LooperCloseResponse, LooperImportRequest, LooperImportResponse,
    LooperListRequest, LooperListResponse, LooperLoopRecord, LooperLoopStatus, LooperLoopType,
    LooperPauseRequest, LooperPauseResponse, LooperPhaseState, LooperPhaseStatus,
    LooperPreviewRequest, LooperPreviewResponse, LooperPreviewStateRecord, LooperQuestion,
    LooperStartRequest, LooperStartResponse, LooperStatusRequest, LooperStatusResponse,
    LooperStopRequest, LooperStopResponse, LooperSubStepStatus, Subsystem,
    TerminalCloseSessionRequest, TerminalInputRequest, TerminalOpenSessionRequest,
};
use crate::observability::EventHub;
use crate::workspace_tools::WorkspaceToolsService;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Command;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, watch};

pub fn get_substeps(phase: &str, loop_type: &LooperLoopType) -> Vec<SubStepState> {
    match (phase, loop_type) {
        ("planner", LooperLoopType::Prd) => vec![
            SubStepState {
                id: "p-read-task".into(),
                label: "Read task.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-research".into(),
                label: "Web research".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-analyze".into(),
                label: "Analyze decisions".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-questions".into(),
                label: "Write questions".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-plan".into(),
                label: "Write plan".into(),
                status: "pending".into(),
            },
        ],
        ("executor", LooperLoopType::Prd) => vec![
            SubStepState {
                id: "e-read-answers".into(),
                label: "Read answers".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-overview".into(),
                label: "Write overview.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-features".into(),
                label: "Write features.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-architecture".into(),
                label: "Write architecture.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-ux".into(),
                label: "Write ux.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-api".into(),
                label: "Write api.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-summary".into(),
                label: "Write summary".into(),
                status: "pending".into(),
            },
        ],
        ("validator", LooperLoopType::Prd) => vec![
            SubStepState {
                id: "v-completeness".into(),
                label: "Check completeness".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-consistency".into(),
                label: "Check consistency".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-crossref".into(),
                label: "Cross-reference".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-report".into(),
                label: "Write report".into(),
                status: "pending".into(),
            },
        ],
        ("critic", LooperLoopType::Prd) => vec![
            SubStepState {
                id: "c-review".into(),
                label: "Review specs".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "c-validate".into(),
                label: "Check validation".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "c-decide".into(),
                label: "Ship or Revise".into(),
                status: "pending".into(),
            },
        ],
        ("planner", LooperLoopType::Build) => vec![
            SubStepState {
                id: "p-read-task".into(),
                label: "Read task.md".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-read-specs".into(),
                label: "Read specs".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-read-code".into(),
                label: "Read codebase".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-read-plan".into(),
                label: "Read plan".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-gap-analysis".into(),
                label: "Gap analysis".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "p-write-plan".into(),
                label: "Write plan".into(),
                status: "pending".into(),
            },
        ],
        ("executor", LooperLoopType::Build) => vec![
            SubStepState {
                id: "e-pick-task".into(),
                label: "Pick task".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-inspect".into(),
                label: "Inspect files".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-implement".into(),
                label: "Implement".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "e-summary".into(),
                label: "Write summary".into(),
                status: "pending".into(),
            },
        ],
        ("validator", LooperLoopType::Build) => vec![
            SubStepState {
                id: "v-tests".into(),
                label: "Run tests".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-lint".into(),
                label: "Run lint".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-typecheck".into(),
                label: "Run type-check".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "v-acceptance".into(),
                label: "Acceptance checks".into(),
                status: "pending".into(),
            },
        ],
        ("critic", LooperLoopType::Build) => vec![
            SubStepState {
                id: "c-review".into(),
                label: "Review code".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "c-check-diffs".into(),
                label: "Check diffs".into(),
                status: "pending".into(),
            },
            SubStepState {
                id: "c-decide".into(),
                label: "Ship or Revise".into(),
                status: "pending".into(),
            },
        ],
        _ => vec![],
    }
}

/// Default prompts for BUILD loop
const BUILD_PROMPTS: &[(&str, &str)] = &[
    (
        "planner",
        "You are the Planner agent. Read task.md, specs/*.md, current codebase, and existing implementation_plan.md. Perform gap analysis and reprioritize the plan. Write the updated implementation_plan.md. Do NOT write production code.",
    ),
    (
        "executor",
        "You are the Executor agent. Read the top unfinished task from implementation_plan.md. Inspect relevant files, implement the change, and write a work_summary.txt. Focus on a single task at a time.",
    ),
    (
        "validator",
        "You are the Validator agent. Run all tests, lint, type-check, and any acceptance checks. Report results in validation_report.txt. Be thorough and objective.",
    ),
    (
        "critic",
        "You are the Critic agent. First, read validation_report.txt — if tests, lint, or type-check failed, you MUST write REVISE to review_result.txt. If validation passed, review the code changes, diffs, logs, and work_summary.txt to decide if this is shippable. Write review_result.txt with SHIP or REVISE, and review_feedback.txt with targeted feedback.",
    ),
];

/// PRD loop prompts — research, spec writing, and user question gathering
const PRD_PROMPTS: &[(&str, &str)] = &[
    (
        "planner",
        r#"You are the Planner agent for PRD development. Your job is to research, analyze, and identify key questions that need answers before specs can be finalized.

Research process:
1. Read task.md and project_description to understand the goals
2. Read any existing specs/*.md files
3. Read questions_answered.md if it exists (user's previous answers)
4. Conduct web research on similar projects, best practices, and competitor analysis
5. Identify gaps in understanding and key decisions that need to be made

For each decision point you identify, formulate a question with clear options. Each option must include:
- A clear label (e.g., "Option A: REST API")
- A summary (2-3 sentences)
- Key factors to consider
- Implications and consequences
- Impact on expected behavior

Write questions to questions.md using this exact format:
```
## Question N: [Question Title]

**Question**: [The actual question to answer]

### Option A: [Label]
- **Summary**: ...
- **Key Factors**: ...
- **Implications**: ...
- **Consequences**: ...
- **Impact on Behavior**: ...

### Option B: [Label]
...
```

Also write a detailed implementation_plan.md covering:
- Research findings
- Recommended approach with rationale
- Open questions that need user input
- Next steps once questions are answered

Do NOT write production code. Focus entirely on research and question formulation."#,
    ),
    (
        "executor",
        r#"You are the Executor agent for PRD development. Your job is to transform research and decisions into detailed specification documents.

Read questions_answered.md to understand user decisions, then write comprehensive specs:

1. **specs/overview.md** — Project vision, goals, success metrics, target users
2. **specs/features.md** — Detailed feature list with priorities and acceptance criteria
3. **specs/architecture.md** — System architecture, data models, API contracts
4. **specs/ux.md** — User flows, wireframes description, UI component inventory
5. **specs/api.md** — API endpoints, request/response schemas, error handling

Each spec must be:
- Concrete and actionable
- Self-contained with necessary context
- Cross-referenced to other specs where relevant

After writing specs, write work_summary.txt summarizing what was created and any gaps remaining."#,
    ),
    (
        "validator",
        r#"You are the Validator agent for PRD development. Your job is to ensure specs are complete, consistent, and ready for implementation.

Validation process:
1. Read all specs/*.md files
2. Check for:
   - Completeness: Are all key aspects covered?
   - Consistency: Do specs contradict each other?
   - Feasibility: Can this be implemented with available technology?
   - Clarity: Is each spec unambiguous and actionable?
3. Cross-reference specs to ensure alignment
4. Check that overview.md provides adequate context for all other specs

Write validation_report.txt with:
- Completeness score (1-10) for each spec
- List of inconsistencies or gaps
- Recommendations for improvement

If specs are not ready, this is a failure condition — write FAILED to validation_report.txt."#,
    ),
    (
        "critic",
        r#"You are the Critic agent for PRD development. Your job is to decide if the PRD is ready for implementation or needs more work.

Read validation_report.txt first:
- If validation FAILED or scores are low, write REVISE to review_result.txt
- If specs are incomplete or inconsistent, write REVISE with specific gaps

Read all specs and review_feedback.txt:
- Are the specs comprehensive enough to guide implementation?
- Are there any critical gaps or ambiguities?
- Did the user answer all questions in questions_answered.md?

If specs need more work (missing questions answered, incomplete specs, inconsistencies):
- Write REVISE to review_result.txt
- Write specific feedback to review_feedback.txt about what needs to be fixed

If specs are complete, consistent, and ready:
- Write SHIP to review_result.txt
- Congratulations — the PRD loop is complete!"#,
    ),
];

#[derive(Clone)]
pub struct LooperHandler {
    hub: EventHub,
    terminal: Arc<TerminalService>,
    workspace_tools: Arc<WorkspaceToolsService>,
    web_search: Arc<WebSearchService>,
    api_registry: Arc<ApiRegistryService>,
    loops: Arc<RwLock<HashMap<String, LooperLoop>>>,
    data_path: Arc<RwLock<Option<PathBuf>>>,
    active_runs: Arc<Mutex<HashMap<String, ActivePiRun>>>,
    pi_executable_override: Arc<RwLock<Option<PathBuf>>>,
}

struct ActivePiRun {
    id: String,
    phase: String,
    cancel: watch::Sender<bool>,
}

struct LooperLoop {
    id: String,
    iteration: i32,
    loop_type: LooperLoopType,
    status: LooperLoopStatus,
    active_phase: Option<String>,
    started_at_ms: i64,
    completed_at_ms: Option<i64>,
    phases: HashMap<String, PhaseState>,
    review_result: Option<String>,
    cwd: String,
    task_path: String,
    specs_glob: String,
    max_iterations: i32,
    phase_models: HashMap<String, String>,
    project_name: String,
    project_type: String,
    project_icon: String,
    project_description: String,
    review_before_execute: bool,
    planner_plan: String,
    pending_questions: Vec<LooperQuestion>,
    questions_answered: Vec<String>,
    preview: Option<PreviewState>,
}

struct PhaseState {
    phase: String,
    status: LooperPhaseStatus,
    session_id: Option<String>,
    substeps: Vec<SubStepState>,
    prompt: String,
}

#[derive(Clone)]
struct PreviewState {
    status: String,
    command: Option<String>,
    url: Option<String>,
    session_id: Option<String>,
    last_error: Option<String>,
    last_started_at_ms: Option<i64>,
}

pub struct SubStepState {
    pub id: String,
    pub label: String,
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CriticDecision {
    Ship,
    Revise,
    FailMaxIterations,
}

impl LooperHandler {
    pub fn new(
        hub: EventHub,
        terminal: Arc<TerminalService>,
        workspace_tools: Arc<WorkspaceToolsService>,
        web_search: Arc<WebSearchService>,
        api_registry: Arc<ApiRegistryService>,
    ) -> Self {
        Self {
            hub,
            terminal,
            workspace_tools,
            web_search,
            api_registry,
            loops: Arc::new(RwLock::new(HashMap::new())),
            data_path: Arc::new(RwLock::new(None)),
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            pi_executable_override: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_data_path(&self, path: PathBuf) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        *self.data_path.write().expect("data_path lock poisoned") = Some(path);
    }

    pub fn save_to_disk(&self) {
        let path = match self
            .data_path
            .read()
            .expect("data_path lock poisoned")
            .as_ref()
        {
            Some(p) => p.clone(),
            None => return,
        };
        let loops = self.loops.read().expect("loops lock poisoned");
        let records: Vec<LooperLoopRecord> = loops.values().map(|l| l.to_record()).collect();
        if let Ok(json) = serde_json::to_string_pretty(&records) {
            let _ = fs::write(&path, json);
        }
    }

    pub fn load_from_disk(&self) {
        let path = match self
            .data_path
            .read()
            .expect("data_path lock poisoned")
            .as_ref()
        {
            Some(p) => p.clone(),
            None => return,
        };
        if !path.exists() {
            return;
        }
        let Ok(json) = fs::read_to_string(&path) else {
            return;
        };
        let Ok(records) = serde_json::from_str::<Vec<LooperLoopRecord>>(&json) else {
            return;
        };
        let mut loops = self.loops.write().expect("loops lock poisoned");
        loops.clear();
        for record in records {
            let loopy = LooperLoop::from_record(record);
            loops.insert(loopy.id.clone(), loopy);
        }
    }

    /// Starts a background task that listens for terminal.exit events
    /// and routes them to on_terminal_exit for phase auto-advancement.
    #[cfg(feature = "tauri-runtime")]
    pub fn start_event_listener(self: &Arc<Self>) {
        let hub = self.hub.clone();
        let handler = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let mut rx = hub.subscribe();
            while let Ok(event) = rx.recv().await {
                if event.action == "terminal.exit" {
                    if let Some(session_id) = extract_session_id(&event.payload) {
                        handler.on_terminal_exit(&session_id, 0).await;
                    }
                } else if event.action == "terminal.output" {
                    if let Some(session_id) = extract_session_id(&event.payload) {
                        let chunk = event
                            .payload
                            .as_object()
                            .and_then(|row| row.get("data"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        handler.on_terminal_output(&session_id, chunk);
                    }
                }
            }
        });
    }

    /// Starts a new loop iteration.
    ///
    /// Starts the loop and launches the Planner through headless Pi RPC.
    pub async fn start(&self, req: LooperStartRequest) -> Result<LooperStartResponse, String> {
        let loop_id = req.loop_id.clone();
        let now_ms = now_ms();

        // For app-tool projects, create the plugin scaffold and set cwd to plugins/<tool_id>
        let working_dir: Option<PathBuf> = if req.project_type == "app-tool"
            && !req.project_name.is_empty()
        {
            let tool_id = sanitize_tool_id(&req.project_name);
            if !tool_id.is_empty() {
                match self.workspace_tools.create_app_tool_plugin(
                    &tool_id,
                    &req.project_name,
                    &req.project_icon,
                    &req.project_description,
                ) {
                    Ok(_tool) => {
                        let plugin_dir = self.workspace_tools.plugins_root_path().join(&tool_id);
                        Some(plugin_dir)
                    }
                    Err(e) => {
                        eprintln!("looper: failed to create app-tool plugin: {}", e);
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        // Determine the actual cwd to use
        let cwd = working_dir
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| req.cwd.clone());

        // Build project context for the planner prompt
        let project_context = build_project_context(
            &req.project_name,
            &req.project_type,
            &req.project_icon,
            &req.project_description,
        );

        // Create phase states with prompts and substeps based on loop_type
        let prompts = match req.loop_type {
            LooperLoopType::Prd => PRD_PROMPTS,
            LooperLoopType::Build => BUILD_PROMPTS,
        };
        let mut phases = HashMap::new();
        for (phase_name, default_prompt) in prompts {
            let prompt = if let Some(custom_prompt) = req
                .phase_prompts
                .as_ref()
                .and_then(|prompts| prompts.get(*phase_name))
            {
                custom_prompt.clone()
            } else if *phase_name == "planner" && !project_context.is_empty() {
                format!("{}\n\n{}", project_context, default_prompt)
            } else {
                default_prompt.to_string()
            };
            let prompt = if *phase_name == "planner" {
                if req.review_before_execute {
                    format!(
                        "{}\n\nBefore execution begins, produce implementation_plan.md and, if there are meaningful open decisions, questions.md with user-facing options for review.",
                        prompt
                    )
                } else {
                    format!(
                        "{}\n\nDo not ask the user follow-up questions or write user review options. Make the best decisions autonomously, document them clearly in implementation_plan.md, and continue without requiring plan approval.",
                        prompt
                    )
                }
            } else {
                prompt
            };

            // Define substeps for each phase based on loop type
            let substeps = get_substeps(phase_name, &req.loop_type);

            phases.insert(
                phase_name.to_string(),
                PhaseState {
                    phase: phase_name.to_string(),
                    status: LooperPhaseStatus::Idle,
                    session_id: None,
                    substeps,
                    prompt,
                },
            );
        }

        // Create the loop record
        let loopy = LooperLoop {
            id: loop_id.clone(),
            iteration: req.iteration,
            loop_type: req.loop_type.clone(),
            status: LooperLoopStatus::Running,
            active_phase: Some("planner".to_string()),
            started_at_ms: now_ms,
            completed_at_ms: None,
            phases,
            review_result: None,
            cwd: cwd.clone(),
            task_path: req.task_path.clone(),
            specs_glob: req.specs_glob.clone(),
            max_iterations: req.max_iterations,
            phase_models: req.phase_models.unwrap_or_default(),
            project_name: req.project_name.clone(),
            project_type: req.project_type.clone(),
            project_icon: req.project_icon.clone(),
            project_description: req.project_description.clone(),
            review_before_execute: req.review_before_execute,
            planner_plan: String::new(),
            pending_questions: Vec::new(),
            questions_answered: Vec::new(),
            preview: None,
        };

        // Store the loop
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            loops.insert(loop_id.clone(), loopy);
        }

        // Emit loop.start event
        self.emit_event(
            &req.correlation_id,
            "looper.loop.start",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "iteration": req.iteration,
                "activePhase": "planner",
                "status": "running",
            }),
        );

        // Start the planner phase
        self.start_phase(&loop_id, "planner", &req.correlation_id)
            .await?;

        self.save_to_disk();

        Ok(LooperStartResponse {
            correlation_id: req.correlation_id,
            loop_id,
            status: LooperLoopStatus::Running,
        })
    }

    /// Stops a running loop, aborts its active Pi run, and closes legacy sessions.
    pub async fn stop(&self, req: LooperStopRequest) -> Result<LooperStopResponse, String> {
        // Extract session IDs and iteration before releasing the lock
        let session_ids: Vec<Option<String>>;
        let iteration: i32;
        let active_phase: Option<String>;

        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            let loopy = loops
                .get_mut(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;
            loopy.status = LooperLoopStatus::Failed;
            loopy.completed_at_ms = Some(now_ms());

            // Collect session IDs
            session_ids = ["planner", "executor", "validator", "critic"]
                .iter()
                .map(|phase| loopy.phases.get(*phase).and_then(|p| p.session_id.clone()))
                .collect();
            iteration = loopy.iteration;
            active_phase = loopy.active_phase.clone();
        }

        self.cancel_active_run(&req.loop_id);

        // Close any legacy phase sessions restored from an older record.
        self.close_phase_sessions(&session_ids).await;

        // Emit loop.failed event
        self.emit_event(
            &req.correlation_id,
            "looper.loop.failed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": req.loop_id,
                "iteration": iteration,
                "status": "failed",
                "activePhase": active_phase,
            }),
        );

        self.save_to_disk();

        Ok(LooperStopResponse {
            correlation_id: req.correlation_id,
            loop_id: req.loop_id,
            stopped: true,
        })
    }

    /// Pauses or resumes a running loop.
    pub async fn pause(&self, req: LooperPauseRequest) -> Result<LooperPauseResponse, String> {
        let (paused, active_phase, session_to_close, needs_resume) = {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            match loops.get_mut(&req.loop_id) {
                Some(l) => {
                    if req.paused {
                        let active_phase = l.active_phase.clone();
                        let mut session_to_close = None;
                        if l.status == LooperLoopStatus::Running {
                            if let Some(ref phase_name) = active_phase {
                                if let Some(phase_state) = l.phases.get_mut(phase_name) {
                                    session_to_close = phase_state.session_id.take();
                                    phase_state.status = LooperPhaseStatus::Blocked;
                                    for substep in &mut phase_state.substeps {
                                        if substep.status == "running" {
                                            substep.status = "pending".to_string();
                                        }
                                    }
                                }
                            }
                        }
                        l.status = LooperLoopStatus::Paused;
                        (true, active_phase, session_to_close, false)
                    } else {
                        let active_phase = l.active_phase.clone();
                        (
                            false,
                            active_phase,
                            None,
                            l.status == LooperLoopStatus::Paused,
                        )
                    }
                }
                None => {
                    return Err(format!("loop not found: {}", req.loop_id));
                }
            }
        };

        if paused {
            self.cancel_active_run(&req.loop_id);
        }

        if let Some(session_id) = session_to_close {
            let req = TerminalCloseSessionRequest {
                session_id: session_id.clone(),
                correlation_id: format!("looper-pause-{}", session_id),
            };
            let _ = self.terminal.close_session(req);
        }

        if needs_resume {
            let Some(ref phase_name) = active_phase else {
                return Err(format!(
                    "loop {} has no active phase to resume",
                    req.loop_id
                ));
            };
            self.start_phase(&req.loop_id, phase_name, &req.correlation_id)
                .await?;
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            if let Some(l) = loops.get_mut(&req.loop_id) {
                l.status = LooperLoopStatus::Running;
            }
        }

        self.emit_event(
            &req.correlation_id,
            "looper.loop.paused",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": req.loop_id,
                "paused": paused,
                "activePhase": active_phase,
            }),
        );

        self.save_to_disk();

        Ok(LooperPauseResponse {
            correlation_id: req.correlation_id,
            loop_id: req.loop_id,
            paused,
            updated: true,
        })
    }

    /// Submits answers to pending questions and resumes the loop.
    pub async fn submit_questions(
        &self,
        req: crate::contracts::LooperSubmitQuestionsRequest,
    ) -> Result<crate::contracts::LooperSubmitQuestionsResponse, String> {
        let loop_id = req.loop_id.clone();
        let correlation_id = req.correlation_id.clone();

        // Write answers to questions_answered.md in cwd
        let cwd = {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            let loopy = loops
                .get(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;
            loopy.cwd.clone()
        };

        // Build answers content in structured format
        let mut answers_content = String::from("# User Answers to Questions\n\n");
        for answer in &req.answers {
            answers_content.push_str(&format!("## Question: {}\n\n", answer.question_id));
            answers_content.push_str(&format!(
                "**Selected Option:** {}\n\n",
                answer.selected_option_id
            ));
            if let Some(ref freeform) = answer.freeform_text {
                answers_content.push_str(&format!("**Additional Comments:**\n{}\n\n", freeform));
            }
        }

        let answers_path = std::path::Path::new(&cwd).join("questions_answered.md");
        std::fs::write(&answers_path, &answers_content).map_err(|e| e.to_string())?;

        let advance_from_planner_review = {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            loops
                .get(&req.loop_id)
                .map(|l| {
                    l.active_phase.as_deref() == Some("planner")
                        && l.status == LooperLoopStatus::Blocked
                })
                .unwrap_or(false)
        };

        // Mark questions as answered and update status
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            if let Some(l) = loops.get_mut(&req.loop_id) {
                for answer in &req.answers {
                    l.questions_answered.push(answer.question_id.clone());
                }
                l.pending_questions.clear();
                l.planner_plan.clear();
                l.status = LooperLoopStatus::Running;
            }
        }

        // Emit event and resume by restarting planner
        self.emit_event(
            &correlation_id,
            "looper.loop.questions_submitted",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "answersCount": req.answers.len(),
            }),
        );

        if advance_from_planner_review {
            if let Err(e) = self.do_advance(&loop_id, "executor", &correlation_id).await {
                eprintln!(
                    "looper: failed to advance to executor after planner review: {}",
                    e
                );
            }
        } else if let Err(e) = self.start_phase(&loop_id, "planner", &correlation_id).await {
            eprintln!("looper: failed to restart planner after questions: {}", e);
        }

        self.save_to_disk();

        Ok(crate::contracts::LooperSubmitQuestionsResponse {
            correlation_id,
            loop_id,
            submitted: true,
        })
    }

    pub async fn start_preview(
        &self,
        req: LooperPreviewRequest,
    ) -> Result<LooperPreviewResponse, String> {
        let (cwd, command, existing_session_id) = {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            let loopy = loops
                .get(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;
            let inferred = loopy
                .preview
                .as_ref()
                .and_then(|p| p.command.clone())
                .unwrap_or_else(|| infer_preview_command(&loopy.cwd));
            let existing = loopy.preview.as_ref().and_then(|p| p.session_id.clone());
            (loopy.cwd.clone(), inferred, existing)
        };

        if let Some(session_id) = existing_session_id {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            if let Some(loopy) = loops.get(&req.loop_id) {
                if let Some(preview) = loopy.preview.as_ref() {
                    if preview.status == "running" || preview.status == "starting" {
                        return Ok(preview_response(req.correlation_id, req.loop_id, preview));
                    }
                }
            }
            let _ = self.terminal.close_session(TerminalCloseSessionRequest {
                session_id,
                correlation_id: format!("looper-preview-restart-{}", req.loop_id),
            });
        }

        let open_req = TerminalOpenSessionRequest {
            correlation_id: format!("looper-preview-{}", req.loop_id),
            cols: Some(120),
            rows: Some(24),
            shell: Some("/bin/sh".to_string()),
            cwd: if cwd.trim().is_empty() {
                None
            } else {
                Some(cwd)
            },
            model: None,
        };
        let response = self.terminal.open_session(open_req)?;
        let session_id = response.session_id;

        self.terminal.send_input(TerminalInputRequest {
            session_id: session_id.clone(),
            input: format!("{}\n", command),
            correlation_id: req.correlation_id.clone(),
        })?;

        let preview = PreviewState {
            status: "starting".to_string(),
            command: Some(command),
            url: None,
            session_id: Some(session_id.clone()),
            last_error: None,
            last_started_at_ms: Some(now_ms()),
        };
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            let loopy = loops
                .get_mut(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;
            loopy.preview = Some(preview.clone());
        }
        self.save_to_disk();
        Ok(preview_response(req.correlation_id, req.loop_id, &preview))
    }

    pub async fn stop_preview(
        &self,
        req: LooperPreviewRequest,
    ) -> Result<LooperPreviewResponse, String> {
        let session_id = {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            loops
                .get(&req.loop_id)
                .and_then(|l| l.preview.as_ref())
                .and_then(|p| p.session_id.clone())
        };
        if let Some(session_id) = session_id {
            let _ = self.terminal.close_session(TerminalCloseSessionRequest {
                session_id,
                correlation_id: req.correlation_id.clone(),
            });
        }
        let preview = {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            let loopy = loops
                .get_mut(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;
            let preview = loopy.preview.get_or_insert(PreviewState {
                status: "stopped".to_string(),
                command: None,
                url: None,
                session_id: None,
                last_error: None,
                last_started_at_ms: None,
            });
            preview.status = "stopped".to_string();
            preview.session_id = None;
            preview.clone()
        };
        self.save_to_disk();
        Ok(preview_response(req.correlation_id, req.loop_id, &preview))
    }

    /// Manually advances a loop to the next phase.
    /// Normal Pi RPC runs advance on `agent_settled`; this can be triggered
    /// manually for testing or recovery.
    pub async fn advance(
        &self,
        req: LooperAdvanceRequest,
    ) -> Result<LooperAdvanceResponse, String> {
        let (session_id, new_phase) = self
            .do_advance(&req.loop_id, &req.next_phase, &req.correlation_id)
            .await?;

        Ok(LooperAdvanceResponse {
            correlation_id: req.correlation_id,
            loop_id: req.loop_id,
            active_phase: new_phase.clone(),
            session_id,
        })
    }

    /// Gets the current status of a loop.
    pub async fn status(&self, req: LooperStatusRequest) -> Result<LooperStatusResponse, String> {
        let loops = self.loops.read().map_err(|e| e.to_string())?;
        let loopy = loops.get(&req.loop_id).map(|l| l.to_record());

        Ok(LooperStatusResponse {
            correlation_id: req.correlation_id,
            loop_record: loopy,
        })
    }

    /// Lists all loops.
    pub async fn list(&self, req: LooperListRequest) -> Result<LooperListResponse, String> {
        let loops = self.loops.read().map_err(|e| e.to_string())?;
        let loop_records: Vec<LooperLoopRecord> = loops.values().map(|l| l.to_record()).collect();

        Ok(LooperListResponse {
            correlation_id: req.correlation_id,
            loops: loop_records,
        })
    }

    /// Closes a loop and removes it from the handler.
    /// This stops the loop if running and closes all sessions.
    pub async fn close(&self, req: LooperCloseRequest) -> Result<LooperCloseResponse, String> {
        // Extract session IDs before removing from map
        let session_ids: Vec<Option<String>>;
        {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            let loopy = loops
                .get(&req.loop_id)
                .ok_or_else(|| format!("loop not found: {}", req.loop_id))?;

            // Collect session IDs
            session_ids = ["planner", "executor", "validator", "critic"]
                .iter()
                .map(|phase| loopy.phases.get(*phase).and_then(|p| p.session_id.clone()))
                .collect();
        }

        // Remove the loop
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            loops.remove(&req.loop_id);
        }

        self.cancel_active_run(&req.loop_id);
        self.close_phase_sessions(&session_ids).await;

        self.save_to_disk();

        Ok(LooperCloseResponse {
            correlation_id: req.correlation_id,
            loop_id: req.loop_id,
            closed: true,
        })
    }

    pub async fn close_all(
        &self,
        req: LooperCloseAllRequest,
    ) -> Result<LooperCloseAllResponse, String> {
        let all_session_ids: Vec<Vec<Option<String>>>;
        let count: usize;
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            all_session_ids = loops
                .values()
                .map(|l| {
                    ["planner", "executor", "validator", "critic"]
                        .iter()
                        .map(|phase| l.phases.get(*phase).and_then(|p| p.session_id.clone()))
                        .collect()
                })
                .collect();
            count = loops.len();
            loops.clear();
        }

        self.cancel_all_active_runs();
        for session_ids in &all_session_ids {
            self.close_phase_sessions(session_ids).await;
        }

        self.save_to_disk();

        Ok(LooperCloseAllResponse {
            correlation_id: req.correlation_id,
            closed_count: count,
        })
    }

    pub fn import(&self, req: LooperImportRequest) -> Result<LooperImportResponse, String> {
        let mut loops = self.loops.write().map_err(|e| e.to_string())?;
        loops.clear();
        for record in req.loops {
            let loopy = LooperLoop::from_record(record);
            loops.insert(loopy.id.clone(), loopy);
        }

        self.save_to_disk();

        Ok(LooperImportResponse {
            correlation_id: req.correlation_id,
            imported_count: loops.len(),
        })
    }

    /// Checks if the Pi CLI is installed on the system.
    pub async fn check_pi(
        &self,
        req: LooperCheckPiRequest,
    ) -> Result<LooperCheckPiResponse, String> {
        let version = probe_pi_version();
        let installed = version.is_some();

        self.emit_event(
            &req.correlation_id,
            "looper.check-pi.result",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "installed": installed,
                "version": version,
            }),
        );

        Ok(LooperCheckPiResponse {
            correlation_id: req.correlation_id,
            installed,
            version,
        })
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    fn resolve_model_name(&self, raw_model_id: &str) -> Option<String> {
        let id = raw_model_id.trim();
        if id.is_empty() || id == "auto" {
            return None;
        }
        if let Some(rest) = id.strip_prefix("api:") {
            let conn_id = rest.split(':').next().unwrap_or("").trim();
            if !conn_id.is_empty() {
                if let Some(conn) = self
                    .api_registry
                    .verified_for_agent()
                    .into_iter()
                    .find(|r| r.id == conn_id && matches!(r.api_type, ApiConnectionType::Llm))
                {
                    return Some(
                        conn.model_name.unwrap_or_else(|| {
                            rest.splitn(3, ':').nth(2).unwrap_or(id).to_string()
                        }),
                    );
                }
            }
            return Some(rest.splitn(3, ':').nth(2).unwrap_or(id).to_string());
        }
        if let Some(local_name) = id.strip_prefix("local:") {
            let name = local_name.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
            return None;
        }
        Some(id.to_string())
    }

    /// Closes phase sessions retained by legacy persisted loop records.
    async fn close_phase_sessions(&self, session_ids: &[Option<String>]) {
        for session_id in session_ids {
            if let Some(ref sid) = session_id {
                let req = TerminalCloseSessionRequest {
                    session_id: sid.clone(),
                    correlation_id: format!("looper-close-{}", sid),
                };
                if let Err(e) = self.terminal.close_session(req) {
                    eprintln!("looper: failed to close session {}: {}", sid, e);
                }
            }
        }
    }

    /// Starts a phase in a dedicated headless Pi RPC process.
    fn start_phase<'a>(
        &'a self,
        loop_id: &'a str,
        phase: &'a str,
        correlation_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            let (
                prompt,
                raw_model,
                loop_type,
                cwd,
                project_name,
                project_type,
                project_description,
            ) = {
                let loops = self.loops.read().map_err(|e| e.to_string())?;
                let loopy = loops
                    .get(loop_id)
                    .ok_or_else(|| format!("loop not found: {}", loop_id))?;
                let phase_state = loopy
                    .phases
                    .get(phase)
                    .ok_or_else(|| format!("phase not found: {}", phase))?;
                (
                    phase_state.prompt.clone(),
                    loopy.phase_models.get(phase).cloned(),
                    loopy.loop_type.clone(),
                    loopy.cwd.clone(),
                    loopy.project_name.clone(),
                    loopy.project_type.clone(),
                    loopy.project_description.clone(),
                )
            };

            let project_root = fs::canonicalize(if cwd.trim().is_empty() { "." } else { &cwd })
                .map_err(|error| format!("invalid Looper project directory: {error}"))?;
            if !project_root.is_dir() {
                return Err(format!(
                    "Looper project directory is not a folder: {}",
                    project_root.display()
                ));
            }

            let resolved_model = raw_model
                .as_deref()
                .and_then(|model| self.resolve_model_name(model));

            let mut prompt = prompt;
            if phase == "planner" {
                if let Some(research_hint) = self
                    .prepare_planner_web_research(
                        correlation_id,
                        loop_id,
                        &loop_type,
                        &cwd,
                        &project_name,
                        &project_type,
                        &project_description,
                    )
                    .await
                {
                    prompt = format!("{}\n\n{}", prompt, research_hint);
                }
            }

            let run_id = format!("pi-{}-{}-{}", loop_id, phase, now_ms());
            {
                let mut loops = self.loops.write().map_err(|e| e.to_string())?;
                let loopy = loops
                    .get_mut(loop_id)
                    .ok_or_else(|| format!("loop not found: {}", loop_id))?;
                let phase_state = loopy
                    .phases
                    .get_mut(phase)
                    .ok_or_else(|| format!("phase not found: {}", phase))?;
                phase_state.status = LooperPhaseStatus::Running;
                phase_state.session_id = None;
                if let Some(first) = phase_state.substeps.first_mut() {
                    first.status = "running".to_string();
                }
                loopy.active_phase = Some(phase.to_string());
            }

            self.cancel_active_run(loop_id);
            let (cancel, cancellation) = watch::channel(false);
            self.active_runs
                .lock()
                .map_err(|error| error.to_string())?
                .insert(
                    loop_id.to_string(),
                    ActivePiRun {
                        id: run_id.clone(),
                        phase: phase.to_string(),
                        cancel,
                    },
                );

            self.emit_event(
                correlation_id,
                "looper.phase.start",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": loop_id,
                    "phase": phase,
                    "runId": run_id,
                    "model": resolved_model,
                    "runtime": "pi-rpc",
                }),
            );

            let mut config = PiRpcConfig::ephemeral(project_root);
            config.model = resolved_model;
            if let Ok(executable) = self.pi_executable_override.read() {
                if let Some(executable) = executable.as_ref() {
                    config.executable = executable.clone();
                }
            }

            let handler = self.clone();
            let loop_id = loop_id.to_string();
            let phase = phase.to_string();
            let correlation_id = correlation_id.to_string();
            tokio::spawn(async move {
                let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
                let event_handler = handler.clone();
                let event_loop_id = loop_id.clone();
                let event_phase = phase.clone();
                let event_correlation_id = correlation_id.clone();
                tokio::spawn(async move {
                    while let Some(record) = event_receiver.recv().await {
                        event_handler.handle_pi_record(
                            &event_loop_id,
                            &event_phase,
                            &event_correlation_id,
                            record,
                        );
                    }
                });

                let result = PiRpcService::run_prompt_with_cancel(
                    config,
                    prompt,
                    Some(event_sender),
                    Some(cancellation),
                )
                .await;

                if !handler.finish_active_run(&loop_id, &run_id) {
                    return;
                }

                match result {
                    Ok(result) => {
                        handler.emit_event(
                            &correlation_id,
                            "pi.agent.settled",
                            EventStage::Complete,
                            EventSeverity::Info,
                            json!({
                                "loopId": loop_id,
                                "phase": phase,
                                "runId": run_id,
                                "eventCount": result.event_count,
                                "finalTextBytes": result.final_text.len(),
                            }),
                        );
                        handler.complete_phase_flow(&loop_id, &phase, &run_id).await;
                    }
                    Err(PiRpcError::Cancelled) => {}
                    Err(error) => {
                        handler.fail_rpc_phase(
                            &loop_id,
                            &phase,
                            &run_id,
                            &correlation_id,
                            &safe_pi_error(&error),
                        );
                    }
                }
            });

            Ok(())
        })
    }

    fn handle_pi_record(
        &self,
        loop_id: &str,
        phase: &str,
        correlation_id: &str,
        record: PiRpcRecord,
    ) {
        match record {
            PiRpcRecord::Event(event) => self.emit_pi_event(loop_id, phase, correlation_id, event),
            PiRpcRecord::ExtensionUiRequest(request) => self.emit_event(
                correlation_id,
                "pi.approval.blocked",
                EventStage::Complete,
                EventSeverity::Warn,
                json!({
                    "loopId": loop_id,
                    "phase": phase,
                    "requestId": request.id,
                    "method": request.method,
                    "decision": "cancelled",
                }),
            ),
            PiRpcRecord::Stderr(_) | PiRpcRecord::Response(_) => {}
        }
    }

    fn emit_pi_event(&self, loop_id: &str, phase: &str, correlation_id: &str, event: PiRpcEvent) {
        match event.event_type.as_str() {
            "message_update" => {
                let update = &event.payload["assistantMessageEvent"];
                if update["type"].as_str() == Some("text_delta") {
                    if let Some(delta) = update["delta"].as_str() {
                        self.emit_event(
                            correlation_id,
                            "pi.message.delta",
                            EventStage::Progress,
                            EventSeverity::Info,
                            json!({
                                "loopId": loop_id,
                                "phase": phase,
                                "text": truncate_utf8(delta, 8 * 1024),
                            }),
                        );
                    }
                }
            }
            "tool_execution_start" => self.emit_event(
                correlation_id,
                "pi.tool.start",
                EventStage::Start,
                EventSeverity::Info,
                json!({
                    "loopId": loop_id,
                    "phase": phase,
                    "toolCallId": event.payload["toolCallId"],
                    "toolName": event.payload["toolName"],
                }),
            ),
            "tool_execution_end" => self.emit_event(
                correlation_id,
                "pi.tool.end",
                EventStage::Complete,
                if event.payload["isError"].as_bool() == Some(true) {
                    EventSeverity::Warn
                } else {
                    EventSeverity::Info
                },
                json!({
                    "loopId": loop_id,
                    "phase": phase,
                    "toolCallId": event.payload["toolCallId"],
                    "toolName": event.payload["toolName"],
                    "isError": event.payload["isError"],
                }),
            ),
            "message_end" => {
                let usage = &event.payload["message"]["usage"];
                if usage.is_object() {
                    self.emit_event(
                        correlation_id,
                        "pi.usage",
                        EventStage::Complete,
                        EventSeverity::Info,
                        json!({
                            "loopId": loop_id,
                            "phase": phase,
                            "inputTokens": usage["input"],
                            "outputTokens": usage["output"],
                            "cacheReadTokens": usage["cacheRead"],
                            "cacheWriteTokens": usage["cacheWrite"],
                        }),
                    );
                }
            }
            "auto_retry_start" | "auto_retry_end" | "compaction_start" | "compaction_end" => {
                self.emit_event(
                    correlation_id,
                    "pi.agent.status",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({
                        "loopId": loop_id,
                        "phase": phase,
                        "status": event.event_type,
                    }),
                );
            }
            _ => {}
        }
    }

    fn finish_active_run(&self, loop_id: &str, run_id: &str) -> bool {
        let Ok(mut runs) = self.active_runs.lock() else {
            return false;
        };
        if runs.get(loop_id).map(|run| run.id.as_str()) != Some(run_id) {
            return false;
        }
        runs.remove(loop_id);
        true
    }

    fn cancel_active_run(&self, loop_id: &str) {
        let run = self
            .active_runs
            .lock()
            .ok()
            .and_then(|mut runs| runs.remove(loop_id));
        if let Some(run) = run {
            let _ = run.cancel.send(true);
            self.emit_event(
                &format!("looper-cancel-{}", loop_id),
                "pi.agent.cancelled",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": loop_id,
                    "phase": run.phase,
                    "runId": run.id,
                }),
            );
        }
    }

    fn cancel_all_active_runs(&self) {
        let runs = self
            .active_runs
            .lock()
            .map(|mut runs| runs.drain().map(|(_, run)| run).collect::<Vec<_>>())
            .unwrap_or_default();
        for run in runs {
            let _ = run.cancel.send(true);
        }
    }

    fn fail_rpc_phase(
        &self,
        loop_id: &str,
        phase: &str,
        run_id: &str,
        correlation_id: &str,
        error: &str,
    ) {
        {
            let Ok(mut loops) = self.loops.write() else {
                return;
            };
            let Some(loopy) = loops.get_mut(loop_id) else {
                return;
            };
            loopy.status = LooperLoopStatus::Failed;
            loopy.completed_at_ms = Some(now_ms());
            if let Some(phase_state) = loopy.phases.get_mut(phase) {
                phase_state.status = LooperPhaseStatus::Error;
                for substep in &mut phase_state.substeps {
                    if substep.status == "running" {
                        substep.status = "error".to_string();
                    }
                }
            }
        }
        self.emit_event(
            correlation_id,
            "looper.phase.error",
            EventStage::Error,
            EventSeverity::Error,
            json!({
                "loopId": loop_id,
                "phase": phase,
                "runId": run_id,
                "error": error,
                "runtime": "pi-rpc",
            }),
        );
        self.emit_event(
            correlation_id,
            "looper.loop.failed",
            EventStage::Error,
            EventSeverity::Error,
            json!({
                "loopId": loop_id,
                "phase": phase,
                "reason": "pi_rpc_failed",
                "error": error,
            }),
        );
        self.save_to_disk();
    }

    /// Advances from the current phase to the next one.
    /// Returns the new session_id and phase name.
    async fn do_advance(
        &self,
        loop_id: &str,
        next_phase: &str,
        correlation_id: &str,
    ) -> Result<(Option<String>, String), String> {
        // Mark current phase as complete and get current_phase before mutating
        let current_phase: String;
        {
            let mut loops = self.loops.write().map_err(|e| e.to_string())?;
            let loopy = loops
                .get_mut(loop_id)
                .ok_or_else(|| format!("loop not found: {}", loop_id))?;

            // Capture current_phase before we modify state
            current_phase = loopy.active_phase.clone().unwrap_or_default();

            // Mark previous phase complete
            if let Some(ref prev) = loopy.active_phase {
                if let Some(p) = loopy.phases.get_mut(prev) {
                    p.status = LooperPhaseStatus::Complete;
                    // Mark all running substeps complete
                    for s in &mut p.substeps {
                        if s.status == "running" {
                            s.status = "complete".to_string();
                        }
                    }
                }
            }

            // Set new phase
            loopy.active_phase = Some(next_phase.to_string());
            if let Some(p) = loopy.phases.get_mut(next_phase) {
                p.status = LooperPhaseStatus::Running;
                if !p.substeps.is_empty() {
                    p.substeps[0].status = "running".to_string();
                }
            } else {
                return Err(format!("phase not found: {}", next_phase));
            }
        };

        // Close the previous phase session
        // (session cleanup is handled by terminal service)

        // Start the new phase
        self.start_phase(loop_id, next_phase, correlation_id)
            .await?;

        // Return the new session info
        let new_session_id = {
            let loops = self.loops.read().map_err(|e| e.to_string())?;
            loops
                .get(loop_id)
                .and_then(|l| l.phases.get(next_phase))
                .and_then(|p| p.session_id.clone())
        };

        // Emit phase transition event
        self.emit_event(
            correlation_id,
            "looper.phase.transition",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "phase": next_phase,
                "fromPhase": current_phase,
                "toPhase": next_phase,
                "sessionId": new_session_id,
            }),
        );

        Ok((new_session_id, next_phase.to_string()))
    }

    /// Handles a terminal exit event.
    /// This is called by the terminal event handler when a looper phase session exits.
    /// It automatically advances to the next phase.
    pub async fn on_terminal_exit(&self, session_id: &str, _exit_code: i32) {
        if self.handle_preview_exit(session_id) {
            self.save_to_disk();
            return;
        }
        // First find the loop and phase that match this session
        let (loop_id, phase) = match self.find_loop_by_session(session_id) {
            Some(pair) => pair,
            None => return,
        };

        {
            let mut loops = self.loops.write().expect("loops lock poisoned");
            if let Some(loopy) = loops.get_mut(&loop_id) {
                if let Some(phase_state) = loopy.phases.get_mut(&phase) {
                    phase_state.session_id = None;
                }
            }
        }
        let _ = self.terminal.close_session(TerminalCloseSessionRequest {
            session_id: session_id.to_string(),
            correlation_id: format!("looper-exit-{}", session_id),
        });

        self.complete_phase_flow(&loop_id, &phase, session_id).await;
    }

    async fn complete_phase_flow(&self, loop_id: &str, phase: &str, run_id: &str) {
        let iteration = {
            let mut loops = self.loops.write().expect("loops lock poisoned");
            let Some(loopy) = loops.get_mut(loop_id) else {
                return;
            };
            if loopy.status != LooperLoopStatus::Running
                || loopy.active_phase.as_deref() != Some(phase)
            {
                return;
            }
            if let Some(phase_state) = loopy.phases.get_mut(phase) {
                phase_state.status = LooperPhaseStatus::Complete;
                for substep in &mut phase_state.substeps {
                    if substep.status == "running" {
                        substep.status = "complete".to_string();
                    }
                }
            }
            loopy.iteration
        };

        self.emit_event(
            &format!("looper-auto-{}", loop_id),
            "looper.phase.complete",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "iteration": iteration,
                "phase": phase,
                "runId": run_id,
            }),
        );

        if phase == "planner" {
            let (cwd, review_before_execute) = {
                let loops = self.loops.read().expect("loops lock poisoned");
                loops
                    .get(loop_id)
                    .map(|l| (l.cwd.clone(), l.review_before_execute))
                    .unwrap_or_else(|| (String::new(), true))
            };
            if !review_before_execute {
                // Autonomous mode skips the planner review gate and proceeds directly.
            } else {
                let (planner_plan, pending_questions) = read_planner_review_files(&cwd);
                {
                    let mut loops = self.loops.write().expect("loops lock poisoned");
                    if let Some(loopy) = loops.get_mut(loop_id) {
                        loopy.status = LooperLoopStatus::Blocked;
                        loopy.active_phase = Some("planner".to_string());
                        loopy.planner_plan = planner_plan.clone();
                        loopy.pending_questions = pending_questions.clone();
                        if let Some(phase_state) = loopy.phases.get_mut("planner") {
                            phase_state.status = LooperPhaseStatus::Blocked;
                        }
                    }
                }

                self.emit_event(
                    &format!("looper-auto-{}", loop_id),
                    "looper.planner.review_ready",
                    EventStage::Complete,
                    EventSeverity::Info,
                    json!({
                        "loopId": loop_id,
                        "iteration": iteration,
                        "phase": "planner",
                        "questionsCount": pending_questions.len(),
                        "hasPlan": !planner_plan.trim().is_empty(),
                    }),
                );
                self.save_to_disk();
                return;
            }
        }

        // Determine the next phase
        let next_phase = match phase {
            "planner" => Some("executor"),
            "executor" => Some("validator"),
            "validator" => Some("critic"),
            "critic" => None, // Loop completes
            _ => return,
        };

        let correlation_id = format!("looper-auto-{}", loop_id);

        if let Some(next) = next_phase {
            // Advance to next phase
            if let Err(e) = self.do_advance(&loop_id, next, &correlation_id).await {
                eprintln!("looper: advance failed: {}", e);
            } else {
                self.save_to_disk();
            }
        } else {
            let review_result = self.read_review_result(&loop_id);
            match self.apply_critic_decision(&loop_id, &correlation_id, review_result) {
                CriticDecision::Ship | CriticDecision::FailMaxIterations => {
                    self.save_to_disk();
                }
                CriticDecision::Revise => {
                    if let Err(e) = self.start_phase(&loop_id, "planner", &correlation_id).await {
                        eprintln!("looper: failed to start planner for new iteration: {}", e);
                    } else {
                        self.save_to_disk();
                    }
                }
            }
        }
    }

    #[cfg(feature = "tauri-runtime")]
    fn on_terminal_output(&self, session_id: &str, chunk: &str) {
        let Some(url) = detect_preview_url(chunk) else {
            return;
        };
        let mut changed = false;
        {
            let mut loops = self.loops.write().expect("loops lock poisoned");
            for loopy in loops.values_mut() {
                let Some(preview) = loopy.preview.as_mut() else {
                    continue;
                };
                if preview.session_id.as_deref() == Some(session_id) {
                    preview.url = Some(url.clone());
                    preview.status = "running".to_string();
                    preview.last_error = None;
                    changed = true;
                    break;
                }
            }
        }
        if changed {
            self.save_to_disk();
        }
    }

    fn handle_preview_exit(&self, session_id: &str) -> bool {
        let mut handled = false;
        {
            let mut loops = self.loops.write().expect("loops lock poisoned");
            for loopy in loops.values_mut() {
                let Some(preview) = loopy.preview.as_mut() else {
                    continue;
                };
                if preview.session_id.as_deref() == Some(session_id) {
                    preview.session_id = None;
                    if preview.url.is_some() {
                        preview.status = "stopped".to_string();
                    } else {
                        preview.status = "failed".to_string();
                        if preview.last_error.is_none() {
                            preview.last_error = Some(
                                "Preview process exited before a URL was detected.".to_string(),
                            );
                        }
                    }
                    handled = true;
                    break;
                }
            }
        }
        handled
    }

    pub fn preview_url(&self, loop_id: &str) -> Option<String> {
        let loops = self.loops.read().ok()?;
        loops
            .get(loop_id)
            .and_then(|l| l.preview.as_ref())
            .and_then(|p| p.url.clone())
    }

    /// Helper: finds a loop by its phase session ID.
    fn find_loop_by_session(&self, session_id: &str) -> Option<(String, String)> {
        let loops = self.loops.read().expect("loops lock poisoned");
        for (id, loopy) in loops.iter() {
            for (phase_name, phase_state) in &loopy.phases {
                if phase_state.session_id.as_deref() == Some(session_id) {
                    // Check if this loop is running
                    if loopy.status != LooperLoopStatus::Running {
                        return None;
                    }
                    return Some((id.clone(), phase_name.clone()));
                }
            }
        }
        None
    }

    fn emit_event(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        let event = self.hub.make_event(
            correlation_id,
            Subsystem::Tool,
            action,
            stage,
            severity,
            payload,
        );
        self.hub.emit(event);
    }

    fn read_review_result(&self, loop_id: &str) -> Option<String> {
        let loops = self.loops.read().expect("loops lock poisoned");
        let loopy = loops.get(loop_id)?;
        let review_path = Path::new(&loopy.cwd).join("review_result.txt");
        let content = fs::read_to_string(&review_path).unwrap_or_default();
        Some(content.trim().to_uppercase())
    }

    fn apply_critic_decision(
        &self,
        loop_id: &str,
        correlation_id: &str,
        review_result: Option<String>,
    ) -> CriticDecision {
        let should_ship = review_result
            .as_deref()
            .map(|content| content.contains("SHIP") && !content.contains("REVISE"))
            .unwrap_or(false);

        if should_ship {
            let loop_record = {
                let mut loops = self.loops.write().expect("loops lock poisoned");
                let Some(l) = loops.get_mut(loop_id) else {
                    return CriticDecision::Ship;
                };
                l.status = LooperLoopStatus::Completed;
                l.completed_at_ms = Some(now_ms());
                l.review_result = review_result.clone();
                l.to_record()
            };

            if !loop_record.cwd.is_empty() {
                self.auto_git_commit(loop_id, loop_record.iteration, &loop_record.cwd);
            }

            self.emit_event(
                correlation_id,
                "looper.loop.complete",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": loop_id,
                    "iteration": loop_record.iteration,
                    "status": "completed",
                    "reviewResult": loop_record.review_result,
                }),
            );
            return CriticDecision::Ship;
        }

        let (current_iteration, new_iteration, max_iterations) = {
            let loops = self.loops.read().expect("loops lock poisoned");
            let Some(l) = loops.get(loop_id) else {
                return CriticDecision::Revise;
            };
            (l.iteration, l.iteration + 1, l.max_iterations)
        };

        if new_iteration > max_iterations {
            let mut loops = self.loops.write().expect("loops lock poisoned");
            if let Some(l) = loops.get_mut(loop_id) {
                l.status = LooperLoopStatus::Failed;
                l.completed_at_ms = Some(now_ms());
                l.review_result = review_result.clone();
            }
            drop(loops);
            self.emit_event(
                correlation_id,
                "looper.loop.failed",
                EventStage::Complete,
                EventSeverity::Error,
                json!({
                    "loopId": loop_id,
                    "iteration": current_iteration,
                    "status": "failed",
                    "reason": "max_iterations_exceeded",
                    "reviewResult": review_result,
                }),
            );
            return CriticDecision::FailMaxIterations;
        }

        let mut loops = self.loops.write().expect("loops lock poisoned");
        if let Some(l) = loops.get_mut(loop_id) {
            l.iteration = new_iteration;
            l.status = LooperLoopStatus::Running;
            l.completed_at_ms = None;
            l.review_result = review_result.clone();
            l.active_phase = Some("planner".to_string());
            for phase in l.phases.values_mut() {
                phase.status = LooperPhaseStatus::Idle;
                phase.session_id = None;
                for substep in phase.substeps.iter_mut() {
                    substep.status = "pending".to_string();
                }
            }
        }
        drop(loops);

        self.emit_event(
            correlation_id,
            "looper.loop.revise",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "previousIteration": new_iteration - 1,
                "newIteration": new_iteration,
                "reason": "critic_requested_revision",
            }),
        );
        CriticDecision::Revise
    }

    fn auto_git_commit(&self, loop_id: &str, iteration: i32, cwd: &str) {
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(cwd)
            .output();

        if let Ok(output) = status {
            let has_changes = !output.stdout.is_empty();
            if has_changes {
                let commit_msg = format!("looper: iteration {} - auto-commit", iteration);
                let add_result = Command::new("git")
                    .args(["add", "-A"])
                    .current_dir(cwd)
                    .output();

                if add_result.is_ok() {
                    let _ = Command::new("git")
                        .args(["commit", "-m", &commit_msg])
                        .current_dir(cwd)
                        .output();
                    println!(
                        "looper [{}]: auto-committed iteration {}",
                        loop_id, iteration
                    );
                }
            }
        }
    }

    async fn prepare_planner_web_research(
        &self,
        correlation_id: &str,
        loop_id: &str,
        loop_type: &LooperLoopType,
        cwd: &str,
        project_name: &str,
        project_type: &str,
        project_description: &str,
    ) -> Option<String> {
        if cwd.trim().is_empty() {
            return None;
        }

        let queries = build_planner_research_queries(
            loop_type,
            project_name,
            project_type,
            project_description,
        );
        if queries.is_empty() {
            return None;
        }

        let mut sections = Vec::new();
        for query in queries {
            match self
                .web_search
                .search(ServiceWebSearchRequest {
                    query: query.clone(),
                    mode: None,
                    num: Some(5),
                    page: Some(1),
                })
                .await
            {
                Ok(result) => sections.push(format_web_research_section(&query, &result)),
                Err(error) => {
                    self.emit_event(
                        correlation_id,
                        "looper.planner.research_unavailable",
                        EventStage::Complete,
                        EventSeverity::Warn,
                        json!({
                            "loopId": loop_id,
                            "query": query,
                            "error": error,
                        }),
                    );
                    continue;
                }
            }
        }

        if sections.is_empty() {
            return None;
        }

        let content = format!("# Looper Web Research\n\n{}\n", sections.join("\n\n"));
        let research_path = Path::new(cwd).join("looper_web_research.md");
        if fs::write(&research_path, content).is_err() {
            return None;
        }

        self.emit_event(
            correlation_id,
            "looper.planner.research_ready",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "loopId": loop_id,
                "path": research_path.to_string_lossy(),
            }),
        );

        Some(
            "Read looper_web_research.md if it exists and use it as supplementary research context. If it is missing or incomplete, continue planning with local context only.".to_string(),
        )
    }
}

impl LooperLoop {
    fn from_record(record: LooperLoopRecord) -> Self {
        let restored_status = match record.status {
            LooperLoopStatus::Running => LooperLoopStatus::Paused,
            other => other,
        };

        let mut phases = HashMap::new();
        for (name, phase) in record.phases {
            let mut status = phase.status;
            if record.active_phase.as_deref() == Some(name.as_str())
                && matches!(
                    restored_status,
                    LooperLoopStatus::Paused | LooperLoopStatus::Blocked
                )
            {
                status = LooperPhaseStatus::Blocked;
            }
            phases.insert(
                name.clone(),
                PhaseState {
                    phase: phase.phase,
                    status,
                    session_id: None,
                    substeps: phase
                        .substeps
                        .into_iter()
                        .map(|step| SubStepState {
                            id: step.id,
                            label: step.label,
                            status: step.status,
                        })
                        .collect(),
                    prompt: phase.prompt,
                },
            );
        }

        Self {
            id: record.id,
            iteration: record.iteration,
            loop_type: record.loop_type,
            status: restored_status,
            active_phase: record.active_phase,
            started_at_ms: record.started_at_ms,
            completed_at_ms: record.completed_at_ms,
            phases,
            review_result: record.review_result,
            cwd: record.cwd,
            task_path: record.task_path,
            specs_glob: record.specs_glob,
            max_iterations: record.max_iterations,
            phase_models: record.phase_models,
            project_name: record.project_name,
            project_type: record.project_type,
            project_icon: record.project_icon,
            project_description: record.project_description,
            review_before_execute: record.review_before_execute,
            planner_plan: record.planner_plan,
            pending_questions: record.pending_questions,
            questions_answered: Vec::new(),
            preview: record.preview.map(preview_from_record),
        }
    }

    fn to_record(&self) -> LooperLoopRecord {
        let mut phases_map = std::collections::HashMap::new();
        for (name, phase) in &self.phases {
            let substeps = phase
                .substeps
                .iter()
                .map(|s| LooperSubStepStatus {
                    id: s.id.clone(),
                    label: s.label.clone(),
                    status: s.status.clone(),
                })
                .collect();

            phases_map.insert(
                name.clone(),
                LooperPhaseState {
                    phase: phase.phase.clone(),
                    status: phase.status.clone(),
                    session_id: phase.session_id.clone(),
                    substeps,
                    prompt: phase.prompt.clone(),
                },
            );
        }

        LooperLoopRecord {
            id: self.id.clone(),
            iteration: self.iteration,
            loop_type: self.loop_type.clone(),
            status: self.status.clone(),
            active_phase: self.active_phase.clone(),
            started_at_ms: self.started_at_ms,
            completed_at_ms: self.completed_at_ms,
            phases: phases_map,
            review_result: self.review_result.clone(),
            cwd: self.cwd.clone(),
            task_path: self.task_path.clone(),
            specs_glob: self.specs_glob.clone(),
            max_iterations: self.max_iterations,
            phase_models: self.phase_models.clone(),
            project_name: self.project_name.clone(),
            project_type: self.project_type.clone(),
            project_icon: self.project_icon.clone(),
            project_description: self.project_description.clone(),
            review_before_execute: self.review_before_execute,
            planner_plan: self.planner_plan.clone(),
            pending_questions: self.pending_questions.clone(),
            preview: self.preview.as_ref().map(preview_to_record),
        }
    }
}

fn preview_from_record(record: LooperPreviewStateRecord) -> PreviewState {
    PreviewState {
        status: record.status,
        command: record.command,
        url: record.url,
        session_id: record.session_id,
        last_error: record.last_error,
        last_started_at_ms: record.last_started_at_ms,
    }
}

fn preview_to_record(preview: &PreviewState) -> LooperPreviewStateRecord {
    LooperPreviewStateRecord {
        status: preview.status.clone(),
        command: preview.command.clone(),
        url: preview.url.clone(),
        session_id: preview.session_id.clone(),
        last_error: preview.last_error.clone(),
        last_started_at_ms: preview.last_started_at_ms,
    }
}

fn preview_response(
    correlation_id: String,
    loop_id: String,
    preview: &PreviewState,
) -> LooperPreviewResponse {
    LooperPreviewResponse {
        correlation_id,
        loop_id,
        status: preview.status.clone(),
        command: preview.command.clone(),
        url: preview.url.clone(),
        session_id: preview.session_id.clone(),
        last_error: preview.last_error.clone(),
    }
}

fn read_planner_review_files(cwd: &str) -> (String, Vec<LooperQuestion>) {
    if cwd.trim().is_empty() {
        return (String::new(), Vec::new());
    }
    let plan =
        fs::read_to_string(Path::new(cwd).join("implementation_plan.md")).unwrap_or_default();
    let questions = fs::read_to_string(Path::new(cwd).join("questions.md"))
        .map(|content| parse_looper_questions(&content))
        .unwrap_or_default();
    (plan, questions)
}

fn build_planner_research_queries(
    loop_type: &LooperLoopType,
    project_name: &str,
    project_type: &str,
    project_description: &str,
) -> Vec<String> {
    let mut queries = Vec::new();
    let scope = if project_name.trim().is_empty() {
        project_type.trim().to_string()
    } else {
        format!("{} {}", project_name.trim(), project_type.trim())
    };

    if !scope.trim().is_empty() {
        let topic = match loop_type {
            LooperLoopType::Prd => "best practices competitor analysis examples",
            LooperLoopType::Build => "architecture implementation best practices",
        };
        queries.push(format!("{} {}", scope.trim(), topic));
    }

    let description = project_description.trim();
    if !description.is_empty() {
        let compact = description
            .split_whitespace()
            .take(24)
            .collect::<Vec<_>>()
            .join(" ");
        if !compact.is_empty() {
            queries.push(compact);
        }
    }

    queries.truncate(2);
    queries
}

fn format_web_research_section(query: &str, result: &WebSearchResult) -> String {
    let mut lines = vec![format!("## Query: {}", query)];
    let items = if result.items.is_empty() {
        &result.organic
    } else {
        &result.items
    };
    for item in items.iter().take(5) {
        let title = item
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Untitled");
        let link = item
            .get("link")
            .or_else(|| item.get("url"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let snippet = item
            .get("snippet")
            .or_else(|| item.get("description"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        lines.push(format!("- {}", title));
        if !link.is_empty() {
            lines.push(format!("  URL: {}", link));
        }
        if !snippet.is_empty() {
            lines.push(format!("  Notes: {}", snippet));
        }
    }
    lines.join("\n")
}

fn infer_preview_command(cwd: &str) -> String {
    let root = Path::new(cwd);
    if root.join("package.json").exists() {
        return "npm run dev".to_string();
    }
    if root.join("Cargo.toml").exists() && root.join("src-tauri").exists() {
        return "cargo tauri dev".to_string();
    }
    "npm run dev".to_string()
}

#[cfg(feature = "tauri-runtime")]
fn detect_preview_url(chunk: &str) -> Option<String> {
    for token in chunk.split_whitespace() {
        let trimmed =
            token.trim_matches(|ch: char| matches!(ch, '\'' | '"' | '(' | ')' | '[' | ']' | ','));
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Some(trimmed.trim_end_matches('/').to_string());
        }
    }
    None
}

fn parse_looper_questions(content: &str) -> Vec<LooperQuestion> {
    let mut questions = Vec::new();
    let mut current: Option<LooperQuestion> = None;
    let mut current_option: Option<crate::contracts::LooperQuestionOption> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(rest) = line.strip_prefix("## Question ") {
            if let Some(option) = current_option.take() {
                if let Some(question) = current.as_mut() {
                    question.options.push(option);
                }
            }
            if let Some(question) = current.take() {
                questions.push(question);
            }
            let title = rest
                .split_once(':')
                .map(|(_, value)| value.trim())
                .unwrap_or(rest)
                .trim_matches('[')
                .trim_matches(']')
                .trim()
                .to_string();
            current = Some(LooperQuestion {
                id: format!("question-{}", questions.len() + 1),
                title,
                prompt: String::new(),
                options: Vec::new(),
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("**Question**:") {
            if let Some(question) = current.as_mut() {
                question.prompt = rest.trim().to_string();
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("### Option ") {
            if let Some(option) = current_option.take() {
                if let Some(question) = current.as_mut() {
                    question.options.push(option);
                }
            }
            current_option = Some(crate::contracts::LooperQuestionOption {
                id: format!(
                    "option-{}-{}",
                    questions.len() + 1,
                    current.as_ref().map(|q| q.options.len() + 1).unwrap_or(1)
                ),
                label: rest
                    .split_once(':')
                    .map(|(_, value)| value.trim())
                    .unwrap_or(rest)
                    .trim_matches('[')
                    .trim_matches(']')
                    .trim()
                    .to_string(),
                summary: None,
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("- **Summary**:") {
            if let Some(option) = current_option.as_mut() {
                option.summary = Some(rest.trim().to_string());
            }
        }
    }

    if let Some(option) = current_option {
        if let Some(question) = current.as_mut() {
            question.options.push(option);
        }
    }
    if let Some(question) = current {
        questions.push(question);
    }

    questions
}

pub fn build_project_context(
    name: &str,
    project_type: &str,
    icon: &str,
    description: &str,
) -> String {
    let mut parts = Vec::new();
    if !name.is_empty() {
        parts.push(format!("Project: {}", name));
    }
    parts.push(format!("Type: {}", project_type));
    if project_type == "app-tool" && !icon.is_empty() {
        parts.push(format!("Icon: {}", icon));
    }
    if !description.is_empty() {
        parts.push(format!("\n{}", description));
    }
    parts.join("\n")
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn safe_pi_error(error: &PiRpcError) -> String {
    let message = match error {
        PiRpcError::UnexpectedExit { status, .. } => {
            format!("Pi RPC exited unexpectedly ({status})")
        }
        PiRpcError::RecordTooLarge { limit } => {
            format!("Pi RPC output exceeded the {limit}-byte record limit")
        }
        PiRpcError::Cancelled => "Pi RPC run was cancelled".to_string(),
        _ => error.to_string(),
    };
    truncate_utf8(&message, 500).to_string()
}

fn pi_executable() -> String {
    std::env::var("ARXELL_PI_EXECUTABLE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "pi".to_string())
}

fn probe_pi_version() -> Option<String> {
    let executable = pi_executable();

    #[cfg(target_os = "windows")]
    let output = if executable.contains('\\') || executable.contains('/') {
        std::process::Command::new(&executable)
            .arg("--version")
            .output()
            .ok()?
    } else {
        std::process::Command::new("cmd")
            .args(["/C", executable.as_str(), "--version"])
            .output()
            .ok()?
    };

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new(&executable)
        .arg("--version")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

#[cfg(feature = "tauri-runtime")]
fn extract_session_id(payload: &serde_json::Value) -> Option<String> {
    if let Some(obj) = payload.as_object() {
        if let Some(session_id) = obj.get("sessionId") {
            return session_id.as_str().map(String::from);
        }
    }
    None
}

fn sanitize_tool_id(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        let next = if ch.is_ascii_alphanumeric() { ch } else { '-' };
        if next == '-' {
            if last_dash {
                continue;
            }
            last_dash = true;
        } else {
            last_dash = false;
        }
        out.push(next);
        if out.len() >= 40 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api_registry::ApiRegistryService;
    use crate::app::terminal_service::TerminalService;
    use crate::app::web_search_service::WebSearchService;
    use std::sync::Arc;

    fn sample_handler() -> LooperHandler {
        let hub = EventHub::new();
        let api_registry = Arc::new(ApiRegistryService::new());
        LooperHandler::new(
            hub.clone(),
            Arc::new(TerminalService::new(hub)),
            Arc::new(WorkspaceToolsService::new()),
            Arc::new(WebSearchService::new(Arc::clone(&api_registry))),
            api_registry,
        )
    }

    fn sample_loop() -> LooperLoop {
        let mut phases = HashMap::new();
        phases.insert(
            "planner".to_string(),
            PhaseState {
                phase: "planner".to_string(),
                status: LooperPhaseStatus::Running,
                session_id: Some("term-1".to_string()),
                substeps: vec![SubStepState {
                    id: "p-1".to_string(),
                    label: "Read task".to_string(),
                    status: "running".to_string(),
                }],
                prompt: "planner prompt".to_string(),
            },
        );
        phases.insert(
            "executor".to_string(),
            PhaseState {
                phase: "executor".to_string(),
                status: LooperPhaseStatus::Idle,
                session_id: Some("term-2".to_string()),
                substeps: vec![],
                prompt: "executor prompt".to_string(),
            },
        );
        phases.insert(
            "validator".to_string(),
            PhaseState {
                phase: "validator".to_string(),
                status: LooperPhaseStatus::Idle,
                session_id: Some("term-3".to_string()),
                substeps: vec![],
                prompt: "validator prompt".to_string(),
            },
        );
        phases.insert(
            "critic".to_string(),
            PhaseState {
                phase: "critic".to_string(),
                status: LooperPhaseStatus::Idle,
                session_id: Some("term-4".to_string()),
                substeps: vec![],
                prompt: "critic prompt".to_string(),
            },
        );

        LooperLoop {
            id: "loop-1".to_string(),
            iteration: 2,
            loop_type: LooperLoopType::Build,
            status: LooperLoopStatus::Running,
            active_phase: Some("planner".to_string()),
            started_at_ms: 10,
            completed_at_ms: None,
            phases,
            review_result: None,
            cwd: "/workspace".to_string(),
            task_path: "task.md".to_string(),
            specs_glob: "specs/*.md".to_string(),
            max_iterations: 8,
            phase_models: HashMap::from([("planner".to_string(), "gpt-5".to_string())]),
            project_name: "Looper Test".to_string(),
            project_type: "app-tool".to_string(),
            project_icon: "wrench".to_string(),
            project_description: "test project".to_string(),
            review_before_execute: true,
            planner_plan: String::new(),
            pending_questions: vec![],
            questions_answered: vec![],
            preview: None,
        }
    }

    #[test]
    fn to_record_preserves_launch_fields() {
        let loopy = sample_loop();
        let record = loopy.to_record();

        assert_eq!(record.cwd, "/workspace");
        assert_eq!(record.task_path, "task.md");
        assert_eq!(record.specs_glob, "specs/*.md");
        assert_eq!(record.max_iterations, 8);
        assert_eq!(
            record.phase_models.get("planner"),
            Some(&"gpt-5".to_string())
        );
        assert_eq!(record.project_name, "Looper Test");
        assert_eq!(record.project_icon, "wrench");
    }

    #[test]
    fn from_record_restores_running_loops_as_paused_without_live_sessions() {
        let record = sample_loop().to_record();
        let restored = LooperLoop::from_record(record);

        assert_eq!(restored.status, LooperLoopStatus::Paused);
        assert_eq!(restored.active_phase.as_deref(), Some("planner"));
        assert_eq!(
            restored.phases["planner"].status,
            LooperPhaseStatus::Blocked
        );
        assert_eq!(restored.phases["planner"].session_id, None);
        assert_eq!(restored.cwd, "/workspace");
        assert_eq!(restored.task_path, "task.md");
        assert_eq!(restored.specs_glob, "specs/*.md");
    }

    #[test]
    fn apply_critic_decision_ship_completes_loop() {
        let handler = sample_handler();
        let mut loopy = sample_loop();
        loopy.cwd = std::env::temp_dir()
            .join("arxell-looper-ship-test")
            .display()
            .to_string();
        loopy.active_phase = Some("critic".to_string());
        loopy.phases.get_mut("critic").unwrap().status = LooperPhaseStatus::Running;
        handler
            .loops
            .write()
            .unwrap()
            .insert(loopy.id.clone(), loopy);

        let decision =
            handler.apply_critic_decision("loop-1", "corr-ship", Some("SHIP".to_string()));

        let loops = handler.loops.read().unwrap();
        let loopy = loops.get("loop-1").unwrap();
        assert_eq!(decision, CriticDecision::Ship);
        assert_eq!(loopy.status, LooperLoopStatus::Completed);
        assert!(loopy.completed_at_ms.is_some());
        assert_eq!(loopy.review_result.as_deref(), Some("SHIP"));
    }

    #[test]
    fn apply_critic_decision_revise_starts_clean_next_iteration_state() {
        let handler = sample_handler();
        let mut loopy = sample_loop();
        loopy.active_phase = Some("critic".to_string());
        loopy.phases.get_mut("planner").unwrap().status = LooperPhaseStatus::Complete;
        loopy.phases.get_mut("executor").unwrap().status = LooperPhaseStatus::Complete;
        loopy.phases.get_mut("validator").unwrap().status = LooperPhaseStatus::Complete;
        loopy.phases.get_mut("critic").unwrap().status = LooperPhaseStatus::Running;
        handler
            .loops
            .write()
            .unwrap()
            .insert(loopy.id.clone(), loopy);

        let decision =
            handler.apply_critic_decision("loop-1", "corr-revise", Some("REVISE".to_string()));

        let loops = handler.loops.read().unwrap();
        let loopy = loops.get("loop-1").unwrap();
        assert_eq!(decision, CriticDecision::Revise);
        assert_eq!(loopy.iteration, 3);
        assert_eq!(loopy.status, LooperLoopStatus::Running);
        assert_eq!(loopy.active_phase.as_deref(), Some("planner"));
        for phase in loopy.phases.values() {
            assert_eq!(phase.status, LooperPhaseStatus::Idle);
            assert_eq!(phase.session_id, None);
            assert!(phase.substeps.iter().all(|step| step.status == "pending"));
        }
    }

    #[tokio::test]
    async fn pi_rpc_settlement_advances_all_looper_phases_without_terminals() {
        if Command::new("node")
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_none()
        {
            return;
        }

        let root = std::env::temp_dir().join(format!("arxell-looper-rpc-{}", now_ms()));
        fs::create_dir_all(&root).unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("fake_pi_rpc.js");
        let wrapper = root.join(if cfg!(target_os = "windows") {
            "fake-pi.cmd"
        } else {
            "fake-pi.sh"
        });
        let script = if cfg!(target_os = "windows") {
            format!("@node \"{}\" %*\r\n", fixture.display())
        } else {
            format!("#!/bin/sh\nexec node \"{}\" \"$@\"\n", fixture.display())
        };
        fs::write(&wrapper, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&wrapper, permissions).unwrap();
        }

        let handler = sample_handler();
        *handler.pi_executable_override.write().unwrap() = Some(wrapper);
        let mut events = handler.hub.subscribe();
        handler
            .start(LooperStartRequest {
                correlation_id: "rpc-loop-correlation".to_string(),
                loop_id: "rpc-loop".to_string(),
                iteration: 1,
                loop_type: LooperLoopType::Build,
                cwd: root.to_string_lossy().into_owned(),
                task_path: "task.md".to_string(),
                specs_glob: "specs/*.md".to_string(),
                max_iterations: 1,
                phase_models: None,
                phase_prompts: None,
                project_name: "RPC Test".to_string(),
                project_type: "standalone-app".to_string(),
                project_icon: String::new(),
                project_description: "exercise headless phase transitions".to_string(),
                review_before_execute: false,
            })
            .await
            .unwrap();

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let failed = handler
                .loops
                .read()
                .unwrap()
                .get("rpc-loop")
                .map(|loopy| loopy.status == LooperLoopStatus::Failed)
                .unwrap_or(false);
            if failed {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "Looper RPC run timed out"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        let loops = handler.loops.read().unwrap();
        let loopy = loops.get("rpc-loop").unwrap();
        assert_eq!(loopy.active_phase.as_deref(), Some("critic"));
        assert!(loopy
            .phases
            .values()
            .all(|phase| phase.session_id.is_none()));
        assert!(loopy
            .phases
            .values()
            .all(|phase| phase.status == LooperPhaseStatus::Complete));
        drop(loops);

        let mut settled = 0;
        let mut completed = 0;
        while let Ok(event) = events.try_recv() {
            settled += usize::from(event.action == "pi.agent.settled");
            completed += usize::from(event.action == "looper.phase.complete");
        }
        assert_eq!(settled, 4);
        assert_eq!(completed, 4);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn apply_critic_decision_fails_when_revision_exceeds_max_iterations() {
        let handler = sample_handler();
        let mut loopy = sample_loop();
        loopy.iteration = loopy.max_iterations;
        loopy.active_phase = Some("critic".to_string());
        handler
            .loops
            .write()
            .unwrap()
            .insert(loopy.id.clone(), loopy);

        let decision =
            handler.apply_critic_decision("loop-1", "corr-revise-max", Some("REVISE".to_string()));

        let loops = handler.loops.read().unwrap();
        let loopy = loops.get("loop-1").unwrap();
        assert_eq!(decision, CriticDecision::FailMaxIterations);
        assert_eq!(loopy.status, LooperLoopStatus::Failed);
        assert!(loopy.completed_at_ms.is_some());
        assert_eq!(loopy.iteration, loopy.max_iterations);
    }
}
