import { terminalExec } from "../core/tooling/client";

const PI_REPO_RESOLUTION_STEPS = [
  'PI_REPO=""',
  'if [ -n "${ARX_PI_MONO_PATH:-}" ] && [ -d "${ARX_PI_MONO_PATH}" ]; then PI_REPO="${ARX_PI_MONO_PATH}"; fi',
  'if [ -z "$PI_REPO" ] && [ -d "vendor/pi-mono-main" ]; then PI_REPO="$(pwd)/vendor/pi-mono-main"; fi',
  'if [ -z "$PI_REPO" ] && [ -d "/home/user/Projects/arxell-main/vendor/pi-mono-main" ]; then PI_REPO="/home/user/Projects/arxell-main/vendor/pi-mono-main"; fi',
  'if [ -z "$PI_REPO" ] && [ -d "$HOME/Projects/arxell-main/vendor/pi-mono-main" ]; then PI_REPO="$HOME/Projects/arxell-main/vendor/pi-mono-main"; fi',
  'if [ -z "$PI_REPO" ]; then echo "[pi] missing pi-mono repo. Set ARX_PI_MONO_PATH or place vendor/pi-mono-main under workspace."; exit 1; fi',
];

export const PI_PREPARE_COMMAND = [
  ...PI_REPO_RESOLUTION_STEPS,
  'PI_CODING_AGENT_DIR="$PI_REPO/.pi/agent"',
  'export PI_CODING_AGENT_DIR',
  'mkdir -p "$PI_CODING_AGENT_DIR"',
  'PI_NEEDS_PREP=0',
  'if [ ! -f "$PI_CODING_AGENT_DIR/.arx-ready-v2" ]; then PI_NEEDS_PREP=1; fi',
  'if [ ! -f "$PI_REPO/packages/coding-agent/dist/cli.js" ] || [ ! -f "$PI_REPO/packages/ai/dist/index.js" ] || [ ! -f "$PI_REPO/packages/agent/dist/index.js" ] || [ ! -f "$PI_REPO/packages/tui/dist/index.js" ]; then PI_NEEDS_PREP=1; fi',
  'if [ "$PI_NEEDS_PREP" = "1" ]; then ( cd "$PI_REPO" && ( [ -d node_modules ] || HUSKY=0 npm ci --no-audit --no-fund ) && npm run build && PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" node -e "(async () => { const m = await import(\'./packages/coding-agent/dist/utils/tools-manager.js\'); await m.ensureTool(\'fd\', true); await m.ensureTool(\'rg\', true); })().catch((e) => { console.error(e); process.exit(1); });" ) && touch "$PI_CODING_AGENT_DIR/.arx-ready-v2"; fi',
  'if [ ! -f "$PI_REPO/packages/coding-agent/dist/cli.js" ]; then echo "[pi] build did not produce packages/coding-agent/dist/cli.js"; exit 1; fi',
].join(" && ");

export const PI_START_COMMAND = [
  'ARX_ORIG_CWD="$(pwd)"',
  PI_PREPARE_COMMAND,
  'cd "$ARX_ORIG_CWD"',
  'PI_SKIP_VERSION_CHECK=1 PI_CODING_AGENT_DIR="$PI_CODING_AGENT_DIR" node "$PI_REPO/packages/coding-agent/dist/cli.js"',
].join(" && ");

let piPrewarmStarted = false;

export async function prewarmPiBootstrap(cwd = "."): Promise<void> {
  if (piPrewarmStarted) return;
  piPrewarmStarted = true;
  try {
    await terminalExec(PI_PREPARE_COMMAND, cwd, null, 600_000, "shell");
  } catch (error) {
    console.debug("pi prewarm skipped:", error);
  }
}

