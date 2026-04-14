use crate::api_registry::ApiRegistryService;
use crate::contracts::{
    ApiConnectionStatus, ApiConnectionType, EventSeverity, EventStage, FlowIterationStatus, FlowListRunsRequest,
    FlowListRunsResponse, FlowMode, FlowNudgeRequest, FlowNudgeResponse, FlowPauseRequest,
    FlowPauseResponse, FlowRerunValidationRequest, FlowRerunValidationResponse,
    FlowRerunValidationResult, FlowRunRecord, FlowRunStatus, FlowStartRequest, FlowStartResponse,
    FlowStatusRequest, FlowStatusResponse, FlowStepState, FlowStepStatus, FlowStopRequest,
    FlowStopResponse, Subsystem,
};
use crate::observability::EventHub;
use git2::{Cred, IndexAddOption, PushOptions, RemoteCallbacks, Repository, Signature};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

const FLOW_PLAN_STEPS: &[&str] = &[
    "orient",
    "read_plan",
    "select_task",
    "investigate",
    "update_plan",
];
const FLOW_BUILD_STEPS: &[&str] = &[
    "orient",
    "read_plan",
    "select_task",
    "investigate",
    "implement",
    "validate",
    "update_plan",
    "commit",
    "push",
];

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowPersistedState {
    runs: Vec<FlowRunRecord>,
}

#[derive(Default)]
struct FlowRuntimeState {
    runs: Vec<FlowRunRecord>,
    active_run_id: Option<String>,
    cancel_senders: HashMap<String, watch::Sender<bool>>,
    paused_run_ids: HashSet<String>,
    nudges_by_run: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct ValidationExecutionResult {
    pub command: String,
    pub ok: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: i64,
}

#[derive(Clone)]
pub struct FlowService {
    hub: EventHub,
    api_registry: Option<Arc<ApiRegistryService>>,
    state: Arc<Mutex<FlowRuntimeState>>,
    persist_path: PathBuf,
}

const FLOW_GIT_NATIVE_V1_ENV: &str = "FLOW_GIT_NATIVE_V1";
const FLOW_LLM_ENABLED_ENV: &str = "FLOW_LLM_ENABLED";

#[derive(Debug, Clone, Serialize)]
struct FlowOpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
struct FlowOpenAiRequest {
    model: String,
    messages: Vec<FlowOpenAiMessage>,
    stream: bool,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

impl FlowService {
    pub fn new(hub: EventHub) -> Self {
        Self::new_with_registry(hub, None)
    }

    pub fn new_with_registry(hub: EventHub, api_registry: Option<Arc<ApiRegistryService>>) -> Self {
        let persist_path = default_persist_path();
        let runs = load_runs(&persist_path);
        let active_run_id = runs
            .iter()
            .find(|run| matches!(run.status, FlowRunStatus::Queued | FlowRunStatus::Running))
            .map(|run| run.run_id.clone());
        Self {
            hub,
            api_registry,
            state: Arc::new(Mutex::new(FlowRuntimeState {
                runs,
                active_run_id,
                cancel_senders: HashMap::new(),
                paused_run_ids: HashSet::new(),
                nudges_by_run: HashMap::new(),
            })),
            persist_path,
        }
    }

    pub fn start(&self, request: FlowStartRequest) -> Result<FlowStartResponse, String> {
        let run_id = format!(
            "flow-{}-{}",
            now_ms(),
            (now_ms() as u64).wrapping_mul(2654435761) % 10000
        );
        let mode = request.mode.clone();
        let max_iterations = request.max_iterations;
        let dry_run = request.dry_run.unwrap_or(true);
        let auto_push = request.auto_push.unwrap_or(false);
        let prompt_plan_path = request
            .prompt_plan_path
            .clone()
            .unwrap_or_else(|| "PROMPT_plan.md".to_string());
        let prompt_build_path = request
            .prompt_build_path
            .clone()
            .unwrap_or_else(|| "PROMPT_build.md".to_string());
        let plan_path = request
            .plan_path
            .clone()
            .unwrap_or_else(|| "IMPLEMENTATION_PLAN.md".to_string());
        let specs_glob = request
            .specs_glob
            .clone()
            .unwrap_or_else(|| "specs/*.md".to_string());
        let backpressure_commands = request.backpressure_commands.clone().unwrap_or_default();
        let implement_command = request.implement_command.clone().unwrap_or_default();
        let phase_models = request.phase_models.clone().unwrap_or_default();

        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        if state
            .runs
            .iter()
            .any(|run| matches!(run.status, FlowRunStatus::Queued | FlowRunStatus::Running))
        {
            return Err("a flow run is already active".to_string());
        }

        let run = FlowRunRecord {
            run_id: run_id.clone(),
            mode: mode.clone(),
            status: FlowRunStatus::Queued,
            max_iterations,
            current_iteration: 0,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            dry_run,
            auto_push,
            prompt_plan_path,
            prompt_build_path,
            plan_path,
            specs_glob,
            backpressure_commands,
            implement_command,
            phase_models,
            summary: None,
            iterations: vec![],
        };

        let (cancel_tx, cancel_rx) = watch::channel(false);
        state.active_run_id = Some(run_id.clone());
        state.cancel_senders.insert(run_id.clone(), cancel_tx);
        state.runs.push(run.clone());
        persist_runs(&self.persist_path, &state.runs);
        drop(state);

        self.hub.emit(self.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Service,
            "flow.run.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "runId": run_id,
                "mode": mode,
                "maxIterations": max_iterations,
                "dryRun": dry_run,
                "autoPush": auto_push
            }),
        ));

        let service = self.clone();
        let correlation_id = request.correlation_id.clone();
        let spawned_run_id = run.run_id.clone();
        tokio::spawn(async move {
            service
                .run_loop(correlation_id, spawned_run_id, cancel_rx)
                .await;
        });

