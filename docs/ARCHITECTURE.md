# Architecture Foundation

## Goal
Build a desktop AI chat application with strict layering so subsystems can be developed, tested, and migrated independently across Windows, macOS, and Linux.

## Layering Contract

1. Frontend (TypeScript)
- Pure rendering and user interaction.
- Must never contain business logic, tool policies, or persistence logic.

2. IPC Command Layer (Rust)
- Thin translation between frontend payloads and service-layer requests.
- Must never orchestrate use cases or directly call tools.

3. Application Service Layer (Rust)
- Owns orchestration/state machine behavior.
- Must never perform direct tool-side effects without registry indirection.

4. Tool Registry (Rust)
- Single policy and dispatch gateway for tools.
- Service layer calls tools only through this registry.

5. Tool Modules + Memory Manager (Rust)
- Side effects and platform-specific behavior are isolated here.
- No tool may call another tool directly.

## Dependency Direction

Allowed:
- frontend -> ipc
- ipc -> services
- services -> registry
- services -> memory manager
- registry -> tools

Forbidden:
- frontend -> services/tools/memory internals
- ipc -> tools directly
- services -> tools directly
- tool -> tool

## Tool Contract Rules
- Every tool implements a single common trait.
- Trait is platform-agnostic.
- Platform details stay private inside each tool module.
- Tool I/O is typed and explicit.

## Event and Troubleshooting Rules
- Every command and service operation must emit structured events.
- Every event must include:
  - timestamp
  - correlation_id
  - subsystem
  - action
  - stage (start, progress, complete, error)
  - severity
  - payload
- Events must avoid leaking secrets (API keys, tokens, raw credentials).

## Initial Vertical Slice
- Basic chat request from frontend
- IPC command receives request
- Service layer starts turn orchestration
- Service invokes one safe demo tool via registry
- Service emits structured events
- Frontend receives messages + event stream

## Non-Goals (Foundation Stage)
- Full model inference integration
- Full STT/TTS pipeline integration
- Full persistence schema
- Full agent loop with planner

