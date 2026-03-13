# Troubleshooting

## UI is black/crashes
Symptoms:
- black screen,
- error boundary message,
- React nested update stack traces.

Actions:
1. Check browser devtools console for top exception.
2. Check terminal panel logs (`log:error`, `log:warn`).
3. Restart dev app and isolate recently changed panel/store code.

## Model/API verification fails
Actions:
1. Validate base URL and API key.
2. Confirm endpoint returns OpenAI-compatible `/models` and/or `/chat/completions`.
3. Re-run verification in API panel.
4. Inspect backend logs for status/body parse failures.

## Local model won’t load
Actions:
1. Verify GGUF file exists and is readable.
2. Check runtime status and install compatible engine if needed.
3. Validate memory/GPU availability.
4. Review `model:load_progress` and load errors.

## Voice not working
Actions:
1. Run diagnostics panel.
2. Check audio device availability.
3. Verify STT/TTS engine settings and paths.
4. For local engines, verify Python packages/binaries.

## Terminal command blocked unexpectedly
- Check path guard status and current cwd.
- Check command guard toggles for blocked command key.
- Use prompt override consciously when needed.

## Useful diagnostic data to collect for bug reports
- App version (`0.8.0` in this source snapshot).
- OS/platform and GPU/runtime info.
- Relevant log excerpts from terminal panel.
- Reproduction steps + exact UI panel/workflow.
