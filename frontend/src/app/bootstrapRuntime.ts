import type { ChatIpcClient } from "../ipcClient";
import { normalizeVersionLabel } from "../version";

export type TauriWindowHandle = {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
  startDragging: () => Promise<void>;
};

interface BootstrapRuntimeState {
  runtimeMode: string;
  appVersion: string;
  stt: {
    backend: string;
    availableModels: string[];
    selectedModel: string;
  };
}

interface BootstrapRuntimeDeps {
  client: ChatIpcClient;
  runtimeMode: string;
  state: BootstrapRuntimeState;
  fallbackAppVersion: string;
  persistSttBackend: (backend: "whisper_cpp" | "sherpa_onnx") => void;
  persistSttModel: (model: string) => void;
}

export async function syncBootstrapRuntime(
  deps: BootstrapRuntimeDeps
): Promise<TauriWindowHandle | null> {
  let tauriWindowHandle: TauriWindowHandle | null = null;
  deps.state.runtimeMode = deps.runtimeMode;

  if (deps.runtimeMode === "tauri") {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      tauriWindowHandle = getCurrentWindow() as TauriWindowHandle;
      const { invoke } = await import("@tauri-apps/api/core");
      const backend = await invoke<string>("stt_get_backend");
      if (backend === "whisper_cpp" || backend === "sherpa_onnx") {
        deps.state.stt.backend = backend;
        deps.persistSttBackend(backend);
      }
      const models = await invoke<string[]>("stt_list_models");
      deps.state.stt.availableModels = Array.isArray(models) && models.length > 0 ? models : ["auto"];
      if (!deps.state.stt.availableModels.includes(deps.state.stt.selectedModel)) {
        deps.state.stt.selectedModel = deps.state.stt.availableModels[0] ?? "auto";
        deps.persistSttModel(deps.state.stt.selectedModel);
      }
    } catch {
      // Ignore backend sync failures and keep local preference.
    }
  }

  try {
    const version = (await deps.client.getAppVersion()).version.trim();
    if (version) {
      deps.state.appVersion = normalizeVersionLabel(version);
    }
  } catch {
    deps.state.appVersion = deps.fallbackAppVersion;
  }

  return tauriWindowHandle;
}