        Ok(FlowStartResponse {
            correlation_id: request.correlation_id,
            run_id: run.run_id,
            status: FlowRunStatus::Queued,
        })
    }

    pub fn stop(&self, request: FlowStopRequest) -> Result<FlowStopResponse, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let mut stopped = false;
        if let Some(tx) = state.cancel_senders.remove(request.run_id.as_str()) {
            let _ = tx.send(true);
            stopped = true;
        }
        if let Some(run) = state.runs.iter_mut().find(|run| {
            run.run_id == request.run_id
                && matches!(run.status, FlowRunStatus::Queued | FlowRunStatus::Running)
        }) {
            run.status = FlowRunStatus::Stopped;
            run.completed_at_ms = Some(now_ms());
            run.summary = Some("Stopped by user".to_string());
            if state.active_run_id.as_deref() == Some(request.run_id.as_str()) {
                state.active_run_id = None;
            }
            persist_runs(&self.persist_path, &state.runs);
        }
        drop(state);

        self.hub.emit(self.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Service,
            if stopped {
                "flow.run.complete"
            } else {
                "flow.run.error"
            },
            if stopped {
                EventStage::Complete
            } else {
                EventStage::Error
            },
            if stopped {
                EventSeverity::Info
            } else {
                EventSeverity::Warn
            },
            json!({
                "runId": request.run_id,
                "stopped": stopped
            }),
        ));

        Ok(FlowStopResponse {
            correlation_id: request.correlation_id,
            run_id: request.run_id,
            stopped,
        })
    }

    pub fn pause(&self, request: FlowPauseRequest) -> Result<FlowPauseResponse, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let exists = state.runs.iter().any(|run| run.run_id == request.run_id);
        if !exists {
            return Err(format!("flow run not found: {}", request.run_id));
        }
        if request.paused {
            state.paused_run_ids.insert(request.run_id.clone());
        } else {
            state.paused_run_ids.remove(request.run_id.as_str());
        }
        drop(state);
        self.hub.emit(self.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Service,
            "flow.run.paused",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "runId": request.run_id,
                "paused": request.paused
            }),
        ));
        Ok(FlowPauseResponse {
            correlation_id: request.correlation_id,
            run_id: request.run_id,
            paused: request.paused,
            updated: true,
        })
    }

    pub fn nudge(&self, request: FlowNudgeRequest) -> Result<FlowNudgeResponse, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let exists = state.runs.iter().any(|run| run.run_id == request.run_id);
        if !exists {
            return Err(format!("flow run not found: {}", request.run_id));
        }
        let item = state
            .nudges_by_run
            .entry(request.run_id.clone())
            .or_insert_with(Vec::new);
        item.push(request.message.clone());
        if item.len() > 20 {
            let overflow = item.len() - 20;
            item.drain(0..overflow);
        }
        drop(state);
        self.hub.emit(self.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Service,
            "flow.run.nudge",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "runId": request.run_id,
                "message": request.message
            }),
        ));
        Ok(FlowNudgeResponse {
            correlation_id: request.correlation_id,
            run_id: request.run_id,
            accepted: true,
        })
    }

    pub fn status(&self, request: FlowStatusRequest) -> Result<FlowStatusResponse, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let run = state
            .runs
            .iter()
            .find(|run| run.run_id == request.run_id)
            .cloned()
            .ok_or_else(|| format!("flow run not found: {}", request.run_id))?;
        Ok(FlowStatusResponse {
            correlation_id: request.correlation_id,
            run,
        })
    }

    pub fn list_runs(&self, request: FlowListRunsRequest) -> Result<FlowListRunsResponse, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let mut runs = state.runs.clone();
        runs.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
        Ok(FlowListRunsResponse {
            correlation_id: request.correlation_id,
            runs,
        })
    }

    pub fn rerun_validation(
        &self,
        request: FlowRerunValidationRequest,
    ) -> Result<FlowRerunValidationResponse, String> {
        let run_snapshot = {
            let state = self
                .state
                .lock()
                .map_err(|_| "flow runtime state lock poisoned".to_string())?;
            state
                .runs
                .iter()
                .find(|run| run.run_id == request.run_id)
                .cloned()
                .ok_or_else(|| format!("flow run not found: {}", request.run_id))?
        };
        if run_snapshot.dry_run {
            return Err("validation rerun is disabled for dry-run executions".to_string());
        }
        if run_snapshot.backpressure_commands.is_empty() {
            return Err("no backpressure commands configured for this run".to_string());
        }
        let iteration = request.iteration.or(Some(run_snapshot.current_iteration));
        let mut results = Vec::with_capacity(run_snapshot.backpressure_commands.len());
        for command in &run_snapshot.backpressure_commands {
            let result = execute_validation_command(command)?;
            self.hub.emit(self.hub.make_event(
                request.correlation_id.as_str(),
                Subsystem::Service,
                "flow.step.progress",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "runId": run_snapshot.run_id,
                    "iteration": iteration,
                    "step": "validate",
                    "rerun": true,
                    "command": result.command,
                    "ok": result.ok,
                    "exitCode": result.exit_code,
                    "durationMs": result.duration_ms,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                }),
            ));
            results.push(FlowRerunValidationResult {
                command: result.command,
                ok: result.ok,
                exit_code: result.exit_code,
                stdout: result.stdout,
                stderr: result.stderr,
                duration_ms: result.duration_ms,
            });
        }
        let ok = results.iter().all(|item| item.ok);
        self.hub.emit(self.hub.make_event(
            request.correlation_id.as_str(),
            Subsystem::Service,
            if ok {
                "flow.validation.rerun.complete"
            } else {
                "flow.validation.rerun.error"
            },
            if ok {
                EventStage::Complete
            } else {
                EventStage::Error
            },
            if ok {
                EventSeverity::Info
            } else {
                EventSeverity::Warn
            },
            json!({
                "runId": run_snapshot.run_id,
                "iteration": iteration,
                "ok": ok,
                "results": results,
            }),
        ));
        Ok(FlowRerunValidationResponse {
            correlation_id: request.correlation_id,
            run_id: request.run_id,
            iteration,
            ok,
            results,
        })
    }

    async fn run_loop(
        &self,
        correlation_id: String,
        run_id: String,
        cancel_rx: watch::Receiver<bool>,
    ) {
        let _ = self.set_run_status(run_id.as_str(), FlowRunStatus::Running);
        self.hub.emit(self.hub.make_event(
            correlation_id.as_str(),
            Subsystem::Service,
            "flow.run.progress",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "runId": run_id,
                "status": FlowRunStatus::Running,
            }),
        ));

        let run_snapshot = {
            let state = match self.state.lock() {
                Ok(value) => value,
                Err(_) => return,
            };
            state.runs.iter().find(|run| run.run_id == run_id).cloned()
        };
        let Some(run) = run_snapshot else {
            return;
        };

        let steps = if matches!(run.mode, FlowMode::Plan) {
            FLOW_PLAN_STEPS
        } else {
            FLOW_BUILD_STEPS
        };

        let max_iterations = run.max_iterations.unwrap_or(1).max(1);
        for iteration in 1..=max_iterations {
            if self.wait_if_paused(run_id.as_str(), &cancel_rx).await {
                self.finish_run(
                    correlation_id.as_str(),
                    run_id.as_str(),
                    FlowRunStatus::Stopped,
                    Some("Stopped by user".to_string()),
                );
                return;
            }
            if *cancel_rx.borrow() {
                self.finish_run(
                    correlation_id.as_str(),
                    run_id.as_str(),
                    FlowRunStatus::Stopped,
                    Some("Stopped by user".to_string()),
                );
                return;
            }

            if self
                .start_iteration(correlation_id.as_str(), run_id.as_str(), iteration)
                .is_err()
            {
                return;
            }

            let mut selected_task: Option<String> = None;
            for step in steps {
                if self.wait_if_paused(run_id.as_str(), &cancel_rx).await {
                    self.finish_run(
                        correlation_id.as_str(),
                        run_id.as_str(),
                        FlowRunStatus::Stopped,
                        Some("Stopped by user".to_string()),
                    );
                    return;
                }
                if *cancel_rx.borrow() {
                    self.finish_run(
                        correlation_id.as_str(),
                        run_id.as_str(),
                        FlowRunStatus::Stopped,
                        Some("Stopped by user".to_string()),
                    );
                    return;
                }

                self.emit_step_event(
                    correlation_id.as_str(),
                    run_id.as_str(),
                    iteration,
                    step,
                    EventStage::Start,
                    EventSeverity::Info,
                    json!({
                        "mode": run.mode,
                    }),
                );
                let _ = self.update_step_state(
                    run_id.as_str(),
                    iteration,
                    step,
                    FlowStepState::Running,
                    Some(now_ms()),
                    None,
                    None,
                    None,
                );

                let started = now_ms();
                let step_result = self.execute_step(
                    run_id.as_str(),
                    iteration,
                    step,
                    &run,
                    selected_task.clone(),
                    correlation_id.as_str(),
                );

                match step_result {
                    Ok(result) => {
                        let mut step_result_text = result.clone();
                        if *step == "select_task" {
                            selected_task = result.clone();
                            step_result_text = result
                                .as_ref()
                                .map(|value| format!("Selected task: {value}"));
                        }
                        let completed = now_ms();
                        let _ = self.update_step_state(
                            run_id.as_str(),
                            iteration,
                            step,
                            FlowStepState::Complete,
                            Some(started),
                            Some(completed),
                            step_result_text.clone(),
                            None,
                        );
                        self.emit_step_event(
                            correlation_id.as_str(),
                            run_id.as_str(),
                            iteration,
                            step,
                            EventStage::Complete,
                            EventSeverity::Info,
                            json!({
                                "mode": run.mode,
                                "taskId": selected_task,
                                "durationMs": completed - started,
                                "result": step_result_text,
                            }),
                        );
                    }
                    Err(error) => {
                        let completed = now_ms();
                        let _ = self.update_step_state(
                            run_id.as_str(),
                            iteration,
                            step,
                            FlowStepState::Error,
                            Some(started),
                            Some(completed),
                            None,
                            Some(error.clone()),
                        );
                        self.emit_step_event(
                            correlation_id.as_str(),
                            run_id.as_str(),
                            iteration,
                            step,
                            EventStage::Error,
                            EventSeverity::Error,
                            json!({
                                "mode": run.mode,
                                "taskId": selected_task,
                                "durationMs": completed - started,
                                "error": error,
                            }),
                        );
                        let _ = self.finish_iteration(
                            correlation_id.as_str(),
                            run_id.as_str(),
                            iteration,
                            FlowRunStatus::Failed,
                            selected_task.clone(),
                        );
                        self.finish_run(
                            correlation_id.as_str(),
                            run_id.as_str(),
                            FlowRunStatus::Failed,
                            Some(format!("Step {step} failed")),
                        );
                        return;
                    }
                }
            }

            let _ = self.finish_iteration(
                correlation_id.as_str(),
                run_id.as_str(),
                iteration,
                FlowRunStatus::Succeeded,
                selected_task,
            );
        }

        self.finish_run(
            correlation_id.as_str(),
            run_id.as_str(),
            FlowRunStatus::Succeeded,
            Some("Completed all iterations".to_string()),
        );
    }

    fn execute_step(
        &self,
        _run_id: &str,
        iteration: u32,
        step: &str,
        run: &FlowRunRecord,
        selected_task: Option<String>,
        correlation_id: &str,
    ) -> Result<Option<String>, String> {
        match step {
            "orient" => {
                let specs = collect_spec_files(run.specs_glob.as_str())?;
                let preview = specs
                    .iter()
                    .take(4)
                    .map(|path| path.to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                Ok(Some(if preview.is_empty() {
                    format!("Found {} spec files", specs.len())
                } else {
                    format!("Found {} spec files ({preview})", specs.len())
                }))
            }
            "read_plan" => {
                let path = resolve_workspace_path(run.plan_path.as_str());
                let status = if path.exists() {
                    let (open, done) = count_plan_tasks(path.as_path());
                    format!(
                        "Plan file found at {} (open={}, done={})",
                        path.to_string_lossy(),
                        open,
                        done
                    )
                } else {
                    format!("Plan file not found at {}", path.to_string_lossy())
                };
                Ok(Some(status))
            }
            "select_task" => {
                let plan_path = resolve_workspace_path(run.plan_path.as_str());
                let task = select_next_plan_task(plan_path.as_path())?;
                if !flow_llm_enabled() {
                    return Ok(task);
                }
                if let Some(candidate) =
                    self.llm_select_task(plan_path.as_path(), run, iteration, correlation_id)?
                {
                    return Ok(Some(candidate));
                }
                Ok(task)
            }
            "investigate" => {
                if !flow_llm_enabled() {
                    return Ok(Some("Investigation completed".to_string()));
                }
                let plan_path = resolve_workspace_path(run.plan_path.as_str());
                let specs = collect_spec_files(run.specs_glob.as_str())?;
                let strategy = self.llm_investigate(
                    run,
                    iteration,
                    selected_task.as_deref(),
                    plan_path.as_path(),
                    specs.as_slice(),
                    correlation_id,
                )?;
                Ok(Some(strategy))
            }
            "implement" => {
                if run.dry_run {
                    Ok(Some("Dry run: implementation skipped".to_string()))
                } else {
                    if run.implement_command.trim().is_empty() {
                        return Err(
                            "implement step requires `implementCommand` when dryRun=false"
                                .to_string(),
                        );
                    }
                    let resolved = resolve_implement_command(
                        run.implement_command.as_str(),
                        run.run_id.as_str(),
                        iteration,
                        selected_task.as_deref(),
                    );
                    let output = run_shell_command(resolved.as_str())?;
                    if !output.ok {
                        return Err(format!(
                            "implement command failed (exit {}): {}",
                            output.exit_code, resolved
                        ));
                    }
                    let changed_count = count_changed_files().unwrap_or(0);
                    Ok(Some(format!(
                        "Implement command passed ({}): changedFiles={} stdout={} stderr={}",
                        output.exit_code, changed_count, output.stdout, output.stderr
                    )))
                }
            }
            "validate" => {
                if run.backpressure_commands.is_empty() {
                    self.hub.emit(self.hub.make_event(
                        correlation_id,
                        Subsystem::Service,
                        "flow.guardrail.blocked",
                        EventStage::Error,
                        EventSeverity::Warn,
                        json!({
                            "runId": run.run_id,
                            "iteration": iteration,
                            "step": step,
                            "reason": "no backpressure commands configured"
                        }),
                    ));
                    return Err("backpressure commands are required for build mode".to_string());
                }
                let mut validation_results = Vec::with_capacity(run.backpressure_commands.len());
                for command in &run.backpressure_commands {
                    self.hub.emit(self.hub.make_event(
                        correlation_id,
                        Subsystem::Service,
                        "flow.step.progress",
                        EventStage::Progress,
                        EventSeverity::Info,
                        json!({
                            "runId": run.run_id,
                            "iteration": iteration,
                            "step": step,
                            "command": command,
                            "message": "Executing backpressure command"
                        }),
                    ));
                    if run.dry_run {
                        validation_results.push(ValidationExecutionResult {
                            command: command.clone(),
                            ok: true,
                            exit_code: 0,
                            stdout: String::new(),
                            stderr: String::new(),
                            duration_ms: 0,
                        });
                        continue;
                    }
                    let output = execute_validation_command(command)?;
                    validation_results.push(output.clone());
                    self.hub.emit(self.hub.make_event(
                        correlation_id,
                        Subsystem::Service,
                        "flow.step.progress",
                        EventStage::Progress,
                        EventSeverity::Info,
                        json!({
                            "runId": run.run_id,
                            "iteration": iteration,
                            "step": step,
                            "command": command,
                            "ok": output.ok,
                            "exitCode": output.exit_code,
                            "durationMs": output.duration_ms,
                            "stdout": output.stdout,
                            "stderr": output.stderr,
                        }),
                    ));
                    if !output.ok {
                        return Err(format!(
                            "backpressure command failed (exit {}): {}",
                            output.exit_code, command
                        ));
                    }
                }
                Ok(Some(format!(
                    "Validated {} backpressure command(s): {}",
                    run.backpressure_commands.len(),
                    validation_results
                        .iter()
                        .map(|item| format!(
                            "{}={}({}ms)",
                            item.command,
                            if item.ok { "ok" } else { "fail" },
                            item.duration_ms
                        ))
                        .collect::<Vec<_>>()
                        .join(", ")
                )))
            }
            "update_plan" => {
                if matches!(run.mode, FlowMode::Plan) {
                    let plan_path = resolve_workspace_path(run.plan_path.as_str());
                    if flow_llm_enabled() {
                        let specs = collect_spec_files(run.specs_glob.as_str())?;
                        let generated =
                            self.llm_generate_plan_seed(run, specs.as_slice(), correlation_id)?;
                        std::fs::write(plan_path.as_path(), generated)
                            .map_err(|e| format!("failed writing plan file: {e}"))?;
                    } else if !plan_path.exists() {
                        std::fs::write(
                            plan_path.as_path(),
                            "# Implementation Plan\n\n- [ ] Seed first task from specs\n",
                        )
                        .map_err(|e| format!("failed writing plan file: {e}"))?;
                    }
                    return Ok(Some("Planning mode updated plan artifact".to_string()));
                }
                if run.dry_run {
                    return Ok(Some("Dry run: plan update skipped".to_string()));
                }
                let Some(task) = selected_task else {
                    return Ok(Some("No unfinished task found".to_string()));
                };
                let plan_path = resolve_workspace_path(run.plan_path.as_str());
                let contents = std::fs::read_to_string(plan_path.as_path())
                    .map_err(|e| format!("failed reading plan file: {e}"))?;
                let completed = mark_task_complete(contents.as_str(), task.as_str());
                std::fs::write(plan_path.as_path(), completed)
                    .map_err(|e| format!("failed writing plan file: {e}"))?;
                Ok(Some(format!(
                    "Marked task complete in {}: {}",
                    plan_path.to_string_lossy(),
                    task
                )))
            }
            "commit" => {
                if run.dry_run {
                    Ok(Some("Dry run: commit skipped".to_string()))
                } else if !flow_git_native_enabled() {
                    Ok(Some(
                        "Native git disabled (set FLOW_GIT_NATIVE_V1=1 to enable)".to_string(),
                    ))
                } else {
                    self.emit_git_event(
                        correlation_id,
                        "flow.git.commit.start",
                        EventStage::Start,
                        EventSeverity::Info,
                        run.run_id.as_str(),
                        iteration,
                        json!({ "step": step }),
                    );
                    match perform_native_git_commit(run.run_id.as_str(), iteration) {
                        Ok(summary) => {
                            self.emit_git_event(
                                correlation_id,
                                "flow.git.commit.complete",
                                EventStage::Complete,
                                EventSeverity::Info,
                                run.run_id.as_str(),
                                iteration,
                                json!({ "step": step, "result": summary }),
                            );
                            Ok(Some(summary))
                        }
                        Err(error) => {
                            self.emit_git_event(
                                correlation_id,
                                "flow.git.commit.error",
                                EventStage::Error,
                                EventSeverity::Error,
                                run.run_id.as_str(),
                                iteration,
                                json!({ "step": step, "error": error }),
                            );
                            Err(error)
                        }
                    }
                }
            }
            "push" => {
                if !run.auto_push {
                    Ok(Some("Auto-push disabled".to_string()))
                } else if run.dry_run {
                    Ok(Some("Dry run: push skipped".to_string()))
                } else if !flow_git_native_enabled() {
                    Ok(Some(
                        "Native git disabled (set FLOW_GIT_NATIVE_V1=1 to enable)".to_string(),
                    ))
                } else {
                    self.emit_git_event(
                        correlation_id,
                        "flow.git.push.start",
                        EventStage::Start,
                        EventSeverity::Info,
                        run.run_id.as_str(),
                        iteration,
                        json!({ "step": step }),
                    );
                    match perform_native_git_push() {
                        Ok(summary) => {
                            self.emit_git_event(
                                correlation_id,
                                "flow.git.push.complete",
                                EventStage::Complete,
                                EventSeverity::Info,
                                run.run_id.as_str(),
                                iteration,
                                json!({ "step": step, "result": summary }),
                            );
                            Ok(Some(summary))
                        }
                        Err(error) => {
                            self.emit_git_event(
                                correlation_id,
                                "flow.git.push.error",
                                EventStage::Error,
                                EventSeverity::Error,
                                run.run_id.as_str(),
                                iteration,
                                json!({ "step": step, "error": error }),
                            );
                            Err(error)
                        }
                    }
                }
            }
            _ => Err(format!("unknown flow step: {step}")),
        }
    }

    fn start_iteration(
        &self,
        correlation_id: &str,
        run_id: &str,
        iteration: u32,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let run = state
            .runs
            .iter_mut()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| format!("flow run not found: {run_id}"))?;

        run.current_iteration = iteration;
        run.iterations.push(FlowIterationStatus {
            index: iteration,
            status: FlowRunStatus::Running,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            task_id: None,
            steps: Vec::new(),
        });
        persist_runs(&self.persist_path, &state.runs);
        drop(state);

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "flow.iteration.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "runId": run_id,
                "iteration": iteration
            }),
        ));
        Ok(())
    }

    fn finish_iteration(
        &self,
        correlation_id: &str,
        run_id: &str,
        iteration: u32,
        status: FlowRunStatus,
        task_id: Option<String>,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let run = state
            .runs
            .iter_mut()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| format!("flow run not found: {run_id}"))?;
        let iter = run
            .iterations
            .iter_mut()
            .find(|item| item.index == iteration)
            .ok_or_else(|| format!("flow iteration not found: {iteration}"))?;
        iter.status = status.clone();
        iter.completed_at_ms = Some(now_ms());
        iter.task_id = task_id.clone();
        persist_runs(&self.persist_path, &state.runs);
        drop(state);

        let stage = if matches!(status, FlowRunStatus::Failed) {
            EventStage::Error
        } else {
            EventStage::Complete
        };
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            if matches!(status, FlowRunStatus::Failed) {
                "flow.iteration.error"
            } else {
                "flow.iteration.complete"
            },
            stage,
            if matches!(status, FlowRunStatus::Failed) {
                EventSeverity::Error
            } else {
                EventSeverity::Info
            },
            json!({
                "runId": run_id,
                "iteration": iteration,
                "status": status,
                "taskId": task_id,
            }),
        ));
        Ok(())
    }

    fn finish_run(
        &self,
        correlation_id: &str,
        run_id: &str,
        status: FlowRunStatus,
        summary: Option<String>,
    ) {
        let mut state = match self.state.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if let Some(run) = state.runs.iter_mut().find(|run| run.run_id == run_id) {
            run.status = status.clone();
            run.completed_at_ms = Some(now_ms());
            run.summary = summary.clone();
        }
        if state.active_run_id.as_deref() == Some(run_id) {
            state.active_run_id = None;
        }
        state.cancel_senders.remove(run_id);
        persist_runs(&self.persist_path, &state.runs);
        drop(state);

        let (action, stage, severity) = match status {
            FlowRunStatus::Succeeded | FlowRunStatus::Stopped => (
                "flow.run.complete",
                EventStage::Complete,
                EventSeverity::Info,
            ),
            FlowRunStatus::Failed => ("flow.run.error", EventStage::Error, EventSeverity::Error),
            _ => (
                "flow.run.progress",
                EventStage::Progress,
                EventSeverity::Info,
            ),
        };

        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            stage,
            severity,
            json!({
                "runId": run_id,
                "status": status,
                "summary": summary,
                "result": summary,
                "error": if matches!(status, FlowRunStatus::Failed) { summary } else { None::<String> },
            }),
        ));
    }

    fn emit_step_event(
        &self,
        correlation_id: &str,
        run_id: &str,
        iteration: u32,
        step: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        let mut envelope = Map::<String, Value>::new();
        envelope.insert("runId".to_string(), Value::String(run_id.to_string()));
        envelope.insert(
            "iteration".to_string(),
            Value::Number(serde_json::Number::from(iteration)),
        );
        envelope.insert("step".to_string(), Value::String(step.to_string()));
        if let Value::Object(map) = payload {
            for (key, value) in map {
                envelope.insert(key, value);
            }
        } else {
            envelope.insert("detail".to_string(), payload);
        }
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            match stage {
                EventStage::Start => "flow.step.start",
                EventStage::Progress => "flow.step.progress",
                EventStage::Complete => "flow.step.complete",
                EventStage::Error => "flow.step.error",
            },
            stage,
            severity,
            Value::Object(envelope),
        ));
    }

    fn emit_git_event(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        run_id: &str,
        iteration: u32,
        payload: serde_json::Value,
    ) {
        let mut envelope = Map::<String, Value>::new();
        envelope.insert("runId".to_string(), Value::String(run_id.to_string()));
        envelope.insert(
            "iteration".to_string(),
            Value::Number(serde_json::Number::from(iteration)),
        );
        if let Value::Object(map) = payload {
            for (key, value) in map {
                envelope.insert(key, value);
            }
        } else {
            envelope.insert("detail".to_string(), payload);
        }
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            stage,
            severity,
            Value::Object(envelope),
        ));
    }

    async fn wait_if_paused(&self, run_id: &str, cancel_rx: &watch::Receiver<bool>) -> bool {
        loop {
            if *cancel_rx.borrow() {
                return true;
            }
            let paused = match self.state.lock() {
                Ok(state) => state.paused_run_ids.contains(run_id),
                Err(_) => false,
            };
            if !paused {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    fn recent_nudges(&self, run_id: &str) -> Vec<String> {
        let state = match self.state.lock() {
            Ok(value) => value,
            Err(_) => return vec![],
        };
        state
            .nudges_by_run
            .get(run_id)
            .map(|items| items.iter().rev().take(5).cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    }

    fn resolve_phase_model_override(&self, phase: &str) -> Option<String> {
        let state = self.state.lock().ok()?;
        let run_id = state.active_run_id.as_ref()?;
        let run = state.runs.iter().find(|run| &run.run_id == run_id)?;
        run.phase_models
            .get(phase)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty() && value != "auto")
    }

    fn llm_select_task(
        &self,
        plan_path: &Path,
        run: &FlowRunRecord,
        iteration: u32,
        correlation_id: &str,
    ) -> Result<Option<String>, String> {
        let plan = std::fs::read_to_string(plan_path).unwrap_or_default();
        let open_tasks: Vec<String> = plan
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with("- [ ]"))
            .map(|line| line.trim_start_matches("- [ ]").trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
        if open_tasks.is_empty() {
            return Ok(None);
        }
        let prompt = format!(
            "You are selecting the next implementation task.\nRun: {}\nMode: {:?}\nIteration: {}\nRecent nudges:\n{}\nOpen tasks:\n{}\n\nReturn ONLY the exact task text of the best next task.",
            run.run_id,
            run.mode,
            iteration,
            {
                let nudges = self.recent_nudges(run.run_id.as_str());
                if nudges.is_empty() {
                    "(none)".to_string()
                } else {
                    nudges.join(" | ")
                }
            },
            open_tasks
                .iter()
                .enumerate()
                .map(|(idx, task)| format!("{}. {}", idx + 1, task))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let text = self.llm_generate_text(
            run.run_id.as_str(),
            correlation_id,
            "Select the single best next task from the list. Output task text only.",
            prompt.as_str(),
            Some("select_task"),
            Some(220),
            Some(0.2),
        )?;
        let selected = text.lines().next().unwrap_or("").trim().to_string();
        if selected.is_empty() {
            return Ok(None);
        }
        if open_tasks.iter().any(|task| task == &selected) {
            return Ok(Some(selected));
        }
        let normalized = selected.to_lowercase();
        if let Some(matched) = open_tasks
            .iter()
            .find(|task| task.to_lowercase().contains(normalized.as_str()))
        {
            return Ok(Some(matched.clone()));
        }
        Ok(None)
    }

    fn llm_investigate(
        &self,
        run: &FlowRunRecord,
        iteration: u32,
        selected_task: Option<&str>,
        plan_path: &Path,
        specs: &[PathBuf],
        correlation_id: &str,
    ) -> Result<String, String> {
        let plan_excerpt = std::fs::read_to_string(plan_path)
            .unwrap_or_default()
            .lines()
            .take(80)
            .collect::<Vec<_>>()
            .join("\n");
        let spec_preview = specs
            .iter()
            .take(6)
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let prompt = format!(
            "Run: {}\nMode: {:?}\nIteration: {}\nSelected task: {}\nRecent nudges: {}\nPlan excerpt:\n{}\nSpecs: {}\n\nProduce a concise investigation outcome with:\n1) assumptions\n2) implementation approach\n3) risks\n4) validation focus",
            run.run_id,
            run.mode,
            iteration,
            selected_task.unwrap_or("(none)"),
            {
                let nudges = self.recent_nudges(run.run_id.as_str());
                if nudges.is_empty() {
                    "(none)".to_string()
                } else {
                    nudges.join(" | ")
                }
            },
            plan_excerpt,
            if spec_preview.is_empty() { "(none)" } else { spec_preview.as_str() }
        );
        self.llm_generate_text(
            run.run_id.as_str(),
            correlation_id,
            "You are a pragmatic staff engineer. Return concise, high-signal execution guidance.",
            prompt.as_str(),
            Some("investigate"),
            Some(700),
            Some(0.25),
        )
    }

    fn llm_generate_plan_seed(
        &self,
        run: &FlowRunRecord,
        specs: &[PathBuf],
        correlation_id: &str,
    ) -> Result<String, String> {
        let prompt_path = resolve_workspace_path(run.prompt_plan_path.as_str());
        let prompt_seed = std::fs::read_to_string(prompt_path).unwrap_or_default();
        let spec_list = specs
            .iter()
            .take(10)
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("\n- ");
        let user_prompt = format!(
            "Create an actionable IMPLEMENTATION_PLAN.md for this project.\nSpecs files:\n- {}\n\nCustom planning prompt:\n{}\n\nRequirements:\n- Markdown\n- Checklist format '- [ ] task'\n- 5-12 tasks\n- Tasks should be testable and sequenced",
            if spec_list.is_empty() {
                "(none)".to_string()
            } else {
                spec_list
            },
            prompt_seed
        );
        self.llm_generate_text(
            run.run_id.as_str(),
            correlation_id,
            "You are generating implementation plans for iterative software delivery.",
            user_prompt.as_str(),
            Some("update_plan"),
            Some(900),
            Some(0.2),
        )
    }

    fn llm_generate_text(
        &self,
        run_id: &str,
        correlation_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        phase: Option<&str>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
    ) -> Result<String, String> {
        let (mut endpoint, mut model, mut api_key) = resolve_flow_provider(self.api_registry.as_ref())?;
        if let Some(phase_name) = phase {
            if let Some(override_value) = self.resolve_phase_model_override(phase_name) {
                let resolved = resolve_flow_provider_for_model_id(
                    self.api_registry.as_ref(),
                    override_value.as_str(),
                )?;
                endpoint = resolved.0;
                model = resolved.1;
                api_key = resolved.2;
            }
        }
        let payload = FlowOpenAiRequest {
            model: model.clone(),
            messages: vec![
                FlowOpenAiMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                FlowOpenAiMessage {
                    role: "user".to_string(),
                    content: user_prompt.to_string(),
                },
            ],
            stream: false,
            max_tokens: max_tokens.or(Some(900)),
            temperature,
        };
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(70))
            .build()
            .map_err(|e| format!("failed creating LLM client: {e}"))?;
        let mut req = client
            .post(endpoint.as_str())
            .header("Content-Type", "application/json")
            .header("User-Agent", "arxell-lite/flow");
        if let Some(key) = api_key {
            req = req
                .header("Authorization", format!("Bearer {key}"))
                .header("x-api-key", key);
        }
        let request_once = |model_name: &str| -> Result<String, String> {
            let mut request_payload = payload.clone();
            request_payload.model = model_name.to_string();
            let response = req
                .try_clone()
                .ok_or_else(|| "failed cloning flow LLM request".to_string())?
                .json(&request_payload)
                .send()
                .map_err(|e| format!("flow LLM request failed: {e}"))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response
                    .text()
                    .unwrap_or_else(|_| "<unreadable body>".to_string());
                return Err(format!(
                    "flow LLM request failed (HTTP {}): {}",
                    status.as_u16(),
                    body.chars().take(260).collect::<String>()
                ));
            }
            let body = response
                .json::<Value>()
                .map_err(|e| format!("failed parsing flow LLM response: {e}"))?;
            let text = extract_generated_text_from_value(&body);
            if text.trim().is_empty() {
                return Err("flow LLM response was empty".to_string());
            }
            Ok(text.trim().to_string())
        };

        let max_retries = 2u32;
        let phase_name = phase.unwrap_or("unknown");
        let mut last_error: Option<String> = None;
        for attempt in 0..=max_retries {
            match request_once(model.as_str()) {
                Ok(text) => return Ok(text),
                Err(error) => {
                    if !is_model_unavailable_error(error.as_str()) {
                        return Err(error);
                    }
                    last_error = Some(error.clone());
                    self.emit_model_recovery_event(
                        correlation_id,
                        run_id,
                        phase_name,
                        model.as_str(),
                        None,
                        error.as_str(),
                        attempt + 1,
                        max_retries,
                        "retrying",
                    );
                    if attempt < max_retries {
                        std::thread::sleep(std::time::Duration::from_millis(1000));
                    }
                }
            }
        }

        if self.is_run_paused(run_id) {
            self.emit_model_recovery_event(
                correlation_id,
                run_id,
                phase_name,
                model.as_str(),
                None,
                "Paused by user before fallback switch",
                max_retries,
                max_retries,
                "paused",
            );
            return Err(
                last_error.unwrap_or_else(|| "flow LLM unavailable while paused".to_string())
            );
        }

        if let Some(fallback_model) = self.select_fallback_model(model.as_str(), phase) {
            if fallback_model != model {
                self.emit_model_recovery_event(
                    correlation_id,
                    run_id,
                    phase_name,
                    model.as_str(),
                    Some(fallback_model.as_str()),
                    "Switching to fallback model",
                    max_retries,
                    max_retries,
                    "switching",
                );
                if let Some(phase_value) = phase {
                    self.set_phase_model_override(run_id, phase_value, fallback_model.as_str());
                }
                let text = request_once(fallback_model.as_str())?;
                self.emit_model_recovery_event(
                    correlation_id,
                    run_id,
                    phase_name,
                    model.as_str(),
                    Some(fallback_model.as_str()),
                    "Fallback model active",
                    max_retries,
                    max_retries,
                    "switched",
                );
                return Ok(text);
            }
        }

        Err(last_error.unwrap_or_else(|| "flow LLM request failed".to_string()))
    }

    fn set_phase_model_override(&self, run_id: &str, phase: &str, model: &str) {
        let mut state = match self.state.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if let Some(run) = state.runs.iter_mut().find(|run| run.run_id == run_id) {
            run.phase_models
                .insert(phase.to_string(), model.to_string());
            persist_runs(&self.persist_path, &state.runs);
        }
    }

    fn is_run_paused(&self, run_id: &str) -> bool {
        match self.state.lock() {
            Ok(state) => state.paused_run_ids.contains(run_id),
            Err(_) => false,
        }
    }

    fn select_fallback_model(&self, current_model: &str, phase: Option<&str>) -> Option<String> {
        let phase_override =
            phase.and_then(|phase_name| self.resolve_phase_model_override(phase_name));
        if let Some(value) = phase_override {
            let normalized = normalize_phase_model_value(value.as_str());
            if !normalized.is_empty() && normalized != current_model {
                return Some(normalized);
            }
        }
        fallback_model_candidates(self.api_registry.as_ref(), current_model)
            .into_iter()
            .next()
    }

    fn emit_model_recovery_event(
        &self,
        correlation_id: &str,
        run_id: &str,
        phase: &str,
        model: &str,
        fallback_model: Option<&str>,
        reason: &str,
        attempt: u32,
        max_attempts: u32,
        status: &str,
    ) {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            "flow.model.unavailable",
            EventStage::Progress,
            if status == "paused" {
                EventSeverity::Warn
            } else {
                EventSeverity::Info
            },
            json!({
                "runId": run_id,
                "phase": phase,
                "model": model,
                "fallbackModel": fallback_model,
                "reason": reason,
                "attempt": attempt,
                "maxAttempts": max_attempts,
                "status": status,
            }),
        ));
    }

    #[allow(clippy::too_many_arguments)]
    fn update_step_state(
        &self,
        run_id: &str,
        iteration: u32,
        step: &str,
        state_value: FlowStepState,
        started_at_ms: Option<i64>,
        completed_at_ms: Option<i64>,
        result: Option<String>,
        error: Option<String>,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let run = state
            .runs
            .iter_mut()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| format!("flow run not found: {run_id}"))?;
        let iteration_item = run
            .iterations
            .iter_mut()
            .find(|item| item.index == iteration)
            .ok_or_else(|| format!("flow iteration not found: {iteration}"))?;
        let step_item = iteration_item
            .steps
            .iter_mut()
            .find(|item| item.step == step);
        let step_item = match step_item {
            Some(item) => item,
            None => {
                iteration_item.steps.push(FlowStepStatus {
                    step: step.to_string(),
                    state: FlowStepState::Pending,
                    started_at_ms: None,
                    completed_at_ms: None,
                    result: None,
                    error: None,
                });
                iteration_item
                    .steps
                    .iter_mut()
                    .find(|item| item.step == step)
                    .ok_or_else(|| format!("flow step not found after insert: {step}"))?
            }
        };
        step_item.state = state_value;
        if let Some(value) = started_at_ms {
            step_item.started_at_ms = Some(value);
        }
        if let Some(value) = completed_at_ms {
            step_item.completed_at_ms = Some(value);
        }
        if result.is_some() {
            step_item.result = result;
        }
        if error.is_some() {
            step_item.error = error;
        }
        persist_runs(&self.persist_path, &state.runs);
        Ok(())
    }
}

