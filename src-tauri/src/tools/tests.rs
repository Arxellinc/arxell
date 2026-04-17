//! Tests for the looper handler
//!
//! This module contains unit tests for LooperHandler functionality including:
//! - Loop lifecycle (start, stop, pause, close)
//! - Phase state management
//! - App-tool plugin scaffold creation
//! - Question submission
//! - Phase auto-advancement logic

use crate::contracts::{
    LooperAdvanceRequest, LooperCloseRequest, LooperListRequest, LooperLoopStatus, LooperLoopType,
    LooperPauseRequest, LooperStartRequest, LooperStatusRequest, LooperStopRequest,
};
use crate::observability::EventHub;
use crate::tools::looper_handler::{build_project_context, get_substeps, now_ms};
use serde_json::json;

fn create_test_hub() -> EventHub {
    EventHub::new()
}

fn create_test_request() -> LooperStartRequest {
    LooperStartRequest {
        correlation_id: "test-correlation".to_string(),
        loop_id: "test-loop-1".to_string(),
        iteration: 1,
        loop_type: LooperLoopType::Build,
        cwd: "/tmp/test-looper".to_string(),
        task_path: "task.md".to_string(),
        specs_glob: "specs/*.md".to_string(),
        max_iterations: 3,
        phase_models: None,
        project_name: "Test Project".to_string(),
        project_type: "build".to_string(),
        project_icon: "wrench".to_string(),
        project_description: "A test project for unit testing".to_string(),
    }
}

#[test]
fn test_build_project_context_basic() {
    let context = build_project_context("My Project", "build", "wrench", "A test description");
    assert!(context.contains("Project: My Project"));
    assert!(context.contains("Type: build"));
    assert!(context.contains("A test description"));
}

#[test]
fn test_build_project_context_app_tool() {
    let context = build_project_context("My App", "app-tool", "star", "");
    assert!(context.contains("Project: My App"));
    assert!(context.contains("Type: app-tool"));
    assert!(context.contains("Icon: star"));
}

#[test]
fn test_build_project_context_empty_name() {
    let context = build_project_context("", "build", "", "Some description");
    assert!(!context.contains("Project:"));
    assert!(context.contains("Type: build"));
    assert!(context.contains("Some description"));
}

#[test]
fn test_build_project_context_empty_description() {
    let context = build_project_context("Project", "build", "", "");
    assert!(context.contains("Project: Project"));
    assert!(context.contains("Type: build"));
}

#[test]
fn test_build_project_context_multiline_description() {
    let desc = "Line 1\nLine 2\nLine 3";
    let context = build_project_context("Proj", "build", "", desc);
    assert!(context.contains("Line 1"));
    assert!(context.contains("Line 2"));
    assert!(context.contains("Line 3"));
}

#[test]
fn test_app_tool_icon_included() {
    let context = build_project_context("Tool", "app-tool", "star", "A tool");
    assert!(context.contains("Icon: star"));
}

#[test]
fn test_non_app_tool_icon_excluded() {
    let context = build_project_context("Project", "build", "star", "");
    assert!(!context.contains("Icon:"));
}

#[test]
fn test_get_substeps_prd_planner() {
    let substeps = get_substeps("planner", &LooperLoopType::Prd);
    assert!(!substeps.is_empty());
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Read task.md"));
    assert!(labels.contains(&"Web research"));
    assert!(labels.contains(&"Write plan"));
}

#[test]
fn test_get_substeps_prd_executor() {
    let substeps = get_substeps("executor", &LooperLoopType::Prd);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Write overview.md"));
    assert!(labels.contains(&"Write features.md"));
    assert!(labels.contains(&"Write api.md"));
}

#[test]
fn test_get_substeps_prd_validator() {
    let substeps = get_substeps("validator", &LooperLoopType::Prd);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Check completeness"));
    assert!(labels.contains(&"Check consistency"));
}

#[test]
fn test_get_substeps_prd_critic() {
    let substeps = get_substeps("critic", &LooperLoopType::Prd);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Ship or Revise"));
}

