use crate::contracts::{
    EventSeverity, EventStage, FlowIterationStatus, FlowListRunsRequest, FlowListRunsResponse,
    FlowMode, FlowRerunValidationRequest, FlowRerunValidationResponse, FlowRerunValidationResult,
    FlowRunRecord, FlowRunStatus, FlowStartRequest, FlowStartResponse, FlowStatusRequest,
    FlowStatusResponse, FlowStepState, FlowStepStatus, FlowStopRequest, FlowStopResponse,
    Subsystem,
};
use crate::observability::EventHub;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
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
    state: Arc<Mutex<FlowRuntimeState>>,
    persist_path: PathBuf,
}

impl FlowService {
    pub fn new(hub: EventHub) -> Self {
        let persist_path = default_persist_path();
        let runs = load_runs(&persist_path);
        let active_run_id = runs
            .iter()
            .find(|run| matches!(run.status, FlowRunStatus::Queued | FlowRunStatus::Running))
            .map(|run| run.run_id.clone());
        Self {
            hub,
            state: Arc::new(Mutex::new(FlowRuntimeState {
                runs,
                active_run_id,
                cancel_senders: HashMap::new(),
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
                Ok(task)
            }
            "investigate" => Ok(Some("Investigation completed".to_string())),
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
                    if !plan_path.exists() {
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
                } else {
                    Ok(Some(
                        "Commit hook ready (disabled in v1 for safety)".to_string(),
                    ))
                }
            }
            "push" => {
                if !run.auto_push {
                    Ok(Some("Auto-push disabled".to_string()))
                } else if run.dry_run {
                    Ok(Some("Dry run: push skipped".to_string()))
                } else {
                    Ok(Some(
                        "Push hook ready (disabled in v1 for safety)".to_string(),
                    ))
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
    std::env::temp_dir().join("arxell-lite-flow-runs.json")
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
