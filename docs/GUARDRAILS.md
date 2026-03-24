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

## Dependency Guardrails
- Minimize dependencies by default.
- No CSS framework required for base UI.
- No remote font dependencies (Google Fonts, CDN fonts).