impl Default for FlowService {
    fn default() -> Self {
        Self::new(EventHub::new())
    }
}

fn default_persist_path() -> PathBuf {
    let path = flow_state_root().join("flow-runs.json");
    migrate_legacy_flow_file(
        std::env::temp_dir().join("arxell-lite-flow-runs.json"),
        path.as_path(),
    );
    path
}

fn load_runs(path: &Path) -> Vec<FlowRunRecord> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return vec![];
    };
    serde_json::from_str::<FlowPersistedState>(contents.as_str())
        .map(|state| state.runs)
        .unwrap_or_default()
}

fn persist_runs(path: &Path, runs: &[FlowRunRecord]) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = FlowPersistedState {
        runs: runs.to_vec(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(path, json);
    }
}

fn flow_state_root() -> PathBuf {
    if let Ok(raw) = std::env::var("XDG_STATE_HOME") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("arxell-lite");
        }
    }
    if let Ok(raw) = std::env::var("APPDATA") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("arxell-lite");
        }
    }
    if let Ok(raw) = std::env::var("HOME") {
        let home = PathBuf::from(raw.trim());
        #[cfg(target_os = "macos")]
        {
            return home
                .join("Library")
                .join("Application Support")
                .join("arxell-lite");
        }
        #[cfg(not(target_os = "macos"))]
        {
            return home.join(".local").join("state").join("arxell-lite");
        }
    }
    std::env::temp_dir()
}

