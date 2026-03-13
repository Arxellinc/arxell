import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ModelConfig,
  modelListAll,
  modelsList,
  settingsGetAll,
  settingsSet,
} from "../../lib/tauri";
import type { ServeState } from "../../types/model";
import { useServeStore } from "../../store/serveStore";
import { useToolPanelStore } from "../../store/toolPanelStore";

interface ModelStatusProps {
  onSettingsChange?: () => void;
}

function formatParameterLabel(parameterCount: number | null | undefined): string | null {
  if (typeof parameterCount !== "number" || !Number.isFinite(parameterCount) || parameterCount <= 0) {
    return null;
  }
  if (parameterCount >= 1e12) return `${(parameterCount / 1e12).toFixed(1).replace(/\.0$/, "")}T`;
  if (parameterCount >= 1e9) return `${(parameterCount / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (parameterCount >= 1e6) return `${(parameterCount / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(parameterCount).toLocaleString()}`;
}

function parseParameterLabelFromName(name: string): string | null {
  const match = /(\d+(?:\.\d+)?)\s*([TtBbMm])\b/.exec(name);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `${num.toString().replace(/\.0$/, "")}${match[2].toUpperCase()}`;
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <div
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        active ? "bg-accent-green" : "bg-line-dark"
      }`}
    />
  );
}

