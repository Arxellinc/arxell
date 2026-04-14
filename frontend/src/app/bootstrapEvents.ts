import type { AppEvent } from "../contracts";

interface TauriSttListenerState {
  events: AppEvent[];
  stt: {
    status: string;
    message: string | null;
    isSpeaking: boolean;
  };
}

export async function installTauriSttListeners(deps: {
  runtimeMode: string;
  state: TauriSttListenerState;
  sttPipelineErrorUnlisten: (() => void) | null;
  sttVadUnlisten: (() => void) | null;
  setSttPipelineErrorUnlisten: (value: (() => void) | null) => void;
  setSttVadUnlisten: (value: (() => void) | null) => void;
  nextCorrelationId: () => string;
  pushConsoleEntry: (
    level: "log" | "info" | "warn" | "error" | "debug",
    source: "browser" | "app",
    message: string
  ) => void;
  rerender: () => void;
  onVadSpeakingChanged: (isSpeaking: boolean) => void;
}): Promise<void> {
  if (deps.runtimeMode === "tauri" && !deps.sttPipelineErrorUnlisten) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{
      source?: string;
      message?: string;
      details?: string | null;
    }>("pipeline://error", (event) => {
      const source = event.payload.source?.trim() || "unknown";
      const message = event.payload.message?.trim() || "Pipeline error";
      const details = typeof event.payload.details === "string" ? event.payload.details.trim() : "";
      const detailsText = details ? ` details=${details}` : "";
      deps.pushConsoleEntry("error", "app", `[${source}] pipeline.error ${message}${detailsText}`);
      const syntheticEvent: AppEvent = {
        timestampMs: Date.now(),
        correlationId: deps.nextCorrelationId(),
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
      deps.state.events.push(syntheticEvent);
      if (source === "stt") {
        deps.state.stt.status = "error";
        deps.state.stt.message = message;
      }
      deps.rerender();
    });
    deps.setSttPipelineErrorUnlisten(unlisten);
  }

  if (deps.runtimeMode === "tauri" && !deps.sttVadUnlisten) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{ is_speaking?: boolean }>("stt://vad", (event) => {
      const isSpeaking = event.payload?.is_speaking === true;
      if (deps.state.stt.isSpeaking !== isSpeaking) {
        deps.state.stt.isSpeaking = isSpeaking;
        deps.onVadSpeakingChanged(isSpeaking);
        deps.pushConsoleEntry("debug", "browser", "STT backend VAD: " + (isSpeaking ? "speaking" : "silence"));
        deps.rerender();
      }
    });
    deps.setSttVadUnlisten(unlisten);
  }
}

export function registerClientEventBridge(deps: {
  client: { onEvent: (handler: (event: AppEvent) => void) => void };
  handleCoreEvent: (event: AppEvent) => boolean;
  handleChatEvent: (event: AppEvent) => void;
}): void {
  deps.client.onEvent((event) => {
    const handled = deps.handleCoreEvent(event);
    if (handled) return;
    deps.handleChatEvent(event);
  });
}