fn migrate_legacy_flow_file(legacy: PathBuf, destination: &Path) {
    if destination.exists() || !legacy.exists() {
        return;
    }
    if let Some(parent) = destination.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::copy(legacy, destination);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn resolve_workspace_path(path: &str) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        cwd.join(path)
    }
}

fn collect_spec_files(specs_glob: &str) -> Result<Vec<PathBuf>, String> {
    let glob = specs_glob.trim();
    if glob.is_empty() {
        return Ok(vec![]);
    }
    let (base, suffix) = split_glob(glob);
    let base_path = resolve_workspace_path(base);
    if !base_path.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in walk_recursive(base_path.as_path())? {
        if entry
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(suffix))
            .unwrap_or(false)
        {
            files.push(entry);
        }
    }
    Ok(files)
}

fn split_glob(glob: &str) -> (&str, &str) {
    let trimmed = glob.trim();
    if let Some(index) = trimmed.find('*') {
        let (left, right) = trimmed.split_at(index);
        return (left.trim_end_matches('/'), right.trim_start_matches('*'));
    }
    (trimmed, "")
}

fn walk_recursive(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut pending = vec![path.to_path_buf()];
    let mut files = vec![];
    while let Some(next) = pending.pop() {
        let metadata = std::fs::metadata(next.as_path())
            .map_err(|e| format!("failed reading metadata: {e}"))?;
        if metadata.is_file() {
            files.push(next);
            continue;
        }
        let entries =
            std::fs::read_dir(next.as_path()).map_err(|e| format!("failed reading dir: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("failed reading dir entry: {e}"))?;
            pending.push(entry.path());
        }
    }
    Ok(files)
}

fn select_next_plan_task(plan_path: &Path) -> Result<Option<String>, String> {
    if !plan_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(plan_path)
        .map_err(|e| format!("failed reading plan file {}: {e}", plan_path.display()))?;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("- [ ]") {
            return Ok(Some(trimmed.trim_start_matches("- [ ]").trim().to_string()));
        }
    }
    Ok(None)
}

