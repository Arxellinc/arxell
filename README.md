<div align="center">

# Arxell

**Privacy-first desktop AI workstation**

Chat, voice, code, and local inference — fully offline, cross-platform, yours.

[![Build](https://img.shields.io/github/actions/workflow/status/anomalyco/arxell/build-desktop.yml?branch=main&style=flat-square&label=build)](https://github.com/anomalyco/arxell/actions/workflows/build-desktop.yml)
[![Version](https://img.shields.io/badge/version-0.2.7-blue?style=flat-square)](https://github.com/anomalyco/arxell)
[![License](https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/tauri-v2-orange?style=flat-square)](https://v2.tauri.app)

[Features](#features) · [Architecture](#architecture) · [Getting Started](#getting-started) · [Documentation](#documentation) · [Development](#development)

</div>

---

## Why Arxell

Most AI tools send everything to the cloud. Arxell runs **locally** on your machine — your conversations, your API keys, your models, your files. Nothing leaves your machine unless you explicitly connect to an external provider.

- **No cloud dependency** — works fully offline with local models
- **Your keys stay yours** — API keys stored in your OS keychain, never transmitted
- **Your data stays local** — conversations, files, and settings live in `~/.arxell`
- **Cross-platform** — native desktop app for Windows, macOS, and Linux
- **Extensible** — workspace tools, agent skills, and plugin support

---

## Features

### AI Chat

Multi-conversation chat interface with streaming responses, thinking/reasoning display, and agent loop integration. Connect to any OpenAI-compatible API or run models locally through llama.cpp.

- Streaming text and reasoning chunks
- Multi-conversation management with history
- Thinking mode toggle (chain-of-thought visibility)
- File attachments in messages
- TTS playback of responses
- Voice mode with full-duplex conversation

### Voice Pipeline

Full speech-to-text and text-to-speech subsystems with configurable voice activity detection.

| Component | Backend | Details |
|-----------|---------|---------|
| **Speech-to-Text** | whisper.cpp | Streaming transcription, partial results, configurable VAD |
| **Text-to-Speech** | Kokoro (ONNX) | 53+ voices across American, British, Japanese, Chinese accents |
| **VAD** | Multiple methods | Method selection, shadow evaluation, live handoff between methods |

Voice runtime supports single-turn, full-duplex speculative, and shadow-only duplex modes with real-time state machine management.

### Local Inference

Run GGUF models directly on your hardware through llama.cpp with automatic backend selection.

| Backend | Platforms | Auto-detection |
|---------|-----------|----------------|
| CUDA | Windows, Linux | `nvidia-smi` probe |
| Metal | macOS | Always available on Apple Silicon |
| Vulkan | Windows, Linux | Runtime/driver detection |
| CPU | All | Universal fallback |

Model Manager connects to HuggingFace — search, download, and manage GGUF models with progress tracking and the Unsloth dynamic quantization catalog.

### Image Generation

Local image generation using FLUX.1 Schnell via stable-diffusion.cpp with GGUF quantized weights.

- **Model**: FLUX.1 Schnell (Apache-2.0)
- **Quantization**: GGUF Q4\_0 default (~11 GB download)
- **Resolution**: 512×512 to 1024×1024
- **Backend**: Auto-detected GPU with CPU fallback
- **No Python/PyTorch required** — pure C++ sidecar

### Workspace Tools

11 builtin tools for productivity, all accessible from the workspace panel and available to the agent runtime.

| Tool | Category | Description |
|------|----------|-------------|
| **Terminal** | workspace | PTY-based shell sessions |
| **Files** | workspace | File browser and editor |
| **Sheets** | data | Spreadsheet editor with formulas and agent access |
| **Notepad** | workspace | Tabbed text editor |
| **WebSearch** | agent | Web search integration |
| **Chart** | agent | Mermaid flowcharts and diagrams |
| **Tasks** | agent | Task planning and tracking |
| **Memory** | data | Persistent context references |
| **Looper** | automation | Multi-agent build loop orchestration |
| **OpenCode** | automation | AI coding agent |
| **Docs** | workspace | Documentation browser |

Tools support enable/disable, icon customization, and import/export of workspace configurations.

### Agent Skills

8 specialized skills that guide the agent runtime through complex workflows — from product vision to database engineering.

| Skill | Scope |
|-------|-------|
| Core Orchestrator | Agent architecture, control loops, memory, approvals |
| Product Visionary | Scope, differentiation, roadmap, success metrics |
| Product Designer | PRDs, UX design, trust/approval patterns |
| Planning & Specs | Contract-first specs, phase decomposition |
| Backend Engineer | Run lifecycle, orchestrators, tool routers, reliability |
| Frontend Engineer | Agent UX surfaces, streaming state, recovery |
| Evals & Guardrails | Test suites, observability, rollout criteria |
| Database Engineer | Schema, migrations, performance, backups |

### Security

- API keys stored in your OS keychain (via `keyring`)
- Plaintext fallback requires explicit user acknowledgment
- Secrets never appear in event payloads
- Tool policy checks before execution
- Plugin tools run in sandboxed iframes

---

## Architecture

Arxell follows a strict layered architecture with forbidden dependency paths to keep subsystems independently testable and migratable.

```
┌─────────────────────────────────────────┐
│           Frontend (TypeScript)          │
│         Vite · xterm.js · Three.js       │
├─────────────────────────────────────────┤
│           IPC Command Layer (Rust)       │
│     Tauri bridge · 96 typed commands     │
├─────────────────────────────────────────┤
│        Application Services (Rust)       │
│  Chat · Voice · Runtime · Files · etc.  │
├─────────────────────────────────────────┤
│          Tool Registry (Rust)            │
│     Policy gateway · Tool dispatch       │
├─────────────────────────────────────────┤
│       Tool Modules (Rust / C++)          │
│  Terminal · Sheets · Search · sd-cli     │
└─────────────────────────────────────────┘
```

**Dependency direction:** Frontend → IPC → Services → Registry → Tools

**Forbidden:** Frontend → services directly, tools calling tools, IPC → tool modules directly

All operations emit structured events with correlation IDs, timestamps, subsystem, action, stage, and severity — giving you full observability from UI click to backend execution.

### Backend Services

| Service | Purpose |
|---------|---------|
| Chat Service | Message handling, agent loop, tool binding, streaming |
| Terminal Service | PTY sessions with streaming output |
| LLaMA Runtime Service | Engine discovery, installation, start/stop |
| Model Manager Service | GGUF model lifecycle, HuggingFace integration |
| Image Generation Service | stable-diffusion.cpp sidecar, GGUF model management |
| Voice Runtime Service | VAD method selection, duplex modes, handoff |
| API Registry Service | API connection CRUD, secret storage |
| Files Service | Filesystem operations with permission checks |
| Web Search Service | Search query execution |
| Sheets Service | Spreadsheet state, formulas, agent access |
| Looper Handler | Multi-phase build loop orchestration |
| Permission Service | Tool action and file access enforcement |

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| TypeScript | UI logic and rendering |
| Vite | Build tooling |
| xterm.js | Terminal emulator |
| Three.js | 3D avatar rendering |
| Mermaid | Diagram visualization |
| highlight.js | Syntax highlighting |

### Backend

| Technology | Purpose |
|------------|---------|
| Rust | Core application logic |
| Tauri v2 | Desktop framework and IPC |
| SQLite (rusqlite) | Local persistence |
| tokio | Async runtime |
| ONNX Runtime | TTS inference |
| llama.cpp | Local LLM inference |
| stable-diffusion.cpp | Local image generation |
| whisper.cpp | Speech-to-text |
| reqwest | HTTP client |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Rust** stable (via rustup)
- **Tauri CLI** v2 (`cargo install tauri-cli --version "^2"`)

### Build and Run

```bash
# Clone the repository
git clone https://github.com/anomalyco/arxell.git
cd arxell

# Install frontend dependencies
cd frontend && npm install && cd ..

# Development mode (two terminals)
cd frontend && npm run dev          # Terminal 1: frontend dev server
cd src-tauri && cargo tauri dev     # Terminal 2: Tauri app

# Production build
cd src-tauri && cargo tauri build
```

### Quick Checks

```bash
# Frontend type check
cd frontend && npm run lint

# Frontend tests
cd frontend && npm run test

# Rust compilation check (no Tauri)
cd src-tauri && cargo check

# Rust compilation check (with Tauri)
cd src-tauri && cargo check --features tauri-runtime
```

---

## Project Structure

```
arxell/
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── app/                  # Application services
│   │   │   ├── chat_service.rs
│   │   │   ├── terminal_service.rs
│   │   │   ├── runtime_service.rs
│   │   │   ├── model_manager_service.rs
│   │   │   ├── image_generation_service.rs
│   │   │   ├── voice_runtime_service.rs
│   │   │   └── ...
│   │   ├── agent_tools/          # Tools exposed to the agent loop
│   │   ├── contracts.rs          # Typed IPC request/response contracts
│   │   ├── ipc/                  # IPC command handlers
│   │   ├── skills/               # Agent skill definitions
│   │   ├── stt/                  # Speech-to-text subsystem
│   │   ├── tts/                  # Text-to-speech subsystem
│   │   ├── tools/                # Workspace tool invoke handlers
│   │   ├── voice/                # Voice/VAD subsystem
│   │   ├── workspace_tools/      # Backend workspace registry
│   │   └── main.rs               # Tauri entry point
│   └── Cargo.toml
├── frontend/
│   └── src/
│       ├── panels/               # Sidebar panel renderers
│       ├── tools/                # Workspace tool implementations
│       │   ├── terminal/
│       │   ├── files/
│       │   ├── sheets/
│       │   ├── chart/
│       │   └── ...
│       ├── contracts.ts          # TypeScript contract mirrors
│       ├── styles.css            # Global styles and CSS variables
│       ├── main.ts               # App entry and state management
│       └── ipcClient.ts          # IPC client (Tauri + mock)
├── agent/                        # Agent runtime (local Rust crate)
├── docs/                         # Architecture and integration docs
└── .github/workflows/            # CI/CD pipelines
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Layering contract, subsystems, dependency rules |
| [Tools Architecture](docs/TOOLS_ARCHITECTURE.md) | Tool types, rendering, invoke flow, adding new tools |
| [IPC Events](docs/IPC_EVENTS.md) | Command reference, event contracts, streaming actions |
| [Tauri Integration](docs/TAURI_INTEGRATION.md) | Bridge state, registered commands, event forwarding |
| [Guardrails](docs/GUARDRAILS.md) | Engineering constraints for security, layers, observability |
| [Smoke Test](docs/SMOKE_TEST.md) | Manual and automated test procedures |
| [macOS Setup](docs/MACOS_SETUP_GUIDE.md) | macOS-specific build instructions |

---

## Development

### Adding a Workspace Tool

1. Create `frontend/src/tools/<toolId>/manifest.ts` with metadata
2. Add render functions in `index.tsx`, state in `state.ts`, bindings in `bindings.ts`
3. Add the tool ID to `PREFERRED_TOOL_ORDER` in `frontend/src/tools/registry.ts`
4. Add a builtin manifest in `src-tauri/src/workspace_tools/mod.rs`
5. Add the rendered view in `frontend/src/tools/host/viewBuilder.ts`
6. Add event dispatch hooks in `frontend/src/tools/host/workspaceDispatch.ts`
7. Add backend invoke handlers (only if backend behavior is needed)
8. Add agent tool bindings (only if the model needs direct capability)

Full checklist in [docs/TOOLS_ARCHITECTURE.md](docs/TOOLS_ARCHITECTURE.md).

### Code Conventions

- **Frontend**: Pure rendering — no business logic, no persistence, no tool policies
- **IPC**: Thin translation layer — no orchestration, no direct tool calls
- **Services**: Orchestration only — no direct tool side effects
- **Tools**: Side effects and platform-specific behavior — no cross-tool calls
- **Events**: Every operation emits structured events with correlation IDs
- **Security**: Never include secrets in event payloads

### CSS Guidelines

- Use CSS variables from `frontend/src/styles.css` — never hardcode colors or font sizes
- Use shared utility classes (`.field-input`, `.modal-box`, `.data-table`, etc.)
- Scope tool-specific styles with the tool name prefix
- No CSS frameworks, no remote font dependencies

---

## CI/CD

Automated builds run on every push to `main` and on version tags:

| Platform | Runner | Artifacts |
|----------|--------|-----------|
| Linux x64 | ubuntu-24.04 | `.deb`, `.AppImage` |
| macOS | macos-latest | `.dmg` |
| Windows x64 | windows-latest | `.msi` |

The pipeline automatically:
- Runs frontend type checks, tests, and production build
- Runs Rust `cargo test` with Tauri features
- Downloads and bundles llama.cpp runtimes (CPU, Vulkan, Metal)
- Downloads and bundles whisper.cpp + Kokoro TTS runtimes
- Builds platform-specific Tauri bundles
- Publishes GitHub Releases on version tags

---

## Data Storage

All user data is stored locally in `~/.arxell/`:

```
~/.arxell/
├── conversations.sqlite3         # Chat history
├── api-registry/                  # API connection metadata
├── engines/                       # Engine binaries
│   ├── llama-runtime/             # llama.cpp engines
│   └── sd-cpp/                    # stable-diffusion.cpp binary
├── models/                        # Downloaded models
│   └── flux/schnell/q4_0/         # FLUX.1 Schnell GGUF models
├── outputs/                       # Generated content
│   └── images/                    # Generated images
├── tools-registry.json            # Workspace tool settings
├── image-generation/              # Image generation settings
└── voice/                         # Voice configuration
```

API keys are stored in your OS keychain — never in plaintext files.

---

## License

Apache License 2.0
