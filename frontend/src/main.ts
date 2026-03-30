import "./styles.css";
import "xterm/css/xterm.css";
import type {
  ApiConnectionRecord,
  AppEvent,
  ChatStreamChunkPayload,
  ChatStreamReasoningChunkPayload,
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  WebSearchResponse,
  WorkspaceToolRecord
} from "./contracts";
import { iconHtml } from "./icons";
import type { IconName } from "./icons";
import { APP_ICON } from "./icons/map";
import type { ChatIpcClient } from "./ipcClient";
import { createChatIpcClient } from "./ipcClient";
import {
  isWorkspaceTab,
  renderGlobalBottombar,
  renderGlobalTopbar,
  renderSidebarRail,
  renderWorkspacePane
} from "./layout";
import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
import type { ApiConnectionDraft, DevicesState, SidebarTab, UiMessage } from "./panels/types";
import type { DisplayMode, LayoutOrientation, WorkspaceTab } from "./layout";
import { escapeHtml } from "./panels/utils";
import { TerminalManager, renderTerminalToolbar, renderTerminalWorkspace } from "./tools/terminal/index";
import type { TerminalShellProfile } from "./tools/terminal/types";
import {
  MANAGER_DATA_ATTR,
  MANAGER_UI_ID,
  TERMINAL_DATA_ATTR,
  TERMINAL_UI_ID,
  WEB_DATA_ATTR,
  WEB_UI_ID,
  WORKSPACE_DATA_ATTR
} from "./tools/ui/constants";
import { renderWorkspaceToolsActions, renderWorkspaceToolsBody } from "./tools/manager/index";
import { renderWebToolActions, renderWebToolBody } from "./tools/webSearch/index";
import { renderChatMessages } from "./panels/chatPanel";
import { APP_BUILD_VERSION, normalizeVersionLabel } from "./version";
import {
  closeTerminalSessionAndPickNext,
  createTerminalSessionForProfile,
  ensureTerminalSessionForProfile
} from "./workspace/controller";

const terminalManager = new TerminalManager();
const MAX_CONSOLE_ENTRIES = 600;
const LLAMA_MODEL_PATH_STORAGE_KEY = "arxell.llama.modelPath";
const LLAMA_MAX_TOKENS_STORAGE_KEY = "arxell.llama.maxTokens";
const MIC_PERMISSION_BUBBLE_DISMISSED_KEY = "arxell.micPermissionBubbleDismissed";
const WEB_SEARCH_HISTORY_STORAGE_KEY = "arxell.webSearch.history.v1";
const CHAT_ID_ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let chatStreamDomUpdateScheduled = false;
let chatThinkingDelegationInstalled = false;
const FALLBACK_APP_VERSION = normalizeVersionLabel(APP_BUILD_VERSION);

interface WebTabState {
  id: string;
  title: string;
  query: string;
  mode: string;
  viewMode: "markdown" | "json";
  num: number;
  busy: boolean;
  message: string | null;
  result: Record<string, unknown> | null;
}

interface WebSearchHistoryItem {
  id: string;
  query: string;
  mode: string;
  num: number;
  timestampMs: number;
}

function generateChatConversationId(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += CHAT_ID_ALPHANUM[Math.floor(Math.random() * CHAT_ID_ALPHANUM.length)] ?? "A";
  }
  return `C${suffix}`;
}

function loadPersistedLlamaModelPath(): string {
  try {
    const value = window.localStorage.getItem(LLAMA_MODEL_PATH_STORAGE_KEY);
    return value?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistLlamaModelPath(modelPath: string): void {
  try {
    const normalized = modelPath.trim();
    if (!normalized) {
      window.localStorage.removeItem(LLAMA_MODEL_PATH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LLAMA_MODEL_PATH_STORAGE_KEY, normalized);
  } catch {
    // Ignore local storage failures (private mode / denied access).
  }
}

function loadPersistedLlamaMaxTokens(): number | null {
  try {
    const raw = window.localStorage.getItem(LLAMA_MAX_TOKENS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return null;
    const clamped = Math.max(128, Math.min(4096, parsed));
    return clamped;
  } catch {
    return null;
  }
}

function persistLlamaMaxTokens(maxTokens: number | null): void {
  try {
    if (maxTokens === null) {
      window.localStorage.removeItem(LLAMA_MAX_TOKENS_STORAGE_KEY);
      return;
    }
    const clamped = Math.max(128, Math.min(4096, Math.trunc(maxTokens)));
    window.localStorage.setItem(LLAMA_MAX_TOKENS_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore local storage failures.
  }
}

function loadMicBubbleDismissed(): boolean {
  try {
    return window.localStorage.getItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function loadPersistedWebSearchHistory(): WebSearchHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(WEB_SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeWebHistoryItem(item))
      .filter((item): item is WebSearchHistoryItem => item !== null)
      .slice(0, 200);
  } catch {
    return [];
  }
}

function persistWebSearchHistory(entries: WebSearchHistoryItem[]): void {
  try {
    window.localStorage.setItem(WEB_SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    // Ignore local storage failures.
  }
}

function normalizeWebHistoryItem(value: unknown): WebSearchHistoryItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as {
    id?: unknown;
    query?: unknown;
    mode?: unknown;
    num?: unknown;
    timestampMs?: unknown;
  };
  const query = typeof item.query === "string" ? item.query.trim() : "";
  if (!query) return null;
  const mode = typeof item.mode === "string" && item.mode.trim() ? item.mode.trim() : "search";
  const numRaw = typeof item.num === "number" ? item.num : 10;
  const num = Number.isFinite(numRaw) ? Math.max(1, Math.min(20, Math.trunc(numRaw))) : 10;
  const tsRaw = typeof item.timestampMs === "number" ? item.timestampMs : Date.now();
  const timestampMs = Number.isFinite(tsRaw) ? tsRaw : Date.now();
  const id =
    typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `webh-${timestampMs}-${Math.floor(Math.random() * 1000)}`;
  return { id, query, mode, num, timestampMs };
}

function persistMicBubbleDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      window.localStorage.setItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY, "1");
    } else {
      window.localStorage.removeItem(MIC_PERMISSION_BUBBLE_DISMISSED_KEY);
    }
  } catch {
    // Ignore local storage failures.
  }
}

function defaultDevicesState(): DevicesState {
  return {
    microphonePermission: "not_enabled",
    speakerPermission: "not_enabled",
    defaultAudioInput: "Unknown",
    defaultAudioOutput: "Unknown",
    audioInputCount: 0,
    audioOutputCount: 0,
    webcamCount: 0,
    keyboardDetected: true,
    mouseDetected: false,
    lastUpdatedLabel: "Not checked"
  };
}

function defaultApiConnectionDraft(): ApiConnectionDraft {
  return {
    apiType: "llm",
    apiUrl: "",
    name: "",
    apiKey: "",
    modelName: "",
    costPerMonthUsd: "",
    apiStandardPath: ""
  };
}

function createWebTab(index: number): WebTabState {
  return {
    id: `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: `Search ${index}`,
    query: "",
    mode: "search",
    viewMode: "markdown",
    num: 10,
    busy: false,
    message: null,
    result: null
  };
}

const state: {
  conversationId: string;
  messages: UiMessage[];
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatFirstAssistantChunkMsByCorrelation: Record<string, number>;
  chatFirstReasoningChunkMsByCorrelation: Record<string, number>;
  chatStreaming: boolean;
  chatDraft: string;
  activeChatCorrelationId: string | null;
  devices: DevicesState;
  apiConnections: ApiConnectionRecord[];
  apiFormOpen: boolean;
  apiDraft: ApiConnectionDraft;
  apiEditingId: string | null;
  apiMessage: string | null;
  micPermissionBubbleDismissed: boolean;
  events: AppEvent[];
  consoleEntries: Array<{
    timestampMs: number;
    level: "log" | "info" | "warn" | "error" | "debug";
    source: "browser" | "app";
    message: string;
  }>;
  runtimeMode: "tauri" | "mock" | "unknown";
  chatPanePercent: number;
  portraitWorkspacePercent: number;
  sidebarTab: SidebarTab;
  workspaceTab: WorkspaceTab;
  layoutOrientation: LayoutOrientation;
  activeTerminalSessionId: string | null;
  terminalShellProfile: TerminalShellProfile;
  conversations: ConversationSummaryRecord[];
  workspaceTools: WorkspaceToolRecord[];
  webTabs: WebTabState[];
  activeWebTabId: string;
  nextWebTabIndex: number;
  webHistoryOpen: boolean;
  webHistoryClearConfirmOpen: boolean;
  webHistory: WebSearchHistoryItem[];
  webSetupModalOpen: boolean;
  webSetupAccount: string;
  webSetupApiKey: string;
  webSetupMessage: string | null;
  webSetupBusy: boolean;
  displayMode: DisplayMode;
  appVersion: string;
  chatThinkingEnabled: boolean;
  llamaRuntime: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId: string;
  llamaRuntimeModelPath: string;
  llamaRuntimePort: number;
  llamaRuntimeCtxSize: number;
  llamaRuntimeGpuLayers: number;
  llamaRuntimeThreads: number | null;
  llamaRuntimeBatchSize: number | null;
  llamaRuntimeUbatchSize: number | null;
  llamaRuntimeTemperature: number;
  llamaRuntimeTopP: number;
  llamaRuntimeTopK: number;
  llamaRuntimeRepeatPenalty: number;
  llamaRuntimeFlashAttn: boolean;
  llamaRuntimeMmap: boolean;
  llamaRuntimeMlock: boolean;
  llamaRuntimeSeed: number | null;
  llamaRuntimeMaxTokens: number | null;
  llamaRuntimeBusy: boolean;
  llamaRuntimeLogs: string[];
  llamaRuntimeContextTokens: number | null;
  llamaRuntimeContextCapacity: number | null;
  llamaRuntimeTokensPerSecond: number | null;
  modelManagerInstalled: ModelManagerInstalledModel[];
  modelManagerQuery: string;
  modelManagerCollection: string;
  modelManagerSearchResults: ModelManagerHfCandidate[];
  modelManagerBusy: boolean;
  modelManagerMessage: string | null;
  modelManagerUnslothUdCatalog: Array<{
    repoId: string;
    modelName: string;
    parameterCount: string;
    udAssets: Array<{
      fileName: string;
      quant: string;
      sizeGb: string;
    }>;
    selectedAssetFileName: string;
  }>;
  modelManagerUnslothUdLoading: boolean;
  stt: {
    status: "idle" | "starting" | "running" | "error";
    message: string | null;
    isListening: boolean;
    isSpeaking: boolean;
    lastTranscript: string | null;
    microphonePermission: "not_enabled" | "enabled" | "no_device";
    vadBaseThreshold: number;
    vadStartFrames: number;
    vadEndFrames: number;
    vadDynamicMultiplier: number;
    vadNoiseAdaptationAlpha: number;
    vadPreSpeechMs: number;
    vadMinUtteranceMs: number;
    vadMaxUtteranceS: number;
    vadForceFlushS: number;
  };
} = {
  conversationId: generateChatConversationId(),
  messages: [],
  chatReasoningByCorrelation: {},
  chatThinkingPlacementByCorrelation: {},
  chatThinkingExpandedByCorrelation: {},
  chatFirstAssistantChunkMsByCorrelation: {},
  chatFirstReasoningChunkMsByCorrelation: {},
  chatStreaming: false,
  chatDraft: "",
  activeChatCorrelationId: null,
  devices: defaultDevicesState(),
  apiConnections: [],
  apiFormOpen: false,
  apiDraft: defaultApiConnectionDraft(),
  apiEditingId: null,
  apiMessage: null,
  micPermissionBubbleDismissed: loadMicBubbleDismissed(),
  events: [],
  consoleEntries: [],
  runtimeMode: "unknown",
  chatPanePercent: 35,
  portraitWorkspacePercent: 46,
  sidebarTab: "chat",
  workspaceTab: "events",
  layoutOrientation: "landscape",
  activeTerminalSessionId: null,
  terminalShellProfile: "default",
  conversations: [],
  workspaceTools: [],
  webTabs: [createWebTab(1)],
  activeWebTabId: "",
  nextWebTabIndex: 2,
  webHistoryOpen: false,
  webHistoryClearConfirmOpen: false,
  webHistory: loadPersistedWebSearchHistory(),
  webSetupModalOpen: false,
  webSetupAccount: "Serper",
  webSetupApiKey: "",
  webSetupMessage: null,
  webSetupBusy: false,
  displayMode: "dark",
  appVersion: FALLBACK_APP_VERSION,
  chatThinkingEnabled: false,
  llamaRuntime: null,
  llamaRuntimeSelectedEngineId: "",
  llamaRuntimeModelPath: loadPersistedLlamaModelPath(),
  llamaRuntimePort: 1420,
  llamaRuntimeCtxSize: 8192,
  llamaRuntimeGpuLayers: 999,
  llamaRuntimeThreads: null,
  llamaRuntimeBatchSize: 512,
  llamaRuntimeUbatchSize: 512,
  llamaRuntimeTemperature: 0.7,
  llamaRuntimeTopP: 0.95,
  llamaRuntimeTopK: 40,
  llamaRuntimeRepeatPenalty: 1.1,
  llamaRuntimeFlashAttn: false,
  llamaRuntimeMmap: true,
  llamaRuntimeMlock: false,
  llamaRuntimeSeed: null,
  llamaRuntimeMaxTokens: loadPersistedLlamaMaxTokens(),
  llamaRuntimeBusy: false,
  llamaRuntimeLogs: [],
  llamaRuntimeContextTokens: null,
  llamaRuntimeContextCapacity: null,
  llamaRuntimeTokensPerSecond: null,
  modelManagerInstalled: [],
  modelManagerQuery: "",
  modelManagerCollection: "unsloth_ud",
  modelManagerSearchResults: [],
  modelManagerBusy: false,
  modelManagerMessage: null,
  modelManagerUnslothUdCatalog: [],
  modelManagerUnslothUdLoading: false,
  stt: {
    status: "idle",
    message: null,
    isListening: false,
    isSpeaking: false,
    lastTranscript: null,
    microphonePermission: "not_enabled",
    vadBaseThreshold: 0.005,
    vadStartFrames: 2,
    vadEndFrames: 8,
    vadDynamicMultiplier: 2.4,
    vadNoiseAdaptationAlpha: 0.03,
    vadPreSpeechMs: 200,
    vadMinUtteranceMs: 200,
    vadMaxUtteranceS: 30,
    vadForceFlushS: 3
  }
};
state.activeWebTabId = state.webTabs[0]?.id ?? "";

let clientRef: ChatIpcClient | null = null;
let consoleCaptureInstalled = false;
let warnedMissingBundleEngineId: string | null = null;

function nextCorrelationId(): string {
  return `corr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function formatLastUpdated(ts: number): string {
  return `Updated ${new Date(ts).toLocaleTimeString()}`;
}

async function detectMicrophonePermission(): Promise<DevicesState["microphonePermission"]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "no_device";
  }
  const state = await queryPermissionState("microphone");
  return state === "granted" ? "enabled" : "not_enabled";
}

async function detectSpeakerPermission(): Promise<DevicesState["speakerPermission"]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return "not_enabled";
  }
  const state = await queryPermissionState("speaker-selection");
  return state === "granted" ? "enabled" : "not_enabled";
}

