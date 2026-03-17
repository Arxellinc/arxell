function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function normalizeSetting(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (
    lowered === "default" ||
    lowered === "auto" ||
    lowered === "openai/default" ||
    lowered === "openai/auto"
  ) {
    return "";
  }
  return trimmed;
}

export interface CoderAgentCommandOptions {
  prompt: string;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  maxTurns?: number;
}

// Builds a single shell command that prefers a local arx-rs binary and falls
// back to `cargo run` in dev checkouts.
export function buildCoderAgentCommand(options: CoderAgentCommandOptions): string {
  const prompt = options.prompt.trim();
  const model = normalizeSetting(options.model);
  const baseUrl = (options.baseUrl ?? "").trim();
  const apiKey = (options.apiKey ?? "").trim();
  const maxTurns = Number.isFinite(options.maxTurns) ? Math.max(1, Math.floor(options.maxTurns!)) : 8;

  const runArgs: string[] = [
    "--provider openai-compatible",
    `--max-turns ${maxTurns}`,
  ];
  if (model) runArgs.push(`--model ${shellQuote(model)}`);
  if (baseUrl) runArgs.push(`--base-url ${shellQuote(baseUrl)}`);
  if (apiKey) runArgs.push(`--api-key ${shellQuote(apiKey)}`);
  runArgs.push(shellQuote(prompt));

  const runTail = runArgs.join(" ");

  return [
    'ARX_AGENT_BIN=""',
    'if command -v arx-rs >/dev/null 2>&1; then ARX_AGENT_BIN="$(command -v arx-rs)"; fi',
    'if [ -z "$ARX_AGENT_BIN" ] && [ -x "./target/debug/arx-rs" ]; then ARX_AGENT_BIN="./target/debug/arx-rs"; fi',
    'if [ -z "$ARX_AGENT_BIN" ] && [ -x "./agent/target/debug/arx-rs" ]; then ARX_AGENT_BIN="./agent/target/debug/arx-rs"; fi',
    `if [ -n "$ARX_AGENT_BIN" ]; then "$ARX_AGENT_BIN" ${runTail};`,
    'elif command -v cargo >/dev/null 2>&1 && [ -f "./agent/Cargo.toml" ]; then',
    `cargo run --quiet --manifest-path ./agent/Cargo.toml --bin arx-rs -- ${runTail};`,
    'else',
    'echo "[coder] arx-rs agent CLI not found (expected binary or ./agent/Cargo.toml + cargo).";',
    'exit 127;',
    'fi',
  ].join(" ");
}