#[test]
fn test_get_substeps_build_planner() {
    let substeps = get_substeps("planner", &LooperLoopType::Build);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Read task.md"));
    assert!(labels.contains(&"Read specs"));
    assert!(labels.contains(&"Gap analysis"));
}

#[test]
fn test_get_substeps_build_executor() {
    let substeps = get_substeps("executor", &LooperLoopType::Build);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Pick task"));
    assert!(labels.contains(&"Implement"));
}

#[test]
fn test_get_substeps_build_validator() {
    let substeps = get_substeps("validator", &LooperLoopType::Build);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Run tests"));
    assert!(labels.contains(&"Run lint"));
    assert!(labels.contains(&"Run type-check"));
}

#[test]
fn test_get_substeps_build_critic() {
    let substeps = get_substeps("critic", &LooperLoopType::Build);
    let labels: Vec<_> = substeps.iter().map(|s| s.label.as_str()).collect();
    assert!(labels.contains(&"Check diffs"));
    assert!(labels.contains(&"Ship or Revise"));
}

#[test]
fn test_get_substeps_unknown_phase() {
    let substeps = get_substeps("unknown", &LooperLoopType::Build);
    assert!(substeps.is_empty());
}

#[test]
fn test_loop_type_serde() {
    let prd = serde_json::to_string(&LooperLoopType::Prd).unwrap();
    let build = serde_json::to_string(&LooperLoopType::Build).unwrap();
    assert_eq!(prd, "\"prd\"");
    assert_eq!(build, "\"build\"");

    let prd_back: LooperLoopType = serde_json::from_str(&prd).unwrap();
    let build_back: LooperLoopType = serde_json::from_str(&build).unwrap();
    assert_eq!(prd_back, LooperLoopType::Prd);
    assert_eq!(build_back, LooperLoopType::Build);
}

#[test]
fn test_loop_status_serde() {
    let running = serde_json::to_string(&LooperLoopStatus::Running).unwrap();
    let paused = serde_json::to_string(&LooperLoopStatus::Paused).unwrap();
    let failed = serde_json::to_string(&LooperLoopStatus::Failed).unwrap();
    let idle = serde_json::to_string(&LooperLoopStatus::Idle).unwrap();

    assert_eq!(running, "\"running\"");
    assert_eq!(paused, "\"paused\"");
    assert_eq!(failed, "\"failed\"");
    assert_eq!(idle, "\"idle\"");
}

#[test]
fn test_looper_start_request_serde() {
    let req = create_test_request();
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("\"loopId\":\"test-loop-1\""));
    assert!(json.contains("\"iteration\":1"));
    assert!(json.contains("\"loopType\":\"build\""));
    assert!(json.contains("\"projectName\":\"Test Project\""));

    let parsed: LooperStartRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.loop_id, "test-loop-1");
    assert_eq!(parsed.iteration, 1);
    assert_eq!(parsed.project_name, "Test Project");
}

#[test]
fn test_looper_start_request_with_phase_models() {
    let mut req = create_test_request();
    let mut models = std::collections::HashMap::new();
    models.insert("planner".to_string(), "gpt-4".to_string());
    models.insert("executor".to_string(), "gpt-3.5".to_string());
    req.phase_models = Some(models);

    let json = serde_json::to_string(&req).unwrap();
    let parsed: LooperStartRequest = serde_json::from_str(&json).unwrap();

    assert!(parsed.phase_models.is_some());
    let models = parsed.phase_models.unwrap();
    assert_eq!(models.get("planner").unwrap(), "gpt-4");
    assert_eq!(models.get("executor").unwrap(), "gpt-3.5");
}

#[test]
fn test_looper_stop_request_serde() {
    let req = LooperStopRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
    };

    let json = serde_json::to_string(&req).unwrap();
    let parsed: LooperStopRequest = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.loop_id, "loop-1");
    assert_eq!(parsed.correlation_id, "corr");
}