async function queryPermissionState(
  name: PermissionName | "speaker-selection"
): Promise<PermissionState | null> {
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state;
    }
  } catch {
    // Permission API may be unavailable or unsupported for this name.
  }
  return null;
}

function defaultAudioDeviceLabel(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceInfo["kind"],
  fallback: string
): string {
  const kindDevices = devices.filter((device) => device.kind === kind);
  if (!kindDevices.length) return fallback;
  const explicitDefault = kindDevices.find((device) => device.deviceId === "default");
  const chosen = explicitDefault ?? kindDevices[0];
  return chosen?.label?.trim() || `${fallback} (name hidden until permission granted)`;
}

async function refreshDevicesState(): Promise<void> {
  const next = defaultDevicesState();
  next.microphonePermission = await detectMicrophonePermission();
  next.speakerPermission = await detectSpeakerPermission();
  next.lastUpdatedLabel = formatLastUpdated(Date.now());
  next.mouseDetected =
    typeof window !== "undefined" && window.matchMedia("(pointer:fine)").matches;
  next.keyboardDetected = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    state.devices = next;
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
    const videoInputs = devices.filter((device) => device.kind === "videoinput");

    next.audioInputCount = audioInputs.length;
    next.audioOutputCount = audioOutputs.length;
    next.webcamCount = videoInputs.length;
    next.defaultAudioInput = defaultAudioDeviceLabel(
      devices,
      "audioinput",
      audioInputs.length ? "Default microphone" : "No microphone detected"
    );
    next.defaultAudioOutput = defaultAudioDeviceLabel(
      devices,
      "audiooutput",
      audioOutputs.length ? "Default speaker" : "System default output"
    );

    if (audioInputs.length === 0) {
      next.microphonePermission = "no_device";
    } else {
      if (state.runtimeMode === "tauri" && clientRef) {
        try {
          const probe = await clientRef.probeMicrophoneDevice({
            correlationId: nextCorrelationId(),
            attemptOpen: false
          });
          if (probe.status === "no_device") {
            next.microphonePermission = "no_device";
          } else if (
            probe.status === "enabled" ||
            state.devices.microphonePermission === "enabled"
          ) {
            // Keep enabled state stable after a successful explicit enable action.
            next.microphonePermission = "enabled";
          } else {
            next.microphonePermission = "not_enabled";
          }
          if (probe.defaultInputName?.trim()) {
            next.defaultAudioInput = probe.defaultInputName.trim();
          }
          next.audioInputCount = Math.max(next.audioInputCount, probe.inputDeviceCount);
        } catch (error) {
          next.microphonePermission = "not_enabled";
          pushConsoleEntry(
            "warn",
            "browser",
            `Native microphone probe failed: ${String(error)}`
          );
        }
      } else {
        const hasLabeledInput = audioInputs.some((device) => device.label.trim().length > 0);
        if (
          next.microphonePermission === "enabled" ||
          hasLabeledInput ||
          state.devices.microphonePermission === "enabled"
        ) {
          next.microphonePermission = "enabled";
        } else {
          next.microphonePermission = "not_enabled";
        }
      }
    }

    if (next.speakerPermission === "enabled" || state.devices.speakerPermission === "enabled") {
      next.speakerPermission = "enabled";
    } else {
      next.speakerPermission = "not_enabled";
    }
  } catch (error) {
    pushConsoleEntry("warn", "browser", `Device enumeration failed: ${String(error)}`);
  }

  state.devices = next;
}

async function requestMicrophoneAccess(): Promise<void> {
  // Always try to get browser permission first to trigger the prompt
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Success - we have permission
      stream.getTracks().forEach((track) => track.stop());
      state.devices.microphonePermission = "enabled";
      state.micPermissionBubbleDismissed = true;
      persistMicBubbleDismissed(true);
      pushConsoleEntry("info", "browser", "Microphone access enabled via browser prompt.");
      await refreshDevicesState();
      return;
    } catch (error) {
      const details = await buildMicrophoneAccessErrorDetails(error);
      pushConsoleEntry("warn", "browser", `Microphone access denied: ${details}`);
      state.devices.microphonePermission = "not_enabled";
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      await refreshDevicesState();
      return;
    }
  }

  // Fallback: try native probe if in tauri mode
  if (state.runtimeMode === "tauri" && clientRef) {
    try {
      const probe = await clientRef.probeMicrophoneDevice({
        correlationId: nextCorrelationId(),
        attemptOpen: true
      });
      state.devices.microphonePermission = probe.status;
      if (probe.defaultInputName?.trim()) {
        state.devices.defaultAudioInput = probe.defaultInputName.trim();
      }
      state.devices.audioInputCount = Math.max(state.devices.audioInputCount, probe.inputDeviceCount);

      if (probe.status === "enabled") {
        state.micPermissionBubbleDismissed = true;
        persistMicBubbleDismissed(true);
        pushConsoleEntry("info", "browser", "Microphone access enabled via native probe.");
      } else if (probe.status === "no_device") {
        state.micPermissionBubbleDismissed = true;
        persistMicBubbleDismissed(true);
        pushConsoleEntry("warn", "browser", "Microphone probe failed: no input device detected.");
      } else {
        state.micPermissionBubbleDismissed = false;
        persistMicBubbleDismissed(false);
        pushConsoleEntry("warn", "browser", `Microphone not enabled: ${probe.message}`);
      }
    } catch (error) {
      state.devices.microphonePermission = "not_enabled";
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      pushConsoleEntry("warn", "browser", `Microphone probe failed: ${String(error)}`);
    }
    await refreshDevicesState();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    state.devices.microphonePermission = "no_device";
    state.micPermissionBubbleDismissed = false;
    persistMicBubbleDismissed(false);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
    stream.getTracks().forEach((track) => track.stop());
    state.devices.microphonePermission = "enabled";
    state.micPermissionBubbleDismissed = true;
    persistMicBubbleDismissed(true);
    pushConsoleEntry("info", "browser", "Microphone permission granted.");
  } catch (error) {
    const details = await buildMicrophoneAccessErrorDetails(error);
    pushConsoleEntry("warn", "browser", details);
    state.devices.microphonePermission = "not_enabled";
    state.micPermissionBubbleDismissed = false;
    persistMicBubbleDismissed(false);
  }
  await refreshDevicesState();
}

async function buildMicrophoneAccessErrorDetails(error: unknown): Promise<string> {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);
  const base = `Microphone permission not granted: ${name ? `${name}: ` : ""}${message}`;

  if (!window.isSecureContext) {
    return `${base} | blocked: insecure context (${window.location.protocol}).`;
  }

  const notEnabled =
    name === "NotAllowedError" || /not allowed by the user agent|denied/i.test(message);
  if (!notEnabled) {
    return base;
  }

  const isLinux = /Linux/i.test(navigator.userAgent);
  if (!isLinux) {
    return `${base} | check OS/browser privacy settings and re-enable microphone for this app.`;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputCount = devices.filter((device) => device.kind === "audioinput").length;
    if (inputCount === 0) {
      return `${base} | no audio input devices were detected by the runtime.`;
    }
  } catch {
    // Keep generic Linux guidance if enumeration fails.
  }

  return `${base} | Linux WebKit runtime denied the request; allow microphone in system privacy/portal settings and restart the app.`;
}

async function requestSpeakerAccess(): Promise<void> {
  if (!navigator.mediaDevices) {
    state.devices.speakerPermission = "not_enabled";
    await refreshDevicesState();
    return;
  }
  try {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      selectAudioOutput?: () => Promise<MediaDeviceInfo>;
    };
    if (typeof mediaDevices.selectAudioOutput === "function") {
      await mediaDevices.selectAudioOutput();
      state.devices.speakerPermission = "enabled";
      pushConsoleEntry("info", "browser", "Speaker access granted.");
    } else {
      state.devices.speakerPermission = "enabled";
      pushConsoleEntry(
        "info",
        "browser",
        "Speaker permission prompt is not supported on this platform/runtime. Using default output."
      );
    }
  } catch (error) {
    state.devices.speakerPermission = "not_enabled";
    pushConsoleEntry("warn", "browser", `Speaker permission not granted: ${String(error)}`);
  }
  await refreshDevicesState();
}

function shouldShowMicPermissionBubble(): boolean {
  if (state.devices.microphonePermission === "enabled") return false;
  if (state.devices.microphonePermission === "no_device") return false;
  return !state.micPermissionBubbleDismissed;
}

function renderMicPermissionBubble(): string {
  if (!shouldShowMicPermissionBubble()) return "";
  return `
    <div class="permission-bubble" role="status" aria-live="polite">
      <button type="button" class="permission-bubble-close" id="micPermissionDismissBtn" aria-label="Dismiss microphone permission notice">×</button>
      <span class="permission-bubble-text">Allow microphone access for Local Speech Recognition</span>
      <div class="permission-bubble-actions permission-bubble-actions-second-row">
        <button type="button" class="tool-action-btn permission-enable-btn is-warning" id="micPermissionEnableBtn">Enable Microphone</button>
      </div>
    </div>
  `;
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  document.documentElement.setAttribute("data-theme", state.displayMode);
  const llamaRuntimeOnline = Boolean(
    state.llamaRuntime &&
      state.llamaRuntime.state === "healthy" &&
      state.llamaRuntime.activeEngineId &&
      state.llamaRuntime.endpoint &&
      state.llamaRuntime.pid
  );

  const consoleHtml = `
    <div class="console-panel">
      <div class="console-lines">
        ${
          state.consoleEntries.length
            ? state.consoleEntries
                .map((entry) => {
                  const time = new Date(entry.timestampMs).toLocaleTimeString();
                  return `<div class="console-line">${escapeHtml(
                    `${time} [${entry.source}] ${entry.level.toUpperCase()} ${entry.message}`
                  )}</div>`;
                })
                .join("")
            : "<div class='console-empty'>No console output yet.</div>"
        }
      </div>
    </div>
  `;
  const consoleActionsHtml = `
    <button type="button" class="tool-action-btn" id="copyConsoleBtn" aria-label="Copy console output" title="Copy all console lines to clipboard">Copy</button>
    <button type="button" class="tool-action-btn" id="saveConsoleBtn" aria-label="Save console output to text file" title="Save all console lines to a .txt file">Save .txt</button>
  `;

  const terminalUiHtml = renderTerminalWorkspace(
    terminalManager.listSessions(),
    state.activeTerminalSessionId
  );
  const terminalActionsHtml = renderTerminalToolbar(
    terminalManager.listSessions(),
    state.activeTerminalSessionId,
    state.terminalShellProfile
  );
  const toolsUiHtml = renderWorkspaceToolsBody(state.workspaceTools);
  const toolsActionsHtml = renderWorkspaceToolsActions();
  const activeWebTab = getActiveWebTab();
  const webUiHtml = renderWebToolBody({
    tabId: activeWebTab?.id ?? "",
    title: activeWebTab?.title ?? "Search",
    query: activeWebTab?.query ?? "",
    mode: activeWebTab?.mode ?? "search",
    viewMode: activeWebTab?.viewMode ?? "markdown",
    num: activeWebTab?.num ?? 10,
    busy: activeWebTab?.busy ?? false,
    message: activeWebTab?.message ?? null,
    result: activeWebTab?.result ?? null,
    historyOpen: state.webHistoryOpen,
    historyClearConfirmOpen: state.webHistoryClearConfirmOpen,
    historyItems: state.webHistory,
    setupModalOpen: state.webSetupModalOpen,
    setupAccount: state.webSetupAccount,
    setupApiKey: state.webSetupApiKey,
    setupMessage: state.webSetupMessage,
    setupBusy: state.webSetupBusy
  });
  const webActionsHtml = renderWebToolActions(
    state.webTabs.map((tab) => ({
      id: tab.id,
      label: tab.title,
      active: tab.id === state.activeWebTabId
    })),
    activeWebTab?.viewMode ?? "markdown",
    state.webHistoryOpen,
    activeWebTab?.busy ?? false
  );

  const panel = getPanelDefinition(state.sidebarTab, {
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatStreaming: state.chatStreaming,
    chatDraft: state.chatDraft,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    llamaRuntime: state.llamaRuntime,
    llamaRuntimeSelectedEngineId: state.llamaRuntimeSelectedEngineId,
    llamaRuntimeModelPath: state.llamaRuntimeModelPath,
    llamaRuntimePort: state.llamaRuntimePort,
    llamaRuntimeCtxSize: state.llamaRuntimeCtxSize,
    llamaRuntimeGpuLayers: state.llamaRuntimeGpuLayers,
    llamaRuntimeThreads: state.llamaRuntimeThreads,
    llamaRuntimeBatchSize: state.llamaRuntimeBatchSize,
    llamaRuntimeUbatchSize: state.llamaRuntimeUbatchSize,
    llamaRuntimeTemperature: state.llamaRuntimeTemperature,
    llamaRuntimeTopP: state.llamaRuntimeTopP,
    llamaRuntimeTopK: state.llamaRuntimeTopK,
    llamaRuntimeRepeatPenalty: state.llamaRuntimeRepeatPenalty,
    llamaRuntimeFlashAttn: state.llamaRuntimeFlashAttn,
    llamaRuntimeMmap: state.llamaRuntimeMmap,
    llamaRuntimeMlock: state.llamaRuntimeMlock,
    llamaRuntimeSeed: state.llamaRuntimeSeed,
    llamaRuntimeMaxTokens: state.llamaRuntimeMaxTokens,
    llamaRuntimeBusy: state.llamaRuntimeBusy,
    llamaRuntimeLogs: state.llamaRuntimeLogs,
    modelManagerInstalled: state.modelManagerInstalled,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    consoleEntries: state.consoleEntries
  });

  const primaryPaneHtml = `
    <section class="pane primary-pane ${state.sidebarTab === "chat" ? "chat-pane" : ""}">
      <header class="pane-topbar">
        <span class="pane-title">${renderPanelTitleIcon(panel.icon, panel.title)}</span>
        ${panel.renderActions()}
      </header>
      ${panel.renderBody()}
    </section>
  `;

  const workspacePaneHtml = renderWorkspacePane(
    consoleHtml,
    consoleActionsHtml,
    terminalUiHtml,
    terminalActionsHtml,
    toolsUiHtml,
    toolsActionsHtml,
    webUiHtml,
    webActionsHtml,
    state.workspaceTools,
    state.workspaceTab
  );

  const appBodyHtml =
    state.layoutOrientation === "portrait"
      ? `
        <section class="app-body app-body-portrait" id="portraitLayout">
          <section class="portrait-workspace-row">
            ${workspacePaneHtml}
          </section>
          <div class="pane-divider pane-divider-horizontal" id="portraitPaneDivider" aria-label="Resize portrait panels" aria-orientation="horizontal" role="separator">
            <div class="pane-divider-line"></div>
          </div>
          <section class="portrait-main-row">
            ${renderSidebarRail(state.sidebarTab, llamaRuntimeOnline, state.stt.status === "running")}
            <section class="main-column">
              <div class="portrait-primary-wrap">
                ${primaryPaneHtml}
              </div>
            </section>
          </section>
        </section>
      `
      : `
        <section class="app-body">
          ${renderSidebarRail(state.sidebarTab, llamaRuntimeOnline, state.stt.status === "running")}
          <section class="main-column">
          <div class="split-layout" id="splitLayout">
            ${primaryPaneHtml}
            <div class="pane-divider" id="paneDivider" aria-label="Resize panels" role="separator">
              <div class="pane-divider-line"></div>
            </div>
            ${workspacePaneHtml}
          </div>
          </section>
        </section>
      `;

  app.innerHTML = `
    <main class="app-frame" style="--chat-pane-percent: ${state.chatPanePercent}; --portrait-workspace-percent: ${state.portraitWorkspacePercent};">
      ${renderGlobalTopbar(state.displayMode, state.layoutOrientation, state.appVersion)}
      ${renderMicPermissionBubble()}
      ${appBodyHtml}
      ${renderGlobalBottombar(currentBottomStatus())}
    </main>
  `;
}