fn count_plan_tasks(plan_path: &Path) -> (usize, usize) {
    let Ok(contents) = std::fs::read_to_string(plan_path) else {
        return (0, 0);
    };
    let mut open = 0usize;
    let mut done = 0usize;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("- [ ]") {
            open += 1;
        } else if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
            done += 1;
        }
    }
    (open, done)
}

fn mark_task_complete(contents: &str, task: &str) -> String {
    let mut replaced = false;
    let mut lines = vec![];
    for line in contents.lines() {
        if !replaced {
            let trimmed = line.trim();
            if trimmed.starts_with("- [ ]") && trimmed.contains(task) {
                lines.push(line.replacen("- [ ]", "- [x]", 1));
                replaced = true;
                continue;
            }
        }
        lines.push(line.to_string());
    }
    if lines.is_empty() {
        return format!("- [x] {task}\n");
    }
    format!("{}\n", lines.join("\n"))
}

struct CommandResult {
    ok: bool,
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: i64,
}

fn run_shell_command(command: &str) -> Result<CommandResult, String> {
    let started = now_ms();
    let output = Command::new("bash")
        .arg("-lc")
        .arg(command)
        .output()
        .map_err(|e| format!("failed executing '{command}': {e}"))?;
    Ok(CommandResult {
        ok: output.status.success(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: summarize_output(String::from_utf8_lossy(&output.stdout).as_ref()),
        stderr: summarize_output(String::from_utf8_lossy(&output.stderr).as_ref()),
        duration_ms: (now_ms() - started).max(0),
    })
}

fn summarize_output(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    const MAX: usize = 400;
    if trimmed.len() <= MAX {
        trimmed.to_string()
    } else {
        format!("{}…", &trimmed[..MAX])
    }
}

fn resolve_implement_command(
    template: &str,
    run_id: &str,
    iteration: u32,
    task_id: Option<&str>,
) -> String {
    let task = task_id.unwrap_or("(none)");
    template
        .replace("{{runId}}", run_id)
        .replace("{{iteration}}", iteration.to_string().as_str())
        .replace("{{taskId}}", task)
}

fn execute_validation_command(command: &str) -> Result<ValidationExecutionResult, String> {
    let output = run_shell_command(command)?;
    Ok(ValidationExecutionResult {
        command: command.to_string(),
        ok: output.ok,
        exit_code: output.exit_code,
        stdout: output.stdout,
        stderr: output.stderr,
        duration_ms: output.duration_ms,
    })
}

fn flow_git_native_enabled() -> bool {
    match std::env::var(FLOW_GIT_NATIVE_V1_ENV) {
        Ok(value) => {
            let normalized = value.trim().to_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        }
        // Default to disabled for safety; git operations can stage/commit all files
        Err(_) => false,
    }
}

fn flow_llm_enabled() -> bool {
    match std::env::var(FLOW_LLM_ENABLED_ENV) {
        Ok(value) => {
            let normalized = value.trim().to_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        }
        Err(_) => true,
    }
}

fn resolve_flow_provider(
    api_registry: Option<&Arc<ApiRegistryService>>,
) -> Result<(String, String, Option<String>), String> {
    if let Some(registry) = api_registry {
        if let Some(record) = registry
            .verified_for_agent()
            .into_iter()
            .find(|record| matches!(record.api_type, ApiConnectionType::Llm))
        {
            let endpoint = resolve_flow_chat_endpoint(
                record.api_url.as_str(),
                record.api_standard_path.as_deref(),
            );
            let model = record
                .model_name
                .unwrap_or_else(|| fallback_flow_model_name());
            return Ok((endpoint, model, Some(record.api_key)));
        }
    }
    Ok((
        fallback_flow_endpoint(),
        fallback_flow_model_name(),
        std::env::var("OPENAI_API_KEY").ok(),
    ))
}

fn resolve_flow_provider_for_model_id(
    api_registry: Option<&Arc<ApiRegistryService>>,
    model_id: &str,
) -> Result<(String, String, Option<String>), String> {
    let trimmed = model_id.trim();
    if trimmed.is_empty() || trimmed == "auto" {
        return resolve_flow_provider(api_registry);
    }

    if let Some(rest) = trimmed.strip_prefix("api:") {
        let mut parts = rest.splitn(2, ':');
        let connection_id = parts.next().unwrap_or("").trim();
        let selected_model = parts.next().unwrap_or("").trim();
        if connection_id.is_empty() {
            return Err("invalid API model selection".to_string());
        }
        let Some(registry) = api_registry else {
            return Err("API registry unavailable for selected phase model".to_string());
        };
        let record = registry
            .list()
            .into_iter()
            .find(|item| item.id == connection_id)
            .ok_or_else(|| format!("API connection not found: {connection_id}"))?;
        if !matches!(record.api_type, ApiConnectionType::Llm) {
            return Err(format!("API connection is not an LLM endpoint: {connection_id}"));
        }
        if !matches!(
            record.status,
            ApiConnectionStatus::Verified | ApiConnectionStatus::Warning
        ) {
            return Err(format!("API connection is not usable: {connection_id}"));
        }
        let endpoint = resolve_flow_chat_endpoint(
            record.api_url.as_str(),
            record.api_standard_path.as_deref(),
        );
        let api_key = registry.get_secret_api_key(connection_id)?;
        let model = if selected_model.is_empty() {
            record.model_name.unwrap_or_else(fallback_flow_model_name)
        } else {
            selected_model.to_string()
        };
        return Ok((endpoint, model, Some(api_key)));
    }

    if let Some(model) = trimmed.strip_prefix("mm:") {
        let normalized = model.trim();
        if normalized.is_empty() {
            return Err("invalid model-manager model selection".to_string());
        }
        return Ok((
            fallback_flow_endpoint(),
            normalized.to_string(),
            std::env::var("OPENAI_API_KEY").ok(),
        ));
    }

    Ok((
        fallback_flow_endpoint(),
        normalize_phase_model_value(trimmed),
        std::env::var("OPENAI_API_KEY").ok(),
    ))
}

fn fallback_model_candidates(
    api_registry: Option<&Arc<ApiRegistryService>>,
    current_model: &str,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(registry) = api_registry {
        for record in registry
            .verified_for_agent()
            .into_iter()
            .filter(|record| matches!(record.api_type, ApiConnectionType::Llm))
        {
            if let Some(model) = record.model_name {
                let candidate = normalize_phase_model_value(model.as_str());
                if !candidate.is_empty()
                    && candidate != current_model
                    && !out.iter().any(|item| item == &candidate)
                {
                    out.push(candidate);
                }
            }
        }
    }
    let env_model = normalize_phase_model_value(fallback_flow_model_name().as_str());
    if !env_model.is_empty()
        && env_model != current_model
        && !out.iter().any(|item| item == &env_model)
    {
        out.push(env_model);
    }
    out
}

fn normalize_phase_model_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(rest) = trimmed.strip_prefix("api:") {
        if let Some(idx) = rest.rfind(':') {
            let model = rest[(idx + 1)..].trim();
            if !model.is_empty() {
                return model.to_string();
            }
        }
    }
    if trimmed == "local:runtime" {
        return fallback_flow_model_name();
    }
    trimmed.to_string()
}

