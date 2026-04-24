# Startup Follow-Ups

- Add explicit initializing UI for deferred tool tabs, especially OpenCode and Looper.
- Restore `opencodeNeedsInit` and `looperNeedsInit` when deferred initialization fails so retries still work.
- Smoke test startup when the persisted tab is `opencode-tool`.
- Smoke test startup when the persisted tab is `looper-tool`.
- Review deferred startup console events for noise and usefulness.
- Revisit code-splitting for `main.ts`, `opencode`, and `looper` after startup behavior is hardened.