function renderPanelTitleIcon(icon: IconName, title: string): string {
  return `${iconHtml(icon, { size: 16, tone: "dark" })}<span>${title}</span>`;
}

function pushConsoleEntry(
  level: "log" | "info" | "warn" | "error" | "debug",
  source: "browser" | "app",
  message: string
): void {
  state.consoleEntries.push({
    timestampMs: Date.now(),
    level,
    source,
    message
  });
  if (state.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
    state.consoleEntries.splice(0, state.consoleEntries.length - MAX_CONSOLE_ENTRIES);
  }
}

function buildConsoleCopyText(): string {
  return state.consoleEntries
    .map((entry) => {
      const time = new Date(entry.timestampMs).toLocaleTimeString();
      return `${time} [${entry.source}] ${entry.level.toUpperCase()} ${entry.message}`;
    })
    .join("\n");
}

function buildConsoleFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `console-${stamp}.txt`;
}

function conversationMarkdownFilename(conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `chat-${safe || "conversation"}.md`;
}

function buildConversationMarkdown(
  conversationId: string,
  title: string,
  messages: Array<{ role: "user" | "assistant"; content: string; timestampMs: number }>
): string {
  const lines: string[] = [];
  lines.push(`# ${title || conversationId}`);
  lines.push("");
  lines.push(`- Conversation ID: \`${conversationId}\``);
  lines.push(`- Exported: ${new Date().toLocaleString()}`);
  lines.push("");
  for (const msg of messages) {
    const heading = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${heading} (${new Date(msg.timestampMs).toLocaleString()})`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }
  return lines.join("\n");
}

function updateAssistantDraft(correlationId: string, delta: string): void {
  if (!state.chatFirstAssistantChunkMsByCorrelation[correlationId]) {
    state.chatFirstAssistantChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  const existing = state.messages.find(
    (m) => m.role === "assistant" && m.correlationId === correlationId
  );

  if (existing) {
    existing.text = normalizeChatText(`${existing.text}${delta}`);
    return;
  }

  state.messages.push({ role: "assistant", text: normalizeChatText(delta), correlationId });
}

function updateReasoningDraft(correlationId: string, delta: string): void {
  if (!state.chatFirstReasoningChunkMsByCorrelation[correlationId]) {
    state.chatFirstReasoningChunkMsByCorrelation[correlationId] = Date.now();
    syncThinkingPlacement(correlationId);
  }
  if (state.chatThinkingExpandedByCorrelation[correlationId] === undefined) {
    state.chatThinkingExpandedByCorrelation[correlationId] = false;
  }
  const current = state.chatReasoningByCorrelation[correlationId] ?? "";
  state.chatReasoningByCorrelation[correlationId] = normalizeChatText(`${current}${delta}`);
}

function syncThinkingPlacement(correlationId: string): void {
  const assistantTs = state.chatFirstAssistantChunkMsByCorrelation[correlationId];
  const reasoningTs = state.chatFirstReasoningChunkMsByCorrelation[correlationId];
  if (assistantTs && reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] =
      reasoningTs <= assistantTs ? "before" : "after";
    return;
  }
  if (reasoningTs && !assistantTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "before";
    return;
  }
  if (assistantTs && !reasoningTs) {
    state.chatThinkingPlacementByCorrelation[correlationId] = "after";
  }
}

function resetCurrentConversationUiState(): void {
  state.messages = [];
  state.chatReasoningByCorrelation = {};
  state.chatThinkingPlacementByCorrelation = {};
  state.chatThinkingExpandedByCorrelation = {};
  state.chatFirstAssistantChunkMsByCorrelation = {};
  state.chatFirstReasoningChunkMsByCorrelation = {};
  state.chatStreaming = false;
  state.activeChatCorrelationId = null;
}

function normalizeChatText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseStreamChunk(payload: AppEvent["payload"]): ChatStreamChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

function parseReasoningStreamChunk(
  payload: AppEvent["payload"]
): ChatStreamReasoningChunkPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.conversationId !== "string" ||
    typeof value.delta !== "string" ||
    typeof value.done !== "boolean"
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId,
    delta: value.delta,
    done: value.done
  };
}

function parseTerminalOutput(payload: AppEvent["payload"]): { sessionId: string; data: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string" || typeof value.data !== "string") return null;
  return { sessionId: value.sessionId, data: value.data };
}

function parseTerminalExit(payload: AppEvent["payload"]): { sessionId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sessionId !== "string") return null;
  return { sessionId: value.sessionId };
}

function isNoisyTerminalControlEvent(event: AppEvent): boolean {
  if (event.subsystem !== "ipc") return false;
  if (event.stage === "error") return false;
  return event.action === "cmd.terminal.resize" || event.action === "cmd.terminal.send_input";
}

function isNoisyRuntimeStatusEvent(event: AppEvent): boolean {
  return (
    event.subsystem === "runtime" &&
    event.action === "llama.runtime.status" &&
    event.stage === "complete"
  );
}

function isNoisyChatStreamEvent(event: AppEvent): boolean {
  if (event.subsystem !== "service") return false;
  if (event.stage !== "progress") return false;
  return event.action === "chat.stream.chunk" || event.action === "chat.stream.reasoning_chunk";
}

function formatRuntimeEventLine(event: AppEvent): string {
  const payloadText =
    event.payload && typeof event.payload === "object"
      ? JSON.stringify(event.payload)
      : String(event.payload);
  const payloadObj =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : null;
  const lineText =
    payloadObj && typeof payloadObj.line === "string" ? payloadObj.line : null;

  if (event.action === "llama.runtime.process.stdout" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stdout] ${lineText}`;
  }
  if (event.action === "llama.runtime.process.stderr" && lineText) {
    return `${new Date(event.timestampMs).toLocaleTimeString()} [stderr] ${lineText}`;
  }
  return `${new Date(event.timestampMs).toLocaleTimeString()} ${event.action} ${event.stage} ${payloadText}`;
}

function payloadAsRecord(payload: AppEvent["payload"]): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function formatAgentEventLine(event: AppEvent): string | null {
  const payload = payloadAsRecord(event.payload);
  if (event.action === "chat.agent.request") {
    const model = typeof payload?.model === "string" ? payload.model : "unknown";
    const maxTokens =
      typeof payload?.maxTokens === "number" ? String(payload.maxTokens) : "n/a";
    const baseUrl = typeof payload?.baseUrl === "string" ? payload.baseUrl : "n/a";
    return `${event.action} ${event.stage} model=${model} maxTokens=${maxTokens} baseUrl=${baseUrl}`;
  }
  if (event.action === "chat.agent.tool.start") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const callId =
      typeof payload?.toolCallId === "string" ? payload.toolCallId : "unknown";
    return `tool.start ${tool} call=${callId}`;
  }
  if (event.action === "chat.agent.tool.end") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const display =
      typeof payload?.display === "string" ? payload.display : "";
    return display ? `tool.end ${tool} ${display}` : `tool.end ${tool}`;
  }
  if (event.action === "chat.agent.tool.result") {
    const tool = typeof payload?.toolName === "string" ? payload.toolName : "unknown";
    const success = payload?.success === true;
    const display =
      typeof payload?.display === "string" ? payload.display : "";
    const status = success ? "ok" : "error";
    return display ? `tool.result ${tool} ${status} ${display}` : `tool.result ${tool} ${status}`;
  }
  if (event.action === "chat.agent.fallback") {
    const message =
      typeof payload?.message === "string" ? payload.message : safePayloadPreview(event.payload);
    return `${event.action} ${event.stage} ${message}`;
  }
  return null;
}

function extractRuntimeProcessLine(event: AppEvent): string | null {
  if (
    event.action !== "llama.runtime.process.stderr" &&
    event.action !== "llama.runtime.process.stdout"
  ) {
    return null;
  }
  if (!event.payload || typeof event.payload !== "object") return null;
  const payloadObj = event.payload as Record<string, unknown>;
  return typeof payloadObj.line === "string" ? payloadObj.line : null;
}

function updateRuntimeMetricsFromLine(line: string): void {
  const ctxMatch = line.match(/n_ctx_slot\s*=\s*(\d+)/i);
  const ctxValue = ctxMatch?.[1];
  if (ctxValue) {
    state.llamaRuntimeContextCapacity = Number.parseInt(ctxValue, 10);
  }

  const tokensMatch = line.match(/n_tokens\s*=\s*(\d+)/i);
  const tokenValue = tokensMatch?.[1];
  if (tokenValue) {
    state.llamaRuntimeContextTokens = Number.parseInt(tokenValue, 10);
  }

  const tpsMatch = line.match(/([0-9]+(?:\.[0-9]+)?)\s+tokens per second/i);
  const tpsValue = tpsMatch?.[1];
  if (tpsValue) {
    state.llamaRuntimeTokensPerSecond = Number.parseFloat(tpsValue);
  }
}

function modelNameFromPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "none";
  const normalized = trimmed.replace(/\\/g, "/");
  const tail = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return tail || "none";
}

function prettifyRepoName(repoId: string): string {
  const slug = repoId.split("/").at(-1) ?? repoId;
  const cleaned = slug.replace(/-GGUF(?:-UD)?$/i, "");
  return cleaned.replace(/-/g, " ");
}

function extractParamCountLabel(repoId: string): string {
  const match = repoId.match(/(\d+(?:\.\d+)?B(?:-A\d+B)?)/i);
  const label = match?.[1];
  return label ? label.toUpperCase() : "n/a";
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  if (value >= 100) return "100";
  return value.toFixed(1);
}

function currentBottomStatus() {
  const activeEngineId = state.llamaRuntime?.activeEngineId ?? null;
  const activeEngine =
    (activeEngineId
      ? state.llamaRuntime?.engines.find((engine) => engine.engineId === activeEngineId)
      : undefined) ??
    (state.llamaRuntimeSelectedEngineId
      ? state.llamaRuntime?.engines.find((engine) => engine.engineId === state.llamaRuntimeSelectedEngineId)
      : undefined);
  const engine = activeEngine?.backend?.trim() || "offline";

  const contextTokens = state.llamaRuntimeContextTokens;
  const contextCapacity = state.llamaRuntimeContextCapacity;
  const contextText =
    contextTokens && contextCapacity && contextCapacity > 0
      ? `${contextTokens}/${contextCapacity} (${formatPercent((contextTokens / contextCapacity) * 100)}%)`
      : "n/a";

  const speedText =
    typeof state.llamaRuntimeTokensPerSecond === "number"
      ? `${state.llamaRuntimeTokensPerSecond >= 100 ? state.llamaRuntimeTokensPerSecond.toFixed(0) : state.llamaRuntimeTokensPerSecond.toFixed(1)} tok/s`
      : "n/a";

  return {
    runtimeMode: state.runtimeMode,
    engine,
    model: modelNameFromPath(state.llamaRuntimeModelPath),
    contextText,
    speedText
  };
}

async function refreshConversations(): Promise<void> {
  if (!clientRef) return;
  const list = await clientRef.listConversations({ correlationId: nextCorrelationId() });
  state.conversations = list.conversations;
}

async function loadConversation(conversationId: string): Promise<void> {
  if (!clientRef) return;
  state.conversationId = conversationId;
  const history = await clientRef.getMessages({
    conversationId,
    correlationId: nextCorrelationId()
  });
  state.messages = history.messages.map((m) => ({
    role: m.role,
    text: m.content,
    correlationId: m.correlationId
  }));
  state.chatReasoningByCorrelation = {};
  state.chatThinkingPlacementByCorrelation = {};
  state.chatThinkingExpandedByCorrelation = {};
  state.chatFirstAssistantChunkMsByCorrelation = {};
  state.chatFirstReasoningChunkMsByCorrelation = {};
}

async function refreshTools(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.listWorkspaceTools({ correlationId: nextCorrelationId() });
  state.workspaceTools = response.tools;
}

async function refreshApiConnections(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.listApiConnections({ correlationId: nextCorrelationId() });
  state.apiConnections = response.connections;
}

function getActiveWebTab(): WebTabState | null {
  if (!state.webTabs.length) return null;
  const found = state.webTabs.find((tab) => tab.id === state.activeWebTabId);
  return found ?? state.webTabs[0] ?? null;
}

function withActiveWebTab(mutator: (tab: WebTabState) => void): void {
  const active = getActiveWebTab();
  if (!active) return;
  mutator(active);
}

function ensureWebTabs(): void {
  if (state.webTabs.length) return;
  const tab = createWebTab(state.nextWebTabIndex++);
  state.webTabs = [tab];
  state.activeWebTabId = tab.id;
}

function createAndActivateWebTab(): void {
  const tab = createWebTab(state.nextWebTabIndex++);
  state.webTabs = [...state.webTabs, tab];
  state.activeWebTabId = tab.id;
}

async function runWebSearch(): Promise<void> {
  const client = clientRef;
  const activeTab = getActiveWebTab();
  if (!client || !activeTab || activeTab.busy) return;
  await refreshApiConnections();
  if (!hasVerifiedSearchConnection()) {
    state.webSetupModalOpen = true;
    state.webSetupMessage = "Add and verify a Serper Search API connection to continue.";
    return;
  }
  const query = activeTab.query.trim();
  if (!query) {
    activeTab.message = "Enter a query.";
    return;
  }

  activeTab.busy = true;
  activeTab.message = null;
  try {
    const response = await client.webSearch({
      correlationId: nextCorrelationId(),
      query,
      mode: activeTab.mode,
      num: activeTab.num
    });
    activeTab.result = response.result;
    const resultCount = getWebResultCount(response);
    activeTab.message =
      resultCount !== null
        ? `Fetched ${resultCount} result${resultCount === 1 ? "" : "s"}.`
        : "Search completed.";
    recordWebSearchHistory(query, activeTab.mode, activeTab.num);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed.";
    activeTab.message = message;
    if (isMissingSearchApiError(message)) {
      state.webSetupModalOpen = true;
      state.webSetupMessage = "Search API is missing or not verified. Configure Serper to continue.";
    }
  } finally {
    activeTab.busy = false;
  }
}

