import type { DisplayMode } from "../layout";

const LLAMA_MODEL_PATH_STORAGE_KEY = "arxell.llama.modelPath";
const LLAMA_MAX_TOKENS_STORAGE_KEY = "arxell.llama.maxTokens";
const CHAT_ROUTE_PREFERENCE_STORAGE_KEY = "arxell.chat.routePreference";
const SHOW_APP_RESOURCES_CPU_STORAGE_KEY = "arxell.settings.showAppResources.cpu";
const SHOW_APP_RESOURCES_MEMORY_STORAGE_KEY = "arxell.settings.showAppResources.memory";
const SHOW_APP_RESOURCES_NETWORK_STORAGE_KEY = "arxell.settings.showAppResources.network";
const SHOW_BOTTOM_ENGINE_STORAGE_KEY = "arxell.settings.showBottom.engine";
const SHOW_BOTTOM_MODEL_STORAGE_KEY = "arxell.settings.showBottom.model";
const SHOW_BOTTOM_CONTEXT_STORAGE_KEY = "arxell.settings.showBottom.context";
const SHOW_BOTTOM_SPEED_STORAGE_KEY = "arxell.settings.showBottom.speed";
const SHOW_BOTTOM_TTS_LATENCY_STORAGE_KEY = "arxell.settings.showBottom.ttsLatency";
const CHAT_MODEL_ID_STORAGE_KEY = "arxell.chat.modelId";
const STT_BACKEND_STORAGE_KEY = "arxell.stt.backend";
const MIC_PERMISSION_BUBBLE_DISMISSED_KEY = "arxell.micPermissionBubbleDismissed";
const FLOW_ADVANCED_OPEN_STORAGE_KEY = "arxell.flow.advancedOpen";
const FLOW_BOTTOM_PANEL_STORAGE_KEY = "arxell.flow.bottomPanel";
const FLOW_SPLIT_STORAGE_KEY = "arxell.flow.split";
const FLOW_ACTIVE_PHASE_STORAGE_KEY = "arxell.flow.activePhase";
const FLOW_PHASE_SESSION_MAP_STORAGE_KEY = "arxell.flow.phaseSessions";
const FLOW_AUTO_FOLLOW_STORAGE_KEY = "arxell.flow.autoFollow";

export const BOTTOM_BAR_PREF_KEYS = {
  showBottomEngine: SHOW_BOTTOM_ENGINE_STORAGE_KEY,
  showBottomModel: SHOW_BOTTOM_MODEL_STORAGE_KEY,
  showBottomContext: SHOW_BOTTOM_CONTEXT_STORAGE_KEY,
  showBottomSpeed: SHOW_BOTTOM_SPEED_STORAGE_KEY,
  showBottomTtsLatency: SHOW_BOTTOM_TTS_LATENCY_STORAGE_KEY
} as const;

export const FLOW_TERMINAL_PHASES = [
  "orient",
  "read_plan",
  "select_task",
  "investigate",
  "implement",
  "validate",
  "update_plan",
  "commit",
  "push"
] as const;

export type ChatRoutePreference = "auto" | "agent" | "legacy";
export type SttBackend = "whisper_cpp" | "sherpa_onnx";

export function loadPersistedLlamaModelPath(): string {
  try {
    const value = window.localStorage.getItem(LLAMA_MODEL_PATH_STORAGE_KEY);
    return value?.trim() ?? "";
  } catch {
    return "";
  }
}

