# Rebuild Compatibility Matrix

Date: 2026-03-24  
Owner: Rebuild track

## Status legend

- `Core portable`: no OS assumptions in core logic
- `Portable with adapter`: common interface + per-OS implementation
- `Platform-specific`: behavior intentionally differs by OS
- `Unsupported`: not available on specific OS

## Matrix

| Subsystem | Classification | Windows | macOS | Linux | Notes |
|---|---|---|---|---|---|
| Domain entities and use-case orchestration | Core portable | Yes | Yes | Yes | No direct I/O, no Tauri dependencies |
| Chat persistence (DB layer) | Portable with adapter | Yes | Yes | Yes | File/path location via OS adapter |
| Model provider API integrations | Core portable | Yes | Yes | Yes | Network/config adapters only |
| Local inference process management | Portable with adapter | Yes | Yes | Yes | Process spawn/signals differ by OS |
| GPU backend selection | Platform-specific | CUDA/Direct path | Metal | CUDA/ROCm/Vulkan | Capability-driven fallback required |
| Tool runner contract layer | Core portable | Yes | Yes | Yes | Side effects mediated by adapters |
| Filesystem tool | Portable with adapter | Yes | Yes | Yes | Root allowlist + path normalization |
| Shell/process tool | Platform-specific | Yes | Yes | Yes | Quoting/exec semantics differ |
| Browser/web fetch tool | Core portable | Yes | Yes | Yes | Network policy enforced centrally |
| Voice capture (mic input) | Portable with adapter | Yes | Yes | Yes | Backend audio stack differences |
| TTS runtime orchestration | Portable with adapter | Yes | Yes | Yes | Runtime path and dependencies differ |
| Keychain/secure storage | Portable with adapter | Yes | Yes | Yes | Native secure storage adapter per OS |
| Window controls/desktop notifications | Platform-specific | Yes | Yes | Yes | Tauri window behavior differences |
| Memory retrieval core logic | Core portable | Yes | Yes | Yes | Ranking/retrieval deterministic |
| Memory extraction pipeline | Portable with adapter | Yes | Yes | Yes | Background scheduling via runtime adapter |

## Required CI smoke checks per OS

1. App boot
2. Settings load/save
3. Send/stream/cancel chat
4. Tool registry loads
5. One safe tool invocation
6. Key filesystem/path resolution path