function recordWebSearchHistory(query: string, mode: string, num: number): void {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;
  const entry: WebSearchHistoryItem = {
    id: `webh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    query: normalizedQuery,
    mode: mode.trim() || "search",
    num: Math.max(1, Math.min(20, Math.trunc(num))),
    timestampMs: Date.now()
  };
  const deduped = state.webHistory.filter(
    (item) =>
      !(
        item.query.toLowerCase() === entry.query.toLowerCase() &&
        item.mode === entry.mode &&
        item.num === entry.num
      )
  );
  state.webHistory = [entry, ...deduped].slice(0, 200);
  persistWebSearchHistory(state.webHistory);
}

function hasVerifiedSearchConnection(): boolean {
  return state.apiConnections.some(
    (connection) => connection.apiType === "search" && connection.status === "verified"
  );
}

function isMissingSearchApiError(message: string): boolean {
  const value = message.toLowerCase();
  return value.includes("no verified search api configured") || value.includes("search api key");
}

async function saveWebSearchSetup(): Promise<void> {
  const client = clientRef;
  if (!client || state.webSetupBusy) return;
  const account = state.webSetupAccount.trim();
  const apiKey = state.webSetupApiKey.trim();
  if (!account || !apiKey) {
    state.webSetupMessage = "Account name and API key are required.";
    return;
  }

  state.webSetupBusy = true;
  state.webSetupMessage = "Saving and verifying Serper connection...";
  try {
    const created = await client.createApiConnection({
      correlationId: nextCorrelationId(),
      apiType: "search",
      apiUrl: "https://google.serper.dev",
      name: account,
      apiKey
    });
    await refreshApiConnections();
    if (created.connection.status === "verified") {
      state.webSetupMessage = "Serper connection verified.";
      state.webSetupModalOpen = false;
      state.webSetupApiKey = "";
      withActiveWebTab((tab) => {
        tab.message = "Search API configured. You can run searches now.";
      });
      return;
    }
    state.webSetupMessage = created.connection.statusMessage;
  } catch (error) {
    state.webSetupMessage =
      error instanceof Error ? error.message : "Failed saving Serper connection.";
  } finally {
    state.webSetupBusy = false;
  }
}

function getWebResultCount(response: WebSearchResponse): number | null {
  const raw = response.result as {
    items?: unknown;
    organic?: unknown;
    news?: unknown;
    images?: unknown;
    videos?: unknown;
    shopping?: unknown;
    places?: unknown;
  };
  if (Array.isArray(raw.items)) return raw.items.length;
  if (Array.isArray(raw.organic)) return raw.organic.length;
  if (Array.isArray(raw.news)) return raw.news.length;
  if (Array.isArray(raw.images)) return raw.images.length;
  if (Array.isArray(raw.videos)) return raw.videos.length;
  if (Array.isArray(raw.shopping)) return raw.shopping.length;
  if (Array.isArray(raw.places)) return raw.places.length;
  return null;
}

async function refreshModelManagerInstalled(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.modelManagerListInstalled({
    correlationId: nextCorrelationId()
  });
  state.modelManagerInstalled = response.models;
}

async function refreshModelManagerUnslothUdCatalog(): Promise<void> {
  if (!clientRef) return;
  state.modelManagerUnslothUdLoading = true;
  try {
    const csv = await clientRef.modelManagerListCatalogCsv({
      correlationId: nextCorrelationId(),
      listName: "Unsloth Dynamic Quants"
    });
    const grouped = new Map<
      string,
      {
        repoId: string;
        modelName: string;
        parameterCount: string;
        udAssets: Array<{ fileName: string; quant: string; sizeGb: string }>;
      }
    >();
    for (const row of csv.rows) {
      if (!row.quant || !row.fileName) continue;
      const key = row.repoId;
      const current = grouped.get(key) ?? {
        repoId: row.repoId,
        modelName: row.modelName || prettifyRepoName(row.repoId),
        parameterCount: row.parameterCount || extractParamCountLabel(row.repoId),
        udAssets: []
      };
      current.udAssets.push({
        fileName: row.fileName,
        quant: row.quant.replace(/^UD[-_]?/i, ""),
        sizeGb:
          typeof row.sizeMb === "number" && Number.isFinite(row.sizeMb)
            ? `${(row.sizeMb / 1024).toFixed(1)} GB`
            : "n/a"
      });
      grouped.set(key, current);
    }
    const rows = [...grouped.values()]
      .map((row) => {
        row.udAssets.sort((a, b) => a.quant.localeCompare(b.quant));
        const preferred = row.udAssets.find((asset) =>
          asset.quant.toUpperCase().includes("Q4_K_XL")
        );
        return {
          repoId: row.repoId,
          modelName: row.modelName,
          parameterCount: row.parameterCount,
          udAssets: row.udAssets,
          selectedAssetFileName: preferred?.fileName ?? row.udAssets[0]?.fileName ?? ""
        };
      })
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
    if (rows.length > 0) {
      state.modelManagerUnslothUdCatalog = rows;
      state.modelManagerUnslothUdLoading = false;
      state.modelManagerMessage = `Loaded ${rows.length} UD model(s) from CSV.`;
      return;
    }
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "No UD models found in CSV catalog.";
  } catch {
    state.modelManagerUnslothUdCatalog = [];
    state.modelManagerMessage = "Failed to load UD CSV catalog.";
  }
  state.modelManagerUnslothUdLoading = false;
}

async function refreshLlamaRuntime(): Promise<void> {
  if (!clientRef) return;
  const response = await clientRef.getLlamaRuntimeStatus({ correlationId: nextCorrelationId() });
  state.llamaRuntime = response;
  let current = response.engines.find(
    (engine) => engine.engineId === state.llamaRuntimeSelectedEngineId
  );

  const isSelectableGpu = (engine: (typeof response.engines)[number]): boolean => {
    if (engine.backend === "cpu") return false;
    if (!engine.isApplicable) return false;
    return engine.isReady || engine.isInstalled || engine.prerequisites.some((item) => item.ok);
  };

  // Prefer Linux GPU backends in this order when detected and applicable.
  const preferredRocm = response.engines.find(
    (engine) => engine.backend === "rocm" && isSelectableGpu(engine)
  );
  const preferredVulkan = response.engines.find(
    (engine) => engine.backend === "vulkan" && isSelectableGpu(engine)
  );
  const preferredAnyGpu = response.engines.find(
    (engine) => isSelectableGpu(engine)
  );
  const preferredGpu = preferredRocm ?? preferredVulkan ?? preferredAnyGpu ?? null;

  if (preferredGpu) {
    const isCurrentCpu = current?.backend === "cpu";
    if (!current || isCurrentCpu || !current.isReady) {
      state.llamaRuntimeSelectedEngineId = preferredGpu.engineId;
      current = response.engines.find(
        (engine) => engine.engineId === state.llamaRuntimeSelectedEngineId
      );
    }
  }

  if (!current) {
    const firstEngine = response.engines.at(0);
    if (firstEngine) {
      state.llamaRuntimeSelectedEngineId = firstEngine.engineId;
      current = firstEngine;
    }
  }

  const selectedEngine = current;
  if (
    selectedEngine &&
    selectedEngine.isApplicable &&
    !selectedEngine.isBundled &&
    !selectedEngine.isInstalled
  ) {
    if (warnedMissingBundleEngineId !== selectedEngine.engineId) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Selected engine ${selectedEngine.label} is not bundled in this build. Install will require local PATH or runtime download fallback.`
      );
      warnedMissingBundleEngineId = selectedEngine.engineId;
    }
  } else {
    warnedMissingBundleEngineId = null;
  }
}

async function browseModelPath(): Promise<string | null> {
  const currentValue = state.llamaRuntimeModelPath.trim();
  if (state.runtimeMode === "tauri") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          title: "Select GGUF Model",
          directory: false,
          multiple: false,
          filters: [
            { name: "GGUF", extensions: ["gguf"] },
            { name: "All files", extensions: ["*"] }
          ]
        }
      });
      if (Array.isArray(selected)) {
        return selected[0] ?? null;
      }
      return selected;
    } catch (error) {
      pushConsoleEntry(
        "warn",
        "browser",
        `Native model picker unavailable, falling back to manual entry: ${String(error)}`
      );
    }
  }

  const manual = window.prompt("Enter absolute model path (GGUF file)", currentValue);
  if (!manual) return null;
  const normalized = manual.trim();
  return normalized ? normalized : null;
}

async function autoStartLlamaRuntimeIfConfigured(): Promise<void> {
  if (!clientRef) return;
  const modelPath = state.llamaRuntimeModelPath.trim();
  if (!modelPath) {
    return;
  }

  await refreshLlamaRuntime();
  if (
    state.llamaRuntime &&
    state.llamaRuntime.state === "healthy" &&
    state.llamaRuntime.activeEngineId &&
    state.llamaRuntime.endpoint &&
    state.llamaRuntime.pid
  ) {
    return;
  }

  const engineId =
    state.llamaRuntimeSelectedEngineId || state.llamaRuntime?.engines[0]?.engineId || "";
  if (!engineId) {
    pushConsoleEntry("warn", "browser", "Auto-start skipped: no llama runtime engine available.");
    return;
  }

  state.llamaRuntimeBusy = true;
  try {
    const selectedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === engineId);
    if (!selectedEngine) {
      throw new Error(`Runtime engine not found: ${engineId}`);
    }

    const shouldVerifyInstall =
      selectedEngine.backend !== "cpu" || !selectedEngine.isInstalled || !selectedEngine.isReady;
    if (shouldVerifyInstall) {
      pushConsoleEntry(
        "info",
        "browser",
        `Auto-start: verifying runtime files for ${selectedEngine.label}...`
      );
      await clientRef.installLlamaRuntimeEngine({
        correlationId: nextCorrelationId(),
        engineId
      });
      await refreshLlamaRuntime();
    }

    const refreshedEngine = state.llamaRuntime?.engines.find((engine) => engine.engineId === engineId);
    if (!refreshedEngine?.isReady) {
      const canProceedWithGpu =
        refreshedEngine?.backend !== "cpu" &&
        refreshedEngine?.isApplicable &&
        refreshedEngine?.isInstalled;
      if (!canProceedWithGpu) {
        const blocking = refreshedEngine?.prerequisites
          .filter((item) => !item.ok)
          .map((item) => `${item.key}: ${item.message}`)
          .join(" | ");
        throw new Error(
          blocking
            ? `Auto-start blocked: ${blocking}`
            : `Auto-start blocked: runtime engine is not ready (${engineId})`
        );
      }
    }

    await clientRef.startLlamaRuntime({
      correlationId: nextCorrelationId(),
      engineId,
      modelPath,
      port: state.llamaRuntimePort,
      ctxSize: state.llamaRuntimeCtxSize,
      nGpuLayers: state.llamaRuntimeGpuLayers
    });
    await refreshLlamaRuntime();
    pushConsoleEntry("info", "browser", `Auto-started llama runtime using ${engineId}.`);
  } catch (error) {
    pushConsoleEntry("warn", "browser", `Auto-start failed: ${String(error)}`);
    await refreshLlamaRuntime();
  } finally {
    state.llamaRuntimeBusy = false;
  }
}