export function persistLlamaModelPath(modelPath: string): void {
  try {
    const normalized = modelPath.trim();
    if (!normalized) {
      window.localStorage.removeItem(LLAMA_MODEL_PATH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LLAMA_MODEL_PATH_STORAGE_KEY, normalized);
  } catch {}
}

export function loadPersistedLlamaMaxTokens(): number | null {
  try {
    const raw = window.localStorage.getItem(LLAMA_MAX_TOKENS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(128, Math.min(4096, parsed));
  } catch {
    return null;
  }
}

export function persistLlamaMaxTokens(maxTokens: number | null): void {
  try {
    if (maxTokens === null) {
      window.localStorage.removeItem(LLAMA_MAX_TOKENS_STORAGE_KEY);
      return;
    }
    const clamped = Math.max(128, Math.min(4096, Math.trunc(maxTokens)));
    window.localStorage.setItem(LLAMA_MAX_TOKENS_STORAGE_KEY, String(clamped));
  } catch {}
}

export function loadPersistedChatRoutePreference(): ChatRoutePreference {
  try {
    const raw = window.localStorage.getItem(CHAT_ROUTE_PREFERENCE_STORAGE_KEY);
    if (raw === "agent" || raw === "legacy" || raw === "auto") return raw;
  } catch {}
  return "auto";
}

export function persistChatRoutePreference(mode: ChatRoutePreference): void {
  try {
    window.localStorage.setItem(CHAT_ROUTE_PREFERENCE_STORAGE_KEY, mode);
  } catch {}
}

export function loadPersistedShowAppResourcesCpu(): boolean {
  try {
    const value = window.localStorage.getItem(SHOW_APP_RESOURCES_CPU_STORAGE_KEY);
    if (value === null) return true;
    return value === "1";
  } catch {
    return true;
  }
}

export function persistShowAppResourcesCpu(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SHOW_APP_RESOURCES_CPU_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SHOW_APP_RESOURCES_CPU_STORAGE_KEY);
  } catch {}
}

export function loadPersistedShowAppResourcesMemory(): boolean {
  try {
    const value = window.localStorage.getItem(SHOW_APP_RESOURCES_MEMORY_STORAGE_KEY);
    if (value === null) return true;
    return value === "1";
  } catch {
    return true;
  }
}

export function persistShowAppResourcesMemory(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SHOW_APP_RESOURCES_MEMORY_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SHOW_APP_RESOURCES_MEMORY_STORAGE_KEY);
  } catch {}
}

export function loadPersistedShowAppResourcesNetwork(): boolean {
  try {
    return window.localStorage.getItem(SHOW_APP_RESOURCES_NETWORK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistShowAppResourcesNetwork(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SHOW_APP_RESOURCES_NETWORK_STORAGE_KEY, "1");
    else window.localStorage.removeItem(SHOW_APP_RESOURCES_NETWORK_STORAGE_KEY);
  } catch {}
}

export function loadPersistedBottomItem(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "1";
  } catch {
    return fallback;
  }
}

export function persistBottomItem(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {}
}

export function loadPersistedChatModelId(): string {
  try {
    const raw = window.localStorage.getItem(CHAT_MODEL_ID_STORAGE_KEY);
    const normalized = (raw || "").trim();
    return normalized || "primary-agent";
  } catch {
    return "primary-agent";
  }
}

export function persistChatModelId(modelId: string): void {
  try {
    const normalized = modelId.trim();
    if (!normalized) {
      window.localStorage.removeItem(CHAT_MODEL_ID_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CHAT_MODEL_ID_STORAGE_KEY, normalized);
  } catch {}
}

export function loadPersistedSttBackend(): SttBackend {
  try {
    const raw = window.localStorage.getItem(STT_BACKEND_STORAGE_KEY);
    if (raw === "whisper_cpp" || raw === "sherpa_onnx") return raw;
  } catch {}
  return "whisper_cpp";
}

export function persistSttBackend(backend: SttBackend): void {
  try {
    window.localStorage.setItem(STT_BACKEND_STORAGE_KEY, backend);
  } catch {}
}

export function persistSttModel(model: string): void {
  try {
    window.localStorage.setItem("arxellite_stt_model", model);
  } catch {}
}

export function persistSttLanguage(language: string): void {
  try {
    window.localStorage.setItem("arxellite_stt_language", language);
  } catch {}
}

export function persistSttThreads(threads: number): void {
  try {
    window.localStorage.setItem("arxellite_stt_threads", threads.toString());
  } catch {}
}

export function loadPersistedSttModel(): string {
  try {
    const stored = window.localStorage.getItem("arxellite_stt_model");
    if (stored) return stored;
  } catch {}
  return "auto";
}

export function loadPersistedSttLanguage(): string {
  try {
    const stored = window.localStorage.getItem("arxellite_stt_language");
    if (stored) return stored;
  } catch {}
  return "auto";
}

export function loadPersistedSttThreads(): number {
  try {
    const stored = window.localStorage.getItem("arxellite_stt_threads");
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 8) return parsed;
    }
  } catch {}
  return 4;
}

