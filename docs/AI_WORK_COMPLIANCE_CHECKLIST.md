# AI Work Compliance Checklist

Use this checklist for every AI-assisted change.

## Boundary Compliance
- [ ] Change only touches the intended layer.
- [ ] No forbidden dependency edges introduced.
- [ ] Service layer does not call tools directly.
- [ ] Tool-to-tool calls do not exist.

## Contract Compliance
- [ ] Inputs/outputs are typed in shared contracts.
- [ ] Backward compatibility impact is documented.
- [ ] Error shape is consistent with existing API contract.

## Observability Compliance
- [ ] Start/complete/error events emitted.
- [ ] Correlation ID preserved through all layers.
- [ ] Payloads redact sensitive values.

## Testing Compliance
- [ ] Unit tests for new orchestration behavior.
- [ ] Tool contract tests for changed tools.
- [ ] Event emission path tested for success and failure.

## Voice Compliance
- [ ] Voice session state transitions follow the documented state machine.
- [ ] VAD method changes emit runtime snapshot confirming new state.
- [ ] Audio data does not appear in event payloads.
- [ ] Handoff leaves no orphaned active methods.

## Plugin Compliance
- [ ] Plugin capability invocations use the designated IPC commands.
- [ ] Capability names validated before execution.
- [ ] Plugin errors return structured responses with error codes.
- [ ] Plugin iframes are sandboxed from direct Tauri API access.

## Platform Compliance
- [ ] Platform-specific logic isolated to tool module.
- [ ] Service/contract code remains platform-neutral.