fn is_model_unavailable_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    [
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "unavailable",
        "overloaded",
        "rate limit",
        "quota",
        "token",
        "timeout",
        "temporar",
        "connection refused",
        "model not found",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn resolve_flow_chat_endpoint(api_url: &str, api_standard_path: Option<&str>) -> String {
    let base = api_url.trim().trim_end_matches('/');
    let path = api_standard_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("/chat/completions");
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let lower = base.to_ascii_lowercase();
    if lower.ends_with("/chat/completions") {
        return base.to_string();
    }
    if lower.ends_with("/v1") {
        return format!("{base}{normalized_path}");
    }
    format!("{base}/v1{}", normalized_path)
}

fn fallback_flow_endpoint() -> String {
    std::env::var("FOUNDATION_LLM_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:1420/v1/chat/completions".to_string())
}

fn fallback_flow_model_name() -> String {
    std::env::var("FOUNDATION_LLM_MODEL").unwrap_or_else(|_| "local-model".to_string())
}

fn extract_generated_text_from_value(body: &Value) -> String {
    body.get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .map(str::to_string)
        })
        .or_else(|| {
            body.get("choices")
                .and_then(|choices| choices.as_array())
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("text"))
                .and_then(|text| text.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn open_repo_from_workspace() -> Result<Repository, String> {
    let cwd = resolve_workspace_path(".");
    Repository::discover(cwd).map_err(|e| format!("failed opening git repo: {e}"))
}

fn default_git_signature(repo: &Repository) -> Result<Signature<'_>, String> {
    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(_) => Signature::now("arxell-flow", "flow@local")
            .map_err(|e| format!("failed creating git signature: {e}")),
    }
}

