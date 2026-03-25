type RuntimeEvent = {
  ts: string;
  kind: string;
  detail: string;
};

const MAX_EVENTS = 120;
const STORAGE_KEY = "arx_runtime_diagnostics";

let installed = false;

function toDetail(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readEvents(): RuntimeEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RuntimeEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeEvents(events: RuntimeEvent[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // best effort
  }
}

export function reportRuntimeError(kind: string, detail: unknown): void {
  const next: RuntimeEvent = {
    ts: new Date().toISOString(),
    kind,
    detail: toDetail(detail),
  };
  const events = readEvents();
  events.push(next);
  writeEvents(events);
}

export function readRuntimeDiagnostics(): RuntimeEvent[] {
  return readEvents();
}

export function clearRuntimeDiagnostics(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best effort
  }
}

export function installRuntimeDiagnostics(): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      reportRuntimeError("console-error", args.map(toDetail).join(" | "));
    } catch {
      // don't break error path
    }
    originalError(...args);
  };
}

