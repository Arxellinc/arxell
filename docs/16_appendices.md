# Appendices

## Glossary
- `GGUF`: model file format for llama.cpp ecosystem.
- `VAD`: Voice Activity Detection.
- `STT`: Speech-to-Text.
- `TTS`: Text-to-Speech.
- `IPC`: Inter-process communication (frontend ↔ backend commands/events).
- `MCP`: Model Context Protocol server definitions used by the app’s MCP panel.
- `Prefill`: speculative request sent to prime cache before final user utterance.

## License information
- No top-level LICENSE file was identified in reviewed source paths.
- Add explicit project license documentation if intended for distribution.

## Third-party dependency attribution (significant)
### Frontend (package.json)
- React, React DOM
- Zustand
- Monaco editor bindings
- Radix UI components
- Lucide icons
- React markdown + GFM + highlight
- Tauri JS APIs/plugins

### Backend (Cargo.toml)
- Tauri + plugins (`dialog`, `fs`, `shell`)
- Tokio, Reqwest
- Rusqlite
- Serde/serde_json
- `llama-cpp-2` (optional feature-based)
- `gguf`, `memmap2`, `sysinfo`, `zip`
- Audio/ML: `cpal`, `tract-onnx`, `hound`

License metadata for each dependency is not fully documented in source docs reviewed; verify via package registries and lockfiles during release/legal checks.

## Compliance/standards considerations
- Desktop security posture should be reviewed for file/shell access scope.
- API key handling is currently plain-text settings storage.

## External references
- Tauri docs: https://tauri.app/
- Rust docs: https://www.rust-lang.org/
- llama.cpp: https://github.com/ggml-org/llama.cpp
- OpenAI API compatibility reference (for endpoint semantics)