fn perform_native_git_commit(run_id: &str, iteration: u32) -> Result<String, String> {
    let repo = open_repo_from_workspace()?;
    let mut index = repo
        .index()
        .map_err(|e| format!("failed loading git index: {e}"))?;
    index
        .add_all(["*"], IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("failed staging files: {e}"))?;
    index
        .write()
        .map_err(|e| format!("failed writing git index: {e}"))?;
    let tree_id = index
        .write_tree()
        .map_err(|e| format!("failed writing git tree: {e}"))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| format!("failed loading git tree: {e}"))?;

    let parent_commit = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());
    let mut commit_message = format!("flow: run {} iteration {}", run_id, iteration);
    if let Ok(statuses) = repo.statuses(None) {
        let changed_count = statuses.len();
        commit_message = format!("{commit_message} ({changed_count} changed)");
    }
    let author = default_git_signature(&repo)?;
    let committer = default_git_signature(&repo)?;

    let commit_id = if let Some(parent) = parent_commit.as_ref() {
        repo.commit(
            Some("HEAD"),
            &author,
            &committer,
            commit_message.as_str(),
            &tree,
            &[parent],
        )
        .map_err(|e| format!("failed creating git commit: {e}"))?
    } else {
        repo.commit(
            Some("HEAD"),
            &author,
            &committer,
            commit_message.as_str(),
            &tree,
            &[],
        )
        .map_err(|e| format!("failed creating initial git commit: {e}"))?
    };

    Ok(format!("Native git commit created: {}", commit_id))
}

