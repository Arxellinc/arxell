# Engineering Guardrails

## Scope Guardrails
- Build only through defined contracts.
- Avoid hidden couplings and global mutable state.
- Favor deterministic behavior and explicit error propagation.

## Layer Guardrails
- Frontend is presentation only.
- IPC is translation only.
- Services orchestrate only.
- Registry dispatches only.
- Tools execute side effects only.

## Observability Guardrails
- No silent failures.
- All failures emit structured error events.
- All long-running operations emit start and complete events.
- Correlation IDs must be preserved from UI -> IPC -> services -> tools.

## Security Guardrails
- Never include secrets in event payloads.
- Redact known secret-like fields before emission.
- Tool policy checks happen before tool execution.

## Platform Guardrails
- Platform branches are allowed only in tool modules.
- Service and contracts remain platform-agnostic.

## Voice Guardrails
- Voice session state transitions must follow the documented state machine (`idle` → `starting` → `running` → `stopping` → `idle`).
- VAD handoff must never leave both methods active without a clear primary/shadow distinction.
- Duplex mode changes must emit a snapshot response confirming the new state.
- Audio data must not appear in event payloads; use counts and status indicators.

## Plugin Guardrails
- Custom tool and plugin capability invocations must go through `cmd_custom_tool_capability_invoke` or `cmd_plugin_capability_invoke`.
- Plugin iframes are sandboxed; they must not access Tauri APIs directly.
- Capability invocations must validate the capability name against the registered set before execution.
- Plugin errors must return structured error responses with error codes, not panics.

## Dependency Guardrails
- Minimize dependencies by default.
- No CSS framework required for base UI.
- No remote font dependencies (Google Fonts, CDN fonts).