export function ModelStatus({ onSettingsChange }: ModelStatusProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [savedModelConfigs, setSavedModelConfigs] = useState<ModelConfig[]>([]);
  const [runtimeModelName, setRuntimeModelName] = useState<string>("");
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const { availableModels, modelInfo, fetchAvailableModels } = useServeStore();
  const setPanel = useToolPanelStore((s) => s.setPanel);

  const refreshStatusState = useCallback(async (includeRemoteProbe: boolean) => {
    try {
      const [allSettings, saved] = await Promise.all([
        settingsGetAll(),
        modelListAll(),
      ]);
      setSettings(allSettings);
      setSavedModelConfigs(saved);
      const serveState = await invoke<ServeState>("cmd_get_serve_state");
      setRuntimeLoaded(Boolean(serveState.isLoaded));
      setRuntimeModelName((serveState.modelInfo?.name ?? "").trim());
    } catch (e) {
      console.error("Failed to refresh model settings:", e);
    }

    if (!includeRemoteProbe) return;
    try {
      const list = await modelsList();
      setRemoteModels(list.map((m) => m.trim()).filter(Boolean));
    } catch {
      setRemoteModels([]);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        await refreshStatusState(true);
      } catch (e) {
        console.error("Failed to load model settings:", e);
      }

      try {
        await fetchAvailableModels();
      } catch (e) {
        console.error("Failed to fetch local available models:", e);
      }
    };

    void load();
  }, [fetchAvailableModels, refreshStatusState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshStatusState(false);
    }, 1500);
    const onFocus = () => {
      void refreshStatusState(true);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshStatusState]);

  useEffect(() => {
    if (!modelInfo?.name) return;
    if ((settings["model"] ?? "").trim()) return;
    const localName = modelInfo.name.trim();
    setSettings((prev) => ({ ...prev, model: localName }));
    settingsSet("model", localName).catch((e) => {
      console.error("Failed to default model to local runtime model:", e);
    });
  }, [modelInfo?.name, settings]);

  const savedModelNames = useMemo(
    () =>
      savedModelConfigs
        .flatMap((m) => [m.model_id, m.name])
        .map((m) => m.trim())
        .filter(Boolean),
    [savedModelConfigs]
  );

  const options = useMemo(() => {
    return Array.from(
      new Set([
        ...remoteModels,
        ...savedModelNames,
        ...availableModels.map((m) => m.name),
        ...(modelInfo?.name ? [modelInfo.name] : []),
      ])
    );
  }, [availableModels, modelInfo?.name, remoteModels, savedModelNames]);

  const llmSource = (settings["primary_llm_source"] ?? "").trim().toLowerCase();
  const preferApi = llmSource === "api";
  const selectedModel = (preferApi
    ? settings["model"]
    : runtimeLoaded
    ? runtimeModelName
    : "") || "";

  const apiModelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of remoteModels) {
      const k = m.trim().toLowerCase();
      if (k) keys.add(k);
    }
    for (const cfg of savedModelConfigs) {
      const id = cfg.model_id.trim().toLowerCase();
      const name = cfg.name.trim().toLowerCase();
      if (id) keys.add(id);
      if (name) keys.add(name);
    }
    return keys;
  }, [remoteModels, savedModelConfigs]);

  const availableApiModelKeys = useMemo(() => {
    const keys = new Set<string>();
    // modelsList() returns models currently available from the active API endpoint
    for (const m of remoteModels) {
      const k = m.trim().toLowerCase();
      if (k) keys.add(k);
    }
    // Saved model configs may carry last availability checks
    for (const cfg of savedModelConfigs) {
      if (!cfg.last_available) continue;
      const id = cfg.model_id.trim().toLowerCase();
      const name = cfg.name.trim().toLowerCase();
      if (id) keys.add(id);
      if (name) keys.add(name);
    }
    return keys;
  }, [remoteModels, savedModelConfigs]);

  const verifiedApiModelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cfg of savedModelConfigs) {
      const hasConnection =
        cfg.base_url.trim().length > 0 &&
        cfg.model_id.trim().length > 0 &&
        cfg.api_key.trim().length > 0;
      const isVerified = cfg.last_available && cfg.last_check_at !== null;
      if (!hasConnection || !isVerified) continue;

      const id = cfg.model_id.trim().toLowerCase();
      const name = cfg.name.trim().toLowerCase();
      if (id) keys.add(id);
      if (name) keys.add(name);
    }
    return keys;
  }, [savedModelConfigs]);

  const availableModelOptions = useMemo(
    () =>
      options.filter((model) => {
        const key = model.trim().toLowerCase();
        return key.length > 0 && verifiedApiModelKeys.has(key);
      }),
    [options, verifiedApiModelKeys]
  );

  const isApiModel = (modelName: string): boolean => {
    const key = modelName.trim().toLowerCase();
    return key.length > 0 && apiModelKeys.has(key);
  };

  const isApiModelAvailable = (modelName: string): boolean => {
    const key = modelName.trim().toLowerCase();
    return key.length > 0 && availableApiModelKeys.has(key);
  };

  const displayModelTitle = (modelName: string): string =>
    isApiModel(modelName) ? `${modelName} (API)` : modelName;

  const statusIsActive = preferApi ? Boolean(selectedModel) : Boolean(runtimeLoaded);

  const getModelParameterLabel = (modelName: string): string | null => {
    const wanted = modelName.trim().toLowerCase();
    if (!wanted) return null;

    if (modelInfo?.name?.trim().toLowerCase() === wanted) {
      const fromLoaded = formatParameterLabel(modelInfo.parameterCount);
      if (fromLoaded) return fromLoaded;
    }

    const saved = savedModelConfigs.find((m) => {
      const id = m.model_id.trim().toLowerCase();
      const name = m.name.trim().toLowerCase();
      return id === wanted || name === wanted;
    });
    const fromSaved = formatParameterLabel(saved?.parameter_count);
    if (fromSaved) return fromSaved;

    return parseParameterLabelFromName(modelName);
  };

  const handleSelectModel = async (value: string) => {
    setSettings((prev) => ({ ...prev, model: value }));
    try {
      await settingsSet("model", value);
      onSettingsChange?.();
    } catch (e) {
      console.error("Failed to update selected model:", e);
    }
  };

  return (
    <div className="px-3 pb-3">
      <div className="space-y-1.5 border-b border-line-med pb-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-normal uppercase tracking-wide text-text-dark">Current Model</div>
          <button
            type="button"
            onClick={() => setPanel("serve")}
            className="inline-flex items-center justify-center rounded p-1 text-text-dark hover:text-text-norm hover:bg-line-light transition-colors"
            title="Open Model Server"
            aria-label="Open Model Server"
          >
            <Settings2 size={10} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 py-1">
          <StatusDot active={statusIsActive} />
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <span className="text-[11px] font-normal text-text-norm truncate">
              {selectedModel ? displayModelTitle(selectedModel) : "No model selected"}
            </span>
            {selectedModel && (
              <span className="text-[10px] text-text-dark tabular-nums">
                {getModelParameterLabel(selectedModel) ?? "—"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="pt-2">
        <div className="text-[10px] font-normal uppercase tracking-wide text-text-dark mb-1">Available Models</div>
        {availableModelOptions.length > 0 ? (
          <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-0.5">
            {availableModelOptions.map((model) => {
              const isSelected = model === selectedModel;
              const apiAvailable = isApiModel(model) && isApiModelAvailable(model);
              return (
                <button
                  key={model}
                  type="button"
                  className={`w-full flex items-center gap-2 px-1 py-1 rounded text-left transition-colors ${
                    isSelected
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "text-text-med hover:text-text-norm hover:bg-line-light"
                  }`}
                  onClick={() => void handleSelectModel(model)}
                  title={model}
                >
                  <StatusDot active={isSelected || apiAvailable} />
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-normal truncate">{displayModelTitle(model)}</span>
                    <span className="text-[10px] text-text-dark tabular-nums flex-shrink-0">
                      {getModelParameterLabel(model) ?? "—"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-1 py-1 text-[11px] font-normal text-text-dark">No models available</div>
        )}
      </div>
    </div>
  );
}
