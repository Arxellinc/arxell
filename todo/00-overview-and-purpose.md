# ARX: Overview, Purpose, and Strategic Direction

_Review date: March 2026_

---

## What ARX Is

ARX is a local-first AI desktop application built with Tauri (Rust backend) and React/TypeScript frontend. It combines:

- **Chat interface** with streaming AI responses and multi-turn conversation history
- **Local LLM inference** via llama.cpp with full GPU support (CUDA, Metal, Vulkan, ROCm)
- **Voice I/O** — whisper-based STT and Kokoro ONNX-based TTS
- **Code/terminal workspace** — Monaco editor, xterm PTY, file browser
- **Agent-to-agent workflow system (A2A)** — DAG-based process orchestration
- **Tool plugin architecture** — 23+ tool manifests, extensible via tool packs
- **Skills/agents context system** — loads `.agents` and `.skills` from project directories

The app is heading toward public launch (v0.9.x) and is preparing for a strategic capability shift.

---

## Strategic Shift: Toward Autonomous REPL Loops

The near-term goal is to enable the **primary agent** to create and manage **true REPL loops** — long-running, structured agentic processes that:

- Run continuously across many turns without human re-prompting
- Delegate sub-tasks to **specialized architect agents** (coding agent, research agent, business analyst, etc.)
- Are organized through a **Flow Tool** with templates for common task patterns
- Can be paused, resumed, monitored, and composed

### Key Use Cases for REPL Loops

| Domain | Loop Pattern | Expected Outcome |
|---|---|---|
| **Coding** | Architect → Implementer → Tester | Full feature implementation from spec |
| **Business analysis** | Researcher → Analyst → Summarizer | Comprehensive reports |
| **Due diligence** | Data collector → Reviewer → Risk scorer | Structured diligence output |
| **Personal assistant** | Planner → Executor → Reporter | Calendar, email, task management |
| **Automation** | Trigger → Worker → Notifier | Event-driven pipelines |

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Desktop App                 │
│                                                     │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │  React Frontend │◄──►│   Rust Backend       │   │
│  │  (TypeScript)   │    │   (src-tauri/)       │   │
│  │                 │    │                      │   │
│  │  - Chat UI      │    │  - AppState          │   │
│  │  - Flow Panel   │    │  - DB (SQLite)       │   │
│  │  - Workspace    │    │  - A2A Workflow      │   │
│  │  - Voice UI     │    │  - Audio pipeline    │   │
│  │  - Tool panes   │    │  - Model manager     │   │
│  └─────────────────┘    └──────────────────────┘   │
│                                  │                  │
│                         ┌────────┴────────┐         │
│                         │  Agent Crate    │         │
│                         │  (agent/)       │         │
│                         │                │         │
│                         │  - Agent       │         │
│                         │  - Turn runner │         │
│                         │  - Session     │         │
│                         │  - Provider    │         │
│                         │  - Tools       │         │
│                         └─────────────────┘         │
│                                  │                  │
│                    ┌─────────────┴──────────┐       │
│                    │  llama.cpp server      │       │
│                    │  (external process)    │       │
│                    └────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

---

## Current Codebase Dimensions

| Area | Language | Files | Approx. Lines |
|---|---|---|---|
| Tauri commands | Rust | 20 | ~8,000 |
| Core modules | Rust | ~30 | ~15,000 |
| Agent crate | Rust | ~20 | ~4,000 |
| Frontend components | TypeScript/React | ~80 | ~25,000 |
| Tool manifests | TypeScript | 23 | ~3,000 |
| Zustand stores | TypeScript | ~20 | ~8,000 |

---

## File Index for This Review

| File | Contents |
|---|---|
| `00-overview-and-purpose.md` | This file — big picture |
| `01-architecture-deep-dive.md` | Module-by-module architecture analysis |
| `02-key-process-traces.md` | Detailed tracing of critical code paths |
| `03-stability-and-platform-issues.md` | Cross-platform stability gaps (Linux/macOS/Windows) |
| `04-flow-tool-and-agent-loops-current.md` | Current state of flow tool and A2A |
| `05-repl-loops-vision-and-design.md` | Design for true REPL loops via flow tool |
| `06-library-adoption-and-rust-build.md` | What to adopt vs. build, library recommendations |
| `07-simplification-opportunities.md` | Areas to simplify without losing capability |
| `08-launch-readiness.md` | Pre-launch checklist and priority order |
