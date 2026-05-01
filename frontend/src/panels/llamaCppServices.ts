import type { ChatIpcClient } from "../ipcClient";
import {
  getMissingBundleWarning,
  selectPreferredLlamaEngineId,
  shouldClearActiveModelPath
} from "./llamaCppRuntime";
import type { LlamaStateSlice } from "./llamaCppController";

export async function refreshLlamaRuntimeState(
  state: LlamaStateSlice,
  clientRef: ChatIpcClient | null,
  nextCorrelationId: () => string,
  warnedMissingBundleEngineId: string | null,
  pushConsoleEntry: (level: "warn" | "error" | "info", source: "browser", line: string) => void,
  refreshChatModelProfile: () => void
): Promise<string | null> {
  if (!clientRef) return warnedMissingBundleEngineId;
  const response = await clientRef.getLlamaRuntimeStatus({ correlationId: nextCorrelationId() });
  state.llamaRuntime = response;
  const previousSelectedEngineId = state.llamaRuntimeSelectedEngineId;
  if (shouldClearActiveModelPath(response)) {
    state.llamaRuntimeActiveModelPath = "";
  } else {
    state.llamaRuntimeActiveModelPath = response.activeModelPath?.trim() || state.llamaRuntimeActiveModelPath;
  }

  state.llamaRuntimeSelectedEngineId = selectPreferredLlamaEngineId(
    response,
    state.llamaRuntimeSelectedEngineId
  );
  if (state.llamaRuntimeSelectedEngineId !== previousSelectedEngineId) {
    try {
      window.localStorage.setItem("arxell.llama.engineId", state.llamaRuntimeSelectedEngineId);
    } catch {}
  }

  const warningState = getMissingBundleWarning(
    response,
    state.llamaRuntimeSelectedEngineId,
    warnedMissingBundleEngineId
  );
  if (warningState.warning) {
    pushConsoleEntry("warn", "browser", warningState.warning);
  }
  refreshChatModelProfile();
  return warningState.nextWarnedEngineId;
}

export async function browseLlamaModelPath(
  runtimeMode: "tauri" | "web",
  currentValue: string,
  pushConsoleEntry: (level: "warn" | "error" | "info", source: "browser", line: string) => void
): Promise<string | null> {
  if (runtimeMode === "tauri") {
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
