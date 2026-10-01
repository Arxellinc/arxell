# First-run GGUF onboarding

## Scope and behavior

The custom GGUF row provides **Download** and **Browse**. Download opens the fixed Hugging Face text-generation catalog in the system browser; it does not download a model into Arxell or set the runtime model path. The user downloads a GGUF file externally and then selects it with Browse. Preset downloads continue to use the existing model-manager IPC.

- Browse cancellation preserves the prior model selection and paths.
- Invalid extensions and rejected picker promises produce an inline message without persisting a new path.
- While browsing, opening the catalog, or downloading a preset, actions are disabled and handlers also reject reentry/navigation/completion.
- Custom Finish requires a `.gguf` path, restores that selected path if a preset download changed the runtime path, and requests startup only once.
- Preset Finish and Skip retain their existing behavior. Extension validation is UI eligibility, not proof that a file exists, is valid GGUF, or fits available memory; runtime loading remains responsible for those checks.

## Ownership and permissions

Rendering stays in `frontend/src/onboarding/firstRunOnboarding.ts`; DOM bindings are in `firstRunOnboardingInteractions.ts` so the actual handlers can be unit-tested without loading SVG assets. Persistence and runtime startup still use the existing injected application callbacks.

`firstRunModelBrowser.ts` uses the registered Tauri Opener plugin's `plugin:opener|open_url` on desktop. Only the exact catalog URL is permitted for the local main window. The `?` is escaped as `[?]` because opener scopes are glob patterns. No arbitrary URL/file opening, alternate applications, remote-origin access, or CSP relaxation is granted. Automatic interception of other links is disabled. Native errors are surfaced, not swallowed by a WebView-popup fallback. The web-only preview uses a new tab with `noopener,noreferrer`.

The plugin remains on its Tauri-2.10-compatible 2.5.x line; this change does not upgrade the framework or change Arxell's public `foundation-v7` commands/payloads.

## Verification

Automated: frontend tests (including actual bound handlers, browser adapter, and capability configuration), lint/build, Rust checks with and without `tauri-runtime`, and a host native no-bundle build. Test dependencies explicitly pin Node typings for clean npm installs.

For the local native verification, the frontend was freshly built first, then the already-completed build hook was disabled for the no-bundle command:

```sh
cd frontend && npm ci --no-audit --no-fund && npm test && npm run lint && npm run build
cd ../src-tauri
cargo check --locked
cargo check --locked --features tauri-runtime
cargo tauri build --no-bundle --config '{"build":{"beforeBuildCommand":""}}' -- --features tauri-runtime
```

Separate follow-up: the existing `npm --prefix frontend run build` hook resolves to `frontend/frontend` with the local CLI's detected frontend working directory. This onboarding change does not alter that hook. The override skips only a redundant frontend build, not frontend verification or security configuration.

Manual acceptance still required on each supported desktop OS:

1. In a fresh profile, accept terms, advance to models, and select custom GGUF. Finish remains disabled with no path.
2. Click Download. Confirm the catalog opens in the **system browser**, not an app WebView, and no local model path is changed.
3. Browse, cancel, and confirm prior selection/path are retained. Retry and choose a GGUF (including a Windows path with spaces); confirm selection and Finish eligibility.
4. Select an invalid extension using the picker/manual fallback; confirm an inline error and no new persisted path.
5. Simulate a picker/browser failure; confirm recovery and no silent completion.
6. After browsing a custom model, download a preset, select custom again, and Finish. Confirm the custom path is used. Double-click/reentry must not start twice.

Unit tests/builds do not establish native file-picker or OS-browser acceptance on Windows/macOS.
