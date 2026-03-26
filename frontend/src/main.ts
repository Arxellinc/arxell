import "./styles.css";
import "xterm/css/xterm.css";
import type {
  AppEvent,
  ChatStreamChunkPayload,
  ChatStreamReasoningChunkPayload,
  ConversationSummaryRecord,
  LlamaRuntimeStatusResponse,
  ModelManagerHfCandidate,
  ModelManagerInstalledModel,
  SttStatusResponse,
  TtsEngineStatusResponse,
  WorkspaceToolRecord
} from "./contracts";
import { iconHtml } from "./icons";
import type { IconName } from "./icons";
import type { ChatIpcClient } from "./ipcClient";
import { createChatIpcClient } from "./ipcClient";
import {
  attachWorkspacePaneInteractions,
  renderGlobalBottombar,
  renderGlobalTopbar,
  renderSidebarRail,
  renderWorkspacePane
} from "./layout";
import { attachPrimaryPanelInteractions, getPanelDefinition } from "./panels";
import type { DevicesState, SidebarTab, UiMessage } from "./panels/types";
import type { DisplayMode, LayoutOrientation, WorkspaceTab } from "./layout";
import { escapeHtml } from "./panels/utils";
import { TerminalManager } from "./terminal/manager";
import { renderTerminalWorkspace } from "./terminal/view";
import {
  bindWorkspaceToolsPanel,
  renderWorkspaceToolsActions,
  renderWorkspaceToolsBody
} from "./workspace-tools/panel";
import { renderChatMessages } from "./panels/chatPanel";
import { APP_BUILD_VERSION, normalizeVersionLabel } from "./version";

// Local sleep function (previously imported from ipcClient)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const terminalManager = new TerminalManager();
const MAX_CONSOLE_ENTRIES = 600;
const LLAMA_MODEL_PATH_STORAGE_KEY = "arxell.llama.modelPath";
const LLAMA_MAX_TOKENS_STORAGE_KEY = "arxell.llama.maxTokens";
const TTS_ENABLED_STORAGE_KEY = "arxell.tts.enabled";
const TTS_VOICE_STORAGE_KEY = "arxell.tts.voice";
const TTS_LANGUAGE_STORAGE_KEY = "arxell.tts.language";
const TTS_SPEED_STORAGE_KEY = "arxell.tts.speed";
const TTS_CHUNK_MAX_CHARS_STORAGE_KEY = "arxell.tts.chunkMaxChars";
const TTS_CHUNK_PAUSE_MS_STORAGE_KEY = "arxell.tts.chunkPauseMs";
const STT_AUTO_SUBMIT_STORAGE_KEY = "arxell.stt.autoSubmit";
const STT_VAD_THRESHOLD_STORAGE_KEY = "arxell.stt.vadThreshold";
const STT_MIN_SILENCE_MS_STORAGE_KEY = "arxell.stt.minSilenceMs";
const VOICE_MODE_ENABLED_STORAGE_KEY = "arxell.voiceMode.enabled";
const MIC_PERMISSION_BUBBLE_DISMISSED_KEY = "arxell.micPermissionBubbleDismissed";
const CHAT_ID_ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let chatStreamDomUpdateScheduled = false;
let chatThinkingDelegationInstalled = false;
const FALLBACK_APP_VERSION = normalizeVersionLabel(APP_BUILD_VERSION);

// Render batching to reduce flickering
let renderBatchPending = false;
let renderBatchScheduledFrame: number | null = null;
let sendMessageRef: ((text: string) => Promise<void>) | null = null;
const RENDER_BATCH_THRESHOLD_MS = 16; // ~60fps

// Track last rendered state to avoid unnecessary re-renders
let lastRenderedStateSnapshot = "";
function getStateSnapshot(): string {
  // Create a lightweight snapshot of key state that affects rendering
  return JSON.stringify({
    sidebarTab: state.sidebarTab,
    workspaceTab: state.workspaceTab,
    layoutOrientation: state.layoutOrientation,
    displayMode: state.displayMode,
    conversationId: state.conversationId,
    messagesCount: state.messages.length,
    chatStreaming: state.chatStreaming,
    activeChatCorrelationId: state.activeChatCorrelationId,
    llamaRuntimeState: state.llamaRuntime?.state,
    ttsEnabled: state.ttsEnabled,
    sttRunning: state.sttRunning,
    devices: state.devices,
    voiceModeEnabled: state.voiceModeEnabled,
    chatThinkingEnabled: state.chatThinkingEnabled,
    consoleEntriesCount: state.consoleEntries.length,
    conversationsCount: state.conversations.length
  });
}

function scheduleBatchedRender(): void {
  if (!sendMessageRef) return;
  
  // Skip render if state hasn't changed since last render
  const currentSnapshot = getStateSnapshot();
  if (currentSnapshot === lastRenderedStateSnapshot && !renderBatchPending) {
    return;
  }
  
  if (renderBatchPending) return;
  renderBatchPending = true;
  
  if (renderBatchScheduledFrame !== null) {
    cancelAnimationFrame(renderBatchScheduledFrame);
  }
  
  renderBatchScheduledFrame = requestAnimationFrame(() => {
    renderBatchScheduledFrame = null;
    renderBatchPending = false;
    if (sendMessageRef) {
      renderAndBind(sendMessageRef);
      lastRenderedStateSnapshot = getStateSnapshot();
    }
  });
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

function loadPersistedTtsEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(TTS_ENABLED_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    return true;
  }
}

function persistTtsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(TTS_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedTtsVoice(): string {
  try {
    const raw = window.localStorage.getItem(TTS_VOICE_STORAGE_KEY);
    return raw?.trim() || "af_heart";
  } catch {
    return "af_heart";
  }
}

function persistTtsVoice(voice: string): void {
  try {
    const normalized = voice.trim() || "af_heart";
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, normalized);
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedTtsLanguage(): string {
  try {
    const raw = window.localStorage.getItem(TTS_LANGUAGE_STORAGE_KEY);
    return raw?.trim() || "en-us";
  } catch {
    return "en-us";
  }
}

function persistTtsLanguage(language: string): void {
  try {
    const normalized = language.trim() || "en-us";
    window.localStorage.setItem(TTS_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedTtsSpeed(): number {
  try {
    const raw = window.localStorage.getItem(TTS_SPEED_STORAGE_KEY);
    const parsed = Number.parseFloat(raw ?? "");
    if (!Number.isFinite(parsed)) return 1.0;
    return Math.max(0.7, Math.min(1.4, parsed));
  } catch {
    return 1.0;
  }
}

function persistTtsSpeed(speed: number): void {
  try {
    const clamped = Math.max(0.7, Math.min(1.4, speed));
    window.localStorage.setItem(TTS_SPEED_STORAGE_KEY, clamped.toFixed(2));
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedTtsChunkMaxChars(): number {
  try {
    const raw = window.localStorage.getItem(TTS_CHUNK_MAX_CHARS_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(parsed)) return 320;
    return Math.max(80, Math.min(2000, parsed));
  } catch {
    return 320;
  }
}

function persistTtsChunkMaxChars(maxChars: number): void {
  try {
    const clamped = Math.max(80, Math.min(2000, Math.trunc(maxChars)));
    window.localStorage.setItem(TTS_CHUNK_MAX_CHARS_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedTtsChunkPauseMs(): number {
  try {
    const raw = window.localStorage.getItem(TTS_CHUNK_PAUSE_MS_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(parsed)) return 90;
    return Math.max(0, Math.min(2000, parsed));
  } catch {
    return 90;
  }
}

function persistTtsChunkPauseMs(pauseMs: number): void {
  try {
    const clamped = Math.max(0, Math.min(2000, Math.trunc(pauseMs)));
    window.localStorage.setItem(TTS_CHUNK_PAUSE_MS_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedSttAutoSubmit(): boolean {
  try {
    const raw = window.localStorage.getItem(STT_AUTO_SUBMIT_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    return true;
  }
}

function persistSttAutoSubmit(enabled: boolean): void {
  try {
    window.localStorage.setItem(STT_AUTO_SUBMIT_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedSttVadThreshold(): number {
  try {
    const raw = window.localStorage.getItem(STT_VAD_THRESHOLD_STORAGE_KEY);
    const parsed = Number.parseFloat(raw ?? "");
    if (!Number.isFinite(parsed)) return 0.35;
    return Math.max(0.05, Math.min(0.95, parsed));
  } catch {
    return 0.35;
  }
}

function persistSttVadThreshold(value: number): void {
  try {
    const clamped = Math.max(0.05, Math.min(0.95, value));
    window.localStorage.setItem(STT_VAD_THRESHOLD_STORAGE_KEY, clamped.toFixed(3));
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedSttMinSilenceMs(): number {
  try {
    const raw = window.localStorage.getItem(STT_MIN_SILENCE_MS_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(parsed)) return 900;
    return Math.max(250, Math.min(5000, parsed));
  } catch {
    return 900;
  }
}

function persistSttMinSilenceMs(value: number): void {
  try {
    const clamped = Math.max(250, Math.min(5000, Math.trunc(value)));
    window.localStorage.setItem(STT_MIN_SILENCE_MS_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore local storage failures.
  }
}

function loadPersistedVoiceModeEnabled(): boolean {
  try {
    return window.localStorage.getItem(VOICE_MODE_ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistVoiceModeEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(VOICE_MODE_ENABLED_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(VOICE_MODE_ENABLED_STORAGE_KEY);
    }
  } catch {
    // Ignore local storage failures.
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

const state: {
  conversationId: string;
  messages: UiMessage[];
  chatReasoningByCorrelation: Record<string, string>;
  chatThinkingPlacementByCorrelation: Record<string, "before" | "after">;
  chatThinkingExpandedByCorrelation: Record<string, boolean>;
  chatFirstAssistantChunkMsByCorrelation: Record<string, number>;
  chatFirstReasoningChunkMsByCorrelation: Record<string, number>;
  chatStreaming: boolean;
  activeChatCorrelationId: string | null;
  devices: DevicesState;
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
  conversations: ConversationSummaryRecord[];
  workspaceTools: WorkspaceToolRecord[];
  displayMode: DisplayMode;
  appVersion: string;
  chatThinkingEnabled: boolean;
  voiceModeEnabled: boolean;
  voiceModeBusy: boolean;
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
  ttsEnabled: boolean;
  ttsBusy: boolean;
  ttsLastError: string | null;
  ttsEngineStatus: TtsEngineStatusResponse | null;
  ttsVoices: string[];
  ttsSelectedVoice: string;
  ttsLanguage: string;
  ttsSpeed: number;
  ttsChunkMaxChars: number;
  ttsChunkPauseMs: number;
  sttReady: boolean;
  sttRunning: boolean;
  sttState: string;
  sttEngine: string;
  sttModelPath: string;
  sttLastTranscript: string;
  sttLastError: string | null;
  sttAutoSubmit: boolean;
  sttVadThreshold: number;
  sttMinSilenceMs: number;
  sttModels: Array<{
    id: string;
    name: string;
    path: string;
    sizeMb: number;
    isActive: boolean;
    isBundled: boolean;
  }>;
  sttSelectedModelPath: string;
  sttDownloadBusy: boolean;
  sttDownloadMessage: string | null;
  sttConsoleLines: string[];
} = {
  conversationId: generateChatConversationId(),
  messages: [],
  chatReasoningByCorrelation: {},
  chatThinkingPlacementByCorrelation: {},
  chatThinkingExpandedByCorrelation: {},
  chatFirstAssistantChunkMsByCorrelation: {},
  chatFirstReasoningChunkMsByCorrelation: {},
  chatStreaming: false,
  activeChatCorrelationId: null,
  devices: defaultDevicesState(),
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
  conversations: [],
  workspaceTools: [],
  displayMode: "dark",
  appVersion: FALLBACK_APP_VERSION,
  chatThinkingEnabled: false,
  voiceModeEnabled: loadPersistedVoiceModeEnabled(),
  voiceModeBusy: false,
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
  ttsEnabled: loadPersistedTtsEnabled(),
  ttsBusy: false,
  ttsLastError: null,
  ttsEngineStatus: null,
  ttsVoices: ["af_heart"],
  ttsSelectedVoice: loadPersistedTtsVoice(),
  ttsLanguage: loadPersistedTtsLanguage(),
  ttsSpeed: loadPersistedTtsSpeed(),
  ttsChunkMaxChars: loadPersistedTtsChunkMaxChars(),
  ttsChunkPauseMs: loadPersistedTtsChunkPauseMs(),
  sttReady: false,
  sttRunning: false,
  sttState: "idle",
  sttEngine: "whisper.cpp",
  sttModelPath: "",
  sttLastTranscript: "",
  sttLastError: null,
  sttAutoSubmit: loadPersistedSttAutoSubmit(),
  sttVadThreshold: loadPersistedSttVadThreshold(),
  sttMinSilenceMs: loadPersistedSttMinSilenceMs(),
  sttModels: [],
  sttSelectedModelPath: "",
  sttDownloadBusy: false,
  sttDownloadMessage: null,
  sttConsoleLines: []
};

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
  next.microphonePermission =
    state.runtimeMode === "tauri" ? "not_enabled" : await detectMicrophonePermission();
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

let activeTtsAudio: HTMLAudioElement | null = null;
let ttsPlaybackGeneration = 0;

function stopActiveTtsPlayback(): void {
  ttsPlaybackGeneration += 1;
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.currentTime = 0;
    } catch {
      // ignore
    }
    activeTtsAudio = null;
  }
  state.ttsBusy = false;
}

function normalizeTtsText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTextForTts(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let buffer = "";
  const segments = normalized.split(/(?<=[.!?])\s+/);

  for (const segment of segments) {
    const candidate = buffer ? `${buffer} ${segment}` : segment;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      chunks.push(buffer.trim());
      buffer = "";
    }

    if (segment.length <= maxChars) {
      buffer = segment;
      continue;
    }

    const words = segment.split(/\s+/);
    let hard = "";
    for (const word of words) {
      const next = hard ? `${hard} ${word}` : word;
      if (next.length <= maxChars) {
        hard = next;
      } else {
        if (hard) {
          chunks.push(hard.trim());
        }
        hard = word;
      }
    }
    if (hard) {
      buffer = hard;
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.filter(Boolean);
}

async function playTtsAudioBytes(audioBytes: number[], generation: number): Promise<void> {
  if (!audioBytes.length) return;
  if (generation !== ttsPlaybackGeneration) return;
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.currentTime = 0;
    } catch {
      // ignore
    }
    activeTtsAudio = null;
  }

  const blob = new Blob([new Uint8Array(audioBytes)], { type: "audio/wav" });
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  audio.preload = "auto";
  activeTtsAudio = audio;

  const withSink = audio as HTMLAudioElement & {
    setSinkId?: (sinkId: string) => Promise<void>;
  };
  if (typeof withSink.setSinkId === "function") {
    try {
      await withSink.setSinkId("default");
    } catch {
      // Fall back to browser-selected default device.
    }
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(objectUrl);
      if (activeTtsAudio === audio) {
        activeTtsAudio = null;
      }
      resolve();
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.onpause = cleanup;
    void audio.play().catch(() => {
      cleanup();
    });
  });
}

async function refreshTtsEngineStatus(): Promise<void> {
  if (!clientRef) {
    state.ttsLastError = "TTS IPC client is not ready yet.";
    return;
  }
  state.ttsBusy = true;
  state.ttsLastError = "Checking engine status...";
  try {
    const status = await clientRef.ttsCheckEngine({ correlationId: nextCorrelationId() });
    state.ttsEngineStatus = status;
    if (status.ready) {
      state.ttsLastError = null;
      pushConsoleEntry("info", "app", "TTS check: Kokoro engine is ready.");
    } else if (status.reason) {
      state.ttsLastError = status.reason;
      pushConsoleEntry("warn", "app", `TTS check: ${status.reason}`);
    }
  } catch (error) {
    state.ttsEngineStatus = null;
    state.ttsLastError = String(error);
    pushConsoleEntry("error", "app", `TTS check failed: ${String(error)}`);
  } finally {
    state.ttsBusy = false;
  }
}

async function refreshTtsVoices(): Promise<void> {
  if (!clientRef) return;
  try {
    const response = await clientRef.ttsListVoices({ correlationId: nextCorrelationId() });
    const voices = response.voices.length ? response.voices : ["af_heart"];
    state.ttsVoices = voices;
    if (!voices.includes(state.ttsSelectedVoice)) {
      state.ttsSelectedVoice = voices[0] ?? "af_heart";
      persistTtsVoice(state.ttsSelectedVoice);
    }
  } catch (error) {
    state.ttsLastError = String(error);
    state.ttsVoices = ["af_heart"];
  }
}

function applySttStatus(status: SttStatusResponse): void {
  state.sttEngine = status.engine || "whisper.cpp";
  state.sttReady = status.ready;
  state.sttRunning = status.running;
  state.sttState = status.state || (status.running ? "listening" : "idle");
  state.sttModelPath = status.modelPath || "";
  state.sttSelectedModelPath = status.modelPath || state.sttSelectedModelPath;
  state.sttLastTranscript = status.lastTranscript?.trim() || state.sttLastTranscript;
  state.sttLastError = status.reason?.trim() || null;
  state.sttAutoSubmit = status.autoSubmit;
  state.sttVadThreshold = Math.max(0.05, Math.min(0.95, status.vadThreshold));
  state.sttMinSilenceMs = Math.max(250, Math.min(5000, Math.trunc(status.minSilenceMs)));
}

async function refreshSttStatus(): Promise<void> {
  if (!clientRef) return;
  try {
    const status = await clientRef.sttStatus({ correlationId: nextCorrelationId() });
    applySttStatus(status);
  } catch (error) {
    state.sttReady = false;
    state.sttLastError = String(error);
    pushConsoleEntry("warn", "app", `STT status check failed: ${String(error)}`);
  }
}

async function refreshSttModels(): Promise<void> {
  if (!clientRef) return;
  try {
    const response = await clientRef.sttListModels({ correlationId: nextCorrelationId() });
    state.sttModels = response.models;
    const active = response.models.find((m) => m.isActive);
    if (active) {
      state.sttSelectedModelPath = active.path;
    } else if (!response.models.some((m) => m.path === state.sttSelectedModelPath)) {
      state.sttSelectedModelPath = response.models[0]?.path ?? state.sttModelPath;
    }
  } catch (error) {
    state.sttDownloadMessage = `Model list failed: ${String(error)}`;
  }
}

async function enableVoiceMode(): Promise<void> {
  if (!clientRef) return;
  state.voiceModeBusy = true;
  try {
    if (!state.ttsEnabled) {
      state.ttsEnabled = true;
      persistTtsEnabled(true);
    }
    // Lower-latency defaults while voice mode is active.
    if (state.ttsChunkMaxChars > 260) {
      state.ttsChunkMaxChars = 220;
      persistTtsChunkMaxChars(state.ttsChunkMaxChars);
    }
    if (state.ttsChunkPauseMs > 60) {
      state.ttsChunkPauseMs = 40;
      persistTtsChunkPauseMs(state.ttsChunkPauseMs);
    }

    await refreshTtsEngineStatus();
    await refreshTtsVoices();
    if (!state.ttsEngineStatus?.ready) {
      throw new Error(state.ttsEngineStatus?.reason || "TTS engine is not ready");
    }

    if (state.devices.microphonePermission !== "enabled") {
      await requestMicrophoneAccess();
    }

    if (!state.sttRunning) {
      const response = await clientRef.sttStart({
        correlationId: nextCorrelationId(),
        autoSubmit: state.sttAutoSubmit,
        vadThreshold: state.sttVadThreshold,
        minSilenceMs: state.sttMinSilenceMs
      });
      state.sttRunning = response.started || response.state === "listening";
      state.sttState = response.state;
      if (!state.sttRunning) {
        throw new Error("STT did not enter listening state");
      }
    }
    await refreshSttStatus();
    await refreshSttModels();
    state.voiceModeEnabled = true;
    persistVoiceModeEnabled(true);
  } catch (error) {
    state.voiceModeEnabled = false;
    persistVoiceModeEnabled(false);
    pushConsoleEntry("error", "browser", `Voice mode activation failed: ${String(error)}`);
  } finally {
    state.voiceModeBusy = false;
  }
}

async function disableVoiceMode(): Promise<void> {
  if (!clientRef) return;
  state.voiceModeBusy = true;
  try {
    stopActiveTtsPlayback();
    if (state.sttRunning) {
      await clientRef.sttStop({ correlationId: nextCorrelationId() });
      state.sttRunning = false;
      state.sttState = "idle";
    }
    state.ttsEnabled = false;
    persistTtsEnabled(false);
    await refreshSttStatus();
    state.voiceModeEnabled = false;
    persistVoiceModeEnabled(false);
  } catch (error) {
    pushConsoleEntry("error", "browser", `Voice mode deactivation failed: ${String(error)}`);
  } finally {
    state.voiceModeBusy = false;
  }
}

async function speakAssistantText(text: string): Promise<void> {
  if (!clientRef || !state.ttsEnabled) return;
  const normalized = normalizeTtsText(text);
  if (!normalized) return;

  const generation = ++ttsPlaybackGeneration;
  state.ttsBusy = true;
  try {
    const chunks = splitTextForTts(normalized, state.ttsChunkMaxChars);
    for (let i = 0; i < chunks.length; i += 1) {
      if (generation !== ttsPlaybackGeneration || !state.ttsEnabled) {
        break;
      }
      const chunk = chunks[i] ?? "";
      const response = await clientRef.ttsSpeak({
        correlationId: nextCorrelationId(),
        text: chunk,
        voice: state.ttsSelectedVoice,
        language: state.ttsLanguage,
        speed: state.ttsSpeed
      });
      if (!response.audioBytes.length) {
        throw new Error("TTS returned no audio");
      }
      if (generation !== ttsPlaybackGeneration || !state.ttsEnabled) {
        break;
      }
      await playTtsAudioBytes(response.audioBytes, generation);
      if (i < chunks.length - 1 && state.ttsChunkPauseMs > 0) {
        if (generation !== ttsPlaybackGeneration || !state.ttsEnabled) {
          break;
        }
        await sleep(state.ttsChunkPauseMs);
      }
    }
    state.ttsLastError = null;
  } catch (error) {
    state.ttsLastError = String(error);
    pushConsoleEntry("warn", "app", `TTS playback failed: ${String(error)}`);
  } finally {
    state.ttsBusy = false;
  }
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
  const ttsReady = Boolean(
    state.ttsEnabled &&
      state.ttsEngineStatus?.ready &&
      state.ttsVoices.length > 0
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
  const toolsUiHtml = renderWorkspaceToolsBody(state.workspaceTools);
  const toolsActionsHtml = renderWorkspaceToolsActions();

  const panel = getPanelDefinition(state.sidebarTab, {
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatStreaming: state.chatStreaming,
    devices: state.devices,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    voiceModeEnabled: state.voiceModeEnabled,
    voiceModeBusy: state.voiceModeBusy,
    ttsEnabled: state.ttsEnabled,
    ttsBusy: state.ttsBusy,
    ttsLastError: state.ttsLastError,
    ttsEngineStatus: state.ttsEngineStatus,
    ttsVoices: state.ttsVoices,
    ttsSelectedVoice: state.ttsSelectedVoice,
    ttsLanguage: state.ttsLanguage,
    ttsSpeed: state.ttsSpeed,
    ttsChunkMaxChars: state.ttsChunkMaxChars,
    ttsChunkPauseMs: state.ttsChunkPauseMs,
    sttReady: state.sttReady,
    sttRunning: state.sttRunning,
    sttState: state.sttState,
    sttEngine: state.sttEngine,
    sttModelPath: state.sttModelPath,
    sttLastTranscript: state.sttLastTranscript,
    sttLastError: state.sttLastError,
    sttAutoSubmit: state.sttAutoSubmit,
    sttVadThreshold: state.sttVadThreshold,
    sttMinSilenceMs: state.sttMinSilenceMs,
    sttModels: state.sttModels,
    sttSelectedModelPath: state.sttSelectedModelPath,
    sttDownloadBusy: state.sttDownloadBusy,
    sttDownloadMessage: state.sttDownloadMessage,
    sttConsoleLines: state.sttConsoleLines,
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
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading
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
    toolsUiHtml,
    toolsActionsHtml,
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
            ${renderSidebarRail(state.sidebarTab, llamaRuntimeOnline, ttsReady)}
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
          ${renderSidebarRail(state.sidebarTab, llamaRuntimeOnline, ttsReady)}
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

function parseSttTranscriptFinal(
  payload: AppEvent["payload"]
): { text: string; autoSubmit: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.text !== "string") return null;
  return {
    text: value.text,
    autoSubmit: value.autoSubmit !== false
  };
}

function parseSttTranscriptPartial(payload: AppEvent["payload"]): { text: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.text !== "string") return null;
  return { text: value.text };
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

function isNoisySttEvent(event: AppEvent): boolean {
  if (!event.action.startsWith("stt.")) return false;
  return event.action === "stt.vad.progress" || event.action === "stt.capture.progress";
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
  // Preserve chat scroll position across full DOM renders
  const messagesHost = document.querySelector<HTMLElement>(".messages");
  const wasInChatTab = state.sidebarTab === "chat";
  let savedScrollTop = 0;
  let savedScrollHeight = 0;
  let isNearBottom = false;
  
  if (wasInChatTab && messagesHost) {
    savedScrollTop = messagesHost.scrollTop;
    savedScrollHeight = messagesHost.scrollHeight;
    isNearBottom = savedScrollHeight - savedScrollTop - messagesHost.clientHeight < 36;
  }
  
  try {
    render();
  } catch (error) {
    pushConsoleEntry("error", "browser", `Render failed: ${String(error)}`);
    throw error;
  }
  
  // Restore chat scroll position after DOM replacement
  if (wasInChatTab && messagesHost) {
    const newMessagesHost = document.querySelector<HTMLElement>(".messages");
    if (newMessagesHost) {
      if (isNearBottom || state.chatStreaming) {
        // Auto-stick to bottom when near bottom or streaming
        newMessagesHost.scrollTop = newMessagesHost.scrollHeight;
      } else if (savedScrollHeight > 0) {
        // Preserve manual scroll position
        newMessagesHost.scrollTop = savedScrollTop;
      }
    }
  }
  
  scrollConsoleToBottom();
  attachDividerResize();
  attachTopbarInteractions(sendMessage);
  attachSidebarInteractions(sendMessage);
  attachWorkspaceInteractions(sendMessage);
  attachPrimaryPanelInteractions(state.sidebarTab, state, {
    onSendMessage: sendMessage,
    onStopCurrentResponse: async () => {
      stopActiveTtsPlayback();
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
      scheduleBatchedRender();
    },
    onCreateConversation: async () => {
      const id = generateChatConversationId();
      state.conversationId = id;
      resetCurrentConversationUiState();
      state.sidebarTab = "chat";
      await refreshConversations();
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    },
    onToggleChatThinking: async () => {
      state.chatThinkingEnabled = !state.chatThinkingEnabled;
      pushConsoleEntry(
        "info",
        "browser",
        `Thinking mode ${state.chatThinkingEnabled ? "enabled" : "disabled"}`
      );
      scheduleBatchedRender();
    },
    onToggleVoiceMode: async () => {
      if (state.voiceModeBusy) return;
      if (state.voiceModeEnabled) {
        await disableVoiceMode();
      } else {
        await enableVoiceMode();
      }
      scheduleBatchedRender();
    },
    onDevicesRefresh: async () => {
      await refreshDevicesState();
      scheduleBatchedRender();
    },
    onRequestMicrophoneAccess: async () => {
      await requestMicrophoneAccess();
      scheduleBatchedRender();
    },
    onRequestSpeakerAccess: async () => {
      await requestSpeakerAccess();
      scheduleBatchedRender();
    },
    onToggleTtsEnabled: async () => {
      state.ttsEnabled = !state.ttsEnabled;
      persistTtsEnabled(state.ttsEnabled);
      if (!state.ttsEnabled) {
        stopActiveTtsPlayback();
      }
      if (!state.ttsEnabled && state.voiceModeEnabled) {
        state.voiceModeEnabled = false;
        persistVoiceModeEnabled(false);
      }
      scheduleBatchedRender();
    },
    onTtsCheckEngine: async () => {
      await refreshTtsEngineStatus();
      scheduleBatchedRender();
    },
    onTtsTestSpeak: async () => {
      await speakAssistantText("This is a Kokoro TTS system test.");
      scheduleBatchedRender();
    },
    onTtsSetVoice: async (voice: string) => {
      state.ttsSelectedVoice = (voice || "af_heart").trim() || "af_heart";
      persistTtsVoice(state.ttsSelectedVoice);
      scheduleBatchedRender();
    },
    onTtsSetLanguage: async (language: string) => {
      state.ttsLanguage = (language || "en-us").trim() || "en-us";
      persistTtsLanguage(state.ttsLanguage);
      scheduleBatchedRender();
    },
    onTtsSetSpeed: async (speed: number) => {
      state.ttsSpeed = Math.max(0.7, Math.min(1.4, speed));
      persistTtsSpeed(state.ttsSpeed);
      scheduleBatchedRender();
    },
    onTtsSetChunking: async ({ maxChars, pauseMs }: { maxChars: number; pauseMs: number }) => {
      state.ttsChunkMaxChars = Math.max(80, Math.min(2000, Math.trunc(maxChars)));
      state.ttsChunkPauseMs = Math.max(0, Math.min(2000, Math.trunc(pauseMs)));
      persistTtsChunkMaxChars(state.ttsChunkMaxChars);
      persistTtsChunkPauseMs(state.ttsChunkPauseMs);
      scheduleBatchedRender();
    },
    onSttRefresh: async () => {
      await refreshSttStatus();
      await refreshSttModels();
      scheduleBatchedRender();
    },
    onSttToggle: async () => {
      if (!clientRef) return;
      try {
        if (state.sttRunning) {
          await clientRef.sttStop({ correlationId: nextCorrelationId() });
          state.sttRunning = false;
          state.sttState = "idle";
          if (state.voiceModeEnabled) {
            state.voiceModeEnabled = false;
            persistVoiceModeEnabled(false);
          }
        } else {
          if (state.devices.microphonePermission !== "enabled") {
            await requestMicrophoneAccess();
          }
          const response = await clientRef.sttStart({
            correlationId: nextCorrelationId(),
            autoSubmit: state.sttAutoSubmit,
            vadThreshold: state.sttVadThreshold,
            minSilenceMs: state.sttMinSilenceMs
          });
          state.sttRunning = response.started || response.state === "listening";
          state.sttState = response.state;
          if (state.sttRunning && state.ttsEnabled) {
            state.voiceModeEnabled = true;
            persistVoiceModeEnabled(true);
          }
        }
        await refreshSttStatus();
        await refreshSttModels();
      } catch (error) {
        state.sttLastError = String(error);
        pushConsoleEntry("error", "browser", `STT toggle failed: ${String(error)}`);
      }
      scheduleBatchedRender();
    },
    onSttSetAutoSubmit: async (enabled: boolean) => {
      state.sttAutoSubmit = enabled;
      persistSttAutoSubmit(enabled);
      if (state.sttRunning && clientRef) {
        await clientRef.sttStop({ correlationId: nextCorrelationId() });
        await clientRef.sttStart({
          correlationId: nextCorrelationId(),
          autoSubmit: state.sttAutoSubmit,
          vadThreshold: state.sttVadThreshold,
          minSilenceMs: state.sttMinSilenceMs
        });
      }
      await refreshSttStatus();
      await refreshSttModels();
      scheduleBatchedRender();
    },
    onSttSetVad: async ({ threshold, minSilenceMs }: { threshold: number; minSilenceMs: number }) => {
      state.sttVadThreshold = Math.max(0.05, Math.min(0.95, threshold));
      state.sttMinSilenceMs = Math.max(250, Math.min(5000, Math.trunc(minSilenceMs)));
      persistSttVadThreshold(state.sttVadThreshold);
      persistSttMinSilenceMs(state.sttMinSilenceMs);
      if (state.sttRunning && clientRef) {
        await clientRef.sttStop({ correlationId: nextCorrelationId() });
        await clientRef.sttStart({
          correlationId: nextCorrelationId(),
          autoSubmit: state.sttAutoSubmit,
          vadThreshold: state.sttVadThreshold,
          minSilenceMs: state.sttMinSilenceMs
        });
      }
      await refreshSttStatus();
      await refreshSttModels();
      scheduleBatchedRender();
    },
    onSttSetModelPath: async (modelPath: string) => {
      if (!clientRef) return;
      const normalized = modelPath.trim();
      if (!normalized) return;
      try {
        await clientRef.sttSetModel({
          correlationId: nextCorrelationId(),
          modelPath: normalized
        });
        state.sttSelectedModelPath = normalized;
        await refreshSttStatus();
        await refreshSttModels();
      } catch (error) {
        state.sttDownloadMessage = `Failed to apply model: ${String(error)}`;
      }
      scheduleBatchedRender();
    },
    onSttDownloadModel: async ({ url, fileName }: { url: string; fileName?: string }) => {
      if (!clientRef) return;
      const normalizedUrl = url.trim();
      if (!normalizedUrl) return;
      state.sttDownloadBusy = true;
      state.sttDownloadMessage = "Downloading model...";
      scheduleBatchedRender();
      try {
        const response = await clientRef.sttDownloadModel({
          correlationId: nextCorrelationId(),
          url: normalizedUrl,
          fileName: fileName?.trim() || ""
        });
        state.sttSelectedModelPath = response.model.path;
        state.sttDownloadMessage = `Downloaded ${response.model.name}`;
        await refreshSttStatus();
        await refreshSttModels();
      } catch (error) {
        state.sttDownloadMessage = `Download failed: ${String(error)}`;
      } finally {
        state.sttDownloadBusy = false;
      }
      scheduleBatchedRender();
    },
    onSelectConversation: async (conversationId: string) => {
      await loadConversation(conversationId);
      state.sidebarTab = "chat";
      await refreshConversations();
      scheduleBatchedRender();
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
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    },
    onLlamaRuntimeRefresh: async () => {
      state.llamaRuntimeBusy = true;
      try {
        await refreshLlamaRuntime();
      } finally {
        state.llamaRuntimeBusy = false;
      }
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    },
    onLlamaRuntimeBrowseModelPath: async () => {
      const selectedPath = await browseModelPath();
      if (!selectedPath) return;
      state.llamaRuntimeModelPath = selectedPath;
      persistLlamaModelPath(selectedPath);
      scheduleBatchedRender();
    },
    onLlamaRuntimeSetMaxTokens: async (maxTokens: number | null) => {
      state.llamaRuntimeMaxTokens = maxTokens === null ? null : Math.max(128, Math.min(4096, maxTokens));
      persistLlamaMaxTokens(state.llamaRuntimeMaxTokens);
      scheduleBatchedRender();
    },
    onLlamaRuntimeClearLogs: async () => {
      state.llamaRuntimeLogs = [];
      scheduleBatchedRender();
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
      scheduleBatchedRender();
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
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    },
    onModelManagerSetQuery: async (query: string) => {
      state.modelManagerQuery = query.trim();
      scheduleBatchedRender();
    },
    onModelManagerSetCollection: async (collection: string) => {
      state.modelManagerCollection = collection.trim() || "unsloth_ud";
      if (state.modelManagerCollection === "unsloth_ud" && !state.modelManagerUnslothUdCatalog.length) {
        state.modelManagerMessage = "Loading Unsloth UD quant catalog...";
        await refreshModelManagerUnslothUdCatalog();
        state.modelManagerMessage = `Loaded ${state.modelManagerUnslothUdCatalog.length} UD model(s).`;
      }
      scheduleBatchedRender();
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
        scheduleBatchedRender();
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
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    },
    onModelManagerSetUdQuant: async ({ repoId, fileName }) => {
      state.modelManagerUnslothUdCatalog = state.modelManagerUnslothUdCatalog.map((row) =>
        row.repoId === repoId ? { ...row, selectedAssetFileName: fileName } : row
      );
      scheduleBatchedRender();
    },
    onModelManagerUseAsLlamaPath: async (modelPath: string) => {
      state.llamaRuntimeModelPath = modelPath;
      persistLlamaModelPath(modelPath);
      state.modelManagerMessage = `Selected model for llama.cpp: ${modelPath}`;
      scheduleBatchedRender();
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
      scheduleBatchedRender();
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
      scheduleBatchedRender();
    }
  });
}

function currentPrimaryPanelRenderState() {
  return {
    conversationId: state.conversationId,
    messages: state.messages,
    chatReasoningByCorrelation: state.chatReasoningByCorrelation,
    chatThinkingPlacementByCorrelation: state.chatThinkingPlacementByCorrelation,
    chatThinkingExpandedByCorrelation: state.chatThinkingExpandedByCorrelation,
    chatStreaming: state.chatStreaming,
    devices: state.devices,
    conversations: state.conversations,
    chatThinkingEnabled: state.chatThinkingEnabled,
    voiceModeEnabled: state.voiceModeEnabled,
    voiceModeBusy: state.voiceModeBusy,
    ttsEnabled: state.ttsEnabled,
    ttsBusy: state.ttsBusy,
    ttsLastError: state.ttsLastError,
    ttsEngineStatus: state.ttsEngineStatus,
    ttsVoices: state.ttsVoices,
    ttsSelectedVoice: state.ttsSelectedVoice,
    ttsLanguage: state.ttsLanguage,
    ttsSpeed: state.ttsSpeed,
    ttsChunkMaxChars: state.ttsChunkMaxChars,
    ttsChunkPauseMs: state.ttsChunkPauseMs,
    sttReady: state.sttReady,
    sttRunning: state.sttRunning,
    sttState: state.sttState,
    sttEngine: state.sttEngine,
    sttModelPath: state.sttModelPath,
    sttLastTranscript: state.sttLastTranscript,
    sttLastError: state.sttLastError,
    sttAutoSubmit: state.sttAutoSubmit,
    sttVadThreshold: state.sttVadThreshold,
    sttMinSilenceMs: state.sttMinSilenceMs,
    sttModels: state.sttModels,
    sttSelectedModelPath: state.sttSelectedModelPath,
    sttDownloadBusy: state.sttDownloadBusy,
    sttDownloadMessage: state.sttDownloadMessage,
    sttConsoleLines: state.sttConsoleLines,
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
    modelManagerUnslothUdLoading: state.modelManagerUnslothUdLoading
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
    scheduleBatchedRender();
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
      scheduleBatchedRender();
    };
  }
  const layoutToggle = document.querySelector<HTMLButtonElement>("#layoutOrientationToggle");
  if (layoutToggle) {
    layoutToggle.onclick = () => {
      state.layoutOrientation =
        state.layoutOrientation === "landscape" ? "portrait" : "landscape";
      scheduleBatchedRender();
    };
  }

  const micEnableBtn = document.querySelector<HTMLButtonElement>("#micPermissionEnableBtn");
  if (micEnableBtn) {
    micEnableBtn.onclick = async () => {
      state.micPermissionBubbleDismissed = false;
      persistMicBubbleDismissed(false);
      await requestMicrophoneAccess();
      scheduleBatchedRender();
    };
  }

  const micDismissBtn = document.querySelector<HTMLButtonElement>("#micPermissionDismissBtn");
  if (micDismissBtn) {
    micDismissBtn.onclick = () => {
      state.micPermissionBubbleDismissed = true;
      persistMicBubbleDismissed(true);
      scheduleBatchedRender();
    };
  }
}

function attachSidebarInteractions(sendMessage: (text: string) => Promise<void>): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[data-sidebar-tab]");

  tabs.forEach((tab) => {
    tab.onclick = async () => {
      const nextTab = tab.dataset.sidebarTab as SidebarTab | undefined;
      if (!nextTab) return;
      pushConsoleEntry("debug", "browser", `Sidebar click -> ${nextTab}`);
      state.sidebarTab = nextTab;
      if (nextTab === "stt") {
        try {
          await refreshSttStatus();
          await refreshSttModels();
        } catch (error) {
          pushConsoleEntry("warn", "browser", `STT tab pre-refresh failed: ${String(error)}`);
        }
      }
      if (nextTab === "llama_cpp") {
        await refreshLlamaRuntime();
      }
      try {
        scheduleBatchedRender();
      } catch (error) {
        pushConsoleEntry("error", "browser", `Tab render failed for ${nextTab}: ${String(error)}`);
      }
    };
  });
}

function attachWorkspaceInteractions(sendMessage: (text: string) => Promise<void>): void {
  attachWorkspacePaneInteractions(async (tab) => {
    state.workspaceTab = tab;
    if (tab === "terminal") {
      await ensureTerminalSession();
    }
    if (tab === "tools") {
      await refreshTools();
    }
    scheduleBatchedRender();
  });

  const tabButtons = document.querySelectorAll<HTMLButtonElement>("[data-terminal-session-id]");
  tabButtons.forEach((button) => {
    button.onclick = () => {
      const sessionId = button.dataset.terminalSessionId;
      if (!sessionId) return;
      state.activeTerminalSessionId = sessionId;
      scheduleBatchedRender();
    };
  });

  const closeButtons = document.querySelectorAll<HTMLElement>("[data-terminal-close-session-id]");
  closeButtons.forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = button.dataset.terminalCloseSessionId;
      if (!sessionId) return;
      await terminalManager.closeSession(sessionId);
      const remaining = terminalManager.listSessions();
      state.activeTerminalSessionId = remaining[0]?.sessionId ?? null;
      scheduleBatchedRender();
    };
  });

  const actionButtons = document.querySelectorAll<HTMLButtonElement>("[data-terminal-action]");
  const shellSelect = document.querySelector<HTMLSelectElement>("#terminalShellSelect");
  actionButtons.forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.terminalAction;
      if (!action) return;
      if (action === "new") {
        const shellProfile = shellSelect?.value ?? "default";
        const shell = shellProfileToCommand(shellProfile);
        const session = await terminalManager.createSession(
          shell ? { shell } : undefined
        );
        state.activeTerminalSessionId = session.sessionId;
        scheduleBatchedRender();
        return;
      }
      if (!state.activeTerminalSessionId) return;
    };
  });

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
        scheduleBatchedRender();
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
      scheduleBatchedRender();
    };
  }

  const saveConsoleBtn = document.querySelector<HTMLButtonElement>("#saveConsoleBtn");
  if (saveConsoleBtn) {
    saveConsoleBtn.onclick = () => {
      const text = buildConsoleCopyText();
      if (!text) {
        pushConsoleEntry("info", "browser", "Console is empty; nothing to save.");
        scheduleBatchedRender();
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
      scheduleBatchedRender();
    };
  }

  if (state.workspaceTab === "tools") {
    bindWorkspaceToolsPanel(
      async () => {
        await refreshTools();
        scheduleBatchedRender();
      },
      async (toolId, enabled) => {
        if (!clientRef) return;
        await clientRef.setWorkspaceToolEnabled({
          toolId,
          enabled,
          correlationId: nextCorrelationId()
        });
        await refreshTools();
        scheduleBatchedRender();
      }
    );
  }
}

async function ensureTerminalSession(): Promise<void> {
  if (state.activeTerminalSessionId) return;
  const sessions = terminalManager.listSessions();
  const first = sessions.at(0);
  if (first) {
    state.activeTerminalSessionId = first.sessionId;
    return;
  }
  const shell = shellProfileToCommand("default");
  const session = await terminalManager.createSession(shell ? { shell } : undefined);
  state.activeTerminalSessionId = session.sessionId;
}

function shellProfileToCommand(profile: string): string | undefined {
  if (profile === "bash") return "bash";
  if (profile === "zsh") return "zsh";
  if (profile === "powershell") return "powershell.exe";
  return undefined;
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
  await refreshDevicesState();
  await refreshTtsEngineStatus();
  await refreshTtsVoices();
  await refreshSttStatus();
  await refreshSttModels();
  await refreshLlamaRuntime();
  await refreshModelManagerInstalled();
  if (state.modelManagerCollection === "unsloth_ud") {
    await refreshModelManagerUnslothUdCatalog();
  }
  if (state.voiceModeEnabled) {
    await enableVoiceMode();
  }
  await autoStartLlamaRuntimeIfConfigured();
  await loadConversation(state.conversationId);

  window.addEventListener("beforeunload", () => {
    void terminalManager.closeAll();
  });
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void refreshDevicesState().then(() => scheduleBatchedRender());
    });
  }

  client.onEvent((event) => {
    if (
      !event.action.startsWith("llama.runtime") &&
      !isNoisyRuntimeStatusEvent(event) &&
      !isNoisySttEvent(event) &&
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
        // Use batched render instead of direct render
        scheduleBatchedRender();
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
        // Use batched render for runtime status changes
        void refreshLlamaRuntime().then(() => scheduleBatchedRender());
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

    if (event.action.startsWith("stt.")) {
      if (!isNoisySttEvent(event)) {
        const line = `[${event.stage}] ${event.action} ${safePayloadPreview(event.payload)}`;
        state.sttConsoleLines.push(line);
        if (state.sttConsoleLines.length > 200) {
          state.sttConsoleLines.splice(0, state.sttConsoleLines.length - 200);
        }
      }
      if (event.action === "stt.capture.start" && event.stage === "start") {
        state.sttRunning = true;
        state.sttState = "listening";
        if (state.ttsEnabled) {
          state.voiceModeEnabled = true;
          persistVoiceModeEnabled(true);
        }
      } else if (
        event.action === "stt.capture.complete" &&
        (event.stage === "complete" || event.stage === "error")
      ) {
        state.sttRunning = false;
        state.sttState = "idle";
        if (state.voiceModeEnabled) {
          state.voiceModeEnabled = false;
          persistVoiceModeEnabled(false);
        }
      } else if (event.action === "stt.capture.error" || event.action === "stt.transcribe.error") {
        state.sttLastError = safePayloadPreview(event.payload);
      } else if (event.action === "stt.transcribe.start") {
        state.sttState = "transcribing";
      } else if (event.action === "stt.transcribe.complete") {
        state.sttState = "listening";
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

    if (event.action === "stt.transcript.final") {
      const transcript = parseSttTranscriptFinal(event.payload);
      if (transcript) {
        const normalized = normalizeChatText(transcript.text);
        state.sttLastTranscript = normalized;
        if (normalized && transcript.autoSubmit) {
          const input = document.querySelector<HTMLTextAreaElement>("#msg");
          if (input) {
            input.value = normalized;
          }
          if (!state.chatStreaming) {
            void sendMessage(normalized);
            return;
          }
        }
      }
    } else if (event.action === "stt.transcript.partial") {
      const partial = parseSttTranscriptPartial(event.payload);
      if (partial) {
        const normalized = normalizeChatText(partial.text);
        if (normalized && !state.chatStreaming) {
          const input = document.querySelector<HTMLTextAreaElement>("#msg");
          if (input) {
            input.value = normalized;
          }
        }
      }
    }

    // Use batched render instead of direct render to reduce flickering
    scheduleBatchedRender();
  });

  async function sendMessage(text: string): Promise<void> {
    if (!clientRef) return;

    const correlationId = nextCorrelationId();
    const normalizedUserText = normalizeChatText(text);
    state.messages.push({ role: "user", text: normalizedUserText });
    state.chatStreaming = true;
    state.activeChatCorrelationId = correlationId;
    scheduleBatchedRender();

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

      if (state.ttsEnabled) {
        await speakAssistantText(response.assistantMessage);
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
      scheduleBatchedRender();
    }
  }

  scheduleBatchedRender();
  // Store reference for batched renders
  sendMessageRef = sendMessage;
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
