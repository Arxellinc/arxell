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

## Platform Compliance
- [ ] Platform-specific logic isolated to tool module.
- [ ] Service/contract code remains platform-neutral.