fn perform_native_git_push() -> Result<String, String> {
    let repo = open_repo_from_workspace()?;
    let head = repo
        .head()
        .map_err(|e| format!("failed resolving HEAD: {e}"))?;
    let branch = head
        .shorthand()
        .ok_or_else(|| "failed resolving current branch name".to_string())?
        .to_string();

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("failed resolving remote 'origin': {e}"))?;

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, allowed_types| {
        let user = username_from_url.unwrap_or("git");
        if allowed_types.is_ssh_key() {
            if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
        }
        if allowed_types.is_user_pass_plaintext() {
            if let Ok(token) = std::env::var("GIT_TOKEN") {
                return Cred::userpass_plaintext(user, token.as_str());
            }
        }
        Cred::default()
    });

    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote
        .push(&[refspec.as_str()], Some(&mut push_options))
        .map_err(|e| format!("failed pushing to origin/{branch}: {e}"))?;

    Ok(format!("Native git push complete: origin/{branch}"))
}

fn count_changed_files() -> Result<usize, String> {
    let output = Command::new("bash")
        .arg("-lc")
        .arg("git status --porcelain")
        .output()
        .map_err(|e| format!("failed running git status: {e}"))?;
    if !output.status.success() {
        return Ok(0);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.lines().filter(|line| !line.trim().is_empty()).count())
}

impl FlowService {
    fn set_run_status(&self, run_id: &str, status: FlowRunStatus) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "flow runtime state lock poisoned".to_string())?;
        let run = state
            .runs
            .iter_mut()
            .find(|run| run.run_id == run_id)
            .ok_or_else(|| format!("flow run not found: {run_id}"))?;
        run.status = status;
        persist_runs(&self.persist_path, &state.runs);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_task_complete() {
        let input = "- [ ] First task\n- [ ] Second task\n";
        let output = mark_task_complete(input, "First task");
        assert!(output.contains("- [x] First task"));
        assert!(output.contains("- [ ] Second task"));
    }

    #[test]
    fn selects_next_plan_task() {
        let dir = std::env::temp_dir().join(format!("flow-test-{}", now_ms()));
        let _ = std::fs::create_dir_all(dir.as_path());
        let plan_path = dir.join("IMPLEMENTATION_PLAN.md");
        std::fs::write(
            plan_path.as_path(),
            "- [x] done\n- [ ] pending task\n- [ ] another task\n",
        )
        .expect("write plan");

        let selected = select_next_plan_task(plan_path.as_path()).expect("select task");
        assert_eq!(selected.as_deref(), Some("pending task"));
        let _ = std::fs::remove_file(plan_path);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn run_shell_command_reports_nonzero_without_transport_error() {
        let result = run_shell_command("exit 7").expect("command should execute");
        assert!(!result.ok);
        assert_eq!(result.exit_code, 7);
    }

    #[test]
    fn resolve_implement_command_replaces_all_tokens() {
        let resolved = resolve_implement_command(
            "echo {{runId}} {{iteration}} {{taskId}}",
            "run-1",
            3,
            Some("fix-bug"),
        );
        assert_eq!(resolved, "echo run-1 3 fix-bug");
    }

    #[test]
    fn implement_step_requires_command_when_not_dry_run() {
        let service = FlowService::default();
        let run = FlowRunRecord {
            run_id: "run-test".to_string(),
            mode: FlowMode::Build,
            status: FlowRunStatus::Running,
            max_iterations: Some(1),
            current_iteration: 1,
            started_at_ms: now_ms(),
            completed_at_ms: None,
            dry_run: false,
            auto_push: false,
            prompt_plan_path: "PROMPT_plan.md".to_string(),
            prompt_build_path: "PROMPT_build.md".to_string(),
            plan_path: "IMPLEMENTATION_PLAN.md".to_string(),
            specs_glob: "specs/*.md".to_string(),
            backpressure_commands: vec!["echo ok".to_string()],
            implement_command: String::new(),
            phase_models: HashMap::new(),
            summary: None,
            iterations: vec![],
        };

        let result = service.execute_step(
            "run-test",
            1,
            "implement",
            &run,
            Some("task-1".to_string()),
            "corr-1",
        );
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("implementCommand"));
    }
}