function renderAndBind(sendMessage: (text: string) => Promise<void>): void {
  render();
  scrollConsoleToBottom();
  attachDividerResize();
  attachTopbarInteractions(sendMessage);
  attachSidebarInteractions(sendMessage);
  attachWorkspaceInteractions(sendMessage);
  attachPrimaryPanelInteractions(state.sidebarTab, state, {
    onSendMessage: sendMessage,
    onUpdateChatDraft: (text: string) => {
      state.chatDraft = text;
    },
    onStopCurrentResponse: async () => {
      if (!clientRef || !state.activeChatCorrelationId) return;
      const targetCorrelationId = state.activeChatCorrelationId;
      await clientRef.cancelMessage({
        correlationId: nextCorrelationId(),
        targetCorrelationId
      });
      pushConsoleEntry("info", "browser", `Requested stop for ${targetCorrelationId}.`);
    },
    onToggleThinkingPanel: async (correlationId: string) => {
      const current = state.chatThinkingExpandedByCorrelation[correlationId] === true;
      state.chatThinkingExpandedByCorrelation[correlationId] = !current;
      renderAndBind(sendMessage);
    },
    onCreateConversation: async () => {
      const id = generateChatConversationId();
      state.conversationId = id;
      resetCurrentConversationUiState();
      state.sidebarTab = "chat";
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onClearChat: async () => {
      const currentId = state.conversationId;
      if (clientRef) {
        try {
          await clientRef.deleteConversation({
            conversationId: currentId,
            correlationId: nextCorrelationId()
          });
        } catch (error) {
          pushConsoleEntry("warn", "browser", `Failed to clear persisted conversation: ${String(error)}`);
        }
      }
      state.conversationId = generateChatConversationId();
      resetCurrentConversationUiState();
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onToggleChatThinking: async () => {
      state.chatThinkingEnabled = !state.chatThinkingEnabled;
      pushConsoleEntry(
        "info",
        "browser",
        `Thinking mode ${state.chatThinkingEnabled ? "enabled" : "disabled"}`
      );
      renderAndBind(sendMessage);
    },
    onDevicesRefresh: async () => {
      await refreshDevicesState();
      renderAndBind(sendMessage);
    },
    onRequestMicrophoneAccess: async () => {
      await requestMicrophoneAccess();
      // Sync microphone permission to STT state for UI display
      state.stt.microphonePermission = state.devices.microphonePermission;
      renderAndBind(sendMessage);
    },
    onRequestSpeakerAccess: async () => {
      await requestSpeakerAccess();
      renderAndBind(sendMessage);
    },
    onApiConnectionsRefresh: async () => {
      await refreshApiConnections();
      renderAndBind(sendMessage);
    },
    onApiConnectionsSetFormOpen: async (open: boolean) => {
      state.apiFormOpen = open;
      if (!open) {
        state.apiDraft = defaultApiConnectionDraft();
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionDraftChange: async (patch) => {
      state.apiDraft = {
        ...state.apiDraft,
        ...patch
      };
    },
    onApiConnectionEdit: async (id: string) => {
      if (!clientRef) return;
      const connection = state.apiConnections.find((record) => record.id === id);
      if (!connection) return;
      let fullApiKey = "";
      try {
        const secret = await clientRef.getApiConnectionSecret({
          correlationId: nextCorrelationId(),
          id
        });
        fullApiKey = secret.apiKey;
      } catch (error) {
        state.apiMessage = `Failed loading API key for edit: ${String(error)}`;
      }
      state.apiEditingId = id;
      state.apiDraft = {
        apiType: connection.apiType,
        apiUrl: connection.apiUrl,
        name: connection.name ?? "",
        apiKey: fullApiKey,
        modelName: connection.modelName ?? "",
        costPerMonthUsd: typeof connection.costPerMonthUsd === "number"
          ? String(connection.costPerMonthUsd)
          : "",
        apiStandardPath: connection.apiStandardPath ?? ""
      };
      state.apiFormOpen = true;
      renderAndBind(sendMessage);
    },
    onApiConnectionSave: async () => {
      if (!clientRef) return;
      const apiUrl = state.apiDraft.apiUrl.trim();
      const apiKey = state.apiDraft.apiKey.trim();
      if (!apiUrl || (!state.apiEditingId && !apiKey)) {
        state.apiMessage = !apiUrl ? "API URL is required." : "API key is required.";
        renderAndBind(sendMessage);
        return;
      }
      const costRaw = state.apiDraft.costPerMonthUsd.trim();
      let costPerMonthUsd: number | undefined;
      if (costRaw) {
        const parsed = Number.parseFloat(costRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          state.apiMessage = "Cost must be a non-negative number.";
          renderAndBind(sendMessage);
          return;
        }
        costPerMonthUsd = Number.parseFloat(parsed.toFixed(2));
      }
      try {
        if (state.apiEditingId) {
          const includeApiKey =
            Boolean(apiKey) &&
            !(apiKey.includes("*") && /\*{2,}/.test(apiKey));
          // Update existing connection
          const updated = await clientRef.updateApiConnection({
            correlationId: nextCorrelationId(),
            id: state.apiEditingId,
            apiType: state.apiDraft.apiType,
            apiUrl,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(includeApiKey ? { apiKey } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          });
          const verified = await clientRef.reverifyApiConnection({
            correlationId: nextCorrelationId(),
            id: updated.connection.id
          });
          state.apiConnections = state.apiConnections.map((record) =>
            record.id === state.apiEditingId ? verified.connection : record
          );
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = verified.connection.statusMessage;
        } else {
          // Create new connection
          const created = await clientRef.createApiConnection({
            correlationId: nextCorrelationId(),
            apiType: state.apiDraft.apiType,
            apiUrl,
            apiKey,
            ...(state.apiDraft.name.trim() ? { name: state.apiDraft.name.trim() } : {}),
            ...(state.apiDraft.modelName.trim() ? { modelName: state.apiDraft.modelName.trim() } : {}),
            ...(typeof costPerMonthUsd === "number" ? { costPerMonthUsd } : {}),
            ...(state.apiDraft.apiStandardPath.trim() ? { apiStandardPath: state.apiDraft.apiStandardPath.trim() } : {})
          });
          state.apiConnections = [created.connection, ...state.apiConnections];
          state.apiFormOpen = false;
          state.apiEditingId = null;
          state.apiDraft = defaultApiConnectionDraft();
          state.apiMessage = created.connection.statusMessage;
        }
      } catch (error) {
        state.apiMessage = `Failed saving API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionReverify: async (id: string) => {
      if (!clientRef) return;
      try {
        const verified = await clientRef.reverifyApiConnection({
          correlationId: nextCorrelationId(),
          id
        });
        state.apiConnections = state.apiConnections.map((record) =>
          record.id === id ? verified.connection : record
        );
        state.apiMessage = verified.connection.statusMessage;
      } catch (error) {
        state.apiMessage = `Failed re-verifying API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onApiConnectionDelete: async (id: string) => {
      if (!clientRef) return;
      const confirmed = window.confirm("Remove this API connection?");
      if (!confirmed) return;
      try {
        const response = await clientRef.deleteApiConnection({
          correlationId: nextCorrelationId(),
          id
        });
        if (response.deleted) {
          state.apiConnections = state.apiConnections.filter((record) => record.id !== id);
          state.apiMessage = "API connection removed.";
        } else {
          state.apiMessage = "API connection was not found.";
        }
      } catch (error) {
        state.apiMessage = `Failed deleting API: ${String(error)}`;
      }
      renderAndBind(sendMessage);
    },
    onSelectConversation: async (conversationId: string) => {
      await loadConversation(conversationId);
      state.sidebarTab = "chat";
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onExportConversation: async (conversationId: string) => {
      if (!clientRef) return;
      try {
        const history = await clientRef.getMessages({
          conversationId,
          correlationId: nextCorrelationId()
        });
        const summary = state.conversations.find((item) => item.conversationId === conversationId);
        const title = summary?.title?.trim() || summary?.lastMessagePreview || conversationId;
        const markdown = buildConversationMarkdown(
          conversationId,
          title,
          history.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestampMs: m.timestampMs
          }))
        );
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = conversationMarkdownFilename(conversationId);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        pushConsoleEntry("info", "browser", `Saved conversation ${conversationId} as markdown.`);
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed exporting conversation ${conversationId}: ${String(error)}`
        );
      }
      renderAndBind(sendMessage);
    },
    onDeleteConversation: async (conversationId: string) => {
      if (!clientRef) return;
      try {
        await clientRef.deleteConversation({
          conversationId,
          correlationId: nextCorrelationId()
        });
      } catch (error) {
        pushConsoleEntry("error", "browser", `Failed deleting conversation ${conversationId}: ${String(error)}`);
      }
      if (state.conversationId === conversationId) {
        state.conversationId = generateChatConversationId();
        resetCurrentConversationUiState();
      }
      await refreshConversations();
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeRefresh: async () => {
      state.llamaRuntimeBusy = true;
      try {
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeInstall: async (engineId: string) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      try {
        await clientRef.installLlamaRuntimeEngine({
          correlationId: nextCorrelationId(),
          engineId
        });
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed to install runtime engine ${engineId}: ${String(error)}`
        );
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeBrowseModelPath: async () => {
      const selectedPath = await browseModelPath();
      if (!selectedPath) return;
      state.llamaRuntimeModelPath = selectedPath;
      persistLlamaModelPath(selectedPath);
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeSetMaxTokens: async (maxTokens: number | null) => {
      state.llamaRuntimeMaxTokens = maxTokens === null ? null : Math.max(128, Math.min(4096, maxTokens));
      persistLlamaMaxTokens(state.llamaRuntimeMaxTokens);
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeClearLogs: async () => {
      state.llamaRuntimeLogs = [];
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStart: async ({
      engineId,
      modelPath,
      port,
      ctxSize,
      nGpuLayers,
      threads,
      batchSize,
      ubatchSize,
      temperature,
      topP,
      topK,
      repeatPenalty,
      flashAttn,
      mmap,
      mlock,
      seed
    }) => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      state.llamaRuntimeSelectedEngineId = engineId;
      state.llamaRuntimeModelPath = modelPath;
      persistLlamaModelPath(modelPath);
      state.llamaRuntimePort = port;
      state.llamaRuntimeCtxSize = ctxSize;
      state.llamaRuntimeGpuLayers = nGpuLayers;
      state.llamaRuntimeThreads = threads;
      state.llamaRuntimeBatchSize = batchSize;
      state.llamaRuntimeUbatchSize = ubatchSize;
      state.llamaRuntimeTemperature = temperature;
      state.llamaRuntimeTopP = topP;
      state.llamaRuntimeTopK = topK;
      state.llamaRuntimeRepeatPenalty = repeatPenalty;
      state.llamaRuntimeFlashAttn = flashAttn;
      state.llamaRuntimeMmap = mmap;
      state.llamaRuntimeMlock = mlock;
      state.llamaRuntimeSeed = seed;
      try {
        await refreshLlamaRuntime();
        const selectedEngine = state.llamaRuntime?.engines.find(
          (engine) => engine.engineId === engineId
        );
        if (!selectedEngine) {
          throw new Error(`Runtime engine not found: ${engineId}`);
        }

        const shouldVerifyInstall =
          selectedEngine.backend !== "cpu" || !selectedEngine.isInstalled || !selectedEngine.isReady;
        if (shouldVerifyInstall) {
          pushConsoleEntry(
            "info",
            "browser",
            `Verifying runtime files for ${selectedEngine.label} before start...`
          );
          await clientRef.installLlamaRuntimeEngine({
            correlationId: nextCorrelationId(),
            engineId
          });
          await refreshLlamaRuntime();
        }

        const refreshedEngine = state.llamaRuntime?.engines.find(
          (engine) => engine.engineId === engineId
        );
        if (!refreshedEngine?.isReady) {
          const canProceedWithGpu =
            refreshedEngine?.backend !== "cpu" &&
            refreshedEngine?.isApplicable &&
            refreshedEngine?.isInstalled;
          if (canProceedWithGpu) {
            pushConsoleEntry(
              "warn",
              "browser",
              `Proceeding with ${refreshedEngine.label} even though prerequisite probes are inconclusive.`
            );
          } else {
          const blocking = refreshedEngine?.prerequisites
            .filter((item) => !item.ok)
            .map((item) => `${item.key}: ${item.message}`)
            .join(" | ");
            throw new Error(
              blocking
                ? `Runtime engine is not ready: ${blocking}`
                : `Runtime engine is not ready: ${engineId}`
            );
          }
        }

        const startRequest = {
          correlationId: nextCorrelationId(),
          engineId,
          modelPath,
          port,
          ctxSize,
          nGpuLayers,
          temperature,
          topP,
          topK,
          repeatPenalty,
          flashAttn,
          mmap,
          mlock,
          ...(threads !== null ? { threads } : {}),
          ...(batchSize !== null ? { batchSize } : {}),
          ...(ubatchSize !== null ? { ubatchSize } : {}),
          ...(seed !== null ? { seed } : {})
        };
        await clientRef.startLlamaRuntime(startRequest);
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry(
          "error",
          "browser",
          `Failed to start runtime ${engineId}: ${String(error)}`
        );
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onLlamaRuntimeStop: async () => {
      if (!clientRef) return;
      state.llamaRuntimeBusy = true;
      try {
        await clientRef.stopLlamaRuntime({ correlationId: nextCorrelationId() });
        await refreshLlamaRuntime();
      } catch (error) {
        pushConsoleEntry("error", "browser", `Failed to stop runtime: ${String(error)}`);
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerRefreshInstalled: async () => {
      state.modelManagerBusy = true;
      state.modelManagerMessage = "Refreshing installed models...";
      try {
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Found ${state.modelManagerInstalled.length} installed model(s).`;
      } catch (error) {
        state.modelManagerMessage = `Refresh failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSetQuery: async (query: string) => {
      state.modelManagerQuery = query.trim();
      renderAndBind(sendMessage);
    },
    onModelManagerSetCollection: async (collection: string) => {
      state.modelManagerCollection = collection.trim() || "unsloth_ud";
      if (state.modelManagerCollection === "unsloth_ud" && !state.modelManagerUnslothUdCatalog.length) {
        state.modelManagerMessage = "Loading Unsloth UD quant catalog...";
        await refreshModelManagerUnslothUdCatalog();
        state.modelManagerMessage = `Loaded ${state.modelManagerUnslothUdCatalog.length} UD model(s).`;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSearchHf: async () => {
      if (!clientRef) return;
      const query = state.modelManagerQuery.trim();
      const collectionPrefix: Record<string, string> = {
        all: "",
        unsloth_ud: "unsloth",
        arxell: "Arxell",
        qwen: "Qwen",
        glm: "GLM",
        ministral: "Ministral"
      };
      const prefix = collectionPrefix[state.modelManagerCollection] ?? "";
      const effectiveQuery = `${prefix} ${query}`.trim();
      if (!effectiveQuery) {
        state.modelManagerMessage = "Enter a Hugging Face search query.";
        renderAndBind(sendMessage);
        return;
      }
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Searching Hugging Face for "${effectiveQuery}"...`;
      try {
        const response = await clientRef.modelManagerSearchHf({
          correlationId: nextCorrelationId(),
          query: effectiveQuery,
          limit: 8
        });
        state.modelManagerSearchResults = response.results;
        state.modelManagerMessage = `Search complete: ${response.results.length} candidate(s).`;
      } catch (error) {
        state.modelManagerMessage = `Search failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerDownloadHf: async ({ repoId, fileName }) => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Downloading ${repoId}/${fileName}...`;
      try {
        const response = await clientRef.modelManagerDownloadHf({
          correlationId: nextCorrelationId(),
          repoId,
          fileName
        });
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Downloaded ${response.model.name}.`;
      } catch (error) {
        state.modelManagerMessage = `Download failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerSetUdQuant: async ({ repoId, fileName }) => {
      state.modelManagerUnslothUdCatalog = state.modelManagerUnslothUdCatalog.map((row) =>
        row.repoId === repoId ? { ...row, selectedAssetFileName: fileName } : row
      );
      renderAndBind(sendMessage);
    },
    onModelManagerUseAsLlamaPath: async (modelPath: string) => {
      state.llamaRuntimeModelPath = modelPath;
      persistLlamaModelPath(modelPath);
      state.modelManagerMessage = `Selected model for llama.cpp: ${modelPath}`;
      renderAndBind(sendMessage);
    },
    onModelManagerEjectActive: async () => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = "Ejecting active model and stopping llama.cpp...";
      try {
        await clientRef.stopLlamaRuntime({ correlationId: nextCorrelationId() });
      } catch {
        // Ignore stop failure and still clear local model selection.
      }
      try {
        state.llamaRuntimeModelPath = "";
        persistLlamaModelPath("");
        await refreshLlamaRuntime();
        state.modelManagerMessage = "Active model ejected and llama.cpp stopped.";
      } catch (error) {
        state.modelManagerMessage = `Eject completed, refresh failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onModelManagerDeleteInstalled: async (modelId: string) => {
      if (!clientRef) return;
      state.modelManagerBusy = true;
      state.modelManagerMessage = `Removing ${modelId}...`;
      try {
        await clientRef.modelManagerDeleteInstalled({
          correlationId: nextCorrelationId(),
          modelId
        });
        await refreshModelManagerInstalled();
        state.modelManagerMessage = `Removed ${modelId}.`;
      } catch (error) {
        state.modelManagerMessage = `Remove failed: ${String(error)}`;
      } finally {
        state.modelManagerBusy = false;
      }
      renderAndBind(sendMessage);
    },
    onToggleStt: async () => {
      if (!clientRef) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (state.stt.status === "idle" || state.stt.status === "error") {
          // First check and request microphone permission if needed
          await refreshDevicesState();
          const micPermission = state.devices.microphonePermission;
          // Sync to STT state for UI display
          state.stt.microphonePermission = micPermission;
          if (micPermission !== "enabled") {
            // Request microphone access - this will show permission prompt
            await requestMicrophoneAccess();
            // Check again after requesting
            await refreshDevicesState();
            const micPermissionAfter = state.devices.microphonePermission;
            // Sync to STT state for UI display
            state.stt.microphonePermission = micPermissionAfter;
            if (micPermissionAfter !== "enabled") {
              state.stt.status = "error";
              state.stt.message = "Microphone access denied";
              renderAndBind(sendMessage);
              return;
            }
          }
          // Start STT only after permission is confirmed
          state.stt.status = "starting";
          state.stt.message = "Starting whisper server...";
          state.stt.isListening = false;
          renderAndBind(sendMessage);
          await invoke("start_stt");
          state.stt.status = "running";
          state.stt.message = "Server started";
          await setupSttTranscriptListener(sendMessage);
          await startSttAudioCapture(invoke);
        } else if (state.stt.status === "running" || state.stt.status === "starting") {
          stopSttAudioCapture();
          await sttTranscriptionQueue.catch(() => undefined);
          await invoke("stop_stt");
          await teardownSttTranscriptListener();
          state.stt.status = "idle";
          state.stt.message = null;
          state.stt.isListening = false;
        }
        renderAndBind(sendMessage);
      } catch (error) {
        stopSttAudioCapture();
        await teardownSttTranscriptListener();
        state.stt.status = "error";
        state.stt.message = String(error);
        state.stt.isListening = false;
        renderAndBind(sendMessage);
      }
    },
    onUpdateSttVadSetting: async (key, value) => {
      let normalized = value;
      if (key === "vadBaseThreshold") normalized = clampSttSetting(value, 0, 0.2, 0.005);
      if (key === "vadStartFrames") normalized = Math.round(clampSttSetting(value, 1, 100, 2));
      if (key === "vadEndFrames") normalized = Math.round(clampSttSetting(value, 1, 200, 8));
      if (key === "vadDynamicMultiplier") normalized = clampSttSetting(value, 1, 10, 2.4);
      if (key === "vadNoiseAdaptationAlpha") normalized = clampSttSetting(value, 0, 1, 0.03);
      if (key === "vadPreSpeechMs") normalized = Math.round(clampSttSetting(value, 0, 2000, 200));
      if (key === "vadMinUtteranceMs") normalized = Math.round(clampSttSetting(value, 0, 5000, 200));
      if (key === "vadMaxUtteranceS") normalized = Math.round(clampSttSetting(value, 1, 120, 30));
      if (key === "vadForceFlushS") normalized = clampSttSetting(value, 0.25, 30, 3);
      state.stt[key] = normalized;
      renderAndBind(sendMessage);
    }
  });
}

// Global state for STT audio capture
let sttAudioContext: AudioContext | null = null;
let sttMediaStream: MediaStream | null = null;
let sttScriptProcessor: ScriptProcessorNode | null = null;
let sttSilentGainNode: GainNode | null = null;
let sttLastWasSpeaking = false;
let sttTranscriptUnlisten: (() => void) | null = null;
let sttPipelineErrorUnlisten: (() => void) | null = null;
let sttTranscriptionQueue: Promise<void> = Promise.resolve();
let sttFlushPendingUtterance: (() => void) | null = null;

function updateChatVoiceInputIcons(): void {
  const iconName = state.stt.isSpeaking ? APP_ICON.sidebar.sttSpeaking : APP_ICON.sidebar.stt;
  const iconMarkup = iconHtml(iconName, { size: 16, tone: "dark" });

  const chatMicGlyph = document.querySelector<HTMLSpanElement>("#chatMicBtn .mic-icon-glyph");
  if (chatMicGlyph) {
    chatMicGlyph.innerHTML = iconMarkup;
  }

  const chatSttBtn = document.querySelector<HTMLButtonElement>("#chatSttBtn");
  if (chatSttBtn && state.stt.status !== "idle" && state.stt.status !== "error") {
    chatSttBtn.innerHTML = iconMarkup;
  }
}

function appendFloat32(
  a: Float32Array<ArrayBufferLike>,
  b: Float32Array<ArrayBufferLike>
): Float32Array<ArrayBufferLike> {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function clampSttSetting(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function enqueueSttTranscription(
  invokeFn: typeof import("@tauri-apps/api/core").invoke,
  pcmSamples: Float32Array<ArrayBufferLike>,
  utteranceId: string
): void {
  const samples = Array.from(pcmSamples);
  pushConsoleEntry("info", "browser", "STT queue: enqueue utterance " + utteranceId.slice(0, 8) + " (" + samples.length + " samples)");
  sttTranscriptionQueue = sttTranscriptionQueue
    .then(async () => {
      pushConsoleEntry("debug", "browser", "STT queue: transcribing utterance " + utteranceId.slice(0, 8));
      await invokeFn("transcribe_chunk", {
        pcmSamples: samples,
        utteranceId
      });
      pushConsoleEntry("info", "browser", "STT queue: transcribe request sent for " + utteranceId.slice(0, 8));
    })
    .catch((error) => {
      console.error("Transcription error:", error);
      pushConsoleEntry("error", "browser", "STT queue: transcribe failed for " + utteranceId.slice(0, 8) + ": " + String(error));
    });
}

async function setupSttTranscriptListener(onTranscript: (text: string) => Promise<void>): Promise<void> {
  if (sttTranscriptUnlisten) {
    pushConsoleEntry("debug", "browser", "STT listener: transcript listener already installed");
    return;
  }
  const { listen } = await import("@tauri-apps/api/event");
  sttTranscriptUnlisten = await listen<{ text: string }>("stt://transcript", (event) => {
    const transcript = event.payload.text?.trim();
    if (!transcript) {
      pushConsoleEntry("debug", "browser", "STT event: received empty transcript payload");
      return;
    }
    pushConsoleEntry("info", "browser", "STT event: transcript received (" + transcript.length + " chars)");
    state.stt.lastTranscript = transcript;
    state.chatDraft = transcript;
    const input = document.querySelector<HTMLTextAreaElement>("#msg");
    if (input) {
      input.value = transcript;
      input.focus();
    }
    if (!state.chatStreaming) {
      void onTranscript(transcript).catch((error) => {
        pushConsoleEntry("error", "browser", "STT send failed: " + String(error));
      });
    }
  });
  pushConsoleEntry("info", "browser", "STT listener: transcript listener installed");
}

async function teardownSttTranscriptListener(): Promise<void> {
  if (!sttTranscriptUnlisten) return;
  sttTranscriptUnlisten();
  sttTranscriptUnlisten = null;
  pushConsoleEntry("info", "browser", "STT listener: transcript listener removed");
}

async function startSttAudioCapture(invokeFn: typeof import("@tauri-apps/api/core").invoke): Promise<void> {
  try {
    stopSttAudioCapture();
    sttTranscriptionQueue = Promise.resolve();
    pushConsoleEntry("info", "browser", "STT capture: requesting microphone stream");

    sttMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    const trackSettings = sttMediaStream.getAudioTracks()[0]?.getSettings?.();
    pushConsoleEntry("info", "browser", "STT capture: microphone stream granted " + (trackSettings ? JSON.stringify(trackSettings) : "(no track settings)"));

    sttAudioContext = new AudioContext({ sampleRate: 48000 });
    const source = sttAudioContext.createMediaStreamSource(sttMediaStream);
    sttScriptProcessor = sttAudioContext.createScriptProcessor(4096, 1, 1);

    if (sttAudioContext.state === "suspended") {
      await sttAudioContext.resume();
    }
    pushConsoleEntry("info", "browser", "STT capture: AudioContext state=" + sttAudioContext.state);

    sttSilentGainNode = sttAudioContext.createGain();
    sttSilentGainNode.gain.value = 0;

    const resample = (audioData: Float32Array, inputRate: number, outputRate: number): Float32Array => {
      if (inputRate === outputRate) return audioData;
      const ratio = inputRate / outputRate;
      const outputLength = Math.round(audioData.length / ratio);
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const inputIndex = i * ratio;
        const lowerIndex = Math.floor(inputIndex);
        const upperIndex = Math.min(lowerIndex + 1, audioData.length - 1);
        const fraction = inputIndex - lowerIndex;
        const lower = audioData[lowerIndex] ?? 0;
        const upper = audioData[upperIndex] ?? 0;
        output[i] = lower * (1 - fraction) + upper * fraction;
      }
      return output;
    };

    const computeEnergy = (samples: Float32Array): number => {
      if (samples.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i] ?? 0;
        sum += sample * sample;
      }
      return Math.sqrt(sum / samples.length);
    };

    const inputSampleRate = sttAudioContext.sampleRate;
    const outputSampleRate = 16000;
    const readVadThreshold = (): number =>
      clampSttSetting(state.stt.vadBaseThreshold, 0, 0.2, 0.005);
    const readVadStartFrames = (): number =>
      Math.round(clampSttSetting(state.stt.vadStartFrames, 1, 100, 2));
    const readVadEndFrames = (): number =>
      Math.round(clampSttSetting(state.stt.vadEndFrames, 1, 200, 8));
    const readVadDynamicMultiplier = (): number =>
      clampSttSetting(state.stt.vadDynamicMultiplier, 1, 10, 2.4);
    const readVadNoiseAdaptationAlpha = (): number =>
      clampSttSetting(state.stt.vadNoiseAdaptationAlpha, 0, 1, 0.03);
    const readPreSpeechSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadPreSpeechMs, 0, 2000, 200) * 16);
    const readMinUtteranceSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadMinUtteranceMs, 0, 5000, 200) * 16);
    const readMaxUtteranceSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadMaxUtteranceS, 1, 120, 30) * 16_000);
    const readForceFlushSamples = (): number =>
      Math.round(clampSttSetting(state.stt.vadForceFlushS, 0.25, 30, 3) * 16_000);

    let speechStartFrames = 0;
    let speechEndFrames = 0;
    let isSpeaking = false;
    let noiseFloor = 0.001;
    let preSpeechBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let utteranceBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let utteranceId: string | null = null;
    let audioFramesSeen = 0;
    let vadLogFrames = 0;
    let peakEnergy = 0;
    let lastVadLogMs = 0;

    sttLastWasSpeaking = false;
    state.stt.isSpeaking = false;
    updateChatVoiceInputIcons();

    const flushUtterance = () => {
      const minUtteranceSamples = readMinUtteranceSamples();
      if (!utteranceId || utteranceBuffer.length < minUtteranceSamples) {
        if (utteranceId) {
          pushConsoleEntry("debug", "browser", "STT utterance: dropped short utterance " + utteranceId.slice(0, 8) + " (" + utteranceBuffer.length + " samples)");
        }
        utteranceBuffer = new Float32Array(0);
        utteranceId = null;
        return;
      }
      const samples = utteranceBuffer;
      const currentUtteranceId = utteranceId;
      pushConsoleEntry("info", "browser", "STT utterance: flush " + currentUtteranceId.slice(0, 8) + " (" + samples.length + " samples)");
      utteranceBuffer = new Float32Array(0);
      utteranceId = null;
      enqueueSttTranscription(invokeFn, samples, currentUtteranceId);
    };

    sttFlushPendingUtterance = flushUtterance;

    window.setTimeout(() => {
      if (state.stt.isListening && audioFramesSeen === 0) {
        state.stt.status = "error";
        state.stt.message = "No audio frames from microphone (check PipeWire/portal permissions)";
        pushConsoleEntry("error", "browser", "STT capture failed: microphone stream produced zero audio frames.");
        render();
      } else if (state.stt.isListening) {
        pushConsoleEntry("info", "browser", "STT capture: audio frames flowing (" + audioFramesSeen + " frames in first 3s)");
      }
    }, 3000);

    sttScriptProcessor.onaudioprocess = (event) => {
      audioFramesSeen += 1;
      vadLogFrames += 1;
      const inputData = event.inputBuffer.getChannelData(0);
      const resampledData = resample(inputData, inputSampleRate, outputSampleRate);
      const energy = computeEnergy(resampledData);
      peakEnergy = Math.max(peakEnergy, energy);

      if (!isSpeaking) {
        const noiseAdaptationAlpha = readVadNoiseAdaptationAlpha();
        noiseFloor = noiseFloor * (1 - noiseAdaptationAlpha) + energy * noiseAdaptationAlpha;
      }
      const dynamicThreshold = Math.max(readVadThreshold(), noiseFloor * readVadDynamicMultiplier());
      const aboveThreshold = energy > dynamicThreshold;

      const now = Date.now();
      if (now - lastVadLogMs >= 1000) {
        pushConsoleEntry(
          "debug",
          "browser",
          "STT VAD: frames=" + vadLogFrames +
            " rms=" + energy.toFixed(5) +
            " peak=" + peakEnergy.toFixed(5) +
            " floor=" + noiseFloor.toFixed(5) +
            " threshold=" + dynamicThreshold.toFixed(5) +
            " speaking=" + String(isSpeaking) +
            " above=" + String(aboveThreshold)
        );
        lastVadLogMs = now;
        vadLogFrames = 0;
        peakEnergy = 0;
      }

      if (aboveThreshold) {
        speechStartFrames += 1;
        speechEndFrames = 0;
      } else {
        speechEndFrames += 1;
        speechStartFrames = 0;
      }

      if (!isSpeaking) {
        const preSpeechSamples = readPreSpeechSamples();
        preSpeechBuffer = appendFloat32(preSpeechBuffer, resampledData);
        if (preSpeechBuffer.length > preSpeechSamples) {
          preSpeechBuffer = preSpeechBuffer.slice(preSpeechBuffer.length - preSpeechSamples);
        }
      }

      if (!isSpeaking && speechStartFrames >= readVadStartFrames()) {
        isSpeaking = true;
        utteranceId = crypto.randomUUID();
        pushConsoleEntry("info", "browser", "STT VAD: speech start (utterance=" + utteranceId.slice(0, 8) + ")");
        utteranceBuffer = appendFloat32(preSpeechBuffer, resampledData);
        preSpeechBuffer = new Float32Array(0);
      } else if (isSpeaking) {
        utteranceBuffer = appendFloat32(utteranceBuffer, resampledData);
      }

      if (isSpeaking && utteranceBuffer.length >= readForceFlushSamples()) {
        pushConsoleEntry("info", "browser", "STT VAD: force flush chunk buffered=" + utteranceBuffer.length + " samples");
        flushUtterance();
        utteranceId = crypto.randomUUID();
        utteranceBuffer = new Float32Array(0);
      }

      const vadEndFrames = readVadEndFrames();
      const maxUtteranceSamples = readMaxUtteranceSamples();
      if (isSpeaking && (speechEndFrames >= vadEndFrames || utteranceBuffer.length >= maxUtteranceSamples)) {
        const endReason = speechEndFrames >= vadEndFrames ? "silence" : "max_length";
        pushConsoleEntry("info", "browser", "STT VAD: speech end reason=" + endReason + " buffered=" + utteranceBuffer.length + " samples");
        isSpeaking = false;
        flushUtterance();
      }

      if (isSpeaking !== sttLastWasSpeaking) {
        sttLastWasSpeaking = isSpeaking;
        state.stt.isSpeaking = isSpeaking;
        pushConsoleEntry("info", "browser", "STT indicator: " + (isSpeaking ? "speaking" : "silence"));
        updateChatVoiceInputIcons();
      }
    };

    source.connect(sttScriptProcessor);
    if (sttSilentGainNode) {
      sttScriptProcessor.connect(sttSilentGainNode);
      sttSilentGainNode.connect(sttAudioContext.destination);
    }

    pushConsoleEntry("info", "browser", "STT capture ready (sampleRate=" + inputSampleRate + "Hz)");
    pushConsoleEntry(
      "info",
      "browser",
      "STT VAD config: baseThreshold=" + readVadThreshold() +
        ", startFrames=" + readVadStartFrames() +
        ", endFrames=" + readVadEndFrames()
    );
    state.stt.isListening = true;
  } catch (error) {
    console.error("Failed to start audio capture:", error);
    state.stt.status = "error";
    state.stt.message = "Microphone access denied";
    pushConsoleEntry("error", "browser", "STT capture start failed: " + String(error));
  }
}

function stopSttAudioCapture(): void {
  sttFlushPendingUtterance?.();
  sttFlushPendingUtterance = null;

  if (sttScriptProcessor) {
    sttScriptProcessor.disconnect();
    sttScriptProcessor.onaudioprocess = null;
    sttScriptProcessor = null;
  }
  if (sttSilentGainNode) {
    sttSilentGainNode.disconnect();
    sttSilentGainNode = null;
  }
  if (sttAudioContext) {
    sttAudioContext.close();
    sttAudioContext = null;
  }
  if (sttMediaStream) {
    sttMediaStream.getTracks().forEach(track => track.stop());
    sttMediaStream = null;
  }
  sttLastWasSpeaking = false;
  state.stt.isListening = false;
  state.stt.isSpeaking = false;
  pushConsoleEntry("info", "browser", "STT capture: stopped and state reset");
  updateChatVoiceInputIcons();
}

function currentPrimaryPanelRenderState() {
  return {
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatStreaming: state.chatStreaming,
    chatDraft: state.chatDraft,
    devices: state.devices,
    apiConnections: state.apiConnections,
    apiFormOpen: state.apiFormOpen,
    apiDraft: state.apiDraft,
    apiEditingId: state.apiEditingId,
    apiMessage: state.apiMessage,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    llamaRuntime: state.llamaRuntime,
    llamaRuntimeSelectedEngineId: state.llamaRuntimeSelectedEngineId,
    llamaRuntimeModelPath: state.llamaRuntimeModelPath,
    llamaRuntimePort: state.llamaRuntimePort,
    llamaRuntimeCtxSize: state.llamaRuntimeCtxSize,
    llamaRuntimeGpuLayers: state.llamaRuntimeGpuLayers,
    llamaRuntimeThreads: state.llamaRuntimeThreads,
    llamaRuntimeBatchSize: state.llamaRuntimeBatchSize,
    llamaRuntimeUbatchSize: state.llamaRuntimeUbatchSize,
    llamaRuntimeTemperature: state.llamaRuntimeTemperature,
    llamaRuntimeTopP: state.llamaRuntimeTopP,
    llamaRuntimeTopK: state.llamaRuntimeTopK,
    llamaRuntimeRepeatPenalty: state.llamaRuntimeRepeatPenalty,
    llamaRuntimeFlashAttn: state.llamaRuntimeFlashAttn,
    llamaRuntimeMmap: state.llamaRuntimeMmap,
    llamaRuntimeMlock: state.llamaRuntimeMlock,
    llamaRuntimeSeed: state.llamaRuntimeSeed,
    llamaRuntimeMaxTokens: state.llamaRuntimeMaxTokens,
    llamaRuntimeBusy: state.llamaRuntimeBusy,
    llamaRuntimeLogs: state.llamaRuntimeLogs,
    modelManagerInstalled: state.modelManagerInstalled,
    modelManagerQuery: state.modelManagerQuery,
    modelManagerCollection: state.modelManagerCollection,
    modelManagerSearchResults: state.modelManagerSearchResults,
    modelManagerBusy: state.modelManagerBusy,
    modelManagerMessage: state.modelManagerMessage,
    modelManagerUnslothUdCatalog: state.modelManagerUnslothUdCatalog,
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading,
    stt: state.stt,
    consoleEntries: state.consoleEntries
  };
}

function renderChatMessagesOnly(): void {
  if (state.sidebarTab !== "chat") return;
  const messagesHost = document.querySelector<HTMLElement>(".messages");
  if (!messagesHost) return;
  const isNearBottom =
    messagesHost.scrollHeight - messagesHost.scrollTop - messagesHost.clientHeight < 36;
  messagesHost.innerHTML = renderChatMessages(currentPrimaryPanelRenderState());
  if (isNearBottom || state.chatStreaming) {
    messagesHost.scrollTop = messagesHost.scrollHeight;
  }
}

function scheduleChatStreamDomUpdate(): void {
  if (chatStreamDomUpdateScheduled) return;
  chatStreamDomUpdateScheduled = true;
  requestAnimationFrame(() => {
    chatStreamDomUpdateScheduled = false;
    renderChatMessagesOnly();
  });
}

function installThinkingToggleDelegation(sendMessage: (text: string) => Promise<void>): void {
  if (chatThinkingDelegationInstalled) return;
  chatThinkingDelegationInstalled = true;
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const toggle = target?.closest<HTMLButtonElement>("[data-thinking-toggle-corr]");
    if (!toggle) return;
    const correlationId = toggle.dataset.thinkingToggleCorr;
    if (!correlationId) return;
    const current = state.chatThinkingExpandedByCorrelation[correlationId] === true;
    state.chatThinkingExpandedByCorrelation[correlationId] = !current;
    if (state.sidebarTab === "chat") {
      renderChatMessagesOnly();
      return;
    }
    renderAndBind(sendMessage);
  });
}

function scrollConsoleToBottom(): void {
  const panel = document.querySelector<HTMLElement>(".console-panel");
  if (!panel) return;
  panel.scrollTop = panel.scrollHeight;
}

function attachTopbarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const toggle = document.querySelector<HTMLButtonElement>("#displayModeToggle");
  if (toggle) {
    toggle.onclick = () => {
      state.displayMode = state.displayMode === "dark" ? "light" : "dark";
      terminalManager.setDisplayMode(state.displayMode);
      renderAndBind(sendMessage);
    };
  }
  const layoutToggle = document.querySelector<HTMLButtonElement>("#layoutOrientationToggle");
  if (layoutToggle) {
    layoutToggle.onclick = () => {
      state.layoutOrientation =
        state.layoutOrientation === "landscape" ? "portrait" : "landscape";
      renderAndBind(sendMessage);
    };
  }

  const micEnableBtn = document.querySelector<HTMLButtonElement>("#micPermissionEnableBtn");
  if (micEnableBtn) {
    micEnableBtn.onclick = async () => {
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      await requestMicrophoneAccess();
      renderAndBind(sendMessage);
    };
  }

  const micDismissBtn = document.querySelector<HTMLButtonElement>("#micPermissionDismissBtn");
  if (micDismissBtn) {
    micDismissBtn.onclick = () => {
      state.micPermissionBubbleDismissed = true;
      persistMicBubbleDismissed(true);
      renderAndBind(sendMessage);
    };
  }
}

function attachSidebarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]");

  tabs.forEach((tab) => {
    tab.onclick = async () => {
      const nextTab = tab.dataset.sidebarTab as SidebarTab | undefined;
      if (!nextTab) return;
      state.sidebarTab = nextTab;
      if (nextTab === "llama_cpp") {
        await refreshLlamaRuntime();
      }
      if (nextTab === "apis") {
        await refreshApiConnections();
      }
      renderAndBind(sendMessage);
    };
  });
}

function attachWorkspaceInteractions(sendMessage: (text: string) => Promise<void>): void {
  const workspacePane = document.querySelector<HTMLElement>(".workspace-pane");
  const shellPopover = document.querySelector<HTMLElement>(`#${TERMINAL_UI_ID.shellPopover}`);
  if (workspacePane) {
    workspacePane.onclick = async (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        `[${WORKSPACE_DATA_ATTR.tab}], [${TERMINAL_DATA_ATTR.closeSessionId}], [${TERMINAL_DATA_ATTR.sessionId}], [${TERMINAL_DATA_ATTR.action}], #${TERMINAL_UI_ID.shellButton}, [${TERMINAL_DATA_ATTR.shellProfile}], #${MANAGER_UI_ID.refreshToolsButton}, #${MANAGER_UI_ID.exportToolsButton}, #${MANAGER_UI_ID.importToolsButton}, [${WEB_DATA_ATTR.action}], [${WEB_DATA_ATTR.tabId}]`
      );
      if (!target) return;

      const nextWorkspaceTab = target.getAttribute(WORKSPACE_DATA_ATTR.tab);
      if (nextWorkspaceTab && isWorkspaceTab(nextWorkspaceTab)) {
        const workspaceTab: WorkspaceTab = nextWorkspaceTab;
        state.workspaceTab = workspaceTab;
        if (workspaceTab === "terminal") {
          await ensureTerminalSession();
        }
        if (workspaceTab === "manager-tool") {
          await refreshTools();
        }
        if (workspaceTab === "webSearch-tool" || workspaceTab === "web-tool") {
          state.workspaceTab = "webSearch-tool";
          ensureWebTabs();
          await refreshApiConnections();
          if (!hasVerifiedSearchConnection()) {
            state.webSetupModalOpen = true;
            state.webSetupMessage = "Set up Serper Search API to enable this tool.";
          }
        }
        renderAndBind(sendMessage);
        return;
      }

      if (target.id === MANAGER_UI_ID.refreshToolsButton) {
        await refreshTools();
        renderAndBind(sendMessage);
        return;
      }

      if (target.id === MANAGER_UI_ID.exportToolsButton) {
        if (!clientRef) return;
        const exported = await clientRef.exportWorkspaceTools({
          correlationId: nextCorrelationId()
        });
        const blob = new Blob([exported.payloadJson], {
          type: "application/json;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exported.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        pushConsoleEntry("info", "browser", `Exported tool registry to ${exported.fileName}.`);
        renderAndBind(sendMessage);
        return;
      }

      if (target.id === MANAGER_UI_ID.importToolsButton) {
        const client = clientRef;
        if (!client) return;
        const input = document.createElement("input");
        const cleanup = () => {
          if (input.parentElement) {
            document.body.removeChild(input);
          }
        };
        input.type = "file";
        input.accept = "application/json,.json";
        input.style.display = "none";
        document.body.appendChild(input);
        window.setTimeout(cleanup, 60_000);
        input.onchange = () => {
          void (async () => {
            try {
              const file = input.files?.[0];
              if (!file) return;
              const payloadJson = await file.text();
              await client.importWorkspaceTools({
                correlationId: nextCorrelationId(),
                payloadJson
              });
              await refreshTools();
              pushConsoleEntry("info", "browser", `Imported tool registry from ${file.name}.`);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Unknown import failure";
              pushConsoleEntry("error", "browser", `Failed importing tool registry: ${message}`);
            } finally {
              renderAndBind(sendMessage);
              cleanup();
            }
          })();
        };
        input.click();
        return;
      }

      const webAction = target.getAttribute(WEB_DATA_ATTR.action);
      const webTabId = target.getAttribute(WEB_DATA_ATTR.tabId);
      if (webTabId && !webAction) {
        state.activeWebTabId = webTabId;
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "run") {
        await runWebSearch();
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "new-tab") {
        createAndActivateWebTab();
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "toggle-history") {
        state.webHistoryOpen = !state.webHistoryOpen;
        if (!state.webHistoryOpen) {
          state.webHistoryClearConfirmOpen = false;
        }
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "clear-history") {
        state.webHistoryClearConfirmOpen = true;
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "clear-history-cancel") {
        state.webHistoryClearConfirmOpen = false;
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "clear-history-confirm") {
        state.webHistory = [];
        state.webHistoryClearConfirmOpen = false;
        persistWebSearchHistory(state.webHistory);
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "run-history-item") {
        const historyId = target.getAttribute(WEB_DATA_ATTR.historyId);
        if (!historyId) return;
        const item = state.webHistory.find((entry) => entry.id === historyId);
        if (!item) return;
        withActiveWebTab((tab) => {
          tab.query = item.query;
          tab.mode = item.mode;
          tab.num = item.num;
        });
        await runWebSearch();
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "toggle-view-mode") {
        withActiveWebTab((tab) => {
          tab.viewMode = tab.viewMode === "markdown" ? "json" : "markdown";
        });
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "close-tab") {
        if (!webTabId) return;
        const remaining = state.webTabs.filter((tab) => tab.id !== webTabId);
        if (!remaining.length) {
          state.workspaceTab = "terminal";
          await ensureTerminalSession();
        } else {
          state.webTabs = remaining;
          if (state.activeWebTabId === webTabId) {
            state.activeWebTabId = remaining[remaining.length - 1]?.id ?? remaining[0]?.id ?? "";
          }
        }
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "setup-cancel") {
        state.webSetupModalOpen = false;
        state.webSetupMessage = null;
        state.webSetupApiKey = "";
        renderAndBind(sendMessage);
        return;
      }
      if (webAction === "setup-open-apis") {
        state.webSetupModalOpen = false;
        state.sidebarTab = "apis";
        state.apiFormOpen = true;
        state.apiDraft = {
          apiType: "search",
          apiUrl: "https://google.serper.dev",
          name: state.webSetupAccount.trim(),
          apiKey: state.webSetupApiKey,
          modelName: "",
          costPerMonthUsd: "",
          apiStandardPath: ""
        };
        renderAndBind(sendMessage);
        return;
      }

      const closeSessionId = target.getAttribute(TERMINAL_DATA_ATTR.closeSessionId);
      if (closeSessionId) {
        event.preventDefault();
        event.stopPropagation();
        state.activeTerminalSessionId = await closeTerminalSessionAndPickNext(
          terminalManager,
          closeSessionId
        );
        renderAndBind(sendMessage);
        return;
      }

      const shellProfile = target.getAttribute(TERMINAL_DATA_ATTR.shellProfile) as
        | TerminalShellProfile
        | null;
      if (shellProfile) {
        state.terminalShellProfile = shellProfile;
        if (shellPopover) shellPopover.hidden = true;
        renderAndBind(sendMessage);
        return;
      }

      if (target.id === TERMINAL_UI_ID.shellButton) {
        event.preventDefault();
        event.stopPropagation();
        if (!shellPopover) return;
        const nextHidden = !shellPopover.hidden;
        shellPopover.hidden = nextHidden;
        if (!nextHidden) return;
        const closePopover = () => {
          shellPopover.hidden = true;
        };
        document.addEventListener("click", closePopover, { once: true });
        return;
      }

      const action = target.getAttribute(TERMINAL_DATA_ATTR.action);
      if (action === "new") {
        state.activeTerminalSessionId = await createTerminalSessionForProfile(
          terminalManager,
          state.terminalShellProfile
        );
        renderAndBind(sendMessage);
        return;
      }

      const sessionId = target.getAttribute(TERMINAL_DATA_ATTR.sessionId);
      if (sessionId) {
        state.activeTerminalSessionId = sessionId;
        renderAndBind(sendMessage);
      }
    };
    workspacePane.onchange = async (event) => {
      const toggle = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
        `[${MANAGER_DATA_ATTR.toggleToolId}]`
      );
      if (toggle) {
        if (!clientRef) return;
        const toolId = toggle.getAttribute(MANAGER_DATA_ATTR.toggleToolId);
        if (!toolId) return;
        await clientRef.setWorkspaceToolEnabled({
          toolId,
          enabled: toggle.checked,
          correlationId: nextCorrelationId()
        });
        await refreshTools();
      }

      const modeSelect = document.querySelector<HTMLSelectElement>(`#${WEB_UI_ID.modeSelect}`);
      if (modeSelect) {
        withActiveWebTab((tab) => {
          tab.mode = modeSelect.value || "search";
        });
      }

      const numInput = document.querySelector<HTMLInputElement>(`#${WEB_UI_ID.numInput}`);
      if (numInput) {
        const parsed = Number.parseInt(numInput.value, 10);
        withActiveWebTab((tab) => {
          tab.num = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 10;
        });
      }

      renderAndBind(sendMessage);
    };

    workspacePane.onsubmit = async (event) => {
      const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>(
        `#${WEB_UI_ID.searchForm}`
      );
      if (form) {
        event.preventDefault();
        const queryInput = form.querySelector<HTMLInputElement>(`#${WEB_UI_ID.queryInput}`);
        withActiveWebTab((tab) => {
          tab.query = queryInput?.value ?? "";
        });
        await runWebSearch();
        renderAndBind(sendMessage);
        return;
      }

      const setupForm = (event.target as HTMLElement | null)?.closest<HTMLFormElement>(
        `#${WEB_UI_ID.setupForm}`
      );
      if (!setupForm) return;
      event.preventDefault();
      const accountInput = setupForm.querySelector<HTMLInputElement>(`#${WEB_UI_ID.setupAccountInput}`);
      const keyInput = setupForm.querySelector<HTMLInputElement>(`#${WEB_UI_ID.setupApiKeyInput}`);
      state.webSetupAccount = accountInput?.value ?? "";
      state.webSetupApiKey = keyInput?.value ?? "";
      await saveWebSearchSetup();
      renderAndBind(sendMessage);
    };

    workspacePane.oninput = (event) => {
      const queryInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
        `#${WEB_UI_ID.queryInput}`
      );
      if (queryInput) {
        withActiveWebTab((tab) => {
          tab.query = queryInput.value;
        });
      }
      const accountInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
        `#${WEB_UI_ID.setupAccountInput}`
      );
      if (accountInput) {
        state.webSetupAccount = accountInput.value;
        state.webSetupMessage = null;
      }
      const keyInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
        `#${WEB_UI_ID.setupApiKeyInput}`
      );
      if (keyInput) {
        state.webSetupApiKey = keyInput.value;
        state.webSetupMessage = null;
      }
    };

    workspacePane.onkeydown = async (event) => {
      if (event.key !== "Enter") return;
      const queryInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
        `#${WEB_UI_ID.queryInput}`
      );
      if (!queryInput) return;
      event.preventDefault();
      withActiveWebTab((tab) => {
        tab.query = queryInput.value;
      });
      await runWebSearch();
      renderAndBind(sendMessage);
    };
  }
  if (shellPopover) {
    shellPopover.onclick = (event) => {
      event.stopPropagation();
    };
  }

  if (state.workspaceTab === "terminal") {
    const host = document.querySelector<HTMLElement>("#terminalHost");
    if (host && state.activeTerminalSessionId) {
      terminalManager.mountSession(state.activeTerminalSessionId, host);
    }
  }

  const copyConsoleBtn = document.querySelector<HTMLButtonElement>("#copyConsoleBtn");
  if (copyConsoleBtn) {
    copyConsoleBtn.onclick = async () => {
      const text = buildConsoleCopyText();
      if (!text) {
        pushConsoleEntry("info", "browser", "Console is empty; nothing copied.");
        renderAndBind(sendMessage);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        pushConsoleEntry("info", "browser", `Copied ${state.consoleEntries.length} console lines.`);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) {
          pushConsoleEntry("error", "browser", "Failed to copy console output.");
        } else {
          pushConsoleEntry("info", "browser", `Copied ${state.consoleEntries.length} console lines.`);
        }
      }
      renderAndBind(sendMessage);
    };
  }

  const saveConsoleBtn = document.querySelector<HTMLButtonElement>("#saveConsoleBtn");
  if (saveConsoleBtn) {
    saveConsoleBtn.onclick = () => {
      const text = buildConsoleCopyText();
      if (!text) {
        pushConsoleEntry("info", "browser", "Console is empty; nothing to save.");
        renderAndBind(sendMessage);
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildConsoleFilename();
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushConsoleEntry("info", "browser", `Saved ${state.consoleEntries.length} console lines as .txt.`);
      renderAndBind(sendMessage);
    };
  }

}

async function ensureTerminalSession(): Promise<void> {
  state.activeTerminalSessionId = await ensureTerminalSessionForProfile(
    terminalManager,
    state.activeTerminalSessionId,
    state.terminalShellProfile
  );
}

async function bootstrap(): Promise<void> {
  installConsoleCapture();
  const { client, runtimeMode } = await createChatIpcClient();
  clientRef = client;
  state.runtimeMode = runtimeMode;
  try {
    const version = (await client.getAppVersion()).version.trim();
    if (version) {
      state.appVersion = normalizeVersionLabel(version);
    }
  } catch {
    state.appVersion = FALLBACK_APP_VERSION;
  }
  terminalManager.setClient(client);
  terminalManager.setDisplayMode(state.displayMode);

  await refreshConversations();
  await refreshTools();
  await refreshApiConnections();
  await refreshDevicesState();
  await refreshLlamaRuntime();
  await refreshModelManagerInstalled();
  if (state.modelManagerCollection === "unsloth_ud") {
    await refreshModelManagerUnslothUdCatalog();
  }
  await autoStartLlamaRuntimeIfConfigured();
  await loadConversation(state.conversationId);

  window.addEventListener("beforeunload", () => {
    void terminalManager.closeAll();
  });
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void refreshDevicesState().then(() => renderAndBind(sendMessage));
    });
  }
  if (runtimeMode === "tauri" && !sttPipelineErrorUnlisten) {
    const { listen } = await import("@tauri-apps/api/event");
    sttPipelineErrorUnlisten = await listen<{
      source?: string;
      message?: string;
      details?: string | null;
    }>("pipeline://error", (event) => {
      const source = event.payload.source?.trim() || "unknown";
      const message = event.payload.message?.trim() || "Pipeline error";
      const details = typeof event.payload.details === "string" ? event.payload.details.trim() : "";
      const detailsText = details ? ` details=${details}` : "";
      pushConsoleEntry("error", "app", `[${source}] pipeline.error ${message}${detailsText}`);
      const syntheticEvent: AppEvent = {
        timestampMs: Date.now(),
        correlationId: nextCorrelationId(),
        subsystem: "service",
        action: "pipeline.error",
        stage: "error",
        severity: "error",
        payload: {
          source,
          message,
          details: details || null
        }
      };
      state.events.push(syntheticEvent);
      if (source === "stt") {
        state.stt.status = "error";
        state.stt.message = message;
      }
      renderAndBind(sendMessage);
    });
  }

  client.onEvent((event) => {
    const agentEventLine = formatAgentEventLine(event);
    if (agentEventLine) {
      pushConsoleEntry(
        event.severity === "error" ? "error" : "info",
        "app",
        `[agent] ${agentEventLine} corr=${event.correlationId}`
      );
    } else if (
      !event.action.startsWith("llama.runtime") &&
      !isNoisyRuntimeStatusEvent(event) &&
      !isNoisyChatStreamEvent(event)
    ) {
      const payloadText =
        event.stage === "error"
          ? ` payload=${safePayloadPreview(event.payload)}`
          : "";
      pushConsoleEntry(
        event.severity === "error" ? "error" : "info",
        "app",
        `[${event.subsystem}] ${event.action} ${event.stage} corr=${event.correlationId}${payloadText}`
      );
    }

    if (event.action === "terminal.output") {
      const output = parseTerminalOutput(event.payload);
      if (output) {
        terminalManager.writeOutput(output.sessionId, output.data);
      }
      return;
    }

    if (event.action === "terminal.exit") {
      const exiting = parseTerminalExit(event.payload);
      if (exiting) {
        terminalManager.markExited(exiting.sessionId);
        renderAndBind(sendMessage);
      }
      return;
    }

    if (isNoisyTerminalControlEvent(event)) {
      return;
    }

    if (event.action.startsWith("llama.runtime")) {
      const processLine = extractRuntimeProcessLine(event);
      if (processLine) {
        updateRuntimeMetricsFromLine(processLine);
      }
      const runtimeLine = formatRuntimeEventLine(event);
      pushConsoleEntry(
        event.severity === "error" ? "error" : "info",
        "app",
        `[runtime] ${runtimeLine} corr=${event.correlationId}`
      );

      if (!isNoisyRuntimeStatusEvent(event)) {
        state.llamaRuntimeLogs.push(
          runtimeLine
        );
        if (state.llamaRuntimeLogs.length > 300) {
          state.llamaRuntimeLogs.splice(0, state.llamaRuntimeLogs.length - 300);
        }
      }
      if (
        (event.stage === "complete" || event.stage === "error") &&
        event.action !== "llama.runtime.status"
      ) {
        void refreshLlamaRuntime().then(() => renderAndBind(sendMessage));
      }
    }

    if (event.action.startsWith("model.manager.")) {
      if (event.stage === "start") {
        state.modelManagerBusy = true;
      }
      if (event.stage === "complete" || event.stage === "error") {
        state.modelManagerBusy = false;
      }
      if (event.stage === "error") {
        state.modelManagerMessage = `Model manager error: ${safePayloadPreview(event.payload)}`;
      }
    }

    state.events.push(event);

    if (event.action === "chat.stream.chunk") {
      const chunk = parseStreamChunk(event.payload);
      if (chunk && chunk.conversationId === state.conversationId) {
        updateAssistantDraft(event.correlationId, chunk.delta);
        scheduleChatStreamDomUpdate();
        return;
      }
    }
    if (event.action === "chat.stream.reasoning_chunk") {
      const chunk = parseReasoningStreamChunk(event.payload);
      if (chunk && chunk.conversationId === state.conversationId) {
        updateReasoningDraft(event.correlationId, chunk.delta);
        scheduleChatStreamDomUpdate();
        return;
      }
    }

    renderAndBind(sendMessage);
  });

  async function sendMessage(text: string): Promise<void> {
    if (!clientRef) return;

    const correlationId = nextCorrelationId();
    const normalizedUserText = normalizeChatText(text);
    state.messages.push({ role: "user", text: normalizedUserText });
    state.chatDraft = "";
    state.chatStreaming = true;
    state.activeChatCorrelationId = correlationId;
    renderAndBind(sendMessage);

    try {
      const requestPayload = {
        conversationId: state.conversationId,
        userMessage: normalizedUserText,
        correlationId,
        thinkingEnabled: state.chatThinkingEnabled
      } as const;
      const response = await clientRef.sendMessage(
        state.llamaRuntimeMaxTokens === null
          ? requestPayload
          : {
              ...requestPayload,
              maxTokens: state.llamaRuntimeMaxTokens
            }
      );

      const existing = state.messages.find(
        (m) => m.role === "assistant" && m.correlationId === response.correlationId
      );
      if (existing) {
        existing.text = normalizeChatText(response.assistantMessage);
      } else {
        state.messages.push({
          role: "assistant",
          text: normalizeChatText(response.assistantMessage),
          correlationId: response.correlationId
        });
      }
      if (response.assistantThinking?.trim()) {
        state.chatReasoningByCorrelation[response.correlationId] = normalizeChatText(
          response.assistantThinking
        );
        state.chatThinkingExpandedByCorrelation[response.correlationId] =
          state.chatThinkingExpandedByCorrelation[response.correlationId] === true;
        if (!state.chatThinkingPlacementByCorrelation[response.correlationId]) {
          state.chatThinkingPlacementByCorrelation[response.correlationId] = "after";
        }
      }

      await refreshConversations();
    } catch (error) {
      state.events.push({
        timestampMs: Date.now(),
        correlationId,
        subsystem: "frontend",
        action: "chat.send",
        stage: "error",
        severity: "error",
        payload: { message: String(error) }
      });
    } finally {
      if (state.activeChatCorrelationId === correlationId) {
        state.activeChatCorrelationId = null;
      }
      state.chatStreaming = false;
      renderAndBind(sendMessage);
    }
  }

  renderAndBind(sendMessage);
  installThinkingToggleDelegation(sendMessage);
}

