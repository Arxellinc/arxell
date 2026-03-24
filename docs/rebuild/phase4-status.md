# Phase 4 Status (March 24, 2026)

## Summary

Phase 4 ("Tool runtime and Tier-1 tools") is complete for current checklist scope.

## Completed Evidence

- Application-layer tool runtime added:
  - `crates/application/src/tool_runtime.rs`
  - `ToolRunner` enforces input validation, timeout bounds, and cooperative cancellation checks
- Tool call telemetry with `tool_call_id` is emitted through typed events:
  - `AppEvent::ToolCallStarted`
  - `AppEvent::ToolCallFinished`
- Tool runtime contract tests are passing:
  - `contract_tool_runner_emits_started_and_finished_with_tool_call_id`
  - `contract_tool_runner_enforces_timeout`
  - `contract_tool_runner_enforces_cancellation`
  - `contract_tool_runner_validates_required_fields`
- Tier-1 concrete tool adapters migrated behind the runner:
  - `help.workspace.read_file`
  - `help.workspace.list_dir`
- Tier-1 concrete contract tests are passing:
  - `contract_help_read_file_tool_reads_content`
  - `contract_help_list_dir_tool_lists_children`

## Closure Note

- Tool call telemetry now includes generated or caller-provided `tool_call_id`, plus `correlation_id` and `run_id`, through gateway event publishing logs.
