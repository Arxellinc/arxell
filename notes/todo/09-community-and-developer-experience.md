# Community Involvement and Developer Experience

Making ARX easy for contributors to understand, build, and extend.

---

## The Core Problem

A complex codebase that spans Rust, TypeScript, Python scripts, ONNX models, and C++ binaries (llama-server) has a high barrier to contribution. Reducing that barrier does not mean reducing capability — it means making the architecture more legible to newcomers.

The goal: a developer who has never seen ARX should be able to:
1. Build the app locally in < 30 minutes
2. Understand the architecture in < 1 hour by reading docs
3. Make a meaningful contribution (fix a bug, add a tool) in < 1 day

---

## 1. Architecture Document

The most impactful contribution enabler is a clear architecture document. Not a wiki page — a versioned `docs/architecture.md` or `ARCHITECTURE.md` in the repo root.

It should cover:
- What the app does (3 sentences)
- The big picture diagram (similar to what's in `00-overview-and-purpose.md`)
- Which directory does what
- How to add a new tool (step-by-step)
- How the agent loop works
- How to add a new Tauri command
- Where settings are stored
- How the audio pipeline fits together

Without this document, every contributor's first task is to reverse-engineer the architecture from the code. That's the work this review did — but it took hours. A good architecture doc reduces that to 30 minutes.

---

## 2. Getting Started Guide

The `CONTRIBUTING.md` should have a concrete "Getting Started" section:

```markdown
## Development Setup

### Prerequisites
- Rust (stable, >= 1.75)
- Node.js >= 20
- On Linux: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev clang`
- On macOS: `xcode-select --install`
- On Windows: Visual Studio 2022 Build Tools + Clang

### Quick Start
1. `git clone https://github.com/arxell/arx`
2. `cd arx && npm install`
3. `npm run tauri dev`

The first build will take 5–10 minutes (Rust compilation).
Subsequent builds: 30–60 seconds.

### Run Tests
- `cargo test -p arx-rs` — run Rust agent tests
- `npm run test` — run frontend tests (if configured)
```

Currently, a new contributor must piece this together from the README and various scripts. Make it explicit.

---

## 3. Good First Issues

Tag 5–10 issues as "good first issue" before the public launch. These should be:
- Self-contained (don't require understanding the whole codebase)
- Well-specified (expected behavior described)
- Testable (contributor can verify their fix)

Good candidates based on this review:
- "Add WAL mode to database init" (1-line change, well-described fix)
- "Add startup progress events from Rust" (well-defined scope, medium effort)
- "Standardize error return types in commands/" (clear pattern to follow)
- "Add Windows CREATE_NO_WINDOW flag to subprocess launchers" (well-defined, Windows-specific)
- "Write architecture diagram" (non-code contribution, high value)
- "Add a new tool manifest for [X]" (uses existing pattern, low risk)

---

## 4. The Tool Plugin System as a Contribution Funnel

The tool manifest system is the most contributor-friendly part of the codebase. Adding a new tool follows a clear pattern:

1. Create `src/tools/[name]/manifest.ts` — define the tool metadata
2. Create `src/tools/[name]/[Name]Panel.tsx` — optional UI component
3. Register in the tool catalog

This is self-contained TypeScript/React work with no Rust knowledge required. It should be highlighted prominently as the primary way for frontend contributors to add value.

Write a template tool with a clear "copy this and customize" comment in the manifest.

---

## 5. The Agent Crate as a Standalone Library

The `agent/` crate is already structured as a standalone Rust library. After the REPL loop work, it will become a complete multi-agent orchestration library that could be published as a crate.

Publishing `arx-agent` to crates.io would:
- Give the project visibility in the Rust ecosystem
- Allow other developers to build on the agent/tool/session system outside of Tauri
- Create a community around the agent loop design

**Prerequisite:** The crate needs:
- A stable public API (no breaking changes without semver bumps)
- Documentation (`cargo doc`)
- Examples in `agent/examples/`
- At least one integration test

This is medium-term work but the architecture is already there.

---

## 6. Make the Build Reproducible

Currently, build success depends on:
- Correctly installed system libraries (different on every distro)
- Python version for voice scripts
- Correct GPU driver for the target backend

A developer who clones the repo on a fresh machine will hit setup issues. Reduce this with:

### Option A: Dev Container (`.devcontainer/`)

A Docker dev container pre-configured with all Rust, Node.js, and system library dependencies. Works in VS Code and GitHub Codespaces. Developers get a working environment in 5 minutes regardless of host OS.

### Option B: Nix Flake (`flake.nix`)

For Nix users (growing community), a flake that declares the full build environment reproducibly. This is the gold standard for reproducible Rust builds.

### Minimum: Document System Dependencies Per Platform

At minimum, document the exact package names for each major Linux distro, macOS (Homebrew), and Windows (winget/choco). This is the lowest effort and covers most contributors.

---

## 7. Type Safety Across the IPC Boundary

This is mentioned in the architecture review but bears repeating from a community perspective.

When a contributor adds a new Tauri command or event, they must:
1. Define the Rust struct
2. Manually write a matching TypeScript type
3. Hope they got it right

With `tauri-specta`, step 2 and 3 are automatic. The TypeScript types are generated from the Rust types at build time. This means:
- Contributors don't have to understand both Rust and TypeScript to make a safe change
- TypeScript contributors can see the types without reading Rust
- Type errors surface at build time, not runtime

This is one of the highest-leverage changes for enabling community contributions.

---

## 8. License Clarity

The repo has a `LICENSE` file and `CommercialLicenseModal` in the frontend, suggesting a dual license model (open source + commercial). Before public launch:

- Make the license status completely clear in the README
- If there are restrictions on commercial use, state them plainly
- If there are contributor license agreement (CLA) requirements, document them
- Unclear licensing discourages community contributions

---

## 9. CI/CD for Pull Requests

A CI pipeline that runs on every PR:
1. `cargo build` — verify Rust compiles
2. `cargo test` — run Rust tests
3. `npm run build` — verify TypeScript compiles
4. `npm run lint` — enforce code style
5. `cargo clippy -- -D warnings` — catch common Rust issues

Without CI, contributors don't know if their PR is correct until a maintainer reviews it. With CI, contributors get immediate feedback and maintainers review only passing PRs.

The Tauri build itself is heavy; it can be deferred to a separate workflow that runs before merge.

---

## 10. The "One Repo, Three Audiences" Problem

ARX's codebase serves three different audiences who need different things:
- **End users**: Just want it to work; don't care about code
- **Frontend contributors**: TypeScript/React developers who want to add UI features
- **Systems contributors**: Rust developers who want to improve performance/stability

Each audience should have a clear entry point:
- For users: README with install guide and quick start
- For frontend contributors: `docs/frontend-guide.md` explaining the tool system and component patterns
- For systems contributors: `docs/architecture.md` explaining the Rust module structure and how to add commands

This does not require rewriting any code — just organizing documentation to address each audience clearly.

---

## Immediate Actions for Community Readiness

| Action | Effort | Impact |
|---|---|---|
| Tag 5 "good first issues" | 1 hour | Opens door for contributors |
| Expand CONTRIBUTING.md with setup steps | 2 hours | Reduces first-build failures |
| Write architecture overview doc | 4 hours | Biggest contributor enabler |
| Create tool template with instructions | 2 hours | Frontend contributions funnel |
| Add CI for build + lint | 3 hours | Quality gate for PRs |
| Clarify license in README | 30 min | Removes uncertainty |
| Add specta type generation | 1–2 days | IPC type safety |
