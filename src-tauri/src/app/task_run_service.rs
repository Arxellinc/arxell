//! Reconciles durable run identities with delegated loop state. No content is copied.
use crate::app::tasks_service::TaskAutomationService;
use crate::contracts::LooperLoopStatus;
use std::collections::HashMap;

pub fn reconcile_task_runs(
    tasks: &TaskAutomationService,
    loops: &HashMap<String, LooperLoopStatus>,
    recovering: bool,
    now: i64,
) -> Result<usize, String> {
    let mut changed = 0;
    for mut run in tasks.active_runs()? {
        let loop_id = run.result_json.get("loopId").and_then(|id| id.as_str());
        let state = loop_id.and_then(|id| loops.get(id));
        let outcome = match state {
            Some(LooperLoopStatus::Completed) => Some(("succeeded", "")),
            Some(LooperLoopStatus::Failed) => {
                Some(("failed", "Delegated run failed or was stopped."))
            }
            _ if recovering => Some((
                "failed",
                "Run interrupted by application restart; automatic replay was not attempted.",
            )),
            None if run.status == "running" => {
                Some(("failed", "Delegated run is no longer available."))
            }
            // A starting row can be visible while preflight/launch is still in progress.
            _ => None,
        };
        if let Some((status, error)) = outcome {
            run.status = status.into();
            run.error = error.into();
            if run.policy_decision == "pending" {
                run.policy_decision = if matches!(
                    state,
                    Some(LooperLoopStatus::Completed | LooperLoopStatus::Failed)
                ) {
                    "allow"
                } else {
                    "deny"
                }
                .into();
            }
            run.policy_reason = if recovering {
                "restart_reconciliation"
            } else {
                "delegated_outcome"
            }
            .into();
            if tasks.record_run_outcome(&run, now)? {
                changed += 1;
            }
        }
    }
    Ok(changed)
}