function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  console.log = (...args: unknown[]) => {
    originals.log(...args);
    pushConsoleEntry("log", "browser", stringifyConsoleArgs(args));
  };
  console.info = (...args: unknown[]) => {
    originals.info(...args);
    pushConsoleEntry("info", "browser", stringifyConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originals.warn(...args);
    pushConsoleEntry("warn", "browser", stringifyConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originals.error(...args);
    pushConsoleEntry("error", "browser", stringifyConsoleArgs(args));
  };
  console.debug = (...args: unknown[]) => {
    originals.debug(...args);
    pushConsoleEntry("debug", "browser", stringifyConsoleArgs(args));
  };
}

function stringifyConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function safePayloadPreview(payload: AppEvent["payload"]): string {
  try {
    if (payload === null) return "null";
    if (typeof payload === "object") return JSON.stringify(payload);
    return String(payload);
  } catch {
    return "<unserializable>";
  }
}

bootstrap().catch((error) => {
  state.events.push({
    timestampMs: Date.now(),
    correlationId: "bootstrap",
    subsystem: "frontend",
    action: "app.bootstrap",
    stage: "error",
    severity: "error",
    payload: { message: String(error) }
  });
  render();
  attachDividerResize();
});

function attachDividerResize(): void {
  const root = document.querySelector<HTMLElement>(".app-frame");
  if (!root) return;

  if (state.layoutOrientation === "portrait") {
    const portraitLayout = document.querySelector<HTMLElement>("#portraitLayout");
    const portraitDivider = document.querySelector<HTMLDivElement>("#portraitPaneDivider");
    if (!portraitLayout || !portraitDivider) return;

    portraitDivider.onpointerdown = (event) => {
      event.preventDefault();
      portraitDivider.classList.add("dragging");
      portraitDivider.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const bounds = portraitLayout.getBoundingClientRect();
        const rawPercent = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
        const clamped = Math.max(26, Math.min(74, rawPercent));
        state.portraitWorkspacePercent = Number(clamped.toFixed(2));
        root.style.setProperty("--portrait-workspace-percent", String(state.portraitWorkspacePercent));
      };

      const onUp = (upEvent: PointerEvent) => {
        portraitDivider.classList.remove("dragging");
        portraitDivider.releasePointerCapture(upEvent.pointerId);
        portraitDivider.removeEventListener("pointermove", onMove);
        portraitDivider.removeEventListener("pointerup", onUp);
        portraitDivider.removeEventListener("pointercancel", onUp);
      };

      portraitDivider.addEventListener("pointermove", onMove);
      portraitDivider.addEventListener("pointerup", onUp);
      portraitDivider.addEventListener("pointercancel", onUp);
    };
    return;
  }

  const split = document.querySelector<HTMLDivElement>("#splitLayout");
  const divider = document.querySelector<HTMLDivElement>("#paneDivider");
  if (!split || !divider) return;

  divider.onpointerdown = (event) => {
    event.preventDefault();
    divider.classList.add("dragging");
    divider.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const bounds = split.getBoundingClientRect();
      const rawPercent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const clamped = Math.max(22, Math.min(78, rawPercent));
      state.chatPanePercent = Number(clamped.toFixed(2));
      root.style.setProperty("--chat-pane-percent", String(state.chatPanePercent));
    };

    const onUp = (upEvent: PointerEvent) => {
      divider.classList.remove("dragging");
      divider.releasePointerCapture(upEvent.pointerId);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
    };

    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
  };
}