export function loadMicBubbleDismissed(): boolean {
  try {
    return window.localStorage.getItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistMicBubbleDismissed(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY, "1");
    else window.localStorage.removeItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY);
  } catch {}
}

export function loadPersistedFlowAdvancedOpen(): boolean {
  try {
    return window.localStorage.getItem(FLOW_ADVANCED_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistFlowAdvancedOpen(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(FLOW_ADVANCED_OPEN_STORAGE_KEY, "1");
    else window.localStorage.removeItem(FLOW_ADVANCED_OPEN_STORAGE_KEY);
  } catch {}
}

export function loadPersistedFlowBottomPanel(): "terminal" | "validate" | "events" {
  try {
    const stored = window.localStorage.getItem(FLOW_BOTTOM_PANEL_STORAGE_KEY);
    if (stored === "terminal" || stored === "validate" || stored === "events") return stored;
  } catch {}
  return "terminal";
}

export function persistFlowBottomPanel(value: "terminal" | "validate" | "events"): void {
  try {
    window.localStorage.setItem(FLOW_BOTTOM_PANEL_STORAGE_KEY, value);
  } catch {}
}

export function loadPersistedFlowSplit(): number {
  try {
    const stored = window.localStorage.getItem(FLOW_SPLIT_STORAGE_KEY);
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isFinite(parsed)) return Math.max(28, Math.min(78, parsed));
    }
  } catch {}
  return 58;
}

export function persistFlowSplit(value: number): void {
  try {
    window.localStorage.setItem(FLOW_SPLIT_STORAGE_KEY, String(Math.max(28, Math.min(78, value))));
  } catch {}
}

export function loadPersistedFlowActivePhase(): string {
  try {
    const stored = window.localStorage.getItem(FLOW_ACTIVE_PHASE_STORAGE_KEY);
    if (stored && FLOW_TERMINAL_PHASES.includes(stored as (typeof FLOW_TERMINAL_PHASES)[number])) {
      return stored;
    }
  } catch {}
  return FLOW_TERMINAL_PHASES[0];
}

export function persistFlowActivePhase(phase: string): void {
  try {
    if (FLOW_TERMINAL_PHASES.includes(phase as (typeof FLOW_TERMINAL_PHASES)[number])) {
      window.localStorage.setItem(FLOW_ACTIVE_PHASE_STORAGE_KEY, phase);
    }
  } catch {}
}

export function loadPersistedFlowPhaseSessionMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(FLOW_PHASE_SESSION_MAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const phase of FLOW_TERMINAL_PHASES) {
      const value = parsed[phase];
      if (typeof value === "string" && value.trim()) out[phase] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistFlowPhaseSessionMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(FLOW_PHASE_SESSION_MAP_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function loadPersistedFlowAutoFollow(): boolean {
  try {
    const stored = window.localStorage.getItem(FLOW_AUTO_FOLLOW_STORAGE_KEY);
    if (stored === "0") return false;
  } catch {}
  return true;
}

export function persistFlowAutoFollow(enabled: boolean): void {
  try {
    window.localStorage.setItem(FLOW_AUTO_FOLLOW_STORAGE_KEY, enabled ? "1" : "0");
  } catch {}
}

export function persistFlowWorkspacePrefs(slice: {
  flowAdvancedOpen: boolean;
  flowBottomPanel: "terminal" | "validate" | "events";
  flowWorkspaceSplit: number;
  flowActiveTerminalPhase: string;
  flowAutoFocusPhaseTerminal: boolean;
}): void {
  persistFlowAdvancedOpen(slice.flowAdvancedOpen);
  persistFlowBottomPanel(slice.flowBottomPanel);
  persistFlowSplit(slice.flowWorkspaceSplit);
  persistFlowActivePhase(slice.flowActiveTerminalPhase);
  persistFlowAutoFollow(slice.flowAutoFocusPhaseTerminal);
}

export function resolveSystemDisplayMode(): DisplayMode {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {}
  return "dark";
}
