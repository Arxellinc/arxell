# Administration and Operations

## Data locations
The backend uses Tauri `app_data_dir()` and stores:
- SQLite database: `arx.db`
- `models/` directory for GGUF files
- `engines/` directory for runtime binaries
- `skills/` directory for skill markdown files

Exact OS path depends on Tauri conventions for each platform.

## What is stored
- Projects/conversations/messages/settings/model configs in SQLite.
- API keys currently stored in plain settings values.
- Runtime/model metadata and operational logs/events in memory/UI logs.

## Backup and restore
Backup:
1. Stop app.
2. Copy app data directory (DB + models + engines + skills).

Restore:
1. Stop app.
2. Replace app data directory with backup copy.
3. Start app and verify settings/conversations/models.

## Logs and diagnostics
- Backend emits `log:*` events.
- Terminal panel includes backend log tab and frontend console tab.
- Voice diagnostics command provides structured pass/fail checks.

## Uninstall and cleanup
- Remove app binary/package.
- Remove app data directory to fully clear state/models/engines/skills.

## Performance tuning
- Prefer GPU runtime/backend where available.
- Use smaller quantized models for low-memory systems.
- Tune context and generation parameters to reduce compute load.

## Security operations guidance
- Use least-privilege API keys.
- Prefer local endpoints where possible.
- Keep terminal destructive commands blocked by default.
- Keep project/workspace scope tight.