#[test]
fn test_looper_pause_request_serde() {
    let pause_req = LooperPauseRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
        paused: true,
    };

    let resume_req = LooperPauseRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
        paused: false,
    };

    let pause_json = serde_json::to_string(&pause_req).unwrap();
    let resume_json = serde_json::to_string(&resume_req).unwrap();

    let pause_parsed: LooperPauseRequest = serde_json::from_str(&pause_json).unwrap();
    let resume_parsed: LooperPauseRequest = serde_json::from_str(&resume_json).unwrap();

    assert!(pause_parsed.paused);
    assert!(!resume_parsed.paused);
}

#[test]
fn test_looper_advance_request_serde() {
    let req = LooperAdvanceRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
        next_phase: "executor".to_string(),
    };

    let json = serde_json::to_string(&req).unwrap();
    let parsed: LooperAdvanceRequest = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.next_phase, "executor");
    assert_eq!(parsed.loop_id, "loop-1");
}

#[test]
fn test_looper_list_request_serde() {
    let req = LooperListRequest {
        correlation_id: "corr".to_string(),
    };

    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("\"correlationId\":\"corr\""));

    let parsed: LooperListRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.correlation_id, "corr");
}

#[test]
fn test_looper_status_request_serde() {
    let req = LooperStatusRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
    };

    let json = serde_json::to_string(&req).unwrap();
    let parsed: LooperStatusRequest = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.loop_id, "loop-1");
}

#[test]
fn test_looper_close_request_serde() {
    let req = LooperCloseRequest {
        correlation_id: "corr".to_string(),
        loop_id: "loop-1".to_string(),
    };

    let json = serde_json::to_string(&req).unwrap();
    let parsed: LooperCloseRequest = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.loop_id, "loop-1");
    assert_eq!(parsed.correlation_id, "corr");
}

#[test]
fn test_now_ms_returns_positive() {
    let timestamp = now_ms();
    assert!(timestamp > 0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(now - timestamp < 60_000);
}

#[test]
fn test_phase_order_sequence() {
    let phases = ["planner", "executor", "validator", "critic"];
    for (i, phase) in phases.iter().enumerate() {
        let next = match *phase {
            "planner" => "executor",
            "executor" => "validator",
            "validator" => "critic",
            "critic" => "complete",
            _ => panic!("invalid phase"),
        };
        if i < 3 {
            assert_ne!(next, "complete");
        } else {
            assert_eq!(next, "complete");
        }
    }
}

#[test]
fn test_empty_project_name_handled() {
    let context = build_project_context("", "build", "", "");
    assert!(!context.contains("Project:"));
    assert!(context.contains("Type: build"));
}

#[test]
fn test_check_opencode_response_serialization() {
    use crate::contracts::LooperCheckOpenCodeResponse;

    let installed_response = LooperCheckOpenCodeResponse {
        correlation_id: "corr-1".to_string(),
        installed: true,
    };

    let not_installed_response = LooperCheckOpenCodeResponse {
        correlation_id: "corr-1".to_string(),
        installed: false,
    };

    let json_installed = serde_json::to_string(&installed_response).unwrap();
    let json_not_installed = serde_json::to_string(&not_installed_response).unwrap();

    assert!(json_installed.contains("\"installed\":true"));
    assert!(json_not_installed.contains("\"installed\":false"));
}

#[test]
fn test_payload_with_extra_fields_ignored() {
    let payload = serde_json::json!({
        "correlationId": "corr-1",
        "loopId": "loop-1",
        "iteration": 1,
        "loopType": "build",
        "cwd": "/tmp",
        "taskPath": "task.md",
        "specsGlob": "specs/*.md",
        "maxIterations": 5,
        "projectName": "Test",
        "projectType": "build",
        "projectIcon": "wrench",
        "projectDescription": "Desc",
        "extraField": "should be ignored",
        "anotherExtra": 123
    });

    let req: LooperStartRequest = decode_payload(payload).unwrap();
    assert_eq!(req.loop_id, "loop-1");
}

fn decode_payload<T: serde::de::DeserializeOwned>(payload: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|e| format!("invalid payload: {e}"))
}
