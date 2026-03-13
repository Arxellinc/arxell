# arx Documentation Index

arx is a local-first Rust + Tauri desktop application for AI chat, local model serving, voice interaction (STT/TTS/VAD), project/workspace editing, and agent-style task execution with multiple in-app tool panels.

- Detected app version: `0.8.0` (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`)

## Table of Contents
- [01_product_overview.md](./01_product_overview.md): What arx is, who it is for, and what it can do.
- [02_system_requirements.md](./02_system_requirements.md): OS/hardware/software prerequisites and platform notes.
- [03_installation_and_setup.md](./03_installation_and_setup.md): Full setup from source and first-run verification.
- [04_quick_start.md](./04_quick_start.md): Fastest path from install to first useful workflow.
- [05_user_guide.md](./05_user_guide.md): UI walkthrough and practical feature usage.
- [06_models_and_configuration.md](./06_models_and_configuration.md): Local models, API models, runtime engines, and settings.
- [07_autonomous_agent.md](./07_autonomous_agent.md): How agent behavior works, including task/auto mode behavior.
- [08_agent_safeguards.md](./08_agent_safeguards.md): Current safety boundaries, guardrails, and known gaps.
- [09_technical_architecture.md](./09_technical_architecture.md): Backend/frontend architecture, data flow, and concurrency model.
- [10_api_and_ipc_reference.md](./10_api_and_ipc_reference.md): Complete Tauri command/event reference.
- [11_developer_guide.md](./11_developer_guide.md): Dev environment, build/test/debug workflow, and extension points.
- [12_theming_and_customization.md](./12_theming_and_customization.md): What is themeable today and how to evolve it.
- [13_administration_and_operations.md](./13_administration_and_operations.md): Data paths, backups, operations, and maintenance.
- [14_troubleshooting.md](./14_troubleshooting.md): Common failures, diagnostics, and recovery steps.
- [15_release_notes.md](./15_release_notes.md): Current release notes and changelog template.
- [16_appendices.md](./16_appendices.md): Glossary, license/dependency attribution, and external references.
- [guardrails.md](./guardrails.md): Modular tool guardrails, capability modes, gateway policy, and console boundaries.

## Which Doc Do I Need?
- Install and run quickly: `03`, then `04`
- Learn the UI and daily usage: `05`
- Set up models and runtimes: `06`
- Understand agent behavior and safety: `07`, `08`
- Contribute code: `09`, `10`, `11`
- Operate and maintain over time: `13`, `14`
- Customize look/feel: `12`
